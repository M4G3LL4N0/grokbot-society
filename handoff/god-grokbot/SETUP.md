# SETUP

## Prerequisites

- Node >= 24 (uses built-in `node:sqlite`).
- pnpm installed.

## Install

```bash
pnpm install
```

## Scripts

```bash
pnpm typecheck        # tsc --noEmit
pnpm test             # vitest run (42 tests across 8 files)
pnpm dev              # demo bootstrap script
pnpm society          # operator CLI (main operator surface)
```

## Boot a society on disk

```bash
pnpm society start --db <path>
```

- `--db <path>` or env `SOCIETY_DB` — persistent SQLite file. Omit → in-memory
  (`:memory:`, ephemereal).
- env `SOCIETY_INTENSITY=<normal|high|low|quiet|do_not_disturb>` — operator
  social intensity (drives proactive scoring).
- Seeding is idempotent: 5 persons, 29 roles, 11 circles, 10 relationship
  pairs, 5 shared-history landmarks, 5 seed events. Re-running `start` or
  calling `ensureSeeded()` never duplicates rows.

## Config (defaults, all optional)

Society overrides:
- `maxPersons 1000`, `maxCircles 200`, speakers `min 1 / max 3 / hard 3`
- proactive: `enabled false`, `minRelevance 5`, `cooldownMs 86400000`,
  `maxReachesPerTick 1`, `budgetPerDay 0`
- sessions: `rollingMessageWindow 6`, `maxParticipantCards 4`
- memory: hot 8 / warm 6 / cold 3 · relationships: `maxDeltaPerScene 0.1`

Intelligence overrides (env/config):
- route model class: `social.mock` (zero cost) by default
- budget: `maxCallsPerEvent 1`, hourly `$2.00`, daily `$20.00`,
  `maxInputTokensPerCall 12000`, `maxOutputTokensPerCall 2000`,
  `maxRetries 0`, `recursionDepth 0`, `backgroundModelCalls 0`
- `killSwitch false`, cache `maxEntries 5000`

## Pointing at a real model (the only place money can appear)

Replace the DEFAULT_ROUTES values (or pass intelligence.routes) so that a
model class resolves to a configured real provider. Do this ONLY with budget
limits in place. `social.mock`/`social.deterministic` are always $0.

## Connecting

- Use the CLI for everything you need to do operationally (see
  `COMMANDS.md`).
- Programmatic entrypoint: `createKernel(society, overrides, intelligence)`
  in `src/GodKernel.ts`. There is no server, no network, no payment route.

## Trust boundaries

- Providers can only be reached through the IntelligenceGateway (`gatewayDiary`
  + budget). A provider called directly throws `ProviderCallOutsideGatewayError`.
- Budget lives in-front-of every call: kill switch → per-event cap → background
  cap → token ceilings → tier gate → hourly/daily spend.
- You cannot add new tables or columns at runtime. Schema is in `src/db.ts`.