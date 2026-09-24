# God: The Deterministic Society Kernel

> **God is application software, not a permanently reasoning model.**

---

## What God Is

God (`GodKernel`) is the **composition root** of the society. It wires together all services, enforces budgets, routes events, and persists outcomes. It is the *deterministic kernel* that makes the society run.

**God creates and evolves:**
- Persons (durable identities)
- Roles (reusable behavior definitions)
- Role assignments
- Relationships (with inertia)
- Circles (communities)
- Introductions (serendipity)
- Events (the atomic unit of activity)
- Traditions (landmarks, shared history)
- Timelines (per-person/circle event streams)

**God does NOT:**
- "Think" continuously
- Act as a person in the society
- Spawn agents
- Hold opinions or moods
- Generate text directly (it routes to providers via `IntelligenceGateway`)

---

## God's Operating Loop

```
Event intake (user message / scheduled followup / proactive tick)
        │
Deterministic validation
        │
Cache lookup (content-hash)
        │
State / DB lookup
        │
Relevance scoring (deterministic)
        │
Participant selection (max 3)
        │
Context compilation (bounded, ONLY selected persons)
        │
Budget decision (fail closed)
        │
Optional inference (≤1 call)
        │
Deterministic output validation
        │
Persistence (timeline, memory, relationships, followups, serendipity, telemetry)
```

Every step except the optional inference is pure deterministic code. The inference step is gated by `BudgetGovernor` and routed through `IntelligenceGateway`.

---

## God's Public API

```typescript
// Core interaction
kernel.tell(prompt, { circleId? }) → SocietyEvent
kernel.proactiveTick(circleId?) → { candidates, reaches }

// Seeding & identity
kernel.ensureSeeded() → void
kernel.seedBond(a, b, status, dims) → void
kernel.identityCard(personId) → IdentityCard | null
kernel.composeActorContext(personId, eventId, participantIds, circleId?) → ActorContext

// Landmarks (shared history)
kernel.landmark(personId, otherPersonId, kind, content, importance) → void

// Sessions
kernel.sessionStart({ kind, circleId?, participantIds }) → SocietySession
kernel.sessionMessages(sessionId) → SessionMessageRecord[]
kernel.sessionContext(sessionId) → { messages, participants }
kernel.sessionEnd(sessionId) → SocietySession | null

// State control
kernel.pause() / kernel.resume() / kernel.isPaused()
kernel.setKillSwitch(true) / kernel.killSwitch()

// Introspection
kernel.capableRenderers() → RendererInfo[]
kernel.entityCreate(kind) → RouteConfig
kernel.usage() → UsageReport
kernel.stats() → KernelStats
```

---

## Invariants God Enforces

| Invariant | How |
|-----------|-----|
| **No provider bypass** | Providers assert gateway diary; direct calls throw |
| **One call per event** | `maxCallsPerEvent = 1` enforced by `BudgetGovernor` |
| **Zero background inference** | `backgroundModelCalls = 0` by default |
| **No recursion** | `recursionDepth = 0` → `RecursionBlockedError` |
| **Bounded context** | `ContextCompiler` enforces section/token caps; `context_explosion` breaker |
| **Provider-neutral identity** | `ModelRouter` swaps routes; Person never touches provider |
| **Fail closed** | Kill switch, budget, availability all block → deterministic fallback |
| **Idempotent seeding** | `ensureSeeded()` checks `meta.seeded.society` flag |
| **Privacy scopes** | `MemoryService` gates by `private`/`person_user_shared`/`circle`/`public` |

---

## God vs. GrokBot

| God | GrokBot |
|-----|---------|
| Deterministic kernel | Optional premium inference route |
| Wires services | Called via `IntelligenceGateway` |
| Zero inference by default | Only invoked when budget allows |
| Persists canonical state | Stateless inference source |
| One per process | One per capability class (route) |

**GrokBot is a route, not an actor.** The `social.deep` capability class may route to a GrokBot endpoint, but the GrokBot never owns Person identity, never writes to the timeline, and never decides who speaks.

---

## Configuration

God is configured via `KernelConfig` (society + intelligence). All values have sensible defaults:

```typescript
// Society defaults
dbPath: ":memory:"
maxPersons: 1000
maxCircles: 200
minSpeakers: 1
maxSpeakers: 3
hardMaxSpeakers: 3
relationshipLearningRate: 0.15

// Proactive (conservative)
proactive: {
  enabled: false,
  minRelevance: 5,
  cooldownMs: 86_400_000,
  maxReachesPerTick: 1,
  budgetPerDay: 0
}

// Sessions
sessions: { rollingMessageWindow: 6, maxParticipantCards: 4 }

// Budget (strict)
budget: {
  maxCallsPerEvent: 1,
  hourlyBudget: 2.0,
  dailyBudget: 20.0,
  maxInputTokensPerCall: 12_000,
  maxOutputTokensPerCall: 2_000,
  modelTier: "auto",
  maxRetries: 0,
  recursionDepth: 0,
  backgroundModelCalls: 0
}
```

---

## Testing God

```bash
# Unit + integration proofs
pnpm test

# Type-level invariants
pnpm typecheck

# Demo (in-memory, mock provider)
pnpm dev

# CLI with persistent DB
pnpm society start --db ./society.db
pnpm society chat "Hello!" --circle <id> --db ./society.db
```

---

## Common Misconceptions

| Misconception | Reality |
|---------------|---------|
| "God is the LLM" | God is the kernel; LLM is a routed provider |
| "God creates agents" | God creates Persons; Actors are ephemeral per-scene |
| "God decides what people say" | SocialDirector selects speakers; provider generates |
| "God knows everything" | Knowledge flows only through privacy scopes |
| "God runs continuously" | God is event-driven; idle = zero work |