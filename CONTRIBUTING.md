# Contributing

Thank you for contributing to GrokBot Society!

---

## Quick Start

```bash
# Clone and install
git clone https://github.com/M4G3LL4N0/grokbot-society.git
cd grokbot-society
pnpm install

# Verify
pnpm typecheck
pnpm test

# Run demo
pnpm dev

# Use CLI
pnpm society start --db ./society.db
pnpm society chat "Hello!" --circle <id> --db ./society.db
```

---

## Development Workflow

1. **Fork** the repository
2. **Create a branch** for your change: `git checkout -b feature/my-change`
3. **Make changes** following the invariants below
4. **Run verification**: `pnpm typecheck && pnpm test`
5. **Submit a PR** with a clear description

---

## Architectural Invariants (Must Preserve)

These are non-negotiable. Any PR violating them will be rejected.

| Invariant | Description |
|-----------|-------------|
| **No provider bypass** | All model calls go through `IntelligenceGateway`. Direct provider calls throw `ProviderCallOutsideGatewayError`. |
| **One call per event** | `maxCallsPerEvent = 1` enforced by `BudgetGovernor`. |
| **Zero background inference** | `backgroundModelCalls = 0` by default. Scheduled work = $0. |
| **No Person = Agent** | Persons are durable state. Actors are ephemeral per-scene. Roles create zero agents. |
| **No group-call fan-out** | Hard max 3 speakers per scene (`hardMaxSpeakers = 3`). |
| **No unbounded context** | ContextCompiler enforces section/token caps. `context_explosion` breaker is hard. |
| **No uncontrolled retries** | `maxRetries = 0`, `recursionDepth = 0`. Fail closed, deterministic fallback. |
| **Provider-neutral identity** | Switching routes never touches Person state. |

---

## Code Style

- **TypeScript strict mode** (`strict: true`, `noUncheckedIndexedAccess: true`)
- **No `any`** — use proper types
- **Immutable by default** — prefer `readonly`, `const`, pure functions
- **Explicit over implicit** — no magic, no hidden side effects
- **Error types over strings** — domain errors extend `SocietyError` with codes

### Formatting

```bash
# No formatter configured yet — keep consistent with existing code
# 2 spaces, trailing commas, semicolons
```

---

## Test Requirements

- **All tests must pass**: `pnpm test`
- **Typecheck must pass**: `pnpm typecheck`
- **New features need tests**: Add to `tests/` following existing patterns
- **Deterministic tests**: Use `SimulatedClock` and `rng: () => 1` (serendipity off)

### Test Structure

```
tests/
  helpers.ts           # makeKernel, sceneMessages, selectedIds
  01.mass-zero-cost.test.ts
  02.idle-dormant.test.ts
  03.scenes.test.ts
  04.identity-switching.test.ts
  05.guards.test.ts
  06.architectural-block.test.ts
  07.end-to-end.test.ts
  08.society-mvp.test.ts
```

---

## Adding a New Feature

1. **Identify the domain** (people, roles, relationships, circles, events, memory, runtime, intelligence, providers, budget, cache, telemetry, sessions, seed)
2. **Add types** in `src/god/types.ts` or domain-specific types file
3. **Implement service** in `src/<domain>/`
4. **Wire in GodKernel** if needed
5. **Add tests** in `tests/`
6. **Update docs** in `docs/`
7. **Run verification**: `pnpm typecheck && pnpm test && pnpm dev`

---

## Dependency Policy

- **Minimize dependencies** — prefer stdlib or tiny deps
- **No runtime deps** — all deps are `devDependencies`
- **Pin major versions** in `package.json`
- **Audit before adding** — `pnpm audit` on new deps

---

## Documentation

- Update `README.md` for user-facing changes
- Update `docs/` for architectural changes
- Update `docs/ROADMAP.md` for new features
- Keep `ARCHITECTURE.md` current

---

## Release Process

Maintainers only:
1. Update version in `package.json`
2. Update `CHANGELOG.md` (if exists)
3. Tag release: `git tag v0.x.y`
4. Publish to npm (if applicable)

---

## Questions?

Open an issue or start a discussion. We're happy to help.