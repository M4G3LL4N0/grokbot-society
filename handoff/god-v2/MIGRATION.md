# MIGRATION

The previous God is an **ARCHIVED PROTOTYPE**. Do not migrate its conversation,
prompts, transcripts, reasoning, debugging, logs, filler, build discussion,
architecture history, or development history.

Only durable Society facts may be imported:

- Person facts
- relationship facts
- circle definitions and membership
- meaningful memories
- explicit preferences
- persistent commitments

Use the implemented `god migrate` path. It accepts only allowlisted durable
facts, writes through Society services, and reports ignored fields. It does not
contact a provider or enable live inference.

The fresh God starts with an empty conversation and receives only bounded scene
context from Society.

Current status: **NOT RUN**. No old-God state has been imported.
