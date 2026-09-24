# SETUP — fresh God v2

You are creating ONE fresh GrokBot. Do not reuse the old God conversation.

## 1. Identity

Paste the entire contents of `GOD_PROMPT.txt` as the system prompt. It is the
whole identity — do not append architecture docs, README, or prior prompts.

## 2. Commands

God needs three commands and nothing else. All are run by the operator on the
machine running the society.

```bash
# 1. hand God a tiny event; Society replies with what it needs (or nothing)
pnpm society god submit '{"type":"USER_MESSAGE","text":"What is everyone doing tonight?"}' --bridge

# 2. (optional) inspect the bounded slice Society built
pnpm society god context <eventId>

# 3. hand the structured result back; Society persists it
pnpm society god result '{"jobId":"godjob_<eventId>","eventId":"<eventId>","messages":[{"personId":"<selected id>","text":"..."}]}'
```

`god submit` prints the full `GodInput` on stdout: participants, bounded
relationships, bounded memories, constraints, and an `accounting` block with
exact characters, estimated tokens, and what was included or excluded.

You send ONLY the tiny event. Society decides everything else.

## 3. Environment

| variable | meaning | default |
| --- | --- | --- |
| `SOCIETY_DB` | society database path | `./society.db` |
| `SOCIETY_GOD_BRIDGE` | `1` enables the bridge for this process | unset (off) |
| `SOCIETY_GOD_MODE` | `live` records real token cost; `dry` records $0 | `dry` |

Start with `dry` (the default). Confirm the whole path works, then add `--live`
to `god result` for one measured interaction:

```bash
pnpm society god result '<json>' --live
```

`--live` records real token cost through the gateway ledger. Without it, the
job is still validated and persisted, but no provider call is invented.

## 4. One controlled first run

```bash
pnpm society god health          # confirm bridge + limits
pnpm society god submit '{"type":"USER_MESSAGE","text":"Hey — anyone around?"}' --bridge
# ... God renders the GodInput ...
pnpm society god result '<GodResult JSON>'
pnpm society god usage           # exact cost of what just happened
```

Do not run more than a few interactions until `god usage` is understood.

## 5. What you must not do

- Do not read the repository. The contract in `CONTRACT.json` is the interface.
- Do not create a bot per person, city, family, or relationship.
- Do not keep a private memory. Re-read the GodInput every time.
- Do not retry, escalate, or loop. One event, one call.
