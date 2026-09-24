# RESULT SCHEMA

Every interaction event carries `payload.sceneResult`:

```jsonc
{
  "output": {
    "messages": [
      { "personId": "p_...", "text": "..." }
    ],
    "memoryCandidates": [
      { "personId": "p_...", "content": "...", "kind": "recollection|shared_history|...." }
    ],
    "relationshipCandidates": [
      { "personId": "p_...", "targetId": "p_...", "dim": "familiarity|trust|affection",
        "delta": 0.0 }
    ],
    "timelineCandidates": [
      { "personId": "p_...", "kind": "note|event|session|proactive", "content": "..." }
    ],
    "followups": [
      { "personId": "p_...", "delayMs": 0, "reason": "..." }
    ]
  },
  "selected": [ "p_..." ],
  "fallbackUsed": false,
  "blockedReason": null,
  "skipped": false
}
```

## Columns you can rely on

- `selected` — person ids that entered the prompt (≤ `hardMaxSpeakers`).
- `output.messages[$i].personId` — MUST be inside `selected`; validated and
  sanitized by the director. Anything else is dropped.
- `blockedReason` — string when inference was refused; `null` when a model ran.

## Event-level status (the single source of truth)

| `payload.sceneResult` says | event `status` |
| --- | --- |
| `skipped: true` | `no_action` (pacing gated; output is empty + `selected` used for nothing) |
| `selected.length === 0`, not skipped | `silent` |
| `fallbackUsed: true` | `deterministic_fallback` (blockedReason explains) |
| normal | `persisted` |

## Fallback scene (from `fallbackCompose`)

When inference is impossible the director still yields one bounded scene:
`messages = first hardMaxSpeakers selected speakers, each speaking one
template line; no memory/relationship/timeline/followup candidates`.

## Bounded-context guarantee per prompt

- ≤ `hardMaxSpeakers` (3) participant cards
- ≤ 4 relationship rows + ≤ 5 memory rows per joined actor
- context budget ≤ `maxSections` (30) / `maxTokens` (12000); overflow trips the
  `context_explosion` circuit breaker and hard-drops to a smaller context
- cache key = `[modelClass, shape, provider:model, ...context sections]` →
  identical scenes are cache hits at $0 (breaker `repeated_cache_thrash`
  guards miss-avalanches).