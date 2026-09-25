# Roadmap

> **Clear separation: DONE = working code with tests. NEXT = planned with design. EXPERIMENTAL = ideas without implementation.**

---

## ✅ DONE (v0.1.0)

### Core Runtime
- [x] Provider-neutral `IntelligenceGateway` (cache → route → budget → diary → provider)
- [x] `MockProvider` (deterministic, $0, full protocol)
- [x] `DeterministicProvider` (template-only, budget-subject)
- [x] `RemoteStubProvider` (nano/standard/deep scaffolds, fail-closed)
- [x] `ModelRouter` (capability classes → providers, escalation tracking)

### Social OS (Zero-Inference Persistent State)
- [x] `PersonService` (CRUD, state, availability)
- [x] `RoleService` (29 seeded roles, assignments)
- [x] `RelationshipService` (7 dims, inertia, status ladder, privacy scopes)
- [x] `CircleService` (communities, ordered membership, kinds)
- [x] `SocialGraph` (reachability, shared circles, selection support)
- [x] `TimelineService` (per-person/circle event stream)
- [x] `MemoryService` (HOT/WARM/COLD tiers, 4 privacy scopes, landmarks)
- [x] `TelemetryService` (call + cost ledger, per-event `providerCallsForEvent`)
- [x] `CacheService` (content-hash, dependency invalidation)
- [x] `BudgetGovernor` (per-event/hourly/daily caps, token ceilings, tier gate, kill switch, recursion guard)

### Scene Orchestration
- [x] `ParticipantSelector` (deterministic scoring, hard max 3 speakers)
- [x] `ContextCompiler` (BASELINE+DELTA+EVENT, bounded sections/tokens)
- [x] `SocialDirector` (single inference, deterministic validation, fail-closed fallback)
- [x] `SyntheticActorRuntime` (ephemeral per-scene persona materialization)
- [x] `SerendipityEngine` (deterministic eligibility before probability)
- [x] `EventEngine` (interaction + bookkeeping types, stages, statuses)
- [x] `SceneRenderer` interface + `MockSceneRenderer` (provider-neutral)
- [x] `ProactiveEngine` (conservative, disabled by default, cooldown/budget/relevance gates)
- [x] `CircuitBreakers` (9 breakers, advisory + audit)
- [x] `SessionRuntime` (rolling window + participant cards, bounded context)
- [x] `CostSimulator` (deterministic arithmetic, dormant-population profiles)
- [x] `IdentityCardCompiler` (compact frozen Person snapshots)

### Seeding & CLI
- [x] `seedRoles` (29 roles, 11 circles)
- [x] `seedSociety` (5 persons, 10 rel pairs, 5 landmarks, idempotent)
- [x] Operator CLI (`pnpm society`) — 21 commands
- [x] Demo entrypoint (`pnpm dev`)

### Verification
- [x] 128 tests across 13 files (14 required proofs + architectural guarantees + domain proofs + Society MVP + God bridge + offload contract + benchmarks)
- [x] `pnpm typecheck` clean (strict TS, noUncheckedIndexedAccess)
- [x] Zero-cost MockProvider operation verified

### Handoff
- [x] `handoff/god-grokbot/` — minimal God operating package
- [x] `GOD_MINIMAL_PROMPT.md` — extremely small instruction

---

## 🔄 NEXT (v0.2.0)

### Real Provider Integrations
- [ ] `OpenAIProvider` (nano/standard via OpenAI API)
- [ ] `AnthropicProvider` (nano/standard via Anthropic API)
- [ ] `GrokProvider` (deep via xAI API)
- [ ] Feature-flagged enablement per capability class
- [ ] Streaming support (optional, for UX)

### Observability
- [ ] Structured logging (pino/winston)
- [ ] OpenTelemetry metrics (calls, latency, cost, cache hit rate, breaker state)
- [ ] Health endpoint (`/healthz` for future server mode)
- [ ] Structured audit log (JSONL) for event replay

### Persistence & Scale
- [ ] Connection pooling for SQLite (better concurrent access)
- [ ] WAL mode tuning / benchmarking
- [ ] 10k+ person stress test (memory, selection latency)
- [ ] Background tier promotion job (HOT→WARM→COLD)
- [ ] Compaction / vacuum strategy

### Operator Experience
- [ ] WebSocket server for real-time society observation
- [ ] Admin API (REST) for society management
- [ ] Society import/export (JSONL)
- [ ] Persona editor (CLI or TUI)
- [ ] Timeline visualization

### Testing & CI
- [ ] Property-based tests (fast-check) for selection/context invariants
- [ ] Chaos tests (kill switch mid-scene, budget exhaustion, provider failure)
- [ ] CI matrix: Node 24, 26 (if available)
- [ ] Dependency update automation (dependabot/renovate)

---

## 🧪 EXPERIMENTAL (v0.3+)

### Multi-Society Federation
- Multiple `GodKernel` instances sharing a `SocialGraph` namespace
- Cross-society circles / shared persons
- Federation protocol for event sync

### Learned Relevance (Still Provider-Neutral)
- Replace deterministic scoring with lightweight learned model (ONNX/WASM)
- Trained on Society's own telemetry (selection → engagement)
- Provider-neutral: model is a *scorer*, not a generator

### Visual Society Inspector
- React/Vue frontend connecting via WebSocket
- Live graph view (persons, circles, relationships)
- Event timeline replay
- Cost/budget dashboard

### Plugin System
- Custom event types (register via `EventEngine`)
- Custom memory types / scopes
- Custom participant selection strategies
- Custom context compilers

### Natural Language Interface
- Operator speaks to society via LLM (separate from scene inference)
- "Show me Emma's relationships" → kernel query → natural response
- Distinct from scene generation (different budget, different model)

---

## Non-Goals (Explicitly Out of Scope)

| Non-Goal | Reason |
|----------|--------|
| Multi-user server with auth | Single-user local tool; wrap if needed |
| Built-in UI / dashboard | CLI + WebSocket for external UI |
| Fine-tuning / training loops | Provider-neutral; bring your own model |
| Vector database / embeddings | Deterministic retrieval works; add if proven needed |
| Blockchain / crypto / tokens | Not a social protocol |
| Autonomous agent swarms | Architecture explicitly prevents this |
| "AGI" or "consciousness" claims | This is a deterministic social kernel |

---

## Release Cadence

| Version | Target | Focus |
|---------|--------|-------|
| v0.1.x | Current | Bug fixes, docs, CI |
| v0.2.0 | Unscheduled | Real providers, observability, scale |
| v0.3.0 | Unscheduled | Federation, learned relevance, plugins |
| v1.0.0 | TBD | API stability, production hardening |

**Versioning:** SemVer. v0.x = breaking changes possible. v1.0 = stable public API.
