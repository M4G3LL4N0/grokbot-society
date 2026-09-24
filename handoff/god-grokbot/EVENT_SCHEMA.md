# EVENT SCHEMA

Every event is an immutable row in `events`:

```
{ id, event_type, actor_id, person_ids_json, circle_id, payload_json,
  status, source, stages_json, created_at, processed_at }
```

## Event types

### Interaction types — go through the SocialDirector (≤1 inference each)

| type | meaning | status on success |
| --- | --- | --- |
| `USER_MESSAGE` | user talks to society (default route) | `persisted` |
| `DIRECT_INTERACTION` | user → specific person(s) | `persisted` |
| `GROUP_INTERACTION` | user → circle | `persisted` |
| `SCHEDULED_FOLLOWUP` | scheduled follow-up. Background → **zero inference unless budget allows**; else deterministic + `blockedReason background inference disabled` | `persisted` |
| `CIRCLE_EVENT` | circle-level event (walls/threshold calls) — **subject to pacing gate** | `persisted` or `no_action` |
| `PROACTIVE_REACH` | proactive reach from tick — ONE scene per reach — **subject to pacing gate** | `persisted` or `no_action` |
| `SESSION_MESSAGE` | message injected from a running session | `persisted` |

### Bookkeeping types — deterministic, zero inference, no model ever

| type | meaning |
| --- | --- |
| `RELATIONSHIP_EVENT` | relationship deltas applied |
| `TIMELINE_EVENT` | timeline entry appended |
| `CONTEXT_CHANGE` | context register updated (dedupe, snapshot) |
| `INTRODUCTION_CANDIDATE` | serendipity considered (only fires after a real scene) |
| `SESSION_START` | session opened |
| `SESSION_END` | session closed |
| `PROACTIVE_CANDIDATE` | proactive candidate audited (verdict `NO_ACTION` in payload) |
| `LANDMARK_EVENT` | shared-history landmark stored |

## Status === terminal outcome

| status | meaning |
| --- | --- |
| `created` | row inserted (before processing) |
| `persisted` | model-backed scene, validated, output applied |
| `deterministic_fallback` | model refused/blocked/failed → deterministic output used (`blockedReason` set) |
| `silent` | scene selected no speakers — nothing said, nothing spent |
| `no_action` | candidate gated by social pacing or minimum pacing score (`skipped: true`, `blockedReason: "NO_ACTION:pacing"`) |

## Stages (`stages_json`)

`created → validated → scored → selected → context_compiled →
inference_attempted → output_validated → persisted`
(skipped events stop at `skipped` instead.)

## Payload — what you can read off an interaction event

`payload.sceneResult` is documented in `RESULT_SCHEMA.md`.

## Proactive candidates

A `PROACTIVE_CANDIDATE` event's payload always carries the verdict:
`{ personId, verdict: "NO_ACTION", score, reasons }`. A `PROACTIVE_REACH`
event's payload carries `{ pacingScore, proactive: true, reasons }`.
`usage().proactive.noActions` counts `PROACTIVE_CANDIDATE` rows whose payload
verdict is `NO_ACTION`.

## Storage contract

- `createKernel` auto-creates the `events` (and all other) tables with
  `CREATE TABLE IF NOT EXISTS`. Existing databases upgrade in place.
- Tables that exist: persons, roles, person_roles, circles, circle_members,
  relationships, memories, timeline, events, followups, sessions,
  session_messages, meta + indexes. Do not add tables at runtime.