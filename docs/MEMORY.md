# Memory: HOT/WARM/COLD + Privacy Scopes

Memory is how persons retain information across time. It is **tiered**, **scoped**, and **bounded**.

---

## Three Tiers

| Tier | Window | Retrieval Limit | Use Case |
|------|--------|-----------------|----------|
| **HOT** | Recent `hotWindow` events (default 8) | — | Immediate scene context |
| **WARM** | Older but accessible | `warmRetrievalLimit` (default 6) | Scene-relevant recall |
| **COLD** | Archived | `coldRetrievalLimit` (default 3) | Deep history, landmarks |

**Configuration:**
```typescript
memory: {
  hotWindow: 8,
  warmRetrievalLimit: 6,
  coldRetrievalLimit: 3
}
```

---

## Memory Records

```typescript
interface MemoryRecord {
  id: number;
  personId: string;
  scope: MemoryScope;           // private | person_user_shared | circle | public
  type: string;                 // scene | recollection | shared_history | landmark | note
  content: string;              // human-readable
  importance: number;           // 0.0–1.0
  confidence: number;           // 0.0–1.0
  circleId: string | null;      // for circle-scoped
  scopeRef: string | null;      // for person_user_shared (other person id)
  createdAt: number;
}
```

---

## Privacy Scopes (No Omniscient Hive Mind)

| Scope | Who Can Read | Typical Use |
|-------|--------------|-------------|
| `private` | The person only | Inner thoughts, secrets |
| `person_user_shared` | The person + the user (operator) | Shared user-person memories |
| `circle` | Members of the specified circle | Circle traditions, inside jokes |
| `public` | Anyone in the society | Public facts, announcements |

**Scene context compilation respects scopes:** When materializing an Actor for person A, only memories where `A` is in the allowed read set enter A's context. Person B's private memories never leak to A.

---

## Landmarks (Shared History)

Landmarks are **special shared-history memories** stored once per pair.

```typescript
// Stored as TWO rows (one per person), linked by scopeRef
kernel.landmark(personA, personB, "tradition", "First trail of spring", 0.9);
// → Row 1: personId=A, scope=person_user_shared, scopeRef=B
// → Row 2: personId=B, scope=person_user_shared, scopeRef=A
```

**Properties:**
- `type: "landmark"`
- `scope: "person_user_shared"`
- `scopeRef` = the other person's ID
- `importance` typically high (0.7–1.0)
- Queried via `memory.landmarksFor(a, b, limit)` — exact pair match

**Dedupe:** `landmarksFor(a, b)` returns existing landmarks for that exact pair. Re-adding the same landmark is idempotent.

---

## Retrieval for Scenes

When a scene is compiled for person A:

1. **HOT** — Last `hotWindow` events involving A (auto)
2. **WARM** — Up to `warmRetrievalLimit` memories matching scene participants/topics, scoped to A's visibility
3. **COLD** — Up to `coldRetrievalLimit` landmarks + high-importance memories
4. **Total bounded** by `ContextCompiler` section/token limits

**Key:** Only memories visible to A (per scope) are retrieved. A never sees B's `private` memories.

---

## Memory Candidates (Scene Output)

A scene can propose **memory candidates** — new memories to store:

```json
{
  "memoryCandidates": [
    {
      "personId": "p_...",
      "scope": "private",
      "type": "scene",
      "content": "Took part in a conversation about weekend plans",
      "importance": 0.35,
      "confidence": 0.6
    }
  ]
}
```

The `SocialDirector` validates and persists these after the scene. They enter the person's memory tier based on importance/recency.

---

## CLI Inspection

```bash
pnpm society person Emma              # shows landmarks + recent timeline
pnpm society landmarks Emma           # all landmarks for Emma
pnpm society landmarks Emma Sam       # shared landmarks between Emma & Sam
```

---

## Invariants

| Invariant | Enforced By |
|-----------|-------------|
| No cross-scope leaks | `MemoryService.retrieveForScene` filters by viewer's scope access |
| Landmark pair dedupe | `landmarksFor(a, b)` requires exact `(person_id=a AND scope_ref=b) OR (person_id=b AND scope_ref=a)` |
| Tier promotion | HOT → WARM → COLD by age/importance (background job, future) |
| Scope integrity | `store` validates scope/scopeRef combinations |
| Scene memory candidates | Validated by `SocialDirector` before persistence |