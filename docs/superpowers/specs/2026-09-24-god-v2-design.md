# GOD v2 Bridge Design

**Date:** 2026-09-24
**Status:** Approved from the prior God-v2 specification; implementation-ready
**Scope:** `grokbot-society` core only

## Goal

Add a safe, provider-neutral handoff for exactly one external God process while preserving the existing Society runtime, canonical state ownership, zero-cost defaults, and one-inference-per-event invariant. The local implementation is tested in dry mode only; no paid Grok or ChatGPT request is part of this work.

## Non-goals

- No live Grok/ChatGPT client, API key handling, or paid inference.
- No changes to the Person/Role/Actor/Model/GrokBot identity model.
- No new agent process, autonomous scheduler, or background simulation.
- No migration of prompts, transcripts, filler, logs, or development history.
- No redesign of the existing SocialDirector or deterministic renderer.

## Architecture

The bridge is a two-phase service in `src/godbridge/GodBridge.ts`.

1. `submit(GodEventInput)` validates a tiny event, creates a durable `events` row in `created`/`awaitingGod` state, uses the canonical `ParticipantSelector`, compiles only the selected Persons' bounded context, and persists the complete `GodJob` snapshot in the event payload.
2. The external God receives only the returned `GodInput`, performs the reasoning outside this repository, and returns a `GodResult` with `jobId`, `eventId`, structured deltas, and optional measured usage.
3. `apply(GodResult)` rehydrates the persisted snapshot, verifies job/event identity and closed status, validates all deltas against the selected Persons and hard limits, accounts for the external result through `IntelligenceGateway`, persists the validated scene, and closes the event/job atomically.
4. A second result is structurally impossible because the job status and event terminal state are persisted before the method returns.

The persisted event payload is the durable job record. This keeps the change small and makes CLI phase separation work across fresh processes without an in-memory-only job table.

## Context and privacy contract

`GodInput` contains only:

- event id, scene label, and normalized user message;
- at most three selected participant cards;
- bounded relationship rows between selected participants;
- bounded, privacy-filtered memory snippets for selected participants;
- explicit inclusion reasons and population counts, never a population roster;
- hard constraints and a compact output schema.

The bridge uses `kernel.selector` for selection and `kernel.composeActorContext` for each selected Person. It does not query or serialize the full database, repository files, logs, source paths, or all Persons.

## Safety and accounting

- `maxCallsPerEvent = 1`; `recursionDepth = 0`; `backgroundCalls = 0`; `maxRetries = 0`; `maxSpeakers = 3`.
- Bridge construction is disabled by default. The ordinary `GodKernel.tell()` path remains the deterministic fallback when disabled.
- Dry mode is the only mode exercised by tests and benchmarks. It persists a validated God result with zero cost but does not create a provider-call telemetry row.
- Live mode is opt-in and records an external result through a gateway-owned `acceptExternalResult` method. That method performs budget reservation, telemetry recording, and release in one controlled boundary; `GodBridge` never calls `TelemetryService.record()` directly.
- The gateway method accepts reported token/cost/latency data when present and falls back to deterministic estimates otherwise. Negative, non-finite, or over-limit values are rejected or clamped before persistence.
- The event stores the complete `GodCallUsage`, including model, provider, selected participants/roles/circle, tokens, cost, state changes, and miss-analysis signals.
- Follow-ups are inserted into the existing `followups` table with a future `fire_at`; applying a result never immediately calls the event engine.
- Candidate persistence follows the canonical SocialDirector path: messages touch selected Persons and append timeline rows, memories/relationships/timelines are applied, and follow-ups are scheduled.

## CLI

The operator surface is extended under `pnpm society god`:

- `health` reports bridge mode, safety state, pending jobs, and current state.
- `submit <json>` returns a bounded `GodInput` and durable job/event ids.
- `context <event-or-job-id>` returns the exact persisted package.
- `result <json>` validates and persists a returned result.
- `usage` returns event-level cost-per-social-value metrics.
- `benchmarks [A-F]` runs only in-memory dry scenarios.
- `compare <A-F>` reports normalized route estimates without contacting providers.

The default CLI database is the operator-selected `--db`/`SOCIETY_DB` path. Benchmarks always use a fresh `:memory:` kernel and never mutate the operator database.

## Benchmarks

Definitions A–F cover one Person, three Persons, a ten-Person circle, a 1,000-Person stored society, a ten-message conversation, and a thirty-turn session. Each definition records events, actual model calls (zero in dry mode), participants, context size, token totals, cost, and context-growth notes. A separate normalized comparison reports deterministic/mock, cheap, standard, and deep route estimates; it never executes a paid route.

## Migration and handoff

Old God migration accepts only durable Person facts, relationships, circles, memories, and explicit preferences. It ignores prompts, transcripts, filler, logs, and development history. A new tiny `handoff/god-v2/` package contains only `GOD_PROMPT.txt`, `SETUP.md`, `CONTRACT.json`, and `HEALTHCHECK.md`; the old handoff remains archived reference and is not silently edited into the new contract.

## Verification

Tests cover disabled/default behavior, canonical selection, bounded privacy, durable rehydration, duplicate/mismatched results, validation limits, canonical persistence, scheduled follow-ups, dry/live accounting, restart behavior, benchmark isolation, and route comparison. Final verification uses Node 24+, pnpm, typecheck, the full Vitest suite, the repository lint script, build/security checks where configured, and no network-backed model call.
