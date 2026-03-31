# openclaw-browser-platform

Bootstrap for the OpenClaw browser platform MVP0 LitRes pilot.

## Commit 1 scope

This repository currently contains:

- npm-based Node.js + TypeScript project setup
- baseline ESLint, Prettier, Vitest, and Playwright config
- initial CLI entrypoint scaffold
- initial directory skeleton for upcoming daemon/runtime/packs work

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
