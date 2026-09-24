# Test Report

Run with `pnpm test` (vitest) and `pnpm typecheck` (tsc `--noEmit`).

**Result (2026-09-23): 25/25 pass across 7 files. Typecheck clean.**

## The 14 required proofs

| # | Proof | File | Verdict |
| --- | --- | --- | --- |
| 1 | Creating 1,000 Persons makes zero model calls | `01.mass-zero-cost.test.ts` | PASS |
| 2 | Assigning 1,000 Roles makes zero model calls | `01.mass-zero-cost.test.ts` | PASS |
| 3 | Creating 100 Circles makes zero model calls | `01.mass-zero-cost.test.ts` | PASS |
| 4 | Adding thousands of relationships makes zero model calls | `01.mass-zero-cost.test.ts` | PASS |
| 5 | Idle elapsed time → zero model calls | `02.idle-dormant.test.ts` | PASS |
| 6 | Dormant state → zero inference, no manufactured serendipity | `02.idle-dormant.test.ts` | PASS |
| 7 | 3-person scene → at most ONE model request | `03.scenes.test.ts` | PASS |
| 8 | Only selected participants enter model context | `03.scenes.test.ts` | PASS |
| 9 | Silence is valid (no eligible → no inference, no fake chatter) | `03.scenes.test.ts` | PASS |
| 10 | Never activates everyone: 10-member circle → ≤ 3 speakers | `03.scenes.test.ts` | PASS |
| 11 | Canonical identity survives provider switching | `04.identity-switching.test.ts` | PASS |
| 12 | Kill switch blocks all model calls (fail closed) | `05.guards.test.ts` | PASS |
| 13 | Budget limit blocks calls beyond `maxCallsPerEvent` | `05.guards.test.ts` | PASS |
| 14 | Recursion is impossible (`recursionDepth = 0`) | `05.guards.test.ts` | PASS |

## Architectural guarantees

| Guarantee | File | Verdict |
| --- | --- | --- |
| Provider calls outside `IntelligenceGateway` are impossible | `06.architectural-block.test.ts` | PASS |
| Unavailable model class fails closed, never falls back to paid | `05.guards.test.ts` | PASS |
| Background/scheduled followups run with zero inference | `07.end-to-end.test.ts` | PASS |

## Domain proofs

| Behavior | File | Verdict |
| --- | --- | --- |
| Relationship inertia (one interaction ≠ spouse) | `07.end-to-end.test.ts` | PASS |
| Knowledge privacy (private/circle/public scopes, no omniscient hive mind) | `07.end-to-end.test.ts` | PASS |
| Intelligence cache reuses identical requests ($0, no second call) | `07.end-to-end.test.ts` | PASS |
| MockProvider boots → chats → remembers → befriends → schedules end-to-end | `07.end-to-end.test.ts` | PASS |

## Incident ledger (bugs found by tests, each fixed)

1. `CircleService.members()` cast rows with camelCase names while
   `node:sqlite` returns `member_id`/`member_type` → circle membership never
   matched and groups silently produced empty scenes. Fixed with proper
   row mapping.
2. `MemoryService.store()` bound `undefined` as source → node:sqlite bind
   error ("parameter 7"). Fixed with a `source ?? "manual"` default.
3. `retrieveForScene()` only loaded the viewer's own memories, so shared
   circle facts never reached co-members. It now loads memories of all scene
   participants and gates each by the viewer's privacy scope.

## Demo

`pnpm dev` boots the seeded society and runs one group scene on MockProvider:
1 model call, ≥3 messages, 2 timeline/relationship writes, $0 total cost.