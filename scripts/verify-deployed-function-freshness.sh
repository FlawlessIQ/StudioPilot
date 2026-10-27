#!/usr/bin/env bash
# Which deployed functions are running code older than your last functions change.
#
# CLAUDE.md rule 6 exists because a selective deploy missed the function that
# *renders* email while deploying the one that *queues* it, and a crew
# invitation went out with no link. It happened again on 2026-09-18: of 85
# functions, 84 moved to 066c85d and `operationsTaskWorker` stayed on a
# revision from 02:50. The album-reminder template and the portal links on the
# delivery and review emails were therefore not live at all — the commit was
# merged, the app was rolled out, and the one function that turns a template
# into an email had never seen either change.
#
# Nothing reported it. The emailJobs recorded `succeeded`, because sending
# worked and only the rendering was old. That is the same silence as the crew
# invitation, so this is the check that breaks it.
#
# Read-only. Run after every functions deploy, selective or not.
set -euo pipefail

project_id="${1:-studiohub-prod}"
region="${2:-us-east4}"

# The newest commit that touched functions/ source. A function whose deployed
# source predates it is running code from before that change — which may be
# fine (the change did not touch what it imports) or may be the bug above.
last_change_sha="$(git log -1 --format=%H -- functions/src)"
last_change="$(git log -1 --format=%ct -- functions/src)"
last_change_subject="$(git log -1 --format=%s -- functions/src)"
printf '\nLast functions/src commit: %s %s\n  %s\n\n' \
  "$(git rev-parse --short "${last_change_sha}")" \
  "$(date -r "${last_change}" '+%Y-%m-%d %H:%M:%S')" "${last_change_subject}"

# What each function runs is the image on its Cloud Run service. Since
# 2026-10-22 functions deploy with deploy-functions-self-contained.sh, which
# swaps that image (tagged `studiocue-functions:<commit>-<time>`) and never
# touches the Cloud Functions record, so its updateTime stayed on the last
# `firebase deploy`. Read by that time, a deploy of every function at
# 684645ae reported 36 of them BEHIND (2026-10-27). The commit in the tag is
# the answer: current when the last functions/src change is in its history.
# An image without one (a `firebase deploy`) is still read by updateTime.
images="$(mktemp)"
trap 'rm -f "${images}"' EXIT
gcloud run services list --project "${project_id}" --region "${region}" \
  --format='value[separator="	"](metadata.name,spec.template.spec.containers[0].image)' \
  2>/dev/null > "${images}" || true

behind=0
current=0

while IFS=$'\t' read -r name update_time service; do
  [ -z "${name}" ] && continue
  image="$(awk -F '\t' -v s="${service}" '$1 == s { print $2; exit }' "${images}")"
  commit=""
  case "${image}" in
    */studiocue-functions:*) commit="${image##*:}"; commit="${commit%%-*}" ;;
  esac
  if [ -n "${commit}" ]; then
    if ! git cat-file -e "${commit}^{commit}" 2>/dev/null; then
      # Not in this clone: fetch, or the answer is unknown — never a pass.
      printf '  UNKNOWN %-36s image commit %s is not in this clone (git fetch)\n' "${name}" "${commit}"
      behind=$((behind + 1))
    elif git merge-base --is-ancestor "${last_change_sha}" "${commit}"; then
      current=$((current + 1))
    else
      printf '  BEHIND  %-36s image at %s\n' "${name}" "${commit}"
      behind=$((behind + 1))
    fi
    continue
  fi
  deployed_at="$(date -j -f '%Y-%m-%dT%H:%M:%S' "${update_time%%.*}" '+%s' 2>/dev/null || echo 0)"
  if [ "${deployed_at}" -lt "${last_change}" ]; then
    printf '  BEHIND  %-36s deployed %s\n' "${name}" "${update_time%%.*}"
    behind=$((behind + 1))
  else
    current=$((current + 1))
  fi
done < <(
  gcloud functions list \
    --project "${project_id}" --regions "${region}" \
    --format='value[separator="	"](name,updateTime,serviceConfig.service.basename())' 2>/dev/null
)

printf '\n%s current, %s behind the last functions/src commit.\n' "${current}" "${behind}"

# Seeing nothing is not the same as seeing nothing wrong.
#
# `gcloud functions list` sends its errors to /dev/null above, so an expired
# credential produced an empty list, an empty loop, and "0 current, 0 behind —
# every deployed function is at or after the last functions/src change". The
# check that exists to break a silence had a silence of its own: on
# 2026-09-24 it passed while it could not see the project at all, immediately
# after a deploy that had in fact left 84 functions behind.
#
# A run that lists no functions has not verified anything, and must never be
# read as a pass.
if [ "$((current + behind))" -eq 0 ]; then
  cat >&2 <<'EOF'

Listed no functions at all, so nothing was verified — this is NOT a pass.

Usually an expired credential. Check the project is reachable, then re-run:

  gcloud auth login
  gcloud functions list --project PROJECT --regions REGION

EOF
  exit 2
fi

if [ "${behind}" -gt 0 ]; then
  cat <<'NOTE'

A function behind that commit is only a problem if it imports something the
commit changed — but that is exactly the judgement that has been got wrong
twice, and it is silent both times. Find the importers of what you changed and
deploy all of them, or deploy everything:

  grep -rl "communications/email-templates" functions/src

The email path is the one that has bitten: emailJobTaskDispatch queues, and
operationsTaskWorker renders. Deploying one without the other ships a template
change that never reaches an email.
NOTE
  exit 1
fi
printf 'Every deployed function is at or after the last functions/src change.\n\n'
