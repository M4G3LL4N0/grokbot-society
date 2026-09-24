/**
 * Shared domain types for the GrokBot Society runtime.
 *
 * Critical distinction kept explicit everywhere:
 *   PERSON !== ROLE !== ACTOR !== MODEL !== GROKBOT
 *
 * - PERSON : persistent, stored, zero-cost-when-dormant identity.
 * - ROLE   : reusable behavior/capability definition (registry, zero inference).
 * - ACTOR  : ephemeral runtime conjunction created only for one event/session.
 * - MODEL  : temporary cognition/rendering capability (swappable, provider-neutral).
 * - GROKBOT: optional premium runtime/interface; never owns canonical state.
 */

export type ModelClass =
  | "social.deterministic"
  | "social.mock"
  | "social.nano"
  | "social.standard"
  | "social.deep";

export type ModelTier = "mock" | "nano" | "standard" | "deep";

export type SocialIntensity =
  | "quiet"
  | "low"
  | "normal"
  | "social"
  | "very_social"
  | "do_not_disturb";

export type EventType =
  | "USER_MESSAGE"
  | "DIRECT_INTERACTION"
  | "GROUP_INTERACTION"
  | "SCHEDULED_FOLLOWUP"
  | "RELATIONSHIP_EVENT"
  | "TIMELINE_EVENT"
  | "CONTEXT_CHANGE"
  | "INTRODUCTION_CANDIDATE"
  | "CIRCLE_EVENT"
  | "SESSION_START"
  | "SESSION_END"
  | "SESSION_MESSAGE"
  | "PROACTIVE_CANDIDATE"
  | "PROACTIVE_REACH"
  | "LANDMARK_EVENT";

/** Social pacing verdicts for low-value candidate events. */
export type ProactiveVerdict = "NO_ACTION" | "REACH" | "SILENT";

/**
 * Durable shared-history landmarks. Trivia is NOT stored as a landmark; these
 * kinds represent meaningful, relationship-shaping moments only.
 */
export type LandmarkKind =
  | "shared_trip"
  | "important_conversation"
  | "inside_joke"
  | "conflict"
  | "reconciliation"
  | "tradition"
  | "promise"
  | "future_plan"
  | "milestone";

export type SessionKind =
  | "road_trip"
  | "walking"
  | "evening_social"
  | "group_conversation"
  | "ambient_companionship";

export interface SocietySession {
  id: string;
  kind: SessionKind;
  label: string;
  circleId: string | null;
  participantIds: string[];
  createdAt: number;
  lastActiveAt: number;
  messageCount: number;
  status: "active" | "ended";
}

export type RoleCategory = "relationship" | "activity" | "intellectual_social";

export type MemoryScope = "private" | "person_user_shared" | "circle" | "public";

export type MemoryTier = "hot" | "warm" | "cold";

export const RELATIONSHIP_DIMENSIONS = [
  "familiarity",
  "trust",
  "affection",
  "attraction",
  "respect",
  "comfort",
  "shared_history",
  "intellectual_connection",
  "humor_compatibility",
  "reciprocity",
  "tension",
  "interaction_frequency",
] as const;

export type RelationshipDim = (typeof RELATIONSHIP_DIMENSIONS)[number];

export type RelationshipDims = Record<RelationshipDim, number>;

export type RelationshipStatus =
  | "stranger"
  | "acquaintance"
  | "friend"
  | "close_friend"
  | "best_friend"
  | "romantic_interest"
  | "partner"
  | "spouse"
  | "sibling"
  | "parent_like"
  | "cousin"
  | "mentor";

// ---------------------------------------------------------------------------
// PERSON (persistent structured state)
// ---------------------------------------------------------------------------

export interface PersonState {
  id: string;
  name: string;
  identity: Record<string, unknown>;
  personality: Record<string, unknown>;
  biography: string;
  interests: string[];
  preferences: Record<string, unknown>;
  goals: string[];
  opinions: Record<string, unknown>;
  communicationStyle: Record<string, unknown>;
  currentState: Record<string, unknown>;
  socialIntensity: SocialIntensity;
  createdAt: number;
  updatedAt: number;
  lastActiveAt: number | null;
  lastStateAt: number | null;
}

export interface NewPersonInput {
  name: string;
  biography?: string;
  identity?: Record<string, unknown>;
  personality?: Record<string, unknown>;
  interests?: string[];
  preferences?: Record<string, unknown>;
  goals?: string[];
  opinions?: Record<string, unknown>;
  communicationStyle?: Record<string, unknown>;
  currentState?: Record<string, unknown>;
  socialIntensity?: SocialIntensity;
}

// ---------------------------------------------------------------------------
// ROLE (reusable social behavior/capability definition)
// ---------------------------------------------------------------------------

export interface RoleDefinition {
  id: string;
  category: RoleCategory;
  name: string;
  tendencies: string[];
  capabilities: string[];
  relationshipExpectations: string[];
  contextRequirements: string[];
  constraints: string[];
  permissions: string[];
}

// ---------------------------------------------------------------------------
// RELATIONSHIP (undirected social bond with inertia)
// ---------------------------------------------------------------------------

export interface Relationship {
  personA: string;
  personB: string;
  dims: RelationshipDims;
  status: RelationshipStatus;
  interactions: number;
  createdAt: number;
  updatedAt: number;
}

export interface RelationshipSummary {
  personId: string;
  dims: RelationshipDims;
  status: RelationshipStatus;
  interactions: number;
}

// ---------------------------------------------------------------------------
// CIRCLE / GROUP
// ---------------------------------------------------------------------------

export interface Circle {
  id: string;
  name: string;
  kind: string;
  metadata: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// EVENTS
// ---------------------------------------------------------------------------

export type EventStage =
  | "created"
  | "validated"
  | "cache_lookup"
  | "scored"
  | "selected"
  | "context_compiled"
  | "inference_attempted"
  | "output_validated"
  | "persisted"
  | "skipped"
  | "deterministic_fallback";

export interface SocietyEvent {
  id: string;
  eventType: EventType;
  actorId: string | null;
  personIds: string[];
  circleId: string | null;
  payload: Record<string, unknown>;
  status: string;
  source: string;
  stages: EventStage[];
  createdAt: number;
  processedAt: number | null;
}

// ---------------------------------------------------------------------------
// MEMORY
// ---------------------------------------------------------------------------

export interface MemoryRecord {
  id: string;
  personId: string;
  scope: MemoryScope;
  scopeRef: string | null;
  type: string;
  content: string;
  source: string;
  createdAt: number;
  importance: number;
  confidence: number;
  relationshipRelevance: number;
  emotionalSignificance: number;
}

export interface NewMemoryInput {
  personId: string;
  scope: MemoryScope;
  scopeRef?: string | null;
  type: string;
  content: string;
  source: string;
  importance?: number;
  confidence?: number;
  relationshipRelevance?: number;
  emotionalSignificance?: number;
}

// ---------------------------------------------------------------------------
// SCENE / SINGLE-INFERENCE GENERATION
// ---------------------------------------------------------------------------

export interface Message {
  personId: string;
  text: string;
}

export interface MemoryCandidate {
  personId: string;
  scope: MemoryScope;
  scopeRef?: string | null;
  type: string;
  content: string;
  importance?: number;
  confidence?: number;
  relationshipRelevance?: number;
  emotionalSignificance?: number;
}

export interface RelationshipCandidate {
  personA: string;
  personB: string;
  dimsDelta: Partial<Record<RelationshipDim, number>>;
}

export interface TimelineCandidate {
  personId: string;
  kind: string;
  content: string;
}

export interface FollowupCandidate {
  personId: string;
  delayMs: number;
  reason: string;
}

/** Structured output of ONE generation request covering an entire scene. */
export interface SceneOutput {
  messages: Message[];
  memoryCandidates: MemoryCandidate[];
  relationshipCandidates: RelationshipCandidate[];
  timelineCandidates: TimelineCandidate[];
  followups: FollowupCandidate[];
}

/** Compiled scene context passed into the (single) generation request. */
export interface SceneContext {
  eventId: string;
  participantIds: string[];
  sections: string[];
  estimatedTokens: number;
}

export interface SyntheticActor extends ActorContext {
  sessionId: string;
  eventId: string;
  person: PersonState;
  materializedAt: number;
}

// ---------------------------------------------------------------------------
// TELEMETRY
// ---------------------------------------------------------------------------

export interface TelemetryEntry {
  eventId: string | null;
  reason: string | null;
  caller: string | null;
  provider: string;
  model: string;
  modelClass: ModelClass;
  inputSize: number;
  outputSize: number;
  estimatedCost: number;
  durationMs: number;
  cacheStatus: "hit" | "miss";
  createdAt: number;
}

/** Result wrapper coming from any provider through the gateway. */
export interface GenerationResult {
  provider: string;
  model: string;
  modelClass: ModelClass;
  content: string;
  usage: { inputTokens: number; outputTokens: number };
  cost: number;
  durationMs: number;
  cacheStatus: "hit" | "miss";
}

// ---------------------------------------------------------------------------
// ROLE COMPOSITION (deterministic actor-context compile)
// ---------------------------------------------------------------------------

/** Compact, frozen identity card compiled deterministically from state. */
export interface IdentityCard {
  personId: string;
  name: string;
  archetype: string;
  essence: string;
  voice: string;
  interests: string[];
  goals: string[];
  mood: number | null;
  socialIntensity: SocialIntensity;
}

/**
 * The complete deterministic compile of Person + Roles + Relationship +
 * Memory + Scene → Actor Context. This is what a renderer (mock, cheap,
 * GrokBot) receives. Compiled ONLY on demand; zero inference at compile time.
 */
export interface ActorContext {
  personId: string;
  card: IdentityCard;
  roles: RoleDefinition[];
  relationships: RelationshipSummary[];
  memories: MemoryRecord[];
  sceneRef: string;
}

// ---------------------------------------------------------------------------
// PROVIDER-NEUTRAL SCENE RENDERER (runtime interface)
// ---------------------------------------------------------------------------

export interface RenderSceneInput {
  event: SocietyEvent;
  selectedPeople: SelectedPerson[];
  activeRoles: Record<string, RoleDefinition[]>;
  relationshipContext: Record<string, RelationshipSummary[]>;
  relevantMemories: Record<string, MemoryRecord[]>;
  outputBudget: { maxMessages: number; maxTokens: number };
  circle: { id: string | null; name: string | null } | null;
}

export interface SelectedPerson {
  personId: string;
  score: number;
  reasons: string[];
}

export interface RenderSceneOutput {
  output: SceneOutput;
  provider: string;
  model: string;
  cacheStatus: "hit" | "miss";
}

export interface SceneRenderer {
  readonly name: string;
  readonly enabled: boolean;
  /** Render a bounded scene WITHOUT touching canonical state. */
  renderScene(input: RenderSceneInput): Promise<RenderSceneOutput>;
}

// ---------------------------------------------------------------------------
// PROACTIVE PACING
// ---------------------------------------------------------------------------

export interface ProactiveCandidate {
  personId: string;
  score: number;
  reasons: string[];
  verdict: ProactiveVerdict;
}

export interface PacingFactors {
  relevance: number;
  relationshipStrength: number;
  novelty: number;
  unfinishedContext: number;
  timing: number;
  recentContact: number;
  userSocialIntensity: number;
  intrusiveness: number;
}

// ---------------------------------------------------------------------------
// SHARED HISTORY / LANDMARKS
// ---------------------------------------------------------------------------

export interface LandmarkInput {
  personA: string;
  personB: string;
  kind: LandmarkKind;
  content: string;
  importance?: number;
}

export interface LandmarkRecord {
  id: string;
  personId: string;
  kind: LandmarkKind;
  content: string;
  createdAt: number;
  importance: number;
  with: string;
}

// ---------------------------------------------------------------------------
// SESSIONS
// ---------------------------------------------------------------------------

export interface SessionMessageRecord {
  id: string;
  sessionId: string;
  role: "user" | "person";
  personId: string | null;
  text: string;
  createdAt: number;
}