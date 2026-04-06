# Connect `openclaw-browser-platform` to a clean OpenClaw install

This is the recommended setup path today.

It assumes:

- a clean OpenClaw host
- Node.js 22+
- npm 10+
- you want OpenClaw to call `browser-platform` through `exec`

## 1. Clone the repo

```bash
cd /root/git
git clone https://github.com/nvprotas/openclaw-browser-platform.git
cd openclaw-browser-platform
```

## 2. Fast path: run the installer

From a local clone:

```bash
./install.sh
```

Bootstrap one-liner from GitHub raw:

```bash
curl -fsSL https://raw.githubusercontent.com/nvprotas/openclaw-browser-platform/master/install.sh | RUN_TESTS=0 bash
```

Camoufox one-liner from GitHub raw:

```bash
curl -fsSL https://raw.githubusercontent.com/nvprotas/openclaw-browser-platform/master/install.sh | RUN_TESTS=0 INSTALL_CAMOUFOX=1 bash
```

Useful variants:

```bash
RUN_TESTS=0 ./install.sh
SKILL_MODE=shared ./install.sh
LIVE_SMOKE_URL=https://www.litres.ru/ ./install.sh
INSTALL_CAMOUFOX=1 ./install.sh
```

Если хотите сразу подготовить backend `camoufox`, запустите installer так:

```bash
INSTALL_CAMOUFOX=1 ./install.sh
```

В этом режиме installer:

- ставит Python-пакет `camoufox[geoip]`
- скачивает браузер через `python -m camoufox fetch` или `python3 -m camoufox fetch`
- проверяет, что `python -m camoufox version` или `python3 -m camoufox version` отрабатывает без ошибки

Важно: текущий runtime сначала ищет `python`, затем `python3`. Если нужен конкретный интерпретатор, задайте `CAMOUFOX_PYTHON_BIN`.

## 3. Manual path (same steps as the installer)

```bash
npm ci
npx playwright install chromium
npm run build
npm run test
```

## 4. Expose the CLI on PATH

Recommended:

```bash
cd /root/git/openclaw-browser-platform
npm link
```

Verify:

```bash
browser-platform --help
browser-platform daemon status --json
```

## 5. Install the skill into the OpenClaw workspace

Create the workspace skill directory:

```bash
mkdir -p ~/.openclaw/workspace/skills/browser-platform
```

Copy the bundled skill template:

```bash
cp /root/git/openclaw-browser-platform/openclaw/skill-template/SKILL.md \
  ~/.openclaw/workspace/skills/browser-platform/SKILL.md
```

If you want the skill shared across multiple agents instead of only the current workspace, use:

```bash
mkdir -p ~/.openclaw/skills/browser-platform
cp /root/git/openclaw-browser-platform/openclaw/skill-template/SKILL.md \
  ~/.openclaw/skills/browser-platform/SKILL.md
```

## 6. Reload skills

Simplest options:

- start a new session, or
- restart the gateway

```bash
openclaw gateway restart
```

Optional verification:

```bash
openclaw skills list
```

## 7. Sanity-check the runtime manually

Run from the OpenClaw workspace so daemon state lands in the expected `.tmp/` path:

```bash
cd ~/.openclaw/workspace
browser-platform daemon ensure --json
browser-platform session open --url https://www.litres.ru/ [--backend chromium|camoufox] --json
```

Expected behavior:

- daemon starts
- a browser session opens
- the JSON response includes `session`, `packContext`, and `authContext`

## 8. What OpenClaw should do with it

The intended agent loop is:

```text
daemon ensure
-> session open
-> session context
-> session observe
-> session act
-> session snapshot (when needed)
-> session close
```

In practice that means the skill should call `browser-platform` via OpenClaw `exec`, always request `--json`, and keep `cwd` pinned to the OpenClaw workspace root so `.tmp/browser-platform/` stays stable across separate invocations.

## 9. LitRes-specific note

The current LitRes pilot may reuse these paths by default:

- `/root/.openclaw/workspace/sber-cookies.json`
- `/root/.openclaw/workspace/tmp/sberid-login/litres/storage-state.json`

If you are bringing this onto a fresh host and want LitRes auth reuse to work immediately, make sure those artifacts exist or pass `--storage-state` explicitly.

## 10. Recommended first live test in OpenClaw chat

After the skill is loaded, ask the agent something narrow, for example:

- “Открой litres.ru и скажи, авторизована ли сессия”
- “Открой litres.ru, найди книгу 1984 и покажи состояние страницы”

That is enough to verify:

- the skill is discovered
- `exec` can call `browser-platform`
- the daemon/session lifecycle works
- the LitRes pack is being attached correctly

## 11. Подробный чек-лист для ручной проверки

Если нужен отдельный пошаговый сценарий именно для ручной проверки скилла, используйте:

- [MANUAL_SKILL_TEST.md](./MANUAL_SKILL_TEST.md)
