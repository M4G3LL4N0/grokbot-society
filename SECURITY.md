# Security Policy

---

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | ✅ Yes    |

---

## Reporting a Vulnerability

**Do not open public issues for security vulnerabilities.**

Use [GitHub private vulnerability reporting](https://github.com/M4G3LL4N0/grokbot-society/security/advisories/new).

Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

Triage timing is best effort. Include enough detail for reproduction and impact assessment.

---

## Security Model

GrokBot Society is a **local-first, single-process runtime** with no network server by default. The security boundaries are:

### 1. Provider Credentials
- API keys read **only** from environment variables at provider initialization
- Never stored in SQLite, memory, cache, telemetry, or event payloads
- `.env` files excluded via `.gitignore`

### 2. Memory Isolation
- Privacy scopes enforced at read time (`private`/`person_user_shared`/`circle`/`public`)
- No cross-person memory leaks — `MemoryService.retrieveForScene` filters by viewer's access
- Landmarks stored once per pair with `scopeRef` linkage

### 3. Architectural Guardrails
- **No provider bypass**: `assertGatewalledCall()` in every provider
- **Fail-closed budget**: `BudgetGovernor` checks kill switch, caps, tiers before every call
- **Circuit breakers**: 9 breakers detect runaway patterns (advisory + audit)
- **No recursion/retries**: `recursionDepth = 0`, `maxRetries = 0`, `backgroundModelCalls = 0`

### 4. Data at Rest
- SQLite database contains social graph (persons, roles, relationships, memories, events)
- **No credentials in database**
- File permissions should be `600` in production

---

## Threat Mitigations

| Threat | Mitigation |
|--------|------------|
| Runaway LLM spend | Budget ceilings (per-event, hourly, daily), kill switch, circuit breakers |
| Provider credential leak | Env-only, never in DB/logs, `.gitignore` |
| Memory privacy violation | Scope enforcement at read time, no omniscient hive mind |
| Provider bypass | `assertGatewalledCall()` in every provider, architectural test |
| Unbounded context | `ContextCompiler` caps + `context_explosion` hard breaker |
| Recursion/retries | `recursionDepth = 0`, `maxRetries = 0` |
| Background inference | `backgroundModelCalls = 0` by default |

---

## What This Project Does NOT Provide

- ❌ Network server / authentication / authorization
- ❌ Encryption at rest (rely on filesystem permissions)
- ❌ Audit logging beyond telemetry/events
- ❌ GDPR/CCPA compliance tooling
- ❌ Multi-tenancy / RBAC

**If you need these, wrap the kernel in a service with appropriate guards.**

---

## Secure Deployment Checklist

- [ ] Database file permissions `600`
- [ ] API keys in environment / secret manager (not `.env` in repo)
- [ ] `modelTier` matches intended spend ceiling
- [ ] `hourlyBudget` / `dailyBudget` set to enforceable limits
- [ ] `backgroundModelCalls = 0` unless explicitly needed
- [ ] Monitor `usage().blockedCalls` and `usage().trips` in production
- [ ] `.env` in `.gitignore`
- [ ] No `*.db` files in repo (`.gitignore` includes them)

---

## Incident Response

| Symptom | Likely Cause | Action |
|---------|--------------|--------|
| `blockedCalls` spike | Budget ceiling hit | Check `usage()` for which ceiling; raise deliberately or reduce volume |
| `trips` non-empty | Circuit breaker tripped | Check `breaker.name`; `context_explosion`/`premium_model_escalation` require manual `breakers.reset()` |
| `providerEscalations` > 0 | Route flipped to expensive | Audit `ModelRouter` routes; pin to cheaper tier if unintended |
| `estimatedSpend` > budget | Real provider calls accumulating | Check `spendPerProvider`; disable expensive routes or raise budget |

---

## Contact

Security issues: [GitHub private vulnerability reporting](https://github.com/M4G3LL4N0/grokbot-society/security/advisories/new)

General issues: GitHub Issues
