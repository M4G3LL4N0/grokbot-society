# HEALTHCHECK

Run before trusting anything. Target: under a minute.

```bash
pnpm society god health     # bridge state + hard limits
pnpm society god usage      # cost-per-social-value metrics
```

## Pass conditions

**`god health`**

- `enabled` matches what you intended (`true` only when a God is attached).
- `mode` is `dry` until you deliberately switch to `live`.
- `safety.maxCallsPerEvent` = 1
- `safety.recursionDepth` = 0
- `safety.backgroundCalls` = 0
- `safety.maxRetries` = 0
- `safety.proactivePaidInference` = false
- `safety.backgroundLifeSimulation` = false
- `runtime.killSwitch` = false
- `runtime.paused` = false

**`god usage`**

- `grok_calls` matches the number of interactions you actually ran.
- `avg_grok_input_tokens` is in the low thousands — not tens of thousands. If it
  is huge, the context slice has regressed.
- `cost_per_grok_event` is what you expect for the route.
- `events_zero_inference` should dominate `events_total`. If most events cost
  money, the society is paying to do work software should do.

## Failure drills (all free)

```bash
pnpm society kill
pnpm society god submit '{"type":"USER_MESSAGE","text":"still there?"}' --bridge
# expect: no external inference, KillSwitch reason, blockedCalls increments
pnpm society unkill

pnpm society pause
pnpm society god submit '{"type":"USER_MESSAGE","text":"hello"}' --bridge
# expect: rejects with "paused"
pnpm society resume
```

## Escalation posture

God must **earn** escalation. If the same kind of event keeps going to Grok,
check whether a deterministic template or a cheap model would do. Record the
answer in `missAnalysis` — it is already persisted on the event, so the review
costs nothing.
