import type { BudgetLimits, ModelClass, ModelTier } from "../god/config.ts";
import type { TelemetryService } from "../telemetry";
import type { Clock } from "../god/clock.ts";
import {
  BudgetExceededError,
  KillSwitchError,
  ModelUnavailableError,
  RecursionBlockedError,
} from "../god/errors.ts";

const TIER_RANK: Record<ModelTier, number> = {
  mock: 0,
  nano: 1,
  standard: 2,
  deep: 3,
};

export interface ReserveOptions {
  eventId: string;
  reason: string;
  reasonKind: "foreground" | "background";
  modelClass: ModelClass;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedCost: number;
}

export interface Allowance {
  eventId: string;
  release: () => void;
}

const MOCK_CLASSES: ModelClass[] = [
  "social.deterministic",
  "social.mock",
];

/**
 * BudgetGovernor enforces hard limits and FAILS CLOSED. Order of checks:
 * kill switch → budget floors → recursion guard → tier gate. Anything not
 * allowed throws; callers drop to deterministic operation. The governor is
 * deliberately injected with nothing but config + telemetry so budget rules
 * cannot be bypassed by provider implementations.
 */
export class BudgetGovernor {
  private inFlight = new Set<string>();
  private backgroundCallsUsed = 0;
  private blockedCount = 0;
  private readonly killSwitchRef: () => boolean;

  constructor(
    private readonly limits: BudgetLimits,
    private readonly telemetry: TelemetryService,
    private readonly clock: Clock,
    killSwitch: () => boolean = () => false,
  ) {
    this.killSwitchRef = killSwitch;
  }

  get config(): BudgetLimits {
    return this.limits;
  }

  blockedCallCount(): number {
    return this.blockedCount;
  }

  /** Count a pre-budget refusal (e.g. active kill switch) as a blocked call. */
  countBlocked(reason: string): void {
    this.blockedCount += 1;
    void reason;
  }

  /** Non-consuming preflight: would this reserve be allowed right now? */
  canReserve(opts: Omit<ReserveOptions, "estimatedCost">): boolean {
    try {
      this.check({ estimatedCost: 0, ...opts });
      return true;
    } catch {
      return false;
    }
  }

  reserve(opts: ReserveOptions): Allowance {
    this.check(opts);

    if (opts.reasonKind === "background") {
      this.backgroundCallsUsed += 1;
    }
    const eventKey = `${opts.eventId}:${opts.reason}`;
    this.inFlight.add(eventKey);
    let released = false;
    const allowance: Allowance = {
      eventId: opts.eventId,
      release: () => {
        if (!released) {
          released = true;
          this.inFlight.delete(eventKey);
        }
      },
    };
    return allowance;
  }

  private check(opts: ReserveOptions): void {
    if (this.killSwitchRef()) {
      this.blockedCount += 1;
      throw new KillSwitchError();
    }

    // Recursion guard: at most `recursionDepth` in-flight inferences per event
    // chain. Default recursionDepth = 0 => recursion is impossible.
    const eventKey = `${opts.eventId}:${opts.reason}`;
    if (this.inFlight.has(eventKey)) {
      this.blockedCount += 1;
      throw new RecursionBlockedError();
    }

    // Per-event hard call count. APPLIES TO EVERY PROVIDER (mock included).
    const callsForEvent = this.telemetry.providerCallsForEvent(opts.eventId);
    if (callsForEvent >= this.limits.maxCallsPerEvent) {
      this.blockedCount += 1;
      throw new BudgetExceededError(
        `Budget reached: max_calls_per_event=${this.limits.maxCallsPerEvent} for event ${opts.eventId}.`,
        { limit: "maxCallsPerEvent", value: callsForEvent },
      );
    }

    // Background model call ceiling (default 0).
    if (
      opts.reasonKind === "background" &&
      this.backgroundCallsUsed >= this.limits.backgroundModelCalls
    ) {
      this.blockedCount += 1;
      throw new BudgetExceededError(
        `Budget reached: background model calls ceiling (${this.limits.backgroundModelCalls}).`,
        { limit: "backgroundModelCalls" },
      );
    }

    // Token ceilings per call.
    if (opts.estimatedInputTokens > this.limits.maxInputTokensPerCall) {
      this.blockedCount += 1;
      throw new BudgetExceededError(
        `Input tokens ${opts.estimatedInputTokens} exceed limit ${this.limits.maxInputTokensPerCall}.`,
        { limit: "maxInputTokensPerCall", value: opts.estimatedInputTokens },
      );
    }
    if (opts.estimatedOutputTokens > this.limits.maxOutputTokensPerCall) {
      this.blockedCount += 1;
      throw new BudgetExceededError(
        `Output tokens ${opts.estimatedOutputTokens} exceed limit ${this.limits.maxOutputTokensPerCall}.`,
        { limit: "maxOutputTokensPerCall", value: opts.estimatedOutputTokens },
      );
    }

    // Model tier gate.
    if (this.limits.modelTier !== "auto") {
      const requested = TIER_RANK[this.classToTier(opts.modelClass)] ?? 0;
      if (requested > (TIER_RANK[this.limits.modelTier] ?? 0)) {
        this.blockedCount += 1;
        throw new ModelUnavailableError(
          `Model class ${opts.modelClass} is above configured tier ${this.limits.modelTier}.`,
        );
      }
    }

    // Rolling spend ceilings (hourly/daily), estimated cost.
    const now = this.clock.now();
    const hourly = this.telemetry.costSince(3_600_000, now) + opts.estimatedCost;
    if (hourly > this.limits.hourlyBudget) {
      this.blockedCount += 1;
      throw new BudgetExceededError(
        `Hourly budget ${this.limits.hourlyBudget} would be exceeded (${hourly.toFixed(4)}).`,
        { limit: "hourlyBudget" },
      );
    }
    const daily = this.telemetry.costSince(86_400_000, now) + opts.estimatedCost;
    if (daily > this.limits.dailyBudget) {
      this.blockedCount += 1;
      throw new BudgetExceededError(
        `Daily budget ${this.limits.dailyBudget} would be exceeded (${daily.toFixed(4)}).`,
        { limit: "dailyBudget" },
      );
    }
  }

  isZeroCost(modelClass: ModelClass): boolean {
    return MOCK_CLASSES.includes(modelClass);
  }

  private classToTier(modelClass: ModelClass): ModelTier {
    switch (modelClass) {
      case "social.deterministic":
      case "social.mock":
        return "mock";
      case "social.nano":
        return "nano";
      case "social.standard":
        return "standard";
      case "social.deep":
        return "deep";
    }
  }
}