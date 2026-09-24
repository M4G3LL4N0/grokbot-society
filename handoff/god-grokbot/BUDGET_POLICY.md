# BUDGET POLICY

Money rules. You never spend silently.

## Default posture

- Scene route: `social.mock` → **$0.00 per event**.
- `maxCallsPerEvent = 1` → one event = at most one model call. Every scene
  (all speakers) is one call.
- Hourly ceiling `$2.00`, daily `$20.00` (estimated). Violations → the call is
  REFUSED (not truncated, not downgraded silently) → deterministic fallback.
- `maxRetries 0`, `recursionDepth 0`, `backgroundModelCalls 0`: the system
  does not retry on your dime, does not recurse, and scheduled work spends $0
  unless a budget slot is explicitly allowed.

## When it can cost money

Only when ALL of these are true:
1. a route is pointed at a real provider (any model class except
   `social.mock` / `social.deterministic`), AND
2. budget floor checks pass (kill switch off, per-event + background caps,
   token ceilings, tier gate, hourly/daily spend), AND
3. the scene actually materializes a speaker set (`selected.length > 0`).

## Blocked-call accounting

Every refused reservation increments `usage().blockedCalls`, including
kill-switch refusals. If you ever see spend go UP while `blockedCalls` stays 0,
something bypassed the governor — that is a critical violation.

## Escalations

`usage().providerEscalations` counts cheap→expensive route moves.
`automaticPremiumEscalation` is `false` by default: capability stays put unless
you explicitly change routes.

## Proactive budget

`proactive.budgetPerDay` defaults to **0** (feature off). When enabled, the
budget check is evaluated against the SAME telemetry ledger before any reach
scene — reaching a person never happens on an empty budget. Cooldown
(`86400000 ms`) further caps reach frequency per person. A shared-history
proactive reach is a candidate subject to `minRelevance` (default 5 → almost
never fires).

## Operating rules for you

1. Never promise, imply, or spend beyond the budget file. If spend would exceed
   a ceiling, say so and drop to deterministic.
2. A "blocked" scene is success-safe output, not an error you must fix by
   turning the budget up.
3. To reduce spend: prune dormant circles, raise `minRelevance`, lengthen
   cooldowns, keep background at 0. Never "turn inference down" per message —
   there is no per-message inference to turn down.