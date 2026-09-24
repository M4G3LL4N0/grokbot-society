# Architecture

## Model

Five concepts are deliberately separate:

```
PERSON  canonical persistent identity (biography, personality, interests)
ROLE    reusable trait set (29 seeded roles, e.g. friend, mentor, wildcard)
ACTOR   ephemeral session persona materialized per-scene, never persistent identity
MODEL   capability class (social.mock / nano / standard / deep)
GROKBOT an INFERENCE SOURCE, never identity — a route, not an actor
```

GrokBots are interfaces to model capabilities, wired only by an operator
choosing routes. Everything else in the society works without one.

## Inference pipeline

All model calls flow through `IntelligenceGateway`. Providers are the only
thing that can touch a model, and providers **assert a gateway diary context**
(`assertGatewalledCall`) — calling a provider directly is architecturally
impossible from anywhere else in the codebase.

```
                   intake (user/event/tick)
                            │
                    deterministic validation
                            │
                 cache (content-hash) ─── hit → return, $0
                            │ miss
                    state / DB lookup
                            │
                 relevance scoring (deterministic)
                            │
              participant selection (max 3 speakers)
                            │
                context compilation (BASELINE+DELTA+EVENT,
                                     ONLY selected persons)
                            │
                      budget decision (fail closed)
                            │
                 at most ONE generation request
                            │
              deterministic output validation (no LLM judging LLM)
                            │
                  persistence (timeline, memory, relationships,
                               followups, serendipity, telemetry)
```

Ladder used to resolve any cognitive task:

`CACHE → STATE → DETERMINISTIC → DB/SCRIPT → CHEAP → CHATGPT → GROK`

Most scenes stop rungs before a GrokBot is ever asked. Background /
scheduled followups default to **zero** inference (`backgroundModelCalls = 0`)
and resolve deterministically.

## Layers

### `services/` — cheap, persistent, zero-inference state

- `PersonService` — persons, `current_state`, `last_active_at`, availability.
- `RoleService` — role registry + assignments.
- `RelationshipService` — dimension state + inertia + status ladder
  (`stranger → acquaintance → friend → close_friend → best_friend →
  romantic_interest → partner → spouse`).
- `CircleService` — circles / communities / memberships.
- `SocialGraph` — reach/path queries used by selection.
- `TimelineService` — event stream per person/circle.
- `MemoryService` — HOT/WARM/COLD tiers + privacy scopes.
- `TelemetryService` — call + cost ledger, per-event `providerCallsForEvent`.
- `CacheService` — content-hash cache keyed on shape+modelClass+context, with
  person-dependency invalidation.
- `BudgetGovernor` — per-event cap, hourly/daily spend, token caps, background
  ceiling, recursion guard (in-flight set keyed `eventId:reason`),
  `canReserve()` non-mutating preflight.

### `intelligence/` — the only place models are touched

- `IntelligenceGateway` — cache → route → budget reserve → diary-wrapped
  provider call → telemetry → cache set.
- `ModelRouter` — capability routing (`routes`), provider-neutral.
- `MockProvider` — deterministic $0 stand-in, exercises the full protocol.
- `DeterministicProvider` — template-only provider.
- `RemoteStubProvider` — nano/standard/deep scaffolding, fails closed unless
  environment credentials are configured.

### `runtime/` — scene orchestration

- `ParticipantSelector` — deterministic scoring (intensity, circle membership,
  relational closeness, topic/role relevance, speaker recency). Hard max 3.
- `ContextCompiler` — builds `__meta__` + SYSTEM + CIRCLE + per-person PROFILE
  sections; **only selected participants ever enter model context**.
- `SocialDirector` — single inference, deterministic validation, fail-closed
  fallback compose, budget preflight for background events.
- `SyntheticActorRuntime` — ephemeral per-scene persona materialization.
- `SerendipityEngine` — introduction of new persons must first pass
  deterministic eligibility (population, cooldown, recent intros, circle,
  intensity) before any probability; creation itself is zero-inference.
- `EventEngine` — the event-driven state machine. Interaction events route to
  the director; bookkeeping events apply deterministically. Never a
  continuous simulation loop.

### `GodKernel`

Composition root. `createKernel()` boots an in-memory society with a simulated
clock (tests/demo). `kernel.tell()` is the human entry point; `kernel.tick()`
processes due followups with zero background inference.