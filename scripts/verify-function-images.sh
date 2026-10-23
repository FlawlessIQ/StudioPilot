#!/usr/bin/env bash
# Every live function can start: its container image still exists, and no
# cleanup rule can delete it.
#
# 2026-10-22: every function went down at once. `firebase deploy --force`
# had quietly added Firebase's own Artifact Registry cleanup rule,
# "firebase-functions-cleanup", deleting every image older than ONE day. A
# function keeps answering on its warm instances; the first time it needs a
# new one, the image is gone and Cloud Run answers a bare HTML 500 before our
# code runs — no log line anywhere. 91 of 110 functions had not been deployed
# that day. The inquiry form, every studio command and the Console failed
# from 21:14 UTC until all functions were redeployed. Gabe found it, not us.
#
# Two checks, read-only:
#   1. Every gcf-artifacts repository carries Firebase's opt-out label and a
#      KEEP rule for the newest image versions, and has no
#      "firebase-functions-cleanup" rule. (The CLI only adds its rule when a
#      repository has no rule and no opt-out label — see
#      firebase-tools lib/functions/artifacts.js, checkCleanupPolicy.)
#   2. The image digest every function's serving revision runs still exists.
#
# Run before and after every functions deploy (CLAUDE.md rule 5). Exits 1 on
# any failure.
set -euo pipefail

project_id="${1:-studiohub-prod}"
failures=0

printf '\n1. Cleanup rules on the function image repositories\n'
repos="$(gcloud artifacts repositories list --project="${project_id}" --format=json 2>/dev/null)"
policy_report="$(python3 - "${repos}" <<'PY'
import json, sys
bad = 0
for repo in json.loads(sys.argv[1]):
    parts = repo["name"].split("/")
    location, name = parts[3], parts[5]
    if name != "gcf-artifacts":
        continue
    policies = repo.get("cleanupPolicies") or {}
    labels = repo.get("labels") or {}
    problems = []
    if "firebase-functions-cleanup" in policies:
        problems.append("has Firebase's delete-after-N-days rule (firebase-functions-cleanup)")
    if labels.get("firebase-functions-cleanup-opted-out") != "true":
        problems.append("no firebase-functions-cleanup-opted-out=true label: the next --force deploy re-adds the 1-day rule")
    keeps = [p for p in policies.values() if p.get("action") == "KEEP" and (p.get("mostRecentVersions") or {}).get("keepCount", 0) >= 1]
    deletes = [p for p in policies.values() if p.get("action") == "DELETE"]
    if deletes and not keeps:
        problems.append("a DELETE rule with no KEEP rule for the newest versions")
    if problems:
        bad += 1
        for problem in problems:
            print(f"  FAIL  {location}/{name}: {problem}")
    else:
        print(f"  ok    {location}/{name}")
print(f"BAD={bad}")
PY
)"
printf '%s\n' "${policy_report}" | grep -v '^BAD='
failures=$((failures + $(printf '%s\n' "${policy_report}" | sed -n 's/^BAD=//p')))

printf '\n2. Every function revision'\''s image still exists\n'
work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT
for location in $(printf '%s' "${repos}" | python3 -c 'import json,sys; print(" ".join(sorted({r["name"].split("/")[3] for r in json.load(sys.stdin) if r["name"].endswith("/gcf-artifacts")})))'); do
  # Functions only (Cloud Functions labels its services), and the revision
  # taking traffic: that is the one a cold start pulls.
  gcloud run services list --project="${project_id}" --region="${location}" \
    --filter='metadata.labels."goog-managed-by"=cloudfunctions' \
    --format='value(metadata.name,status.traffic[0].revisionName)' > "${work}/services" 2>/dev/null || true
  gcloud run revisions list --project="${project_id}" --region="${location}" \
    --format='value(metadata.name,status.imageDigest)' > "${work}/revisions" 2>/dev/null || true
  # Firebase builds into gcf-artifacts; deploy-functions-self-contained.sh
  # into cloud-run-source-deploy (us-east4 only).
  : > "${work}/images"
  for repo in "${location}-docker.pkg.dev/${project_id}/gcf-artifacts" "us-east4-docker.pkg.dev/${project_id}/cloud-run-source-deploy"; do
    gcloud artifacts docker images list "${repo}" --format='value(version)' >> "${work}/images" 2>/dev/null || true
  done
  result="$(python3 - "${location}" "${work}" <<'PY'
import sys
location, work = sys.argv[1], sys.argv[2]
rows = lambda name: [line.split("\t") for line in open(f"{work}/{name}").read().splitlines() if line.strip()]
digests = {row[0] for row in rows("images")}
revisions = {row[0]: (row[1] if len(row) > 1 else "") for row in rows("revisions")}
bad = 0
services = rows("services")
for row in services:
    name, revision = row[0], (row[1] if len(row) > 1 else "")
    digest = revisions.get(revision, "")
    sha = digest.split("@")[-1] if "@" in digest else ""
    if not sha or sha not in digests:
        bad += 1
        print(f"  FAIL  {location}/{name}: {revision or 'no revision'} runs an image that no longer exists")
print(f"  {len(services)} functions checked in {location}")
print(f"BAD={bad}")
PY
)"
  printf '%s\n' "${result}" | grep -v '^BAD='
  failures=$((failures + $(printf '%s\n' "${result}" | sed -n 's/^BAD=//p')))
done

printf '\n3. Every secret version a function is pinned to is enabled\n'
# A function mounts each secret at a fixed version (Firebase pins the number at
# deploy). Disabling that version — which a rotation that forgets to redeploy
# first does — stops every new instance of the function from starting, the
# same silent spread as 2026-10-22. docs/production-secrets.md has the order.
gcloud run services list --project="${project_id}" --region=us-east4 \
  --filter='metadata.labels."goog-managed-by"=cloudfunctions' --format=json > "${work}/secret-services" 2>/dev/null || echo '[]' > "${work}/secret-services"
secret_pairs="$(python3 - "${work}/secret-services" <<'PY'
import json, sys
pairs = {}
for service in json.load(open(sys.argv[1])):
    template = service["spec"]["template"]
    aliases = {}
    for entry in (template["metadata"].get("annotations", {}).get("run.googleapis.com/secrets") or "").split(","):
        if ":" in entry:
            alias, path = entry.split(":", 1)
            aliases[alias] = path.rsplit("/", 1)[-1]
    for env in template["spec"]["containers"][0].get("env", []):
        ref = (env.get("valueFrom") or {}).get("secretKeyRef")
        if ref:
            secret = aliases.get(ref["name"], ref["name"])
            pairs.setdefault((secret, ref.get("key", "latest")), []).append(service["metadata"]["name"])
for (secret, version), users in sorted(pairs.items()):
    print(f"{secret}\t{version}\t{len(users)}")
PY
)"
while IFS=$'\t' read -r secret version users; do
  [ -z "${secret}" ] && continue
  state="$(gcloud secrets versions describe "${version}" --secret="${secret}" --project="${project_id}" --format='value(state)' 2>/dev/null || echo MISSING)"
  if [ "${state}" = "ENABLED" ]; then
    printf '  ok    %s v%s (%s functions)\n' "${secret}" "${version}" "${users}"
  else
    printf '  FAIL  %s v%s is %s — %s functions cannot start a new instance\n' "${secret}" "${version}" "${state:-UNKNOWN}" "${users}"
    failures=$((failures + 1))
  fi
done <<< "${secret_pairs}"

if [ "${failures}" -gt 0 ]; then
  printf '\n%s problem(s). A function whose image is gone fails on its next cold start: redeploy it.\n' "${failures}"
  exit 1
fi
printf '\nAll function images present and protected.\n'
