# Core Concepts

This document defines the fundamental concepts in GrokBot Society. Understanding these is essential before reading any other documentation.

---

## Person

A **Person** is a durable, canonical identity in the society. They persist across sessions, restarts, and model changes.

**What a Person has:**
- `id` — stable UUID
- `name` — display name
- `biography` — free-form background
- `identity` — core self-description
- `personality` — summary of disposition
- `interests` — array of topic strings
- `current_state` — mood, availability, social intensity
- `preferences` — communication style, opinions, goals

**What a Person is NOT:**
- An agent that runs continuously
- A model or prompt
- A role assignment (roles are separate)

**Lifecycle:** Created via seed or operator CLI → persists in SQLite → relationships/memories accumulate → never deleted by the runtime.

---

## Role

A **Role** is a reusable behavior/capability definition. Roles are *assigned* to persons; they never create agents.

**Role structure:**
```typescript
{
  id: "friend",
  category: "relationship",
  name: "Friend",
  tendencies: ["warm", "supportive", "honest"],
  capabilities: ["small talk", "emotional support", "shared activities"],
  relationshipExpectations: ["mutual care", "reciprocity"],
  contextRequirements: ["established rapport"],
  constraints: ["no professional advice"],
  permissions: []
}
```

**Categories:** `relationship`, `social`, `intellectual`, `creative`, `activity`, `wildcard`

**Key invariant:** `assignRole(personId, roleId)` makes **zero** model calls. Roles are pure configuration.

---

## SyntheticActor

A **SyntheticActor** (or **Actor**) is an *ephemeral* per-scene persona materialized from:

```
Person + Assigned Roles + Relevant Relationships + Relevant Memories + Scene Context
```

**Lifecycle:** Created at scene start → used for one inference → discarded. Never persisted.

**Why this matters:** The same Person can act differently in different scenes because the Actor composes only the relevant subset of their roles, relationships, and memories for that specific context.

---

## Circle

A **Circle** is a named community with membership, order, and circle-scoped state.

**What a Circle has:**
- `id` — stable UUID
- `name` — display name (e.g., "Inner Circle", "Travel Crew")
- `kind` — `inner`, `family`, `interest`, `neighborhood`, etc.
- `memberPersonIds` — ordered array of person IDs
- `metadata` — extensible JSON

**Circle-scoped state:** Memories and relationships can be scoped to a circle, enabling "what happens in the travel crew stays in the travel crew."

---

## Relationship

A **Relationship** is a bidirectional, dimensioned connection between two persons.

**Dimensions (0.0–1.0):**
- `familiarity` — how well they know each other
- `trust` — reliability expectation
- `affection` — warmth/liking
- `attraction` — romantic/physical pull
- `respect` — admiration for competence/character
- `comfort` — ease of being together
- `shared_history` — landmark count

**Status ladder:** `stranger → acquaintance → friend → close_friend → best_friend → romantic_interest → partner → spouse`

**Inertia:** `relationshipLearningRate = 0.15` — a single interaction moves dimensions by at most ~15% of the delta. A stranger cannot become a spouse in one scene.

**Privacy scopes:** Relationships can be `private`, `person_user_shared`, `circle`, or `public` — controlling who sees what.

---

## Event

An **Event** is the atomic unit of society activity. Everything that happens is an event.

**Event types:**

| Category | Types |
|----------|-------|
| **Interaction** (may invoke model) | `USER_MESSAGE`, `DIRECT_INTERACTION`, `GROUP_INTERACTION`, `SCHEDULED_FOLLOWUP`, `CIRCLE_EVENT`, `PROACTIVE_REACH`, `SESSION_MESSAGE` |
| **Bookkeeping** (zero inference) | `RELATIONSHIP_EVENT`, `TIMELINE_EVENT`, `CONTEXT_CHANGE`, `INTRODUCTION_CANDIDATE`, `SESSION_START`, `SESSION_END`, `PROACTIVE_CANDIDATE`, `LANDMARK_EVENT` |

**Event statuses:** `created → validated → scored → selected → context_compiled → inference_attempted → output_validated → persisted` (or `no_action` / `silent` / `deterministic_fallback`)

---

## Scene

A **Scene** is one structured model generation that produces a multi-character response.

**Guarantees:**
- ≤ 3 speakers (`hardMaxSpeakers = 3`)
- ≤ 12,000 tokens context budget
- One model call per scene (`maxCallsPerEvent = 1`)
- Deterministic validation (no LLM judging LLM)
- Fail-closed: budget/refusal → deterministic fallback scene

---

## Memory

**Memory** is how persons retain information across time. Three tiers:

| Tier | Window | Retrieval Limit | Purpose |
|------|--------|-----------------|---------|
| **HOT** | Recent (config: `hotWindow = 8` events) | — | Immediate context |
| **WARM** | Older but accessible | `warmRetrievalLimit = 6` | Scene-relevant recall |
| **COLD** | Archived | `coldRetrievalLimit = 3` | Deep history, landmarks |

**Privacy scopes:** `private` (person only), `person_user_shared` (person + user), `circle` (circle members), `public` (anyone).

**Landmarks:** Special shared-history memories stored once per pair (`scope: person_user_shared`, `scope_ref: other_person_id`). "Emma and Leo's first trail ritual" exists once, visible to both.

---

## God

**God** (the `GodKernel`) is the *deterministic society kernel*—application software that creates and evolves Persons, roles, relationships, circles, events, traditions, and timelines.

**God is NOT:**
- A permanently reasoning model
- An agent that "thinks" continuously
- A person in the society

**God's job:** Wire services, enforce budgets, route events, materialize actors, persist outcomes. Intelligence is *invoked*, not *embodied*.

---

## Provider

A **Provider** is a concrete model endpoint (mock, deterministic, nano, standard, deep).

**Key rule:** Providers **cannot be called directly** anywhere in the codebase. They assert a gateway diary context on entry; calling outside `IntelligenceGateway` throws `ProviderCallOutsideGatewayError`.

**Routing:** `ModelRouter` maps capability classes (`social.mock`, `social.nano`, `social.standard`, `social.deep`) to providers. Switching routes never touches Person identity.

---

## IntelligenceGateway

The **IntelligenceGateway** is the *single approved path* for all model inference.

**Pipeline:**
1. Cache lookup (content-hash keyed on shape + modelClass + context)
2. Route via ModelRouter
3. Budget preflight (`canReserve`) → reserve
4. Gateway diary wraps provider call (telemetry, timing)
5. Cache write (if miss)
6. Telemetry record

**Fail-closed guarantees:** Kill switch, budget ceilings, token caps, recursion guard, tier gate, provider unavailability all block *before* the call and produce deterministic fallback output.

---

## BudgetGovernor

The **BudgetGovernor** enforces hard limits *in front of every call*:

1. Kill switch
2. Per-event call cap (`maxCallsPerEvent = 1`)
3. Background call ceiling (`backgroundModelCalls = 0`)
4. Token ceilings per call
5. Model tier gate
6. Rolling hourly/daily spend ceilings

Every refusal increments `blockedCalls` telemetry. No silent bypasses.

---

## CircuitBreakers

**CircuitBreakers** detect runaway patterns *before* they cost money:

| Breaker | Trigger | Window | Auto-heal |
|---------|---------|--------|-----------|
| `duplicate_inference` | Identical scene context > 2x | 60s | Yes |
| `same_event_recursion` | Nested inference on same event | 60s | Yes |
| `rapid_event_explosion` | >20 events/60s | 60s | Yes |
| `excessive_retries` | >3 retries/60s | 60s | Yes |
| `repeated_provider_failure` | >3 failures/60s | 60s | Yes |
| `participant_fan_out` | >4 participants in scene | 60s | Yes |
| `context_explosion` | Context budget exceeded | **Hard** | No (manual reset) |
| `premium_model_escalation` | Cheap→expensive route flip | **Hard** | No |
| `repeated_cache_thrash` | >8 cache misses in row | 60s | Yes |

Breakers are advisory + audit; they don't kill the process but surface health for operators.

---

## Session

A **Session** is a long-running social context (road trip, evening hang, group chat, ambient companionship).

**Bounded context:** Every `compileContext` returns only the rolling message window (`rollingMessageWindow = 6`) + up to `maxParticipantCards = 4` participant cards. The durable log is full; the prompt is never.

**Session kinds:** `evening_social`, `road_trip`, `walk`, `group_hang`, `ambient`