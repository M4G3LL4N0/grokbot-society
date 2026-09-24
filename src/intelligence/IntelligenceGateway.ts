import type { Clock } from "../god/clock.ts";
import type { IntelligenceConfig, ModelClass } from "../god/config.ts";
import type { CacheService } from "../cache";
import type { TelemetryService } from "../telemetry";
import { estimateCost, estimateTokens } from "../telemetry/TelemetryService.ts";
import { BudgetGovernor } from "../budget/BudgetGovernor.ts";
import { ModelRouter } from "./ModelRouter.ts";
import {
  gatewayDiary,
  type OutputShape,
  type Provider,
  type ProviderResult,
} from "../providers/types.ts";
import type { GenerationResult } from "../god/types.ts";
import { KillSwitchError, ModelUnavailableError } from "../god/errors.ts";
import { CacheService as CacheImpl } from "../cache/CacheService.ts";

export interface GenerationRequest {
  eventId: string;
  caller: string;
  reason: string;
  reasonKind?: "foreground" | "background";
  modelClass: ModelClass;
  shape?: OutputShape;
  context: string[];
  /** Dependency labels for cache invalidation (e.g. person ids). */
  cacheDeps?: string[];
  skipCache?: boolean;
}

interface CachedGeneration {
  provider: string;
  model: string;
  modelClass: ModelClass;
  content: string;
  usage: { inputTokens: number; outputTokens: number };
  cost: number;
}

/**
 * IntelligenceGateway — the ONE approved path for paid/model inference.
 *
 * All providers route through here. No module may call a provider directly
 * (providers enforce the gateway context and throw otherwise). Records every
 * call: eventId, reason, caller, people/circle via event, provider, model,
 * modelClass, input/output size, estimated cost, usage, duration, cache status.
 */
export class IntelligenceGateway {
  private readonly providers = new Map<string, Provider>();
  private readonly cache: CacheImpl;
  private readonly telemetry: TelemetryService;
  private readonly governor: BudgetGovernor;
  readonly router: ModelRouter;
  private readonly clock: Clock;
  private readonly config: IntelligenceConfig;

  constructor(deps: {
    config: IntelligenceConfig;
    clock: Clock;
    cache: CacheService;
    telemetry: TelemetryService;
    budget: BudgetGovernor;
    router: ModelRouter;
  }) {
    this.config = deps.config;
    this.clock = deps.clock;
    this.cache = deps.cache;
    this.telemetry = deps.telemetry;
    this.governor = deps.budget;
    this.router = deps.router;
  }

  getConfig(): IntelligenceConfig {
    return this.config;
  }

  getBudget(): BudgetGovernor {
    return this.governor;
  }

  register(provider: Provider): void {
    this.providers.set(provider.name, provider);
  }

  /**
   * The single accounting boundary for an EXTERNAL inference whose transport
   * lives outside this process (the God GrokBot). It books the call into the
   * same budget + telemetry ledger as every other inference, so external work
   * can never be invisible to cost accounting.
   *
   * `providerCallRecorded` is false for dry runs: the pipeline is proven without
   * inventing a provider call that never happened.
   */
  acceptExternalResult(input: {
    eventId: string;
    reason: string;
    caller: string;
    provider: string;
    model: string;
    modelClass: ModelClass;
    inputTokens: number;
    outputTokens: number;
    estimatedCost: number;
    providerCallRecorded: boolean;
  }): { booked: boolean; cost: number } {
    if (!input.providerCallRecorded) {
      return { booked: false, cost: 0 };
    }
    this.telemetry.record(
      {
        eventId: input.eventId,
        reason: input.reason,
        caller: input.caller,
        provider: input.provider,
        model: input.model,
        modelClass: input.modelClass,
        inputSize: input.inputTokens,
        outputSize: input.outputTokens,
        estimatedCost: input.estimatedCost,
        durationMs: 0,
        cacheStatus: "miss",
      },
      "foreground",
    );
    return { booked: true, cost: input.estimatedCost };
  }

  getProvider(name: string): Provider | undefined {
    return this.providers.get(name);
  }

  async generate(request: GenerationRequest): Promise<GenerationResult> {
    if (this.config.killSwitch) {
      this.governor.countBlocked("killSwitch");
      throw new KillSwitchError();
    }

    const modelClass = request.modelClass;
    const shape = request.shape ?? "scene";
    const reasonKind = request.reasonKind ?? "foreground";

    // ---------------------------------------------------------------- cache
    const route = this.router.route(modelClass);
    const cacheKey = CacheImpl.contentHash([
      modelClass,
      shape,
      `${route.provider}:${route.model}`,
      ...request.context,
    ]);

    if (!request.skipCache) {
      const cached = this.cache.get<CachedGeneration>(cacheKey);
      if (cached) {
        this.recordTelemetry(
          { ...request, route, cacheStatus: "hit" },
          {
            inputTokens: request.context.reduce((n, s) => n + estimateTokens(s), 0),
            outputTokens: cached.usage.outputTokens,
            cost: 0,
            durationMs: 0,
            provider: cached.provider,
            model: cached.model,
          },
          cached.content,
          reasonKind,
        );
        return {
          provider: cached.provider,
          model: cached.model,
          modelClass: cached.modelClass,
          content: cached.content,
          usage: cached.usage,
          cost: 0,
          durationMs: 0,
          cacheStatus: "hit",
        };
      }
    }

    // ---------------------------------------------------------------- route
    const provider = this.providers.get(route.provider);
    if (!provider || !provider.isAvailable()) {
      throw new ModelUnavailableError(
        `Provider "${route.provider}" for capability ${modelClass} is not registered/available.`,
      );
    }

    // ---------------------------------------------------------------- budget
    const inputTokens = request.context.reduce((n, s) => n + estimateTokens(s), 0);
    const outputTokens = estimateTokens("scene-output-2k");
    const estCost = estimateCost(
      modelClass,
      inputTokens,
      outputTokens,
      this.config.costPer1kOutputTokens,
    );
    const allowance = this.governor.reserve({
      eventId: request.eventId,
      reason: request.reason,
      reasonKind,
      modelClass,
      estimatedInputTokens: inputTokens,
      estimatedOutputTokens: outputTokens,
      estimatedCost: estCost,
    });

    // ---------------------------------------------------------------- call
    try {
      const started = this.clock.now();
      const result: ProviderResult = await gatewayDiary.run(
        {
          caller: request.caller,
          eventId: request.eventId,
          reason: request.reason,
        },
        () =>
          provider.generate({
            modelClass,
            shape,
            context: request.context,
          }),
      );
      const durationMs = this.clock.now() - started;

      const cachedPayload: CachedGeneration = {
        provider: result.provider,
        model: result.model,
        modelClass,
        content: result.content,
        usage: result.usage,
        cost: result.cost,
      };
      if (!request.skipCache) {
        this.cache.set(cacheKey, cachedPayload, request.cacheDeps ?? []);
      }
      this.recordTelemetry(
        { ...request, route, cacheStatus: "miss" },
        {
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          cost: result.cost,
          durationMs,
          provider: result.provider,
          model: result.model,
        },
        result.content,
        reasonKind,
      );
      return {
        provider: result.provider,
        model: result.model,
        modelClass,
        content: result.content,
        usage: result.usage,
        cost: result.cost,
        durationMs,
        cacheStatus: "miss",
      };
    } finally {
      allowance.release();
    }
  }

  private recordTelemetry(
    req: GenerationRequest & { route: { provider: string; model: string }; cacheStatus: "hit" | "miss" },
    usage: {
      inputTokens: number;
      outputTokens: number;
      cost: number;
      durationMs: number;
      provider: string;
      model: string;
    },
    content: string,
    reasonKind: "foreground" | "background",
  ): void {
    this.telemetry.record(
      {
        eventId: req.eventId,
        reason: req.reason,
        caller: req.caller,
        provider: usage.provider,
        model: usage.model,
        modelClass: req.modelClass,
        inputSize: usage.inputTokens,
        outputSize: usage.outputTokens,
        estimatedCost: usage.cost,
        durationMs: usage.durationMs,
        cacheStatus: req.cacheStatus,
      },
      reasonKind,
    );
  }
}