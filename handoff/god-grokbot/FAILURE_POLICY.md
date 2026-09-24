# FAILURE POLICY

The runtime is built to fail deterministically, never silently, never expensively.

## Fail modes and their outcomes

| failure | what the operator sees | recovery |
| --- | --- | --- |
| Kill switch ON | every `tell` → `deterministic_fallback`, `blockedReason: KillSwitch`, `usage().blockedCalls` grows | `pnpm society unkill` |
| Budget ceiling hit | scene → `deterministic_fallback`, `blockedReason` names the ceiling | lower volume / raise limits deliberately |
| `maxCallsPerEvent` (1) | further calls for that event refused → fallback | create a NEW event, don't fan out |
| Provider unavailable | `deterministic_fallback`, `blockedReason` set | resume provider / fix route |
| Context overflow | `context_explosion` trip (hard, no auto-heal) | reduce context budget usage; `debugger` trips via `breakers.reset()` |
| Runaway event rate (>20/60s) | `rapid_event_explosion` tripped | throttle; it auto-heals after 60s |
| Fan-out beyond cap | `participant_fan_out` tripped | reconcile selector caps |
| Recursion attempt | `RecursionBlockedError` → fallback (default depth 0 = impossible) | never nest scenes |
| Repeat provider failure (>3/60s) | `repeated_provider_failure` tripped | fix provider, do not hammer retries |
| Premium escalation churn | `premium_model_escalation` tripped | pin routes, stop oscillating tiers |
| Blowout beyond context register | `repeated_cache_thrash` tripped | stop regenerating identical scenes |
| Paused | `tell` and `proactiveTick` REJECT ("society is paused") | `pnpm society resume` |
| Unknown event type / validation | `ValidationError` thrown synchronously | fix caller, it is a bug not a scene |

## Principles

1. **Fails closed.** Every refusal path leaves a durable event row with a
   terminal status and a persisted outcome. Output is deterministic, bounded,
   and free.
2. **One cause, one call.** The budget governor is the single gate. Nobody
   bypasses it; any code path that spends has passed it.
3. **Circuit breakers are advisory + audit.** They don't fail the process;
   they trip so you can see the runaway. Breakers with `windowMs: 0`
   (context_explosion, premium_model_escalation) are hard trips that persist
   until `breakers.reset()`.
4. **No retry loops.** Retries require `maxRetries > 0` (default 0). Failure is
   surfaced as a scene outcome, not hidden behind an infinite loop.
5. **Never lie about health.** A blocked call that you "fixed" by disabling the
   kill switch without explaining it is the one failure mode you must never
   paper over.

## Watchlist (run when something "feels off")

```bash
pnpm society usage     # trips[], blockedCalls, escalations
pnpm society budget    # ceilings + how close you are
pnpm society events    # status mix: persisted vs deterministic_fallback vs no_action
```