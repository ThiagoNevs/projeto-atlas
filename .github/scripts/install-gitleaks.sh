#!/usr/bin/env bash

set -euo pipefail

readonly GITLEAKS_VERSION="8.30.1"
readonly GITLEAKS_ARCHIVE="gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz"
readonly GITLEAKS_SHA256="551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb"
readonly GITLEAKS_URL="https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/${GITLEAKS_ARCHIVE}"

fail() {
  printf 'Gitleaks installation failed: %s\n' "$1" >&2
  exit 1
}

parse_gitleaks_version() {
  local version_output="$1"

  if [[ "${version_output}" =~ ^[[:space:]]*v?([0-9]+\.[0-9]+\.[0-9]+)[[:space:]]*$ ]]; then
    printf '%s\n' "${BASH_REMATCH[1]}"
    return 0
  fi

  return 1
}

validate_gitleaks_version() {
  local executable="$1"
  local version_output
  local parsed_version

  if ! version_output="$("${executable}" version)"; then
    return 1
  fi

  if ! parsed_version="$(parse_gitleaks_version "${version_output}")"; then
    return 1
  fi

  [[ "${parsed_version}" == "${GITLEAKS_VERSION}" ]]
}

temporary_root=""

cleanup() {
  if [[ -n "${temporary_root}" ]]; then
    rm -rf -- "${temporary_root}"
  fi
}

main() {
  local install_root="${GITLEAKS_INSTALL_DIR:-${RUNNER_TEMP:-${TMPDIR:-/tmp}}/atlas-gitleaks-bin}"
  local archive_path
  local actual_sha256

  temporary_root="$(mktemp -d)"
  archive_path="${temporary_root}/${GITLEAKS_ARCHIVE}"
  trap cleanup EXIT

  if [[ -n "${GITLEAKS_ARCHIVE_PATH:-}" ]]; then
    [[ -f "${GITLEAKS_ARCHIVE_PATH}" ]] || fail "archive override does not exist"
    cp -- "${GITLEAKS_ARCHIVE_PATH}" "${archive_path}"
  else
    curl --fail --silent --show-error --location \
      --output "${archive_path}" \
      "${GITLEAKS_URL}"
  fi

  actual_sha256="$(sha256sum "${archive_path}" | awk '{ print $1 }')"
  [[ "${actual_sha256}" == "${GITLEAKS_SHA256}" ]] || fail "archive checksum mismatch"

  rm -rf -- "${install_root}"
  mkdir -p -- "${install_root}"
  tar -xzf "${archive_path}" -C "${install_root}" gitleaks
  chmod 0755 "${install_root}/gitleaks"

  validate_gitleaks_version "${install_root}/gitleaks" || fail "unexpected scanner version"

  if [[ -n "${GITHUB_PATH:-}" ]]; then
    printf '%s\n' "${install_root}" >> "${GITHUB_PATH}"
  fi

  printf 'Installed Gitleaks v%s from a SHA-256 verified release artifact.\n' "${GITLEAKS_VERSION}"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
