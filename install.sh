#!/usr/bin/env bash
set -euo pipefail

OPENCLAW_HOME="${OPENCLAW_HOME:-$HOME/.openclaw}"
OPENCLAW_WORKSPACE="${OPENCLAW_WORKSPACE:-$OPENCLAW_HOME/workspace}"
SKILL_MODE="${SKILL_MODE:-workspace}"   # workspace | shared | skip
RUN_TESTS="${RUN_TESTS:-1}"
RESTART_GATEWAY="${RESTART_GATEWAY:-1}"
RUN_SMOKE_TEST="${RUN_SMOKE_TEST:-1}"
LIVE_SMOKE_URL="${LIVE_SMOKE_URL:-}"
INSTALL_CAMOUFOX="${INSTALL_CAMOUFOX:-1}"
CAMOUFOX_PYTHON_BIN="${CAMOUFOX_PYTHON_BIN:-}"
CAMOUFOX_PACKAGE_SPEC="${CAMOUFOX_PACKAGE_SPEC:-camoufox[geoip]}"
CAMOUFOX_PIP_USER="${CAMOUFOX_PIP_USER:-1}"
CAMOUFOX_VENV_DIR="${CAMOUFOX_VENV_DIR:-$OPENCLAW_HOME/venvs/camoufox}"
CAMOUFOX_FETCH="${CAMOUFOX_FETCH:-auto}"  # auto | always | never
CAMOUFOX_CACHE_DIR="${CAMOUFOX_CACHE_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/camoufox}"

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

camoufox_runtime_present() {
  [ -x "$CAMOUFOX_CACHE_DIR/camoufox-bin" ] || [ -d "$CAMOUFOX_CACHE_DIR/browser" ]
}

camoufox_geoip_present() {
  find "$CAMOUFOX_CACHE_DIR" -type f \( -name '*.mmdb' -o -name 'GeoLite2-*.db' \) -print -quit 2>/dev/null | grep -q .
}

should_fetch_camoufox() {
  case "$CAMOUFOX_FETCH" in
    always)
      return 0
      ;;
    never)
      return 1
      ;;
    auto)
      if ! camoufox_runtime_present; then
        return 0
      fi

      case "$CAMOUFOX_PACKAGE_SPEC" in
        *geoip*)
          if ! camoufox_geoip_present; then
            return 0
          fi
          ;;
      esac

      return 1
      ;;
    *)
      fail "Unsupported CAMOUFOX_FETCH: $CAMOUFOX_FETCH (expected: auto|always|never)"
      ;;
  esac
}

install_camoufox() {
  local pip_args=()
  local python_bin=""
  local install_python_bin=""
  local pip_error_file=""

  if [ "$INSTALL_CAMOUFOX" != "1" ]; then
    return
  fi

  python_bin="$(resolve_camoufox_python_bin)"
  install_python_bin="$python_bin"

  if [ "$CAMOUFOX_PIP_USER" = "1" ] && [ -z "${VIRTUAL_ENV:-}" ]; then
    pip_args=(--user)
  fi

  pip_error_file="$(mktemp)"

  log "Installing Camoufox Python package via $install_python_bin"
  if ! "$install_python_bin" -m pip install "${pip_args[@]}" -U "$CAMOUFOX_PACKAGE_SPEC" 2>"$pip_error_file"; then
    if grep -q 'externally-managed-environment' "$pip_error_file" && [ -z "${VIRTUAL_ENV:-}" ]; then
      log "Detected externally managed Python environment; creating Camoufox venv in $CAMOUFOX_VENV_DIR"
      "$python_bin" -m venv "$CAMOUFOX_VENV_DIR"
      install_python_bin="$CAMOUFOX_VENV_DIR/bin/python"
      log "Installing Camoufox Python package via $install_python_bin"
      "$install_python_bin" -m pip install -U "$CAMOUFOX_PACKAGE_SPEC"
    else
      cat "$pip_error_file" >&2
      rm -f "$pip_error_file"
      return 1
    fi
  fi
  rm -f "$pip_error_file"

  log "Installing Camoufox system dependencies (Firefox/GTK)"
  if command -v apt-get >/dev/null 2>&1; then
    if ! apt-get install -y --no-install-recommends libgtk-3-0 libdbus-glib-1-2 libxt6 2>/dev/null; then
      "$install_python_bin" -m playwright install-deps firefox \
        || log "Warning: could not install Firefox system dependencies; install libgtk-3-0 manually if camoufox fails"
    fi
  else
    "$install_python_bin" -m playwright install-deps firefox 2>/dev/null \
      || log "Warning: could not install Firefox system dependencies; install libgtk-3-0 manually if camoufox fails"
  fi

  if should_fetch_camoufox; then
    log "Fetching Camoufox browser via $install_python_bin"
    "$install_python_bin" -m camoufox fetch
  else
    log "Skipping Camoufox fetch (mode=$CAMOUFOX_FETCH, cache=$CAMOUFOX_CACHE_DIR)"
  fi

  log "Verifying Camoufox installation via $install_python_bin"
  "$install_python_bin" -m camoufox version
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
  printf 'One-liner mode: curl -fsSL https://raw.githubusercontent.com/nvprotas/openclaw-browser-platform/master/install.sh | RUN_TESTS=0 bash\n'
  printf 'Tip: LIVE_SMOKE_URL=https://www.litres.ru/ ./install.sh\n'
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
