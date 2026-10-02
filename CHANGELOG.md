# Changelog

All notable changes to GrokBot Society are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing yet.

## [0.1.0] — 2026-10-02

First public release of the persistent-agent runtime.

### Added

- **Persistent synthetic people.** Roles, memory, economics and governance held
  per agent rather than per request.
- **Provider-neutral execution.** Agents run against any configured provider.
  No vendor is hardcoded into the runtime path.
- **Governance as a first-class concern.** Spend ceilings, approval boundaries
  and refusal are part of the model, not an afterthought wrapped around it.
- **Local state.** SQLite-backed; the runtime database is gitignored, so no
  agent memory is ever committed.

### Fixed

- Declared its own `pnpm-workspace.yaml`, so a fresh clone resolves its own
  lockfile instead of inheriting a parent workspace.

### Added (community)

- Issue forms for bugs and features, blank issues disabled in favour of
  Discussions.
- CI workflow.

### Verified

- 157 tests pass across 14 files
- Typecheck and build clean
- Apache-2.0 licensed

## Trademarks

This project references Grok, ChatGPT and other providers as **integration
targets** inside a provider-neutral runtime. It is not affiliated with,
endorsed by, or maintained by xAI, OpenAI, or any other provider.

[Unreleased]: https://github.com/M4G3LL4N0/grokbot-society/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/M4G3LL4N0/grokbot-society/releases/tag/v0.1.0
