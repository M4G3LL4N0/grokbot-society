# HEALTH CHECK

Run this every time you are asked "is the society healthy, and what does it
cost?" — target ~60 seconds.

```bash
pnpm society status       # persons/roles/circles/relationships/events/memories, calls, spend, blocked, escalations, proactive
pnpm society budget       # governor state + ceilings
pnpm society usage        # spend per person/circle/provider, cache, blocked calls, trips, active vs dormant
pnpm society events       # recent scene statuses
```

## Pass conditions

- `model calls` present, `est. spend` = $0.0000xx (mock) or within configured
  budget for real routes.
- `blocked calls` stable (no growth under normal load; grows ONLY when budget
  ceilings engage or the kill switch is ON).
- `proactive` shows `off (N no-action)` when disabled — candidates are audited
  `NO_ACTION`, zero calls, by design. Quiet is valid.
- `usage().trips` empty or nil (no circuit breakers tripped). If trips exist,
  health check FAILS the tripped breaker names.
- `events` shows `persisted` outcomes; kill switch produces
  `deterministic_fallback` (acceptable ONLY if switch is intentionally ON).
- No `unknown event type` errors; `close` closes the db cleanly.

## Kill switch health

```bash
pnpm society kill
pnpm society status          # kill switch: ON, blocked calls increments on any tell
pnpm society chat "hi"       # deterministic_fallback output, $0 spend
pnpm society unkill
```

The runtime itself must keep working while the switch is ON (health checks are
still runnable). Inference is what fails closed, not the software.

## Dormant-population check

```bash
pnpm society simulate
```

At 5,000 persons the proactive scenario must report `dormant > 4950` and 0
model calls; only the ~active subset is ever sent to a model. If the simulator
reports spend for dormant persons, something regressed.