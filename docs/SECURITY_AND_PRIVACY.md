# Security & Privacy

---

## Threat Model

GrokBot Society is a **local-first, single-process runtime**. It does not expose a network server by default. The primary security boundaries are:

1. **Provider credentials** — API keys for paid inference
2. **Person memory/relationship data** — private social graph
3. **Budget/governance** — preventing runaway spend
4. **Architectural invariants** — no provider bypass, no unbounded inference

---

## Credentials Management

### Environment-Level Secrets Only

```bash
# .env (never committed)
GROK_API_KEY=...
OPENAI_API_KEY=...
SOCIETY_NANO_API_KEY=...
```

**Rules:**
- No API keys in Person state, memory, or timeline
- No keys in SQLite database
- No keys in cache, telemetry, or event payloads
- Keys read **only** at provider initialization via `process.env`

### Provider Initialization

```typescript
// RemoteStubProvider reads env at construction
constructor(kind: StubKind) {
  if (kind === "deep") this.envKey = "GROK_API_KEY";
}
isAvailable(): boolean {
  return Boolean(process.env[this.envKey]);
}
```

If the env var is missing, the provider is unavailable and throws `ModelUnavailableError` — fail closed.

---

## Memory Isolation

### Privacy Scopes (Enforced at Read Time)

| Scope | Readable By |
|-------|-------------|
| `private` | The person only |
| `person_user_shared` | The person + operator (user) |
| `circle` | Members of that circle |
| `public` | Anyone |

**Enforcement:** `MemoryService.retrieveForScene(viewerId, ...)` filters every memory by the *viewer's* access rights. Person A's `private` memories are **never** returned when compiling context for Person B.

### No Cross-Person Leaks

- `retrieveForScene` loads memories of **all scene participants** but gates each by the **viewer's** scope access
- Landmarks (`person_user_shared`) are stored once per pair with `scopeRef = otherPersonId` — visible only to the two persons
- Circle-scoped memories require circle membership

---

## Database Security

### SQLite File Permissions

- Database file (`society.db`) contains: persons, roles, relationships, memories, events, timeline, sessions
- **No credentials** in the database
- File permissions should be `600` (owner read/write only) in production

### No PII in Telemetry/Events

Telemetry records:
- Event IDs, timestamps, caller, reason
- Provider, model, modelClass
- Token counts, estimated cost, duration
- Cache status

**Never recorded:** Person names, message content, memory text, relationship details.

---

## Architectural Guardrails

### No Provider Bypass

```typescript
// Every provider asserts this on entry
assertGatewalledCall(); // throws ProviderCallOutsideGatewayError
```

Only `IntelligenceGateway` sets the gateway diary flag. Direct provider calls are architecturally impossible.

### Fail-Closed Budget

Every inference request passes through `BudgetGovernor.reserve()` which checks:
1. Kill switch
2. Per-event call cap (`maxCallsPerEvent = 1`)
3. Background call ceiling (`backgroundModelCalls = 0`)
4. Token ceilings
5. Model tier gate
6. Hourly/daily spend ceilings

**Every refusal increments `blockedCalls` telemetry.** No silent bypasses.

### Circuit Breakers

9 breakers detect runaway patterns:
- `duplicate_inference`, `same_event_recursion`, `rapid_event_explosion`
- `excessive_retries`, `repeated_provider_failure`, `participant_fan_out`
- `context_explosion` (hard), `premium_model_escalation` (hard), `repeated_cache_thrash`

Breakers are advisory + audit; they don't kill the process but surface health.

### No Recursion / Retries

- `recursionDepth = 0` → nested inference throws `RecursionBlockedError`
- `maxRetries = 0` → no automatic retry loops on failure
- `backgroundModelCalls = 0` → scheduled work = $0 by default

---

## Operator CLI Security

The `pnpm society` CLI:
- Runs in-process (no network)
- Reads `--db` path or `SOCIETY_DB` env
- Reads `SOCIETY_INTENSITY` for user social intensity
- **Never sends data off-machine** unless a real provider is configured and budget allows

---

## Deployment Checklist

- [ ] Set database file permissions to `600`
- [ ] Store API keys in environment / secret manager (not `.env` in repo)
- [ ] Verify `modelTier` matches intended spend ceiling
- [ ] Set `hourlyBudget` / `dailyBudget` to enforceable limits
- [ ] Ensure `backgroundModelCalls = 0` unless explicitly needed
- [ ] Monitor `usage().blockedCalls` and `usage().trips` in production
- [ ] Keep `.env` out of version control (`.gitignore` includes it)
- [ ] No SQLite database files in repo (`.gitignore` includes `*.db`)

---

## Incident Response

| Symptom | Likely Cause | Action |
|---------|--------------|--------|
| `blockedCalls` spike | Budget ceiling hit | Check `usage()` for which ceiling; raise deliberately or reduce volume |
| `trips` non-empty | Circuit breaker tripped | Check `breaker.name`; `context_explosion`/`premium_model_escalation` require manual `breakers.reset()` |
| `providerEscalations` > 0 | Route flipped to expensive | Audit `ModelRouter` routes; pin to cheaper tier if unintended |
| `estimatedSpend` > budget | Real provider calls accumulating | Check `spendPerProvider`; disable expensive routes or raise budget |

---

## What This Project Does NOT Do

- ❌ No network server by default
- ❌ No authentication/authorization framework (single-user local tool)
- ❌ No encryption at rest (SQLite is plaintext; rely on filesystem perms)
- ❌ No audit logging beyond telemetry/events (add if needed)
- ❌ No GDPR/CCPA compliance tooling (build on top if required)

**If you need these, wrap the kernel in a service with appropriate guards.**