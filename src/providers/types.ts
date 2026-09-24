import type { ModelClass } from "../god/types.ts";

/**
 * Provider contract — the ONLY way to touch a model.
 * All providers assert a gateway diary context; calling directly throws.
 */
export interface Provider {
  readonly name: string;
  readonly supports: ModelClass[];
  readonly isAvailable: () => boolean;
  generate(request: ProviderRequest): Promise<ProviderResult>;
}

/** Request shape passed to a provider by the IntelligenceGateway. */
export interface ProviderRequest {
  modelClass: ModelClass;
  shape?: OutputShape;
  context: string[];
}

/** Result returned by any provider implementation. */
export interface ProviderResult {
  provider: string;
  model: string;
  content: string;
  usage: { inputTokens: number; outputTokens: number };
  cost: number;
}

/** Structured scene output from a provider (validated by SocialDirector). */
export interface SceneProviderPayload {
  messages: Array<{ personId: string; text: string }>;
  memoryCandidates: Array<{
    personId: string;
    scope: string;
    type: string;
    content: string;
    importance: number;
    confidence: number;
  }>;
  relationshipCandidates: Array<{
    personA: string;
    personB: string;
    dimsDelta: { familiarity: number; comfort: number };
  }>;
  timelineCandidates: Array<{
    personId: string;
    kind: string;
    content: string;
  }>;
  followups: Array<{
    personId: string;
    delayMs: number;
    reason: string;
  }>;
}

/** Output shape requested by the gateway (scene = multi-person structured output). */
export type OutputShape = "scene" | "json" | "text";

/**
 * Gateway diary — wraps provider calls to record telemetry and enforce
 * the single approved path. Providers assert this context on entry.
 */
export interface GatewayDiary {
  run<T>(meta: { caller: string; eventId: string; reason: string }, fn: () => Promise<T>): Promise<T>;
}

export const gatewayDiary: GatewayDiary = {
  async run<T>(_meta: { caller: string; eventId: string; reason: string }, fn: () => Promise<T>): Promise<T> {
    enterGateway();
    try {
      return await fn();
    } finally {
      exitGateway();
    }
  },
};

/** Runtime guard — throws if a provider is called outside the IntelligenceGateway. */
let inGateway = false;
export function enterGateway(): void { inGateway = true; }
export function exitGateway(): void { inGateway = false; }
export function assertGatewalledCall(): void {
  if (!inGateway) {
    throw new ProviderCallOutsideGatewayError();
  }
}

/** Extract structured meta from the context sections passed to a provider. */
export function extractMeta(context: string[]): {
  participants?: unknown;
  actorMessage?: string;
  participantNames?: Record<string, string>;
} {
  const metaSection = context.find((s) => s.startsWith("__meta__"));
  if (!metaSection) return {};
  try {
    const json = metaSection.replace("__meta__", "").trim();
    return JSON.parse(json);
  } catch {
    return {};
  }
}

/** Errors specific to the provider layer. */
export class ProviderCallOutsideGatewayError extends Error {
  constructor(message = "Provider calls are architecturally blocked outside the IntelligenceGateway.") {
    super(message);
    this.name = "ProviderCallOutsideGatewayError";
  }
}