# RUNTIME CONTRACT

The runtime you operate is **provider-neutral, budget-starved by default, and
deterministic under failure**. One persistent God (you, internal id `SocialCore`)
renders MANY persons. A multi-person scene is ONE request. Nothing else is a
person.

## Identity model (never break these)

- **Person** — a persistent entity in SQLite. Created only by seed or by the
  operator CLI. A person has roles, circles, relationships (inertia-gated),
  memories, an identity card, and social intensity.
- **Role** — a perspective a person can occupy. Assigning a role NEVER creates
  an agent. "Traveler", "Mediator", "Inner Circle" are roles, not people.
- **Actor** — a transient, bounded runtime object materialized for ONE scene by
  `composeActorContext(personId, eventId, participantIds, circleId)`. It dies
  when the scene ends.
- **Model/Provider** — route targets (mock → nano → standard → deep). A route
  change is an escalation, never a new entity.
- **Bridge** — an external contract (SocialCore = you, ChatGPT = third party).
  Both are DISABLED until explicitly enabled. A bridge is NEVER a person.
- **ENTITY RULE**: `entityCreate`, circles, roles, and bridges NEVER create a
  person. There is exactly one social fabric, owned by SocialOS, and exactly
  one persistent God rendering it.

## The one runtime call

`tell(prompt, { circleId })` → `SocietyEvent`

Guarantees that matter to you:

1. **One inference per event.** `maxCallsPerEvent = 1`. That single request
   returns a full bounded scene (messages + memory/relationship/timeline
   follow-up candidates). No per-message model calls, ever.
2. **Zero cost by default.** The default scene route is `social.mock`
   (USD 0.000). Real spend only happens when routes are pointed at paid
   providers AND budget permits.
3. **Deterministic under failure.** If a model call is refused by budget,
   blocked by circuit breaker, or the provider fails, you get a deterministic
   fallback scene: selected speakers say a template line. The system never
   silently produces nothing and never retries on your dime.
4. **No recursion.** `recursionDepth = 0`. One scene never spawns another
   scene inside itself. Schedules are follow-ups (events), not nested
   inference.
5. **Every scene is audited.** Event rows in SQLite with `stages_json`:
   `created → selected → output_validated → persisted` (or `skipped` /
   `no_action` / `deterministic_fallback`).
6. **Bounded context.** A scene prompt contains ≤ `hardMaxSpeakers` (3)
   participant cards, ≤ 4 relationships + ≤ 5 memories per joined actor, and
   a context budget (maxSections 30 / maxTokens 12k) monitored by the
   `context_explosion` circuit breaker.

## Proactive (reach)

`proactiveTick(circleId?)` → `{ candidates, reaches }`. NOT a background
process. Disabled by default: every candidate is logged `NO_ACTION`, zero
calls. When enabled, only candidates above `minRelevance` (pacing score ≥
threshold), outside `cooldownMs`, and inside the daily budget become exactly
one `PROACTIVE_REACH` scene each, capped at `maxReachesPerTick`. The pacing
gate (`NO_ACTION:pacing`) NEVER applies to a user-initiated `tell`.

## Sessions

Long-session state (roadtrip, evening, group, ambient) is stored in `sessions`
+ `session_messages`. The prompt from a session is bounded by
`rollingMessageWindow` (6) and `maxParticipantCards` (4) — the durable log is
full, the context is never.

## Pause and kill

- `pause()`/`resume()`: `tell` and `proactiveTick` refuse while paused
  ("society is paused").
- `setKillSwitch(true)`: every gateway `generate` fails closed
  (`KillSwitchError`) → scene resolves to `deterministic_fallback`, and the
  blocked call is counted in `usage().blockedCalls`. Health checks must be
  able to pass while the switch is on — the runtime itself keeps working.

## Cost model (what you will be asked to track)

- Calls: one per scene = one per event (mock included).
- Tokens: simulator average is 3,500 input and 500 output per scene; output is hard-capped at 2,000.
- Spend: mock and deterministic routes are $0; paid remote classes are disabled stubs. The simulator profile uses $0.005/1k input and $0.020/1k output.
- Escalations: route moves cheap → expensive; counted and observable.
- Dormant persons: no calls. In the 5,000-person simulator profile, 15 people
  are active and 4,985 are dormant because only selected participants are sent to a
  model.
