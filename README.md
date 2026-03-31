# openclaw-browser-platform

Bootstrap for the OpenClaw browser platform MVP0 LitRes pilot.

## Current scope

This repository currently contains:

- npm-based Node.js + TypeScript project setup
- baseline ESLint, Prettier, Vitest, and Playwright config
- CLI entrypoint with JSON-first command handling
- minimal localhost daemon skeleton with stateful in-memory session registry
- LitRes-oriented session/auth reuse via storage-state loading and auth-state reporting
- file-backed daemon discovery via `.tmp/browser-platform/daemon.json`
- integration and unit tests for daemon/session lifecycle

## Supported commands

- `browser-platform daemon ensure --json`
- `browser-platform daemon status --json`
- `browser-platform session open --url <url> [--storage-state <path>] --json`
- `browser-platform session context --session <id> --json`
- `browser-platform session close --session <id> --json`

All implemented commands return stable JSON only.

## Scripts

- `npm run build`
- `npm run lint`
- `npm run test`
- `npm run dev -- --help`
- `npm run playwright:test`

## Structure

```text
bin/
src/
  cli/
  core/
  daemon/
  helpers/
  packs/
  playwright/
  runtime/
  traces/
site-packs/
  litres/
examples/
tests/
  unit/
  integration/
  fixtures/
```
