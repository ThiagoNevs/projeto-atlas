#!/usr/bin/env bash

set -euo pipefail

fail() {
  printf 'Secret scan failed: %s\n' "$1" >&2
  exit 2
}

is_commit_sha() {
  [[ "$1" =~ ^[0-9a-fA-F]{40}$ ]]
}

event_name="${1:-}"
base_sha="${2:-}"
head_sha="${3:-}"
repository_root="${4:-.}"
scanner="${GITLEAKS_BIN:-gitleaks}"
scanner_timeout_seconds="${GITLEAKS_TIMEOUT_SECONDS:-300}"
config_path="${GITLEAKS_CONFIG_PATH:-${PWD}/.gitleaks.toml}"

[[ -n "${event_name}" ]] || fail "event name is required"
[[ -d "${repository_root}" ]] || fail "repository path does not exist"
[[ -f "${config_path}" ]] || fail "scanner configuration is unavailable"
[[ "${scanner_timeout_seconds}" =~ ^[1-9][0-9]*$ ]] || fail "scanner timeout is invalid"
command -v "${scanner}" >/dev/null 2>&1 || fail "scanner executable is unavailable"
command -v timeout >/dev/null 2>&1 || fail "timeout executable is unavailable"

cd "${repository_root}"
git rev-parse --git-dir >/dev/null 2>&1 || fail "target is not a Git repository"
[[ "$(git rev-parse --is-shallow-repository)" == "false" ]] || fail "shallow history is not allowed"
is_commit_sha "${head_sha}" || fail "head SHA is invalid"
git cat-file -e "${head_sha}^{commit}" 2>/dev/null || fail "head commit is unavailable"
[[ "$(git rev-parse HEAD)" == "${head_sha}" ]] || fail "checked out commit does not match the event head"

case "${event_name}" in
  pull_request)
    is_commit_sha "${base_sha}" || fail "base SHA is invalid"
    git cat-file -e "${base_sha}^{commit}" 2>/dev/null || fail "base commit is unavailable"
    if ! merge_base="$(git merge-base "${base_sha}" "${head_sha}")"; then
      fail "merge base is unavailable"
    fi
    [[ -n "${merge_base}" ]] || fail "merge base is unavailable"
    log_range="${merge_base}..${head_sha}"
    ;;
  push)
    log_range="${head_sha}"
    ;;
  *)
    fail "unsupported event"
    ;;
esac

timeout -s TERM "${scanner_timeout_seconds}s" \
  "${scanner}" git \
  --config "${config_path}" \
  --redact=100 \
  --no-banner \
  --log-opts="--diff-merges=separate ${log_range}" \
  .
