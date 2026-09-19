#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly PROJECT_ROOT
readonly SCAN_SCRIPT="${PROJECT_ROOT}/.github/scripts/secret-scan.sh"
readonly INSTALL_SCRIPT="${PROJECT_ROOT}/.github/scripts/install-gitleaks.sh"
readonly CONFIG_PATH="${PROJECT_ROOT}/.gitleaks.toml"

# shellcheck source-path=SCRIPTDIR
# shellcheck source=install-gitleaks.sh
source "${INSTALL_SCRIPT}"

temporary_root="$(mktemp -d)"

cleanup() {
  rm -rf -- "${temporary_root}"
}
trap cleanup EXIT

fail() {
  printf 'Secret scanner self-test failed: %s\n' "$1" >&2
  exit 1
}

configure_repository() {
  local repository="$1"

  git -C "${repository}" init --quiet
  git -C "${repository}" config user.email "secret-scanner-test@atlas.invalid"
  git -C "${repository}" config user.name "Atlas Secret Scanner Test"
}

commit_all() {
  local repository="$1"
  local message="$2"

  git -C "${repository}" add --all
  git -C "${repository}" commit --quiet --message "${message}"
}

synthetic_secret() {
  printf 'atlas-secret-scanner-runtime-fixture' | sha256sum | awk '{ print substr($1, 1, 40) }'
}

write_synthetic_secret() {
  local target="$1"
  local value="$2"

  printf 'api_key = "%s"\n' "${value}" > "${target}"
}

run_scan() {
  local repository="$1"
  local event_name="$2"
  local base_sha="$3"
  local head_sha="$4"
  local log_path="$5"

  GITLEAKS_CONFIG_PATH="${CONFIG_PATH}" \
    bash "${SCAN_SCRIPT}" "${event_name}" "${base_sha}" "${head_sha}" "${repository}" \
    > "${log_path}" 2>&1
}

expect_status() {
  local expected="$1"
  shift

  set +e
  "$@"
  local actual=$?
  set -e

  [[ "${actual}" -eq "${expected}" ]] ||
    fail "expected exit ${expected}, received ${actual}"
}

expect_failure() {
  set +e
  "$@"
  local actual=$?
  set -e

  [[ "${actual}" -ne 0 ]] || fail "expected a blocking failure"
}

write_version_scanner() {
  local target="$1"
  local version_output="$2"
  local exit_code="${3:-0}"
  local quoted_output

  printf -v quoted_output '%q' "${version_output}"
  printf '#!/usr/bin/env bash\nprintf "%%s" %s\nexit %s\n' \
    "${quoted_output}" "${exit_code}" > "${target}"
  chmod 0755 "${target}"
}

expect_version_validation_failure() {
  local version_output="$1"
  local scanner="${temporary_root}/invalid-version-gitleaks"

  write_version_scanner "${scanner}" "${version_output}"
  expect_status 1 validate_gitleaks_version "${scanner}"
}

runtime_secret="$(synthetic_secret)"

# The official v8.30.1 Linux binary prints a bare semantic version followed by
# a newline. The parser also tolerates an optional presentation-only `v` prefix
# and surrounding whitespace while rejecting mismatches and ambiguous output.
valid_version_scanner="${temporary_root}/valid-version-gitleaks"
write_version_scanner "${valid_version_scanner}" $'8.30.1\n'
validate_gitleaks_version "${valid_version_scanner}"
write_version_scanner "${valid_version_scanner}" "8.30.1"
validate_gitleaks_version "${valid_version_scanner}"
write_version_scanner "${valid_version_scanner}" "v8.30.1"
validate_gitleaks_version "${valid_version_scanner}"
write_version_scanner "${valid_version_scanner}" $' \t v8.30.1 \r\n'
validate_gitleaks_version "${valid_version_scanner}"
expect_version_validation_failure "8.30.0"
expect_version_validation_failure "9.0.0"
expect_version_validation_failure "garbage"
expect_version_validation_failure ""
expect_version_validation_failure $'8.30.1\n9.0.0'

failing_version_scanner="${temporary_root}/failing-version-gitleaks"
write_version_scanner "${failing_version_scanner}" "8.30.1" 19
expect_status 1 validate_gitleaks_version "${failing_version_scanner}"

# A PR scan must inspect every commit between merge-base and head, even when the
# final tree no longer contains the generated fixture.
pr_repository="${temporary_root}/pr-history"
mkdir -p "${pr_repository}"
configure_repository "${pr_repository}"
printf 'clean\n' > "${pr_repository}/README.md"
commit_all "${pr_repository}" "base"
pr_base="$(git -C "${pr_repository}" rev-parse HEAD)"
write_synthetic_secret "${pr_repository}/runtime-fixture.txt" "${runtime_secret}"
commit_all "${pr_repository}" "add runtime fixture"
rm -- "${pr_repository}/runtime-fixture.txt"
commit_all "${pr_repository}" "remove runtime fixture"
pr_head="$(git -C "${pr_repository}" rev-parse HEAD)"
pr_log="${temporary_root}/pr-history.log"
expect_status 1 run_scan "${pr_repository}" pull_request "${pr_base}" "${pr_head}" "${pr_log}"
grep -F "leaks found" "${pr_log}" >/dev/null || fail "PR fixture was not reported as a finding"
grep -F "${runtime_secret}" "${pr_log}" >/dev/null && fail "scanner output was not redacted"

# A push scan must cover all history reachable from the supplied head.
main_log="${temporary_root}/main-history.log"
expect_status 1 run_scan "${pr_repository}" push "" "${pr_head}" "${main_log}"
grep -F "leaks found" "${main_log}" >/dev/null || fail "push fixture was not reported as a finding"
grep -F "${runtime_secret}" "${main_log}" >/dev/null && fail "push scan output was not redacted"

# An unrelated ref containing a fixture must not leak into the PR range.
range_repository="${temporary_root}/pr-range"
mkdir -p "${range_repository}"
configure_repository "${range_repository}"
printf 'base\n' > "${range_repository}/README.md"
commit_all "${range_repository}" "base"
range_base="$(git -C "${range_repository}" rev-parse HEAD)"
git -C "${range_repository}" switch --quiet --create unrelated
write_synthetic_secret "${range_repository}/runtime-fixture.txt" "${runtime_secret}"
commit_all "${range_repository}" "unrelated runtime fixture"
git -C "${range_repository}" switch --quiet --create pull-request "${range_base}"
printf 'head\n' >> "${range_repository}/README.md"
commit_all "${range_repository}" "clean pull request"
range_head="$(git -C "${range_repository}" rev-parse HEAD)"
range_log="${temporary_root}/pr-range.log"
if ! run_scan "${range_repository}" pull_request "${range_base}" "${range_head}" "${range_log}"; then
  cat "${range_log}" >&2
  fail "PR scan escaped the merge-base to head range"
fi

# Invalid inputs and scanner failures must remain blocking.
expect_status 2 env \
  GITLEAKS_CONFIG_PATH="${CONFIG_PATH}" \
  GITLEAKS_BIN="${temporary_root}/missing-gitleaks" \
  bash "${SCAN_SCRIPT}" push "" "${range_head}" "${range_repository}"

expect_status 2 env \
  GITLEAKS_CONFIG_PATH="${CONFIG_PATH}" \
  bash "${SCAN_SCRIPT}" push "" "not-a-commit" "${range_repository}"

expect_status 2 env \
  GITLEAKS_CONFIG_PATH="${CONFIG_PATH}" \
  bash "${SCAN_SCRIPT}" pull_request "" "${range_head}" "${range_repository}"

git -C "${range_repository}" switch --quiet --orphan disconnected
git -C "${range_repository}" rm --quiet -r --ignore-unmatch .
printf 'disconnected\n' > "${range_repository}/README.md"
commit_all "${range_repository}" "disconnected history"
disconnected_head="$(git -C "${range_repository}" rev-parse HEAD)"
expect_status 2 env \
  GITLEAKS_CONFIG_PATH="${CONFIG_PATH}" \
  bash "${SCAN_SCRIPT}" pull_request "${range_base}" "${disconnected_head}" "${range_repository}"

failing_scanner="${temporary_root}/failing-gitleaks"
printf '#!/usr/bin/env bash\nexit 42\n' > "${failing_scanner}"
chmod 0755 "${failing_scanner}"
expect_status 42 env \
  GITLEAKS_CONFIG_PATH="${CONFIG_PATH}" \
  GITLEAKS_BIN="${failing_scanner}" \
  bash "${SCAN_SCRIPT}" push "" "${disconnected_head}" "${range_repository}"

slow_scanner="${temporary_root}/slow-gitleaks"
printf '#!/usr/bin/env bash\nsleep 5\n' > "${slow_scanner}"
chmod 0755 "${slow_scanner}"
expect_failure env \
  GITLEAKS_CONFIG_PATH="${CONFIG_PATH}" \
  GITLEAKS_BIN="${slow_scanner}" \
  GITLEAKS_TIMEOUT_SECONDS="1" \
  bash "${SCAN_SCRIPT}" push "" "${disconnected_head}" "${range_repository}"

# The installer must reject an archive that does not match the pinned digest.
invalid_archive="${temporary_root}/invalid-gitleaks.tar.gz"
printf 'not a release archive\n' > "${invalid_archive}"
expect_status 1 env \
  GITLEAKS_ARCHIVE_PATH="${invalid_archive}" \
  GITLEAKS_INSTALL_DIR="${temporary_root}/invalid-install" \
  bash "${INSTALL_SCRIPT}"

printf 'Secret scanner self-tests passed.\n'
