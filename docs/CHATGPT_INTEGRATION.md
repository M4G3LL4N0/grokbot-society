# ChatGPT Integration

> **ChatGPT is an external intelligence service — a bridge, not a person.**

---

## What This Means

"ChatGPT integration" in GrokBot Society means:

- An **optional bridge** (`ChatGPTBridge`) that can render scenes
- Registered as a `SceneRenderer` alongside `MockSceneRenderer`
- **Disabled by default** — `enabled: false`
- When enabled, receives `BoundedScenePackage`, returns `BoundedSceneResult`
- Subject to all the same budget, validation, and circuit breaker rules

**ChatGPT is never a Person, never an Agent, never canonical state.**

---

## Architecture Position

```
┌─────────────────────────────────────────────┐
│              GodKernel                       │
│  ┌─────────────────────────────────────┐    │
│  │        IntelligenceGateway           │    │
│  │  (mock, deterministic, nano, etc.)   │    │
│  └─────────────────────────────────────┘    │
│  ┌─────────────────────────────────────┐    │
│  │        SceneRenderer                 │    │
│  │  ┌─────────────┐ ┌───────────────┐  │    │
│  │  │ MockScene   │ │ ChatGPTBridge │  │    │
│  │  │ Renderer    │ │ (disabled)    │  │    │
│  │  └─────────────┘ └───────────────┘  │    │
│  └─────────────────────────────────────┘    │
└─────────────────────────────────────────────┘
```

The `SocialDirector` delegates rendering to `SceneRenderer` interface. Multiple renderers can be registered; the director uses the first enabled one.

---

## Enabling ChatGPT Bridge

```bash
# 1. Set API key
export OPENAI_API_KEY=your_key_here

# 2. Enable in config (when bridge implementation exists)
bridges: {
  chatgpt: { enabled: true }
}
```

**Current status:** The `ChatGPTBridge` class exists in `src/intelligence/bridges.ts` but throws `BridgeDisabledError` when `enabled: false` (default).

---

## What ChatGPT Bridge Sees

Same `BoundedScenePackage` as GrokBot — the EXACT minimal payload for one scene:

```typescript
{
  scene: { eventId, eventType, actor, message, participants },
  identity: { personId → IdentityCard },
  responsibilities: { personId → [{ roleId, summary }] },
  relationship: { personId → [{ other, dims }] },
  memory: { personId → [{ type, text }] },
  outputBudget: { maxMessages: 3, maxTokens: 2000 }
}
```

**Canonical state NEVER leaves SocialOS.**

---

## What ChatGPT Bridge Returns

Same `BoundedSceneResult` contract:

```typescript
{
  messages: [{ personId, text }],
  memoryCandidates: [],
  relationshipCandidates: [],
  timelineCandidates: [],
  followups: [{ personId, kind, at }]
}
```

Validated by `SocialDirector` against selected participants.

---

## Why a Bridge, Not a Provider?

| Provider (IntelligenceGateway) | Bridge (SceneRenderer) |
|--------------------------------|------------------------|
| Handles `social.mock` → `social.deep` | Renders full scenes |
| Single generation call | May use multiple internal calls |
| Cost tracked per call | Cost tracked per scene |
| Model capability classes | External service contracts |
| Required path | Optional alternative |

The bridge pattern allows **external services with their own prompting logic** to render scenes, while keeping the rest of the pipeline (selection, context, validation, persistence) inside SocialOS.

---

## Cost & Budget

When enabled, the ChatGPT bridge:
- Counts as **one scene = one budget reservation**
- Uses the `social.standard` or `social.deep` route for cost estimation
- Subject to `maxCallsPerEvent = 1`, hourly/daily budgets
- Circuit breakers apply (`premium_model_escalation`, `participant_fan_out`)

---

## Disabling (Default)

```typescript
// bridges.ts
export const createBridges = (godRoute: RouteConfig) => ({
  socialcore: new SocialCoreAdapter(godRoute),   // enabled: false
  chatgpt: new ChatGPTBridge(),                  // enabled: false
});
```

**At default config: zero external service calls can occur.**

---

## Invariants

| Invariant | How |
|-----------|-----|
| ChatGPT never owns Person state | Only SocialOS writes canonical state |
| ChatGPT never decides who speaks | `ParticipantSelector` runs before any renderer |
| ChatGPT is optional | `enabled: false` by default; bridge throws if disabled |
| ChatGPT can be swapped | Renderer interface; zero Person migration |
| ChatGPT respects budgets | `BudgetGovernor` gates every scene |
| Bridge contract is minimal | `BoundedScenePackage` / `BoundedSceneResult` only |