# Distribution notes

This repo is currently prepared for two practical distribution modes.

## Mode A — recommended: clone + build + `npm link`

Best for:

- active development
- fast updates from git
- OpenClaw hosts where you want full source + docs + easy rebuilds

Steps from a local clone:

```bash
git clone https://github.com/nvprotas/openclaw-browser-platform.git
cd openclaw-browser-platform
./install.sh
```

One-liner bootstrap mode from GitHub raw:

```bash
curl -fsSL https://raw.githubusercontent.com/nvprotas/openclaw-browser-platform/master/install.sh | RUN_TESTS=0 bash
```

Useful variants:

```bash
RUN_TESTS=0 ./install.sh
SKILL_MODE=shared ./install.sh
LIVE_SMOKE_URL=https://www.litres.ru/ ./install.sh
```

Manual equivalent:

```bash
npm ci
npm run lint
npm run test
npm run build
npm link
```

For OpenClaw-facing installs, distribution is not complete until the bundled `openclaw/skill-template/SKILL.md` is copied into the target workspace/shared skills directory and the resulting runtime is exercised from the OpenClaw workspace `cwd`.

## Mode B — release snapshot: `npm pack`

Best for:

- handing off a frozen build snapshot
- moving one known package artifact between hosts
- testing package contents before a future publish decision

### Build and pack

```bash
cd /root/git/openclaw-browser-platform
npm ci
npm run lint
npm run test
npm pack --dry-run
npm pack
```

This produces a tarball like:

```text
openclaw-browser-platform-0.1.0.tgz
```

### Install the tarball on the target host

```bash
npm install -g ./openclaw-browser-platform-0.1.0.tgz
```

If Camoufox is not installed yet, rerun `install.sh` or provision it manually through a Python environment that can execute `python -m camoufox fetch`. The installer now uses `CAMOUFOX_FETCH=auto` by default and only fetches when the local Camoufox cache is missing.

Verify:

```bash
browser-platform --help
browser-platform daemon status --json
```

## What the package now includes

The package layout is restricted with the `files` field and includes:

- `dist/`
- `site-packs/`
- `docs/`
- `openclaw/`
- `README.md`
- `ARCHITECTURE_CURRENT.md`
- `ROADMAP.md`

## Runtime dependency note

`playwright` is now a runtime dependency, not only a dev dependency.
That matters because the installed CLI actually needs Playwright on the target host.

## Current recommendation

For a new clean OpenClaw host, prefer **Mode A: clone + build + `npm link`**.

It is simpler because:

- browser provisioning is obvious
- you keep the repo docs nearby
- updating from git is straightforward
- debugging build/runtime mismatches is easier
