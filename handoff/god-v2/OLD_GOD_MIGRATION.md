# OLD GOD → GOD v2 MIGRATION

The experimental God GrokBot is an **archived prototype**. Its conversation is
not migrated and is not a dependency of the production architecture.

## What is NOT migrated

Do not carry any of this forward:

- old reasoning transcripts or assistant replies
- architecture discussion and design debates
- debugging, logs, and incident notes
- "master prompts" and instruction-tuning material
- bot-generated filler, pleasantries, or persona boilerplate
- development history of any kind

## What MAY be imported

Only durable social state that Society can store as first-class rows:

| allowed | lands in |
| --- | --- |
| person facts (name, bio, stable traits) | `persons` |
| relationship facts (who knows whom, and how well) | `relationships` |
| circle definitions (groups and membership) | `circles`, `circle_members` |
| meaningful memories (shared landmarks, real history) | `memories` |
| explicit user preferences | `profile` / preferences |

Everything that cannot be expressed as one of those rows stays archived.

## Procedure

1. **Freeze.** Stop the old God. Keep its transcript offline as a reference
   only. Do not connect it to anything.

2. **Extract, don't summarize.** Build a plain JSON file of the five allowed
   categories. Example:

   ```json
   {
     "persons": [
       { "name": "Emma Reyes", "biography": "...", "traits": ["warm", "detail-obsessed"] }
     ],
     "relationships": [
       { "a": "Emma Reyes", "b": "Julian Park", "dims": { "familiarity": 0.4, "trust": 0.3 } }
     ],
     "circles": [
       { "name": "Inner Circle", "members": ["Emma Reyes", "Julian Park"] }
     ],
     "memories": [
       { "a": "Emma Reyes", "b": "Julian Park", "kind": "shared_trip", "content": "...", "importance": 0.7 }
     ],
     "preferences": [{ "key": "social_intensity", "value": "normal" }]
   }
   ```

3. **Import into a fresh society.**

   ```bash
   pnpm society start --db ./society-migrated.db
   pnpm society people      # confirm the seeded baseline
   ```

   Then apply the JSON through the ordinary services (`persons.create`,
   `relationship.seed`, `circles.create` + `joinCircle`,
   `memory.storeLandmark`, `profile`). Every one of those is idempotent, so
   re-running the import is safe.

4. **Verify.** Compare `pnpm society people`, `circles`, `relationships`, and
   `landmarks` against the source JSON. Anything that does not map to a row is
   archived, not forced.

5. **Do not import God.** The new God v2 starts from an empty conversation and
   learns from Society state only. That is the point.

## Current status

**Not performed.** No old-God state has been imported. The runtime ships with the
idempotent 5-person seed (`ensureSeeded()`), which is the current baseline.

When an import is actually needed, run steps 1–5 above and record the source and
date here:

```
migration status: NOT RUN
source: (none)
date: (none)
```
