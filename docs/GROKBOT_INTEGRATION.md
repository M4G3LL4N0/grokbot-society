# GrokBot Integration

> **GrokBot is optional premium infrastructure — a route, not an actor.**

---

## What GrokBot Is (in this project)

"GrokBot" refers to an **optional inference route** mapped to the `social.deep` capability class. It is:

- A provider implementation (e.g., calling Grok API)
- Registered in `IntelligenceGateway`
- Routed via `ModelRouter` when `social.deep` is requested
- Subject to all budget, tier, and circuit breaker rules

**GrokBot is NOT:**
- A person in the society
- An agent that runs continuously
- The "brain" of the system
- Required for the runtime to function

---

## Architecture Position

```
┌─────────────────────────────────────────────┐
│              GodKernel                       │
│  ┌─────────────────────────────────────┐    │
│  │        IntelligenceGateway           │    │
│  │  ┌───────────────────────────────┐  │    │
│  │  │ ModelRouter                    │  │    │
│  │  │  social.deep → GrokProvider    │  │    │
│  │  └───────────────────────────────┘  │    │
│  │  ┌───────────────────────────────┐  │    │
│  │  │ BudgetGovernor (fail closed)   │  │    │
│  │  └───────────────────────────────┘  │    │
│  └─────────────────────────────────────┘    │
└─────────────────────────────────────────────┘
```

The GrokProvider is **one of many providers**. The gateway doesn't know or care which provider handles `social.deep` — it only sees the `Provider` interface.

---

## Enabling GrokBot

```bash
# 1. Set API key
export GROK_API_KEY=your_key_here

# 2. Update routes (in config or code)
const routes = {
  ...DEFAULT_ROUTES,
  "social.deep": { provider: "grok", model: "grok-3" }
};

# 3. Ensure budget allows
budget: {
  modelTier: "deep",           // or "auto"
  dailyBudget: 50.0,           // raise from default $20
  hourlyBudget: 5.0
}
```

The `RemoteStubProvider("deep")` automatically becomes available when `GROK_API_KEY` is set.

---

## What GrokBot Sees

When a scene routes to `social.deep`, the GrokProvider receives a **BoundedScenePackage** — the EXACT minimal payload:

```typescript
interface BoundedScenePackage {
  scene: {
    eventId: string;
    eventType: string;
    actor: { id: string; name: string } | null;
    message: string;
    participants: Array<{
      personId: string;
      displayName: string;
      roleIds: string[];
    }>;
  };
  identity: Record<string, unknown>;        // IdentityCardCompiler output
  responsibilities: Record<string, { roleId: string; summary: string }[]>;
  relationship: Record<string, Array<{ other: string; dims: Record<string, number> }>>;
  memory: Record<string, Array<{ type: string; text: string }>>;
  outputBudget: { maxMessages: number; maxTokens: number };
}
```

**Canonical state NEVER leaves SocialOS.** The GrokBot sees only what one scene needs.

---

## What GrokBot Returns

The GrokBot must return a **BoundedSceneResult**:

```typescript
interface BoundedSceneResult {
  messages: Array<{ personId: string; text: string }>;
  memoryCandidates: unknown[];
  relationshipCandidates: unknown[];
  timelineCandidates: unknown[];
  followups: Array<{ personId: string; kind: string; at: number }>;
}
```

The `SocialDirector` validates this against the selected participants and budget.

---

## GrokBot as a Bridge Contract

The `handoff/god-grokbot/` package contains the **minimal operating contract** for any external entity (GrokBot "God" or ChatGPT bridge):

| File | Purpose |
|------|---------|
| `GOD_MINIMAL_PROMPT.md` | Identity + operating loop (extremely small) |
| `RUNTIME_CONTRACT.md` | The one `tell()` call and its guarantees |
| `EVENT_SCHEMA.md` | Event types, statuses, stages |
| `RESULT_SCHEMA.md` | Scene result shape |
| `BUDGET_POLICY.md` | Money rules |
| `FAILURE_POLICY.md` | Fail modes and recovery |

**The GrokBot instruction is extremely small.** It is never responsible for architecture.

---

## Disabling GrokBot

```bash
# Default: completely disabled
proactive: { enabled: false, budgetPerDay: 0 }
routes: { "social.deep": { provider: "mock", ... } }
budget: { modelTier: "mock" }
```

At default config, **zero paid inference can occur**.

---

## Invariants

| Invariant | How |
|-----------|-----|
| GrokBot never owns Person state | Only SocialOS writes Persons/relationships/memories |
| GrokBot never decides who speaks | `ParticipantSelector` runs before any provider call |
| GrokBot can be swapped | Route change = config only; zero Person migration |
| GrokBot respects budgets | `BudgetGovernor` gates every call |
| GrokBot is optional | Default runtime = 100% mock/deterministic at $0 |