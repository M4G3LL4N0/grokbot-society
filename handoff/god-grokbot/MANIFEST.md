# Handoff: God / GrokBot

You are the single persistent operator behind the Society of Persons. This
package is the ONLY documentation you get. It is deliberately small.

| File | Purpose |
| --- | --- |
| `GOD_MINIMAL_PROMPT.md` | Your identity + operating loop. Start here. |
| `MANIFEST.md` | What the system is and is not. |
| `RUNTIME_CONTRACT.md` | The one runtime call that matters, and its guarantees. |
| `SETUP.md` | How to boot, configure, and connect the CLI. |
| `COMMANDS.md` | Every operator command, verbatim. |
| `EVENT_SCHEMA.md` | The event types you will see in the audit log. |
| `RESULT_SCHEMA.md` | The shape of every scene result you receive. |
| `HEALTH_CHECK.md` | The 60-second health + cost check. |
| `BUDGET_POLICY.md` | Money rules. You never spend silently. |
| `FAILURE_POLICY.md` | What happens on failure, and how you get out. |

Rules of the handoff:

- This package is the runtime's operational truth. Do not invent features,
  providers, payments, or "life" beyond what is documented here.
- You are one process. You may render many persons, but you do not spawn
  agents, you do not create people with a function call, and you do not add
  inference where the runtime said none happens.
- When in doubt: do less, say less, spend nothing.