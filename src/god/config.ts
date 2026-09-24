import type { ModelClass, ModelTier } from "./types.ts";

export type { ModelClass, ModelTier } from "./types.ts";

export interface BudgetLimits {
  /** Hard max paid/model calls processed per event. Default 1. */
  maxCallsPerEvent: number;
  /** Total estimated spend per rolling hour (USD). */
  hourlyBudget: number;
  /** Total estimated spend per rolling day (USD). */
  dailyBudget: number;
  /** Hard max input tokens per single call. */
  maxInputTokensPerCall: number;
  /** Hard max output tokens per single call. */
  maxOutputTokensPerCall: number;
  /** Highest tier this deployment is permitted to route to. */
  modelTier: ModelTier | "auto";
  /** Max retries of a failed call. Default 0 (no automatic retry). */
  maxRetries: number;
  /** Max nested inference depth. Default 0 => recursion impossible. */
  recursionDepth: number;
  /** Model calls allowed from background/scheduled work. Default 0. */
  backgroundModelCalls: number;
  /** Automatically escalate capability class when allowed. Default false. */
  automaticPremiumEscalation: boolean;
  /** Automatically retry expensive route after cheap failure. Default false. */
  automaticExpensiveRetry: boolean;
}

export interface RouteConfig {
  provider: string;
  model: string;
}

export interface IntelligenceConfig {
  /** Global kill switch. When true, ALL provider/model calls fail closed. */
  killSwitch: boolean;
  /** Provider-neutral capability routing. */
  routes: Record<ModelClass, RouteConfig>;
  /** The capability class the scene director requests by default. */
  sceneModelClass: ModelClass;
  budget: BudgetLimits;
  cache: { enabled: boolean; maxEntries: number };
  /** USD per 1k OUTPUT tokens, per capability class. */
  costPer1kOutputTokens: Record<ModelClass, number>;
}

export interface SocietyConfig {
  dbPath: string;
  maxPersons: number;
  maxCircles: number;
  /** Default (minimum) speakers for an interactive scene. */
  minSpeakers: number;
  /** Default speaker target. */
  maxSpeakers: number;
  /** Ordinary hard maximum for speakers selected into any one scene. */
  hardMaxSpeakers: number;
  /** Relationship inertia: how much of a proposed delta actually lands. 0..1. */
  relationshipLearningRate: number;
  /** Serendipity controls. */
  serendipity: {
    enabled: boolean;
    cooldownMs: number;
    probability: number;
    maxRecentIntroductions: number;
    introductionWindowMs: number;
  };
  /** Memory tuning. */
  memory: {
    hotWindow: number;
    warmRetrievalLimit: number;
    coldRetrievalLimit: number;
  };
  /** Bounded context compiler limits (context-explosion circuit breaker). */
  context: {
    maxSections: number;
    maxTokens: number;
    recentMessageWindow: number;
  };
  /** Relationship evolution: hard cap on how much one routine scene may move a dimension. */
  relationship: {
    maxDeltaPerScene: number;
    maxInteractionsPerScene: number;
  };
  /** Proactive interaction (conservative; disabled by default). */
  proactive: {
    enabled: boolean;
    minRelevance: number;
    cooldownMs: number;
    intrusivenessCap: number;
    maxReachesPerTick: number;
    budgetPerDay: number;
  };
  /** Long-session runtime. */
  sessions: {
    rollingMessageWindow: number;
    maxParticipantCards: number;
  };
  /** User-facing flags. */
  user: { socialIntensity: string; userId: string };
}

export interface SocietyConfigInput {
  dbPath?: string;
  maxPersons?: number;
  maxCircles?: number;
  minSpeakers?: number;
  maxSpeakers?: number;
  hardMaxSpeakers?: number;
  relationshipLearningRate?: number;
  serendipity?: Partial<SocietyConfig["serendipity"]>;
  memory?: Partial<SocietyConfig["memory"]>;
  context?: Partial<SocietyConfig["context"]>;
  relationship?: Partial<SocietyConfig["relationship"]>;
  proactive?: Partial<SocietyConfig["proactive"]>;
  sessions?: Partial<SocietyConfig["sessions"]>;
  user?: Partial<SocietyConfig["user"]>;
}

/** Operator input for intelligence settings; budget limits may be partial and
 *  are merged over defaults at boot. */
export interface IntelligenceConfigInput
  extends Omit<Partial<IntelligenceConfig>, "budget"> {
  budget?: Partial<BudgetLimits>;
}

export const DEFAULT_BUDGET: BudgetLimits = {
  maxCallsPerEvent: 1,
  hourlyBudget: 2.0,
  dailyBudget: 20.0,
  maxInputTokensPerCall: 12_000,
  maxOutputTokensPerCall: 2_000,
  modelTier: "auto",
  maxRetries: 0,
  recursionDepth: 0,
  backgroundModelCalls: 0,
  automaticPremiumEscalation: false,
  automaticExpensiveRetry: false,
};

export const DEFAULT_ROUTES: Record<ModelClass, RouteConfig> = {
  "social.deterministic": { provider: "deterministic", model: "template-v1" },
  "social.mock": { provider: "mock", model: "mock-v1" },
  "social.nano": { provider: "mock", model: "mock-v1" },
  "social.standard": { provider: "mock", model: "mock-v1" },
  "social.deep": { provider: "mock", model: "mock-v1" },
};

export const DEFAULT_COST_PER_1K_OUTPUT: Record<ModelClass, number> = {
  "social.deterministic": 0,
  "social.mock": 0,
  "social.nano": 0.002,
  "social.standard": 0.02,
  "social.deep": 0.1,
};

export function buildConfig(input: SocietyConfigInput = {}): SocietyConfig {
  return {
    dbPath: input.dbPath ?? ":memory:",
    maxPersons: input.maxPersons ?? 1_000,
    maxCircles: input.maxCircles ?? 200,
    minSpeakers: input.minSpeakers ?? 1,
    maxSpeakers: input.maxSpeakers ?? 3,
    hardMaxSpeakers: input.hardMaxSpeakers ?? 3,
    relationshipLearningRate: input.relationshipLearningRate ?? 0.15,
    serendipity: {
      enabled: input.serendipity?.enabled ?? true,
      cooldownMs: input.serendipity?.cooldownMs ?? 3_600_000,
      probability: input.serendipity?.probability ?? 0.25,
      maxRecentIntroductions:
        input.serendipity?.maxRecentIntroductions ?? 2,
      introductionWindowMs:
        input.serendipity?.introductionWindowMs ?? 86_400_000,
    },
    memory: {
      hotWindow: input.memory?.hotWindow ?? 8,
      warmRetrievalLimit: input.memory?.warmRetrievalLimit ?? 6,
      coldRetrievalLimit: input.memory?.coldRetrievalLimit ?? 3,
    },
    context: {
      maxSections: input.context?.maxSections ?? 30,
      maxTokens: input.context?.maxTokens ?? 12_000,
      recentMessageWindow: input.context?.recentMessageWindow ?? 6,
    },
    relationship: {
      maxDeltaPerScene: input.relationship?.maxDeltaPerScene ?? 0.1,
      maxInteractionsPerScene: input.relationship?.maxInteractionsPerScene ?? 4,
    },
    proactive: {
      enabled: input.proactive?.enabled ?? false,
      minRelevance: input.proactive?.minRelevance ?? 5,
      cooldownMs: input.proactive?.cooldownMs ?? 86_400_000,
      intrusivenessCap: input.proactive?.intrusivenessCap ?? 6,
      maxReachesPerTick: input.proactive?.maxReachesPerTick ?? 1,
      budgetPerDay: input.proactive?.budgetPerDay ?? 0,
    },
    sessions: {
      rollingMessageWindow: input.sessions?.rollingMessageWindow ?? 6,
      maxParticipantCards: input.sessions?.maxParticipantCards ?? 4,
    },
    user: {
      socialIntensity: input.user?.socialIntensity ?? "normal",
      userId: input.user?.userId ?? "user",
    },
  };
}

export interface KernelConfig {
  society: SocietyConfig;
  intelligence: IntelligenceConfig;
}

export function buildKernelConfig(
  society: SocietyConfigInput = {},
  intelligence?: IntelligenceConfigInput,
): KernelConfig {
  const base: IntelligenceConfig = {
    killSwitch: intelligence?.killSwitch ?? false,
    routes: intelligence?.routes ?? DEFAULT_ROUTES,
    sceneModelClass: intelligence?.sceneModelClass ?? "social.mock",
    budget: { ...DEFAULT_BUDGET, ...(intelligence?.budget ?? {}) },
    cache: { enabled: true, maxEntries: 5_000, ...(intelligence?.cache ?? {}) },
    costPer1kOutputTokens: {
      ...DEFAULT_COST_PER_1K_OUTPUT,
      ...(intelligence?.costPer1kOutputTokens ?? {}),
    },
  };
  return { society: buildConfig(society), intelligence: base };
}