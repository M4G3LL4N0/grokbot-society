# HEALTHCHECK

Preparation only. Do not run a live interaction.

```bash
pnpm society god health
```

Pass only if:

- the bridge is enabled only when intentionally attached;
- mode is `dry`;
- max calls per event is `1`;
- recursion, background calls, and retries are `0`;
- proactive and background paid inference are off;
- kill switch and pause are off.

Stop after the check. Do not submit an event or run a paid test.
