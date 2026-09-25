/**
 * GOD v2 BRIDGE — TYPES
 *
 * The God GrokBot is ONE external process. It never owns canonical state, never
 * constructs its own context, and never spawns other GrokBots. Society decides
 * everything: event id, circle, participants, roles, memories, relationships,
 * context slice, and whether an inference is warranted at all.
 *
 * The bridge is deliberately tiny:
 *   USER → God → tiny event → Society → GodInput (or deterministic) → God → GodResult → Society state
 */

import type { ModelClass } from "../god/types.ts";

/** What God is allowed to send. Anything else is rejected. */
export interface GodEventInput {
  type: "USER_MESSAGE" | "DIRECT_INTERACTION" | "GROUP_INTERACTION";
  text: string;
  /** optional targeting hints — Society still decides the real participants */
  circleId?: string;
  personIds?: string[];
}

export type GodJobStatus = "AWAITING_GOD" | "COMPLETED" | "REJECTED" | "EXPIRED";

/**
 * The compact package handed to God. Smallest useful context, with an explicit
 * reason for every inclusion so the operator can audit the slice.
 */
export interface GodInput {
  eventId: string;
  scene: string;
  userMessage: string;
  participants: GodParticipant[];
  relationships: GodRelationship[];
  memories: GodMemory[];
  constraints: GodConstraints;
  outputSchema: string;
  /** exact accounting of what was included and why */
  accounting: GodInputAccounting;
}

export interface GodParticipant {
  personId: string;
  name: string;
  roles: string[];
  /** why this person is in the scene */
  why: string;
  identity: {
    socialIntensity: string;
    traits: string[];
    interests: string[];
  };
}

export interface GodRelationship {
  a: string;
  b: string;
  dimensions: Record<string, number>;
  /** why this relationship row was included */
  why: string;
}

export interface GodMemory {
  personId: string;
  content: string;
  kind: string;
  importance: number;
  /** why this memory was included */
  why: string;
}

export interface GodConstraints {
  maxSpeakers: number;
  maxOutputTokens: number;
  /** recursion is structurally impossible; stated for the contract */
  recursion: 0;
  maxCallsThisEvent: 1;
}

export interface GodInputAccounting {
  characters: number;
  estimatedTokens: number;
  participantCount: number;
  memoryCount: number;
  relationshipCount: number;
  /**
   * How many Persons were NOT included and the rule that excluded them. God is
   * told the size of the population, never a roster of it.
   */
  populationSize: number;
  excludedCount: number;
  exclusionCriterion: string;
  memoriesIncluded: string[];
  participantsIncluded: string[];
  truncation: string[];
}

/** What God returns. Structured deltas only — never an essay. */
export interface GodReportedUsage {
  inputTokens: number;
  outputTokens: number;
  cachedTokens?: number;
  reportedCost?: number;
  latencyMs?: number;
}

export interface GodResult {
  jobId: string;
  eventId: string;
  messages: GodMessage[];
  memoryCandidates?: GodMemoryCandidate[];
  relationshipCandidates?: GodRelationshipCandidate[];
  timelineCandidates?: GodTimelineCandidate[];
  followups?: GodFollowup[];
  confidence?: number;
  usage?: GodReportedUsage;
}

export interface GodMessage {
  personId: string;
  text: string;
}

export interface GodMemoryCandidate {
  personId: string;
  content: string;
  kind?: string;
}

export interface GodRelationshipCandidate {
  personId: string;
  targetId: string;
  dim: string;
  delta: number;
}

export interface GodTimelineCandidate {
  personId: string;
  kind: string;
  content: string;
}

export interface GodFollowup {
  personId: string;
  delayMs: number;
  reason: string;
}

/** Durable record of a pending external inference. One per event, never two. */
export interface GodJob {
  id: string;
  eventId: string;
  status: GodJobStatus;
  createdAt: number;
  mode: "dry" | "live";
  modelClass: "grok" | "chatgpt";
  /** participant ids Society selected — God may only speak for these */
  selectedPersonIds: string[];
  input: GodInput;
  result?: GodResult;
  rejectedReason?: string;
  /** measured accounting for the external call */
  usage?: GodCallUsage;
}

/** Every field required to answer "why did this call happen, and what did we get?" */
export interface GodCallUsage {
  eventId: string;
  jobId: string;
  timestamp: number;
  mode: "dry" | "live";
  reasonGrokRequired: string;
  participants: string[];
  participantNames: string[];
  roles: string[];
  circleId: string | null;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  inputCharacters: number;
  outputCharacters: number;
  model: string;
  provider: string;
  modelClass: ModelClass;
  estimatedCost: number;
  reportedCost: number | null;
  latencyMs: number;
  cacheStatus: "hit" | "miss";
  resultStatus: "persisted" | "deterministic_fallback" | "rejected";
  /** false for dry runs: the pipeline was proven without a real provider call */
  providerCallRecorded: boolean;
  stateChanges: GodStateChanges;
  /** offline miss-analysis signals — no extra inference required */
  missAnalysis: GodMissSignals;
}

export interface GodStateChanges {
  messagesApplied: number;
  memoryCandidates: number;
  relationshipCandidates: number;
  timelineCandidates: number;
  followups: number;
  relationshipsUpdated: string[];
}

export interface GodMissSignals {
  /** could a deterministic template have produced this? */
  looksDeterministic: boolean;
  /** was the scene near-identical to a previous one? */
  nearCacheable: boolean;
  /** how many distinct participants spoke */
  speakerCount: number;
  /** did the output actually use the supplied context? */
  usedRelationshipContext: boolean;
  usedMemoryContext: boolean;
  /** short verbatim summary for offline review */
  digest: string;
}

/** Cost-per-social-value classification for every event. */
export type CostClass =
  | "NO_INFERENCE"
  | "CACHE"
  | "DETERMINISTIC"
  | "CHEAP"
  | "CHATGPT"
  | "GROK";

export const COST_CLASSES: readonly CostClass[] = [
  "NO_INFERENCE",
  "CACHE",
  "DETERMINISTIC",
  "CHEAP",
  "CHATGPT",
  "GROK",
] as const;

export interface SocialCostMetrics {
  events_total: number;
  events_zero_inference: number;
  cache_resolved: number;
  deterministic_resolved: number;
  cheap_model_calls: number;
  chatgpt_calls: number;
  grok_calls: number;
  /** every completed God job, including dry runs that cost nothing */
  god_jobs_completed: number;
  /** dry jobs prove the handoff without a provider call */
  dry_runs: number;
  grok_escalation_rate: number;
  avg_grok_input_tokens: number;
  avg_grok_output_tokens: number;
  cost_per_grok_event: number;
  cost_per_social_session: number;
  /** distribution across every layer */
  byClass: Record<CostClass, number>;
}

export class GodBridgeError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "GodBridgeError";
  }
}
