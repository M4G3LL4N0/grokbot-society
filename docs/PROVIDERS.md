# Providers: Abstraction & Identity Survival

Providers are the **only place models are touched**. The abstraction ensures Person identity survives model replacement.

---

## Provider Contract

```typescript
interface Provider {
  readonly name: string;              // "mock" | "deterministic" | "nano" | "standard" | "deep"
  readonly supports: ModelClass[];    // which capability classes this provider handles
  readonly isAvailable: () => boolean;
  generate(request: ProviderRequest): Promise<ProviderResult>;
}
```

**ProviderRequest:**
```typescript
{
  modelClass: ModelClass;      // "social.mock" | "social.nano" | ...
  shape?: OutputShape;         // "scene" | "json" | "text"
  context: string[];           // compiled context sections
}
```

**ProviderResult:**
```typescript
{
  provider: string;
  model: string;
  content: string;             // JSON string of SceneProviderPayload
  usage: { inputTokens, outputTokens };
  cost: number;                // USD
}
```

---

## Built-in Providers

| Provider | Name | Supports | Cost | Purpose |
|----------|------|----------|------|---------|
| `MockProvider` | "mock" | all classes | $0 | Default, exercises full protocol |
| `DeterministicProvider` | "deterministic" | mock, deterministic | $0 | Template-only, no model |
| `RemoteStubProvider` | "nano"/"standard"/"deep" | one class each | $0 (stub) | Scaffold for real integrations |

---

## The Gateway Barrier

**Providers cannot be called directly.** Every provider implements:

```typescript
async generate(request: ProviderRequest): Promise<ProviderResult> {
  assertGatewalledCall();  // throws if not inside IntelligenceGateway
  // ... actual generation
}
```

`IntelligenceGateway` wraps calls with `gatewayDiary.run()` which sets the guard flag. Calling a provider from anywhere else throws `ProviderCallOutsideGatewayError`.

**Test proof:** `tests/06.architectural-block.test.ts` — direct invocation of any provider throws.

---

## Provider-Neutral Routing

`ModelRouter` maps **capability classes** to concrete providers:

```typescript
const routes = {
  "social.deterministic": { provider: "deterministic", model: "template-v1" },
  "social.mock": { provider: "mock", model: "mock-v1" },
  "social.nano": { provider: "mock", model: "mock-v1" },      // stub
  "social.standard": { provider: "mock", model: "mock-v1" },  // stub
  "social.deep": { provider: "mock", model: "mock-v1" }       // stub
};
```

**Switching providers never touches a Person.** The route is pure configuration.

---

## Escalation Ladder

```
CACHE → STATE → DETERMINISTIC → DB/SCRIPT → CHEAP → CHATGPT → GROK
```

- `social.deterministic` — pure code/templates (floor)
- `social.mock` — structured mock responses
- `social.nano` — cheap real model (Haiku, Nano)
- `social.standard` — mid-tier (Sonnet, GPT-4o-mini)
- `social.deep` — premium (Opus, GPT-4o, Grok)

**Escalation tracking:** `ModelRouter.escalationCount()` increments on cheap→expensive route changes. `BudgetGovernor` can gate by `modelTier`.

---

## SceneProviderPayload (Structured Output)

Every provider returns a **structured scene payload** (validated by `SocialDirector`):

```typescript
interface SceneProviderPayload {
  messages: Array<{ personId: string; text: string }>;
  memoryCandidates: Array<{
    personId: string;
    scope: string;
    type: string;
    content: string;
    importance: number;
    confidence: number;
  }>;
  relationshipCandidates: Array<{
    personA: string;
    personB: string;
    dimsDelta: { familiarity: number; comfort: number };
  }>;
  timelineCandidates: Array<{
    personId: string;
    kind: string;
    content: string;
  }>;
  followups: Array<{
    personId: string;
    delayMs: number;
    reason: string;
  }>;
}
```

**Validation:** `SocialDirector.validateSceneOutput` ensures:
- All `personId` in messages are in `selected`
- No extra fields
- Reasonable bounds

---

## Adding a Real Provider

1. Implement `Provider` interface
2. Register in `IntelligenceGateway`:
   ```typescript
   gateway.register(new MyRealProvider());
   ```
3. Update `ModelRouter` routes to point capability classes at the new provider
4. Set API keys via environment (e.g., `OPENAI_API_KEY`, `GROK_API_KEY`)
5. `RemoteStubProvider` will become available when its env key is set

**Identity survival:** The Person, their roles, relationships, memories, and timeline are **unchanged**. Only the inference backend differs.

---

## Cache Invalidation

Cache keys: `sha256([modelClass, shape, provider:model, ...contextSections])`

Dependencies: `cacheDeps` = selected person IDs. When a person's state changes (relationship, memory, role), their ID invalidates relevant cache entries.

**Breaker:** `repeated_cache_thrash` trips on >8 consecutive misses (avalanche guard).

---

## Invariants

| Invariant | How |
|-----------|-----|
| No direct provider calls | `assertGatewalledCall()` in every provider |
| Single path for inference | All routes through `IntelligenceGateway` |
| Provider-neutral identity | `ModelRouter` swaps routes; Person untouched |
| Structured output | `SceneProviderPayload` schema validated |
| Cost tracking | Every gateway call records telemetry |
| Fail closed | Budget/kill/availability block before provider |