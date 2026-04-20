# openclaw-browser-platform

**One-line install/update:**

```bash
curl -fsSL https://raw.githubusercontent.com/nvprotas/openclaw-browser-platform/master/install.sh | RUN_TESTS=0 bash
```

Stateful browser automation runtime for OpenClaw.

Supported sites:

- **LitRes (`litres.ru`)**: the most complete pack at the moment.
- **Azbuka Vkusa (`av.ru`)**: `assisted` support level; search/product/cart flows are described, but city selection, delivery mode, and anti-bot gates may still require human handoff.

The current architecture is:

```text
OpenClaw skill -> exec -> browser-platform CLI -> daemon -> Playwright -> Camoufox
```

This repo is intentionally **not** a native OpenClaw plugin yet.
It is a separate CLI/daemon runtime that OpenClaw can drive through `exec`.

## Current scope

This repository currently contains:

- npm-based Node.js + TypeScript project setup
- CLI entrypoint with JSON-first command handling
- localhost daemon with stateful in-memory session registry
- Playwright-backed browser runtime
- Camoufox-only browser backend
- LitRes-oriented site pack loading
- LitRes auth reuse + repo-owned bootstrap flow
- session `profileContext`, `scenarioContext`, `packContext`, and `authContext`
- action / observe / snapshot flow
- trace artifacts for `session open` / `observe` / `act` / `snapshot`
- tests for daemon/session lifecycle and pack loading

## Prerequisites

- Node.js **22+**
- npm **10+**
- a Linux/macOS host where Camoufox can run
- OpenClaw installed separately if you want agent integration

## Ubuntu 24.04 / headless VPS notes

For a fresh Ubuntu 24.04 VPS, Camoufox needs more than only `pip install`:

- Ubuntu 24.04 often marks the system Python as **externally managed** (PEP 668)
- Camoufox/Firefox still need Linux shared libraries such as `libasound.so.2` and `libX11-xcb.so.1`
- a headless VPS usually has **no `DISPLAY`**, so Camoufox needs `xvfb`

The installer now handles this path directly:

- if Python packaging is blocked by PEP 668, it creates a dedicated venv in `~/.openclaw/venvs/camoufox`
- once it switches to that venv, it installs Camoufox there without `pip --user`
- it installs the required Ubuntu libraries plus `xvfb`
- it creates a wrapper script at `~/.openclaw/venvs/camoufox/camoufox-python-xvfb`
- it writes `CAMOUFOX_PYTHON_BIN` export instructions to `~/.openclaw/camoufox.env`

On a headless Ubuntu VPS, `CAMOUFOX_PYTHON_BIN` should normally point to that wrapper, not to plain `python` or `python3`.

## Quick local setup

```bash
git clone https://github.com/nvprotas/openclaw-browser-platform.git
cd openclaw-browser-platform
npm ci
./install.sh
npm run build
npm run test
```

Verify the CLI:

```bash
node dist/bin/browser-platform.js --help
node dist/bin/browser-platform.js daemon ensure --json
```

### Таймаут простоя browser session

Daemon поддерживает авто-закрытие неиспользуемых browser session по idle timeout.

- По умолчанию используется `1800000` мс, то есть `30` минут.
- Таймаут задаётся через переменную окружения `BROWSER_PLATFORM_SESSION_IDLE_TIMEOUT_MS`.
- Значение читается при старте daemon и применяется к новым сессиям.
- Если значение пустое, невалидное или `<= 0`, runtime откатывается к дефолту `30` минут.

Пример: таймаут простоя `10` минут

```bash
BROWSER_PLATFORM_SESSION_IDLE_TIMEOUT_MS=600000 \
node dist/bin/browser-platform.js daemon ensure --json
```

Пример для установленного CLI:

```bash
BROWSER_PLATFORM_SESSION_IDLE_TIMEOUT_MS=300000 \
browser-platform daemon ensure --json
```

### Backend: Camoufox

`session open` now defaults to and only accepts `camoufox`.
The canonical flow is to open a fresh scenario session against a named profile:

```bash
node dist/bin/browser-platform.js session open \
  --url https://example.com \
  --profile demo \
  --scenario smoke \
  --backend camoufox \
  --json
```

Runtime expects a working `camoufox` Python installation and can use `CAMOUFOX_PYTHON_BIN` to select a specific interpreter explicitly.
On Ubuntu 24.04 headless VPS, the recommended value is:

```bash
export CAMOUFOX_PYTHON_BIN="$HOME/.openclaw/venvs/camoufox/camoufox-python-xvfb"
```

## Recommended install mode for a clean OpenClaw host

For now, the simplest and most reliable installation path is:

1. clone the repo onto the host
2. install dependencies
3. install Camoufox
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

The runtime still checks `CAMOUFOX_PYTHON_BIN` first and only then falls back to `python` / `python3`.
On Ubuntu 24.04 headless VPS, prefer the generated wrapper path explicitly:

```bash
export CAMOUFOX_PYTHON_BIN="$HOME/.openclaw/venvs/camoufox/camoufox-python-xvfb"
```

If the host Python is marked as externally managed (PEP 668), the installer automatically creates `~/.openclaw/venvs/camoufox` and installs Camoufox there without `pip --user`.
The installer also writes the same export into:

```bash
$HOME/.openclaw/camoufox.env
```

Enable it in the current shell with:

```bash
. "$HOME/.openclaw/camoufox.env"
```

### What the installer now provisions on Ubuntu 24.04

- Python package `camoufox[geoip]`
- dedicated venv when PEP 668 blocks system-package install
- Ubuntu shared libraries needed by Camoufox/Firefox
- `xvfb` for headless VPS execution
- wrapper script `~/.openclaw/venvs/camoufox/camoufox-python-xvfb`
- `CAMOUFOX_PYTHON_BIN` export file at `~/.openclaw/camoufox.env`

### Manual recovery on an already-provisioned VPS

If you already have the venv and only need to restore the runtime shell wiring:

```bash
. "$HOME/.openclaw/camoufox.env"
```

Exact step-by-step instructions live here:

- [`docs/OPENCLAW_SETUP.md`](docs/OPENCLAW_SETUP.md)
- [`docs/MANUAL_SKILL_TEST.md`](docs/MANUAL_SKILL_TEST.md)
- [`docs/DISTRIBUTION.md`](docs/DISTRIBUTION.md)
- [`docs/ADDING_SITES.md`](docs/ADDING_SITES.md)
- OpenClaw skill template: [`openclaw/skill-template/SKILL.md`](openclaw/skill-template/SKILL.md)
- Installer script: [`install.sh`](install.sh)

The bundled skill template is intentionally repo-owned and should be copied as-is into OpenClaw, so docs/tests can stay aligned with the real MVP0 integration path.

## Supported commands

All implemented commands return JSON when called with `--json`.

- `browser-platform daemon ensure --json`
- `browser-platform daemon status --json`
- `browser-platform session open --url <url> [--profile <id>] [--scenario <id>] [--backend camoufox] [--storage-state <path>] --json`
- `browser-platform session context --session <id> --json`
- `browser-platform session observe --session <id> --json`
- `browser-platform session act --session <id> --json '<payload>'`
- `browser-platform session snapshot --session <id> --json`
- `browser-platform session close --session <id> --json`

## Examples

Canonical CLI session-open example:

```bash
node dist/bin/browser-platform.js session open \
  --url https://www.litres.ru/ \
  --profile litres \
  --scenario search-1984 \
  --json
```

Legacy/debug/import override when you must bring your own state file:

```bash
node dist/bin/browser-platform.js session open \
  --url https://www.litres.ru/ \
  --storage-state /absolute/path/to/storage-state.json \
  --json
```

- LitRes search MVP0 demo script: `node --import tsx examples/demo-litres-search.ts 1984`
- LitRes cart MVP0 demo script: `node --import tsx examples/demo-litres-cart.ts 1984`
- The search demo uses repo-local helpers from `src/helpers/search.ts` to drive `home -> search -> search_results -> product`.
- The cart demo extends that flow with `src/helpers/cart.ts` to drive `product -> add_to_cart -> cart` validation.

## Important runtime notes

### 1. Run from a stable working directory

The daemon state store currently lives under the installed package/repo root:

```text
<package-root>/.tmp/browser-platform/
```

So when OpenClaw calls the CLI, use a stable workspace directory as `cwd` for your own relative paths and reproducible `exec` calls.
The daemon state itself is package-root-local, which avoids splitting state across unrelated working directories.
Do **not** assume changing `cwd` will create a separate daemon state store.

### 2. Trace artifacts are written per step

For MVP0 acceptance, the runtime now writes JSON trace artifacts under:

```text
<package-root>/.tmp/browser-platform/artifacts/traces/<sessionId>/
```

Current trace coverage:

- `session open` writes the opened page state plus resolved pack/auth/payment context
- `session observe` writes the observed page summary
- `session act` writes before/after state, diff, and success/failure observations
- `session snapshot` writes a trace JSON that points at the saved screenshot + HTML snapshot paths

Hard-stop contract for payment extraction:

- `session observe`, `session act`, and `session snapshot` may now include `hardStop`
- `hardStop.reason = "gateway_payment_json_ready"` means fail-closed: stop normal flow and return only `hardStop.finalPayload`
- `hardStop.returnPolicy = "return_final_payload_verbatim"` и `hardStop.agentInstruction` задают машинный контракт: агент должен вернуть `hardStop.finalPayload` пользователю без изменений
- hard stop is emitted only for gateway URLs `https://payecom.ru/pay?...` and `https://platiecom.ru/deeplink?...` when extraction JSON is ready

The heavier screenshot/HTML artifacts still live under:

```text
<package-root>/.tmp/browser-platform/artifacts/snapshots/
```

### 3. Site packs are repo/package-local

The CLI auto-discovers `site-packs/` relative to the installed package layout.
That means:

- local repo runs work
- `npm link` runs work
- packed distribution artifacts can also ship the same `site-packs/`

### 4. Persistent profile vs scenario session

`session open` now models a **fresh scenario session** that may reuse a **long-lived profile**.
This is the main intended contract for both CLI and OpenClaw skill usage:

- `--profile <id>` stores persistent state under `<state-root>/profiles/<backend>/<profileId>/storage-state.json`
- `--scenario <id>` labels the current live task/session so agents can treat it as disposable runtime state
- the daemon stays long-lived and can host many scenario sessions over time
- when a scenario finishes or looks suspicious, close that session and open a new one against the same `--profile`
- `--storage-state <path>` still works, but only as a legacy/debug/import override when you need to reuse or inspect an external state file directly

Current JSON responses expose both:

- `session.profileContext` - durable profile/storage-state identity
- `session.scenarioContext` - live scenario identity and reuse policy hint

### 5. LitRes auth paths currently reused by default

For the LitRes pilot, the runtime still reuses these practical artifact paths by default:

- `/root/.openclaw/workspace/sber-cookies.json`
- `/root/.openclaw/workspace/tmp/sberid-login/litres/storage-state.json`

That default auto-pick is compatible with the new model: the recommended call shape is still `--profile litres --scenario <task>`, while the runtime may seed that profile from the existing LitRes artifact path when present.

On a different host, you can either:

- provide equivalent files at the same paths, or
- use a named `--profile` and let it build its own persistent state over time, or
- pass an explicit `--storage-state` only as a legacy/debug/import override, or
- adapt the flow as the LitRes auth layer evolves

## Distribution status

This repo is now prepared for **repo clone + build + `npm link`** distribution.
It also has package metadata suitable for creating a release tarball with `npm pack`.

The current recommended OpenClaw integration path is still **clone + build + link**, because it keeps Playwright browser provisioning and repo updates straightforward.

## Related docs

- [`ARCHITECTURE_CURRENT.md`](ARCHITECTURE_CURRENT.md)
- [`docs/ADDING_SITES.md`](docs/ADDING_SITES.md)
- [`ROADMAP.md`](ROADMAP.md)
- [`MVP0_LITRES.md`](MVP0_LITRES.md)
- [`PROGRESS.md`](PROGRESS.md)
- [`BUGS.md`](BUGS.md)
