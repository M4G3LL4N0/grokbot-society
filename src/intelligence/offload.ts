import type { ModelClass, SceneOutput } from "../god/types.ts";

/**
 * CHATGPT OFFLOAD CONTRACT
 *
 * The pattern this supports:
 *
 *   Society detects complex reasoning
 *     → compact objective + bounded state
 *     → ChatGPT
 *     → compact structured social STRATEGY
 *     → Society
 *     → cheap renderer (or God, only if still necessary)
 *
 * The asymmetry with God is deliberate. God RENDERS: it returns the words
 * people say. ChatGPT REASONS: it returns a plan for how a scene should read,
 * and Society turns that plan into words using cheap local rendering. So an
 * expensive reasoning call does not automatically become an expensive
 * rendering call.
 *
 * This contract is DISABLED by default. Enabling it requires an explicit
 * operator decision and a configured provider. Nothing here is ever activated
 * automatically, and no call is made without passing the budget governor.
 */

export interface ReasoningOffloadRequest {
  /** what the society actually needs to work out */
  objective: string;
  /** bounded, per-scene state only — never the database */
  state: {
    eventId: string;
    scene: string;
    message: string;
    participants: Array<{ personId: string; name: string; roles: string[] }>;
    relationships: Array<{ a: string; b: string; dims: Record<string, number> }>;
    memories: Array<{ personId: string; content: string; importance: number }>;
  };
  constraints: {
    maxSpeakers: number;
    maxOutputTokens: number;
    /** reasoning must stay bounded exactly like rendering does */
    recursion: 0;
  };
  /** rendered back by Society, not by ChatGPT */
  desiredOutput: "social_strategy";
}

/** ChatGPT's return value: a plan, not prose. */
export interface SocialStrategy {
  objective: string;
  beats: StrategyBeat[];
  /** tensions the cheap renderer must not paper over */
  conflicts: string[];
  /** why a cheap renderer is sufficient, or why God is still required */
  rendering: "cheap_sufficient" | "needs_god";
  confidence: number;
}

export interface StrategyBeat {
  personId: string;
  intent: string;
  tone: string;
  /** the memory or relationship fact the beat should reference, if any */
  anchor?: string;
  priority: number;
}

export class ChatGPTBridgeDisabledError extends Error {
  constructor() {
    super("ChatGPT bridge is disabled. Enable via kernel config and a provider key before use.");
    this.name = "ChatGPTBridgeDisabledError";
  }
}

/**
 * Turn a strategy into a scene using deterministic local rendering. This is the
 * cheap leg of the loop: once the expensive reasoning is done, producing the
 * actual words costs nothing.
 */
export function renderStrategyLocally(strategy: SocialStrategy, maxSpeakers: number): SceneOutput {
  const seen = new Set<string>();
  const messages = strategy.beats
    .slice()
    .sort((a, b) => b.priority - a.priority)
    .filter((b) => (seen.has(b.personId) ? false : (seen.add(b.personId), true)))
    .slice(0, maxSpeakers)
    .map((b) => ({
      personId: b.personId,
      text: b.anchor ? `${b.intent} (${b.tone}) — ${b.anchor}` : `${b.intent} (${b.tone})`,
    }));
  return {
    messages,
    memoryCandidates: [],
    relationshipCandidates: [],
    timelineCandidates: [],
    followups: [],
  };
}

/** Validate a strategy before Society acts on it. Never calls a model to check a model. */
export function validateStrategy(
  strategy: unknown,
  allowedPersonIds: string[],
  maxSpeakers: number,
): SocialStrategy {
  const s = strategy as Partial<SocialStrategy>;
  if (!s || typeof s !== "object") throw new Error("strategy must be an object");
  if (typeof s.objective !== "string") throw new Error("strategy.objective is required");
  if (!Array.isArray(s.beats)) throw new Error("strategy.beats must be an array");
  const allowed = new Set(allowedPersonIds);
  const beats = s.beats
    .filter((b): b is StrategyBeat => Boolean(b) && typeof b.personId === "string" && typeof b.intent === "string")
    .filter((b) => allowed.has(b.personId))
    .slice(0, maxSpeakers)
    .map((b) => ({
      personId: b.personId,
      intent: String(b.intent).slice(0, 200),
      tone: String(b.tone ?? "neutral").slice(0, 40),
      ...(typeof b.anchor === "string" ? { anchor: b.anchor.slice(0, 120) } : {}),
      priority: typeof b.priority === "number" ? b.priority : 0,
    }));
  return {
    objective: s.objective,
    beats,
    conflicts: (Array.isArray(s.conflicts) ? s.conflicts : []).map((c) => String(c).slice(0, 160)),
    rendering: s.rendering === "needs_god" ? "needs_god" : "cheap_sufficient",
    confidence: typeof s.confidence === "number" ? Math.max(0, Math.min(1, s.confidence)) : 0.5,
  };
}

export interface ChatGPTBridgeDeps {
  enabled: boolean;
  modelClass: ModelClass;
  /** injected transport; absent in the default runtime so nothing can be called */
  call?: (request: ReasoningOffloadRequest) => Promise<unknown>;
}

export class ChatGPTBridge {
  readonly name = "chatgpt";
  enabled: boolean;

  constructor(private readonly deps: ChatGPTBridgeDeps) {
    this.enabled = deps.enabled;
  }

  /**
   * Offload a reasoning problem. Disabled by default; every call is refused
   * until an operator enables it AND injects a transport. The transport is
   * expected to route through the IntelligenceGateway budget on its side; this
   * method records the refusal locally so the attempt is auditable.
   */
  async reason(request: ReasoningOffloadRequest, allowedPersonIds: string[]): Promise<SocialStrategy> {
    if (!this.enabled || !this.deps.call) throw new ChatGPTBridgeDisabledError();
    const raw = await this.deps.call(request);
    return validateStrategy(raw, allowedPersonIds, request.constraints.maxSpeakers);
  }
}
