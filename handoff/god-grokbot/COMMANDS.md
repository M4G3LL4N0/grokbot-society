# COMMANDS

All commands run through `pnpm society <command> [args]`. Default DB is
`./society.db` unless `--db <path>` or `SOCIETY_DB` is given.

```
start [--db <path>]                 boot society (idempotent seed on first run)
status                              society + model + cache state
people                              list persons
person <name-or-id>                 identity card + relationships + landmarks + timeline
roles                               role registry (roles create zero agents)
circles                             circles + members
events                              recent events
chat "<message>" [--circle <id>]    talk to the society (one bounded scene)
chat                                interactive REPL
budget                              budget governor state
usage                               telemetry: spend per person/circle/provider
simulate                            cost simulator (5 / 50 / 500 / 5000 people)
proactive [--circle <id>]           run one explicit proactive tick
session start|end <id>|context <id>  long-session abstraction
landmarks <name-or-id>              shared-history stores
identity <name-or-id>               debug: compact identity card
debug <name-or-id>                  debug: bounded actor context for one person
pause / resume                      pause/resume the society
kill / unkill                       fail-closed kill switch (blocks ALL inference)
close                               close the db cleanly
```

Env:
- `SOCIETY_DB=<path>` (default `./society.db`)
- `SOCIETY_USER=<name>`
- `SOCIETY_INTENSITY=quiet|low|normal|social|very_social|do_not_disturb`

## Working loop

1. `pnpm society status` — health, spend, blocked calls, proactive state.
2. `pnpm society people` — who exists (ids + roles).
3. `pnpm society person <name>` — the compact truth about one person.
4. `pnpm society circles` — which circles exist (grab an id).
5. `pnpm society chat "<line>" --circle <id>` — render one scene.
6. `pnpm society proactive` — explicit reach pass (default: all `NO_ACTION`).
7. `pnpm society usage` — audit every dollar spent and every blocked call.

## Demo commands for a fresh boot

```bash
pnpm society start --db /tmp/society-demo.db
pnpm society people
pnpm society person Emma
pnpm society chat "Anyone up for dinner tonight?" --circle <INNER_CIRCLE_ID>
pnpm society chat              # interactive REPL; type "exit" to leave
pnpm society session start inner_circle evening_social
pnpm society session context <SESSION_ID>
pnpm society session end <SESSION_ID>
pnpm society simulate          # shows dormant-population cost profile
pnpm society usage
```

## Finding the Inner Circle quickly

`pnpm society circles` prints each circle with an id; the demo society seeds an
"Inner Circle" containing Rey, Sam, Emma, Julian, Leo (id: `circle_...inner`).
`chat --circle <id>` requires a full circle id, not a name.