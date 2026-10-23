#!/usr/bin/env bash
# One command from a commit on main to verified production.
#
# Every step CLAUDE.md asks for, in order, stopping at the first failure — the
# 2026-10-22 outage and the week after it were each a step done by hand, out
# of order or not at all: a "deploy all" that silently set a 1-day image
# cleanup rule, an invoker grant forgotten for a new scheduler, a rollout
# assumed to have happened, a shell on Node 18.
#
#   ./scripts/release.sh            # gates, functions, rules, app, verify
#   ./scripts/release.sh --no-app   # functions and rules only
#
# What it does:
#   0. Node 22 (the version the code and the function image are pinned to).
#   1. main is clean, and not behind origin/main (CLAUDE.md "Working on main").
#   2. Gates: typecheck, tests, lint, functions build.
#   3. Functions: any function new in the code is created with Firebase (its
#      trigger or schedule), then every function runs our own image
#      (deploy-functions-self-contained.sh — also re-grants invokers).
#   4. Firestore rules and indexes, Storage rules.
#   5. verify-function-images.sh: images present, cleanup rules safe, pinned
#      secrets enabled.
#   6. Push, then an App Hosting rollout of exactly this commit, waited on
#      until SUCCEEDED (a green rollout of the previous commit looks the same).
#   7. Probes through studio-cue.com: every probed function answers JSON.
#
# A trigger's own settings (retry, schedule, region, secrets) change only with
# `firebase deploy --only functions:<name>`; do that for the function first,
# then run this.
set -euo pipefail

project_id="studiohub-prod"
region="us-east4"
with_app=1
[ "${1:-}" = "--no-app" ] && with_app=0

step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
fail() { printf '\n\033[31mRELEASE STOPPED: %s\033[0m\n' "$*" >&2; exit 1; }
# Never stop without saying where (the first run of this script stopped
# silently at step 3).
trap 'printf "\n\033[31mRELEASE STOPPED at line %s: %s\033[0m\n" "${LINENO}" "${BASH_COMMAND}" >&2' ERR

step "0. Node 22"
if [ -d "${HOME}/.nvm/versions/node" ]; then
  node22="$(ls -d "${HOME}"/.nvm/versions/node/v22.* 2>/dev/null | sort -V | tail -1 || true)"
  [ -n "${node22}" ] && export PATH="${node22}/bin:${PATH}"
fi
node_major="$(node -p 'process.versions.node.split(".")[0]')"
[ "${node_major}" = "22" ] || fail "Node ${node_major} — this repo releases on Node 22 (nvm install 22)."
node -v

step "1. main, clean, up to date"
[ "$(git rev-parse --abbrev-ref HEAD)" = "main" ] || [ "${RELEASE_ALLOW_BRANCH:-}" = "1" ] \
  || fail "not on main (set RELEASE_ALLOW_BRANCH=1 to release a worktree branch onto main)."
git diff --quiet && git diff --cached --quiet || fail "uncommitted changes — commit or set them aside first."
git fetch -q origin
behind="$(git rev-list --count HEAD..origin/main)"
[ "${behind}" = "0" ] || fail "origin/main has ${behind} commit(s) you don't — pull/rebase onto origin/main first."
commit="$(git rev-parse HEAD)"
git log --oneline -1

step "2. Gates"
npm run typecheck
npm test > "${TMPDIR:-/tmp}/release-tests-$$.log" 2>&1 || { tail -40 "${TMPDIR:-/tmp}/release-tests-$$.log"; fail "tests failed"; }
grep -E "^# (tests|pass|fail)" "${TMPDIR:-/tmp}/release-tests-$$.log"
npm run lint
(cd functions && npm run build)

step "3. Functions"
[ -f functions/.env.studiohub-prod ] || fail "functions/.env.studiohub-prod is missing (copy it from the main checkout)."
deployed="$(gcloud functions list --project="${project_id}" --format='value(name.basename())' | sort -u)"
# Loading the bundle declares every trigger, and a Storage trigger needs to
# know the project's bucket.
in_code="$(GCLOUD_PROJECT="${project_id}" FIREBASE_CONFIG="{\"projectId\":\"${project_id}\",\"storageBucket\":\"${project_id}.firebasestorage.app\"}" \
  node --input-type=module -e "const m = await import('./functions/lib/index.js'); console.log(Object.keys(m).join('\n'))" 2>/dev/null | sort -u)"
[ -n "${in_code}" ] || fail "could not list the functions in functions/lib/index.js"
new_functions="$(comm -13 <(printf '%s\n' "${deployed}") <(printf '%s\n' "${in_code}") | grep . || true)"
if [ -n "${new_functions}" ]; then
  printf 'New functions, created with Firebase first:\n%s\n' "${new_functions}"
  only="$(printf '%s\n' "${new_functions}" | sed 's/^/functions:/' | paste -sd, -)"
  firebase deploy --only "${only}" --project production --force --non-interactive
else
  echo "No new functions."
fi
./scripts/deploy-functions-self-contained.sh "${project_id}"

step "4. Rules and indexes"
firebase deploy --only firestore:rules,firestore:indexes,storage --project production --non-interactive

step "5. Function images, cleanup rules, secrets"
./scripts/verify-function-images.sh "${project_id}"

if [ "${with_app}" = "1" ]; then
  step "6. Push and roll out the app"
  git push origin HEAD:main
  firebase apphosting:rollouts:create studiohub --git-commit "${commit}" --project production --force
  short="${commit:0:8}"
  # The rollout whose *build* ran this commit — not "the latest rollout".
  rollout_state() {
    python3 - "${commit}" <<'PY'
import json, subprocess, sys, urllib.request
commit = sys.argv[1]
token = subprocess.check_output(["gcloud", "auth", "print-access-token"]).decode().strip()
base = "https://firebaseapphosting.googleapis.com/v1beta/projects/studiohub-prod/locations/us-east4/backends/studiohub"
def get(path):
    request = urllib.request.Request(f"{base}/{path}?pageSize=50", headers={"Authorization": f"Bearer {token}"})
    return json.load(urllib.request.urlopen(request)).get(path, [])
builds = {b["name"]: b for b in get("builds")}
states = [r.get("state", "") for r in get("rollouts")
          if builds.get(r.get("build"), {}).get("source", {}).get("codebase", {}).get("hash", "").startswith(commit)]
print("SUCCEEDED" if "SUCCEEDED" in states else (states[0] if states else "NONE"))
PY
  }
  state=""
  for _ in $(seq 1 60); do
    state="$(rollout_state || echo UNKNOWN)"
    [ "${state}" = "SUCCEEDED" ] && break
    case "${state}" in FAILED|CANCELLED) fail "rollout of ${short} ended ${state}." ;; esac
    sleep 20
  done
  [ "${state}" = "SUCCEEDED" ] || fail "rollout of ${short} is ${state} after 20 minutes — check the App Hosting console."
  echo "Rollout of ${short} SUCCEEDED."
fi

step "7. Probes through studio-cue.com"
for fn in publicLeadIntake bookingCommand crmCommand publicConsultationScheduling; do
  code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "https://studio-cue.com/api/functions/${fn}" \
    -H 'content-type: application/json' -H 'origin: https://studio-cue.com' -H 'x-firebase-appcheck: release-probe' -d '{}')"
  case "${code}" in 4??) printf '  ok    %-30s %s\n' "${fn}" "${code}" ;; *) fail "${fn} answered ${code} through studio-cue.com" ;; esac
done

printf '\n\033[32mReleased %s.\033[0m\n' "$(git log --oneline -1)"
