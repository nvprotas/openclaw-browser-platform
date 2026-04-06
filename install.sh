#!/usr/bin/env bash
set -euo pipefail

OPENCLAW_HOME="${OPENCLAW_HOME:-$HOME/.openclaw}"
OPENCLAW_WORKSPACE="${OPENCLAW_WORKSPACE:-$OPENCLAW_HOME/workspace}"
SKILL_MODE="${SKILL_MODE:-workspace}"   # workspace | shared | skip
RUN_TESTS="${RUN_TESTS:-1}"
RESTART_GATEWAY="${RESTART_GATEWAY:-1}"
RUN_SMOKE_TEST="${RUN_SMOKE_TEST:-1}"
LIVE_SMOKE_URL="${LIVE_SMOKE_URL:-}"
INSTALL_CAMOUFOX="${INSTALL_CAMOUFOX:-0}"
CAMOUFOX_PYTHON_BIN="${CAMOUFOX_PYTHON_BIN:-}"
CAMOUFOX_PACKAGE_SPEC="${CAMOUFOX_PACKAGE_SPEC:-camoufox[geoip]}"
CAMOUFOX_PIP_USER="${CAMOUFOX_PIP_USER:-1}"

REPO_URL="${REPO_URL:-https://github.com/nvprotas/openclaw-browser-platform.git}"
BRANCH="${BRANCH:-master}"
TARGET_DIR="${TARGET_DIR:-$HOME/git/openclaw-browser-platform}"
FORCE_UPDATE="${FORCE_UPDATE:-0}"

log() {
  printf '==> %s\n' "$*"
}

fail() {
  printf '%s\n' "$*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

resolve_camoufox_python_bin() {
  if [ -n "$CAMOUFOX_PYTHON_BIN" ]; then
    need_cmd "$CAMOUFOX_PYTHON_BIN"
    printf '%s\n' "$CAMOUFOX_PYTHON_BIN"
    return
  fi

  if command -v python >/dev/null 2>&1; then
    printf 'python\n'
    return
  fi

  if command -v python3 >/dev/null 2>&1; then
    printf 'python3\n'
    return
  fi

  fail "Missing required command: python or python3"
}

install_camoufox() {
  local pip_args=()
  local python_bin=""

  if [ "$INSTALL_CAMOUFOX" != "1" ]; then
    return
  fi

  python_bin="$(resolve_camoufox_python_bin)"

  if [ "$CAMOUFOX_PIP_USER" = "1" ] && [ -z "${VIRTUAL_ENV:-}" ]; then
    pip_args=(--user)
  fi

  log "Installing Camoufox Python package via $python_bin"
  "$python_bin" -m pip install "${pip_args[@]}" -U "$CAMOUFOX_PACKAGE_SPEC"

  log "Fetching Camoufox browser via $python_bin"
  "$python_bin" -m camoufox fetch

  log "Verifying Camoufox installation via $python_bin"
  "$python_bin" -m camoufox version
}

canonicalize_repo_url() {
  local url="$1"

  url="${url%/}"

  case "$url" in
    git@github.com:*)
      url="ssh://git@github.com/${url#git@github.com:}"
      ;;
  esac

  case "$url" in
    ssh://git@github.com/*|https://github.com/*|http://github.com/*)
      url="${url%.git}"
      url="${url%/}"
      printf '%s\n' "$url" | tr '[:upper:]' '[:lower:]'
      return 0
      ;;
    file://*)
      local path="${url#file://}"
      if [ -e "$path" ]; then
        cd "$path" && pwd -P
        return 0
      fi
      ;;
    /*|./*|../*)
      if [ -e "$url" ]; then
        cd "$url" && pwd -P
        return 0
      fi
      ;;
  esac

  printf '%s\n' "$url"
}

repo_urls_match() {
  local left right
  left="$(canonicalize_repo_url "$1")"
  right="$(canonicalize_repo_url "$2")"
  [ "$left" = "$right" ]
}

resolve_local_repo_dir() {
  local source="${BASH_SOURCE[0]:-}"
  [ -n "$source" ] || return 1
  [ -e "$source" ] || return 1

  local dir
  dir="$(cd "$(dirname "$source")" && pwd)"

  [ -f "$dir/package.json" ] || return 1
  [ -f "$dir/openclaw/skill-template/SKILL.md" ] || return 1

  printf '%s\n' "$dir"
}

ensure_repo_clone() {
  need_cmd git

  mkdir -p "$(dirname "$TARGET_DIR")"

  if [ -e "$TARGET_DIR" ] && [ ! -d "$TARGET_DIR/.git" ]; then
    fail "Target path exists and is not a git repo: $TARGET_DIR"
  fi

  if [ -d "$TARGET_DIR/.git" ]; then
    local current_remote
    current_remote="$(git -C "$TARGET_DIR" remote get-url origin 2>/dev/null || true)"

    [ -n "$current_remote" ] || fail "Existing repo at $TARGET_DIR has no origin remote"

    if ! repo_urls_match "$current_remote" "$REPO_URL"; then
      fail "Existing repo remote mismatch at $TARGET_DIR: expected $REPO_URL, got $current_remote"
    fi

    if [ "$FORCE_UPDATE" != "1" ]; then
      git -C "$TARGET_DIR" diff --quiet || fail "Existing repo has unstaged changes at $TARGET_DIR (commit/stash them or set FORCE_UPDATE=1)"
      git -C "$TARGET_DIR" diff --cached --quiet || fail "Existing repo has staged changes at $TARGET_DIR (commit/stash them or set FORCE_UPDATE=1)"
      [ -z "$(git -C "$TARGET_DIR" ls-files --others --exclude-standard)" ] || fail "Existing repo has untracked files at $TARGET_DIR (clean them or set FORCE_UPDATE=1)"
    fi

    log "Updating repo in $TARGET_DIR"
    git -C "$TARGET_DIR" fetch --depth=1 origin "$BRANCH"
    git -C "$TARGET_DIR" checkout -B "$BRANCH" "origin/$BRANCH"
  else
    log "Cloning repo into $TARGET_DIR"
    git clone --depth=1 --branch "$BRANCH" "$REPO_URL" "$TARGET_DIR"
  fi
}

run_local_install() {
  local repo_dir="$1"
  local skill_dir=""

  need_cmd node
  need_cmd npm

  cd "$repo_dir"

  log "Installing npm dependencies"
  npm ci

  log "Installing Playwright Chromium"
  npx playwright install chromium

  install_camoufox

  log "Building project"
  npm run build

  if [ "$RUN_TESTS" = "1" ]; then
    log "Running tests"
    npm run test
  fi

  log "Linking browser-platform CLI"
  npm link

  case "$SKILL_MODE" in
    workspace)
      skill_dir="$OPENCLAW_WORKSPACE/skills/browser-platform"
      ;;
    shared)
      skill_dir="$OPENCLAW_HOME/skills/browser-platform"
      ;;
    skip)
      skill_dir=""
      ;;
    *)
      fail "Unsupported SKILL_MODE: $SKILL_MODE (expected: workspace|shared|skip)"
      ;;
  esac

  if [ -n "$skill_dir" ]; then
    log "Installing OpenClaw skill into $skill_dir"
    mkdir -p "$skill_dir"
    cp "$repo_dir/openclaw/skill-template/SKILL.md" "$skill_dir/SKILL.md"
  fi

  if [ "$RESTART_GATEWAY" = "1" ]; then
    need_cmd openclaw
    log "Restarting OpenClaw gateway"
    openclaw gateway restart
  fi

  if [ "$RUN_SMOKE_TEST" = "1" ]; then
    need_cmd browser-platform
    log "Running smoke test from $OPENCLAW_WORKSPACE"
    mkdir -p "$OPENCLAW_WORKSPACE"
    (
      cd "$OPENCLAW_WORKSPACE"
      browser-platform daemon ensure --json >/dev/null
      browser-platform daemon status --json

      if [ -n "$LIVE_SMOKE_URL" ]; then
        browser-platform session open --url "$LIVE_SMOKE_URL" --json
      fi
    )
  fi

  log "Done"
  printf 'Repo: %s\n' "$repo_dir"
  printf 'Workspace: %s\n' "$OPENCLAW_WORKSPACE"
  if [ -n "$skill_dir" ]; then
    printf 'Skill: %s/SKILL.md\n' "$skill_dir"
  fi
  printf 'One-liner mode: curl -fsSL https://openclaw.ai/install.sh | bash\n'
  printf 'Camoufox one-liner: curl -fsSL https://raw.githubusercontent.com/nvprotas/openclaw-browser-platform/master/install.sh | RUN_TESTS=0 INSTALL_CAMOUFOX=1 bash\n'
  printf 'Tip: LIVE_SMOKE_URL=https://www.litres.ru/ ./install.sh\n'
  printf 'Tip: INSTALL_CAMOUFOX=1 ./install.sh\n'
}

main() {
  local repo_dir

  if repo_dir="$(resolve_local_repo_dir)"; then
    run_local_install "$repo_dir"
    return
  fi

  ensure_repo_clone
  log "Running repo-local installer from $TARGET_DIR"
  exec bash "$TARGET_DIR/install.sh"
}

main "$@"
