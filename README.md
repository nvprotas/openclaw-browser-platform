# openclaw-browser-platform

**One-line install/update:**

```bash
curl -fsSL https://raw.githubusercontent.com/nvprotas/openclaw-browser-platform/master/install.sh | RUN_TESTS=0 bash
```

Stateful browser automation runtime for OpenClaw.

Current pilot site: **LitRes (`litres.ru`)**.

The current architecture is:

```text
OpenClaw skill -> exec -> browser-platform CLI -> daemon -> Playwright
```

This repo is intentionally **not** a native OpenClaw plugin yet.
It is a separate CLI/daemon runtime that OpenClaw can drive through `exec`.

## Current scope

This repository currently contains:

- npm-based Node.js + TypeScript project setup
- CLI entrypoint with JSON-first command handling
- localhost daemon with stateful in-memory session registry
- Playwright-backed browser runtime
- LitRes-oriented site pack loading
- LitRes auth reuse + repo-owned bootstrap flow
- session `packContext` + `authContext`
- action / observe / snapshot flow
- trace artifacts for `session open` / `observe` / `act` / `snapshot`
- tests for daemon/session lifecycle and pack loading

## Prerequisites

- Node.js **22+**
- npm **10+**
- a Linux/macOS host where Playwright Chromium can run
- OpenClaw installed separately if you want agent integration

## Quick local setup

```bash
git clone https://github.com/nvprotas/openclaw-browser-platform.git
cd openclaw-browser-platform
npm ci
npx playwright install chromium
npm run build
npm run test
```

Verify the CLI:

```bash
node dist/bin/browser-platform.js --help
node dist/bin/browser-platform.js daemon ensure --json
```

## Recommended install mode for a clean OpenClaw host

For now, the simplest and most reliable installation path is:

1. clone the repo onto the host
2. install dependencies
3. install Playwright Chromium
4. build the project
5. expose the CLI with `npm link`
6. copy the bundled OpenClaw skill template into the workspace
7. let the skill call the CLI through OpenClaw `exec` while using the workspace root as stable `cwd`

Fast path from a cloned repo:

```bash
./install.sh
```

One-liner bootstrap mode from GitHub raw:

```bash
curl -fsSL https://raw.githubusercontent.com/nvprotas/openclaw-browser-platform/master/install.sh | RUN_TESTS=0 bash
```

Useful overrides:

```bash
RUN_TESTS=0 ./install.sh
SKILL_MODE=shared ./install.sh
LIVE_SMOKE_URL=https://www.litres.ru/ ./install.sh
```

Exact step-by-step instructions live here:

- [`docs/OPENCLAW_SETUP.md`](docs/OPENCLAW_SETUP.md)
- [`docs/DISTRIBUTION.md`](docs/DISTRIBUTION.md)
- OpenClaw skill template: [`openclaw/skill-template/SKILL.md`](openclaw/skill-template/SKILL.md)
- Installer script: [`install.sh`](install.sh)

The bundled skill template is intentionally repo-owned and should be copied as-is into OpenClaw, so docs/tests can stay aligned with the real MVP0 integration path.

## Supported commands

All implemented commands return JSON when called with `--json`.

- `browser-platform daemon ensure --json`
- `browser-platform daemon status --json`
- `browser-platform session open --url <url> [--storage-state <path>] --json`
- `browser-platform session context --session <id> --json`
- `browser-platform session observe --session <id> --json`
- `browser-platform session act --session <id> --json '<payload>'`
- `browser-platform session snapshot --session <id> --json`
- `browser-platform session close --session <id> --json`
- `browser-platform handoff start --session <id> [--reason <reason>] --json`
- `browser-platform handoff status --session <id> --json`
- `browser-platform handoff resume --session <id> --json`
- `browser-platform handoff stop --session <id> --json`

## Handoff / trace status

MVP1 уже включает локальный `handoff`-контур для human override:

- `handoff start` поднимает локальный VNC backend и noVNC gateway только на `127.0.0.1`
- `handoff status` показывает текущее состояние connect metadata
- `handoff resume` останавливает human surface и возвращает управление агенту
- `handoff stop` завершает backend-процессы и очищает временные connect-артефакты

Безопасные значения по умолчанию:

- VNC bind только на localhost
- noVNC bind только на localhost
- ничего не публикуется наружу автоматически

Trace artifacts теперь фиксируют lifecycle handoff через события:

- `handoff_started`
- `handoff_connect_info_issued`
- `handoff_human_active`
- `handoff_resumed`
- `handoff_stopped`

Trace writer применяет privacy redact перед записью JSON:

- скрываются OTP, пароли, секреты, токены, CVV/CVC и другие sensitive keys
- redaction применяется и к form/input `value`
- query-параметры вида `token=...` в trace payload тоже маскируются

## Examples

- LitRes search MVP0 demo script: `node --import tsx examples/demo-litres-search.ts 1984`
- LitRes cart MVP0 demo script: `node --import tsx examples/demo-litres-cart.ts 1984`
- The search demo uses repo-local helpers from `src/helpers/search.ts` to drive `home -> search -> search_results -> product`.
- The cart demo extends that flow with `src/helpers/cart.ts` to drive `product -> add_to_cart -> cart` validation.

## Important runtime notes

### 1. Run from a stable working directory

The daemon state store currently lives under:

```text
<cwd>/.tmp/browser-platform/
```

So when OpenClaw calls the CLI, use a stable workspace directory as `cwd`.
For a normal OpenClaw deployment, the workspace root is the right place.
Do **not** launch browser-platform from arbitrary repo subdirectories or transient temp folders if you want the daemon, session registry, and artifacts to remain reusable across separate `exec` calls.

### 2. Trace artifacts are written per step

For MVP0 acceptance, the runtime now writes JSON trace artifacts under:

```text
<cwd>/.tmp/browser-platform/artifacts/traces/<sessionId>/
```

Current trace coverage:
- `session open` writes the opened page state plus resolved pack/auth/payment context
- `session observe` writes the observed page summary
- `session act` writes before/after state, diff, and success/failure observations
- `session snapshot` writes a trace JSON that points at the saved screenshot + HTML snapshot paths
- handoff commands write lifecycle traces with the events listed above

The heavier screenshot/HTML artifacts still live under:

```text
<cwd>/.tmp/browser-platform/artifacts/snapshots/
```

This is enough to diagnose both a successful LitRes pilot flow and a representative failure without adding risky external automation steps.

### 3. Site packs are repo/package-local

The CLI auto-discovers `site-packs/` relative to the installed package layout.
That means:

- local repo runs work
- `npm link` runs work
- packed distribution artifacts can also ship the same `site-packs/`

### 3. LitRes auth paths currently reused by default

For the LitRes pilot, the runtime still reuses these practical artifact paths by default:

- `/root/.openclaw/workspace/sber-cookies.json`
- `/root/.openclaw/workspace/tmp/sberid-login/litres/storage-state.json`

On a different host, you can either:

- provide equivalent files at the same paths, or
- pass an explicit `--storage-state` when opening a session, or
- adapt the flow as the LitRes auth layer evolves

## Distribution status

This repo is now prepared for **repo clone + build + `npm link`** distribution.
It also has package metadata suitable for creating a release tarball with `npm pack`.

The current recommended OpenClaw integration path is still **clone + build + link**, because it keeps Playwright browser provisioning and repo updates straightforward.

## Related docs

- [`ARCHITECTURE_CURRENT.md`](ARCHITECTURE_CURRENT.md)
- [`ROADMAP.md`](ROADMAP.md)
- [`MVP0_LITRES.md`](MVP0_LITRES.md)
- [`PROGRESS.md`](PROGRESS.md)
- [`BUGS.md`](BUGS.md)
