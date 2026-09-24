# Cost Model: Why Population Stays Cheap

> **Central equation:** `cost ≈ meaningful generated interaction`, not `cost ≈ population × relationships × time`

---

## The Problem with Naive Agent Swarms

| Naive approach | GrokBot Society |
|----------------|-----------------|
| One agent per person | One kernel, many persons |
| One call per message | One call per **multi-person scene** |
| Continuous background loop | **Zero inference at rest** |
| Unbounded context | **Bounded context (≤3 speakers, ≤12k tokens)** |
| Full history in every prompt | **Rolling window + participant cards only** |
| Retry on failure | **Fail closed, no retries** |
| Provider lock-in | **Provider-neutral; swap without touching persons** |

---

## Where Money Can Be Spent

Money is **only** spent when ALL of these are true:

1. A route points at a real provider (not `mock`/`deterministic`)
2. Budget floor checks pass (kill switch off, caps OK, tier allowed)
3. A scene actually materializes speakers (`selected.length > 0`)

**Default:** `social.mock` route → **$0.00 per event, forever.**

---

## Cost Ladder

```
CACHE (free, instant)
    ↓ miss
STATE / DB LOOKUP (free)
    ↓
RELEVANCE SCORING (free, deterministic)
    ↓
PARTICIPANT SELECTION (free, max 3)
    ↓
CONTEXT COMPILATION (free, bounded)
    ↓
BUDGET DECISION (free, fail closed)
    ↓
AT MOST ONE GENERATION REQUEST (where cost lives)
    ↓
DETERMINISTIC VALIDATION (free)
    ↓
PERSISTENCE (free)
```

**Most scenes stop before the generation rung.**

---

## Verified Simulator Pricing Profile

No paid provider is connected in v0.1.0. `MockProvider` and `DeterministicProvider` cost $0. The nano, standard, and deep classes are fail-closed remote stubs with no live quote.

The deterministic `CostSimulator` uses this reproducible profile:

| Input assumption | Value |
|------------------|-------|
| Average input tokens per call | 3,500 |
| Average output tokens per call | 500 |
| Simulated input rate | $0.005 / 1k tokens |
| Simulated output rate | $0.020 / 1k tokens |
| Derived cost per scene | $0.0275 |

These assumptions produce the verified scenario totals below. They are not provider quotes.

---

## Budget Ceilings (Hard Limits)

| Ceiling | Default | Behavior on Hit |
|---------|---------|-----------------|
| `maxCallsPerEvent` | 1 | Refuse → deterministic fallback |
| `hourlyBudget` | $2.00 | Refuse → deterministic fallback |
| `dailyBudget` | $20.00 | Refuse → deterministic fallback |
| `maxInputTokensPerCall` | 12,000 | Refuse |
| `maxOutputTokensPerCall` | 2,000 | Refuse |
| `modelTier` | "auto" | Refuse if route exceeds tier |
| `backgroundModelCalls` | 0 | Scheduled work = $0 |
| `maxRetries` | 0 | No retry loops |
| `recursionDepth` | 0 | No nested inference |

**Every refusal increments `usage().blockedCalls`** — visible in telemetry.

---

## Dormant Population = $0

In the 5,000-person simulator profile, 15 people are active and 4,985 are dormant. Dormant people add $0.

**Why:** Only *selected participants* (≤3 per scene) ever enter a model context. Dormant people remain in SQLite but never touch a model.

```bash
pnpm society simulate
# At 5,000 population:
# 1:1 conversation (20 msgs)        → $0.44 (only active subset)
# 3-person group (15 msgs)          → $0.33
# 30-message evening                → $0.66
# Road-trip session (40 msgs)       → $0.88
# 10 proactive candidates (0 reach) → $0.00
# Dormant in ALL scenarios          → 4,985 → $0
```

---

## Proactive Budget

Proactive reach (society-initiated) has its own budget:

```typescript
proactive: {
  enabled: false,           // off by default
  minRelevance: 5,          // high threshold = rarely fires
  cooldownMs: 86_400_000,   // 24h per person
  maxReachesPerTick: 1,     // conservative
  budgetPerDay: 0           // $0 unless explicitly enabled
}
```

When enabled, proactive candidates are evaluated against `minRelevance` (pacing score). Only candidates above threshold, outside cooldown, and within `budgetPerDay` become `PROACTIVE_REACH` scenes. Each reach = one scene = one call.

---

## Telemetry: What You Can Audit

```bash
pnpm society usage
```

Returns:
```json
{
  "callsToday": 3,
  "callsPerEvent": 1,
  "tokens": { "input": 1514, "output": 565 },
  "estimatedSpend": 0.000000,
  "spendPerPerson": { "Emma Reyes": 0.0 },
  "spendPerCircle": { "Inner Circle": 0.0 },
  "spendPerProvider": { "mock": 0.0 },
  "cache": { "hits": 0, "misses": 0, "entries": 3 },
  "blockedCalls": 0,
  "providerEscalations": 0,
  "activePersons": 5,
  "dormantPersons": 0,
  "proactive": { "enabled": false, "reaches": 0, "noActions": 13 },
  "trips": []
}
```

**Key invariant:** `callsPerEvent ≤ 1` always. If you see >1, something bypassed the governor.

---

## Cost-Safe Operating Rules

1. **Never promise spend beyond the budget file.** If a ceiling hits, say so and drop to deterministic.
2. **A blocked scene is success-safe output**, not an error to fix by raising limits.
3. **To reduce spend:** prune dormant circles, raise `minRelevance`, lengthen cooldowns, keep `backgroundModelCalls = 0`.
4. **There is no per-message inference to turn down.** One scene = one call.

---

## Simulating Cost

```bash
pnpm society simulate
```

Outputs a table for populations 5 / 50 / 500 / 5,000 across 5 scenarios. The "dormant → $0" column proves the architecture.

---

## What Costs Money vs. What Doesn't

| Costs $0 (default) | Can Cost $ (opt-in) |
|--------------------|---------------------|
| Creating 10,000 persons | Real provider routes |
| Assigning 50,000 roles | `social.nano`/`standard`/`deep` |
| Building 1,000 circles | Enabling proactive with budget |
| 1M relationship edits | Raising `hourlyBudget`/`dailyBudget` |
| Idle time (any duration) | Disabling `maxRetries = 0` |
| Cache hits | Manual retries |
| Deterministic fallback scenes | |
| Background/scheduled followups | |
| Kill switch engaged | |