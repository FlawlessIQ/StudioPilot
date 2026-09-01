#!/usr/bin/env bash
# Deliberately not `set -e`. Aborting on the first failure is how this script
# used to leave every service after the failing one unbound, and report nothing
# about either. Failures are collected and summarised at the end instead, and the
# exit code reflects them.
set -uo pipefail

project_id="${1:-studiohub-prod}"
region="${2:-us-east4}"
project_number="$(gcloud projects describe "${project_id}" --format='value(projectNumber)' 2>/dev/null)"
# Hard-fail, not collected. Without `set -e` an empty project number no longer
# aborts the run, and every scheduler and dispatcher binding is then attempted
# against "-compute@developer.gserviceaccount.com" — which fails 18 times and
# leaves the job workers unable to be invoked. One bad prerequisite must not
# produce a page of downstream noise.
if [[ ! "${project_number}" =~ ^[0-9]+$ ]]; then
  echo "Could not read the project number for ${project_id}." >&2
  echo "gcloud returned: '${project_number}'" >&2
  echo "Check 'gcloud auth list' and 'gcloud projects describe ${project_id}'." >&2
  exit 1
fi
app_hosting_service_account="firebase-app-hosting-compute@${project_id}.iam.gserviceaccount.com"
functions_service_account="${project_number}-compute@developer.gserviceaccount.com"

problems=()
bound=0

# Bind, then read the policy back and confirm the member is actually there.
#
# "The gcloud command exited 0" and "the binding exists" are different claims,
# and this script only ever made the first one — while printing a success line
# either way, because every call was `--quiet >/dev/null`. Verifying per service
# is the point: an invoker binding that is missing produces a 403 with an HTML
# body, which surfaces in the browser as `Unexpected token '<'` and looks like a
# bug anywhere but here.
bind_service() {
  local service="$1" service_region="$2" member="$3"

  if ! gcloud run services describe "${service}" \
      --region="${service_region}" --project="${project_id}" \
      --format='value(metadata.name)' >/dev/null 2>&1; then
    problems+=("MISSING SERVICE  ${service} (${service_region}) — retired, renamed, or never deployed")
    printf '  %-30s missing\n' "${service}"
    return
  fi

  local output
  if ! output="$(gcloud run services add-iam-policy-binding "${service}" \
      --region="${service_region}" --project="${project_id}" \
      --member="serviceAccount:${member}" \
      --role=roles/run.invoker --quiet 2>&1)"; then
    problems+=("BIND FAILED      ${service}: $(printf '%s' "${output}" | tail -1)")
    printf '  %-30s bind failed\n' "${service}"
    return
  fi

  local granted
  granted="$(gcloud run services get-iam-policy "${service}" \
    --region="${service_region}" --project="${project_id}" \
    --flatten='bindings[].members' \
    --filter='bindings.role:roles/run.invoker' \
    --format='value(bindings.members)' 2>/dev/null)"

  if [[ -z "${granted}" ]]; then
    problems+=("UNVERIFIED       ${service}: could not read the policy back")
    printf '  %-30s unverified\n' "${service}"
  elif ! printf '%s\n' "${granted}" | grep -Fxq "serviceAccount:${member}"; then
    problems+=("NOT APPLIED      ${service}: bind reported success but ${member} is not an invoker")
    printf '  %-30s not applied\n' "${service}"
  else
    bound=$((bound + 1))
    printf '  %-30s ok\n' "${service}"
  fi
}

# Same contract for the project- and service-account-level grants.
bind_iam() {
  local description="$1"; shift
  local output
  if ! output="$("$@" --quiet 2>&1)"; then
    problems+=("BIND FAILED      ${description}: $(printf '%s' "${output}" | tail -1)")
    printf '  %-30s bind failed\n' "${description}"
  else
    bound=$((bound + 1))
    printf '  %-30s ok\n' "${description}"
  fi
}

app_services=(
  aiactioncommand
  aicommunicationscommand
  aicopilotcommand
  aimessagedraftcommand
  aischedulecommand
  aitimingrulescommand
  authemailcommand
  billingcommand
  bookingcommand
  clientinvitationcommand
  communicationscommand
  consultationavailabilityquery
  createsession
  crewcommand
  crewinvitationcommand
  crmcommand
  dropboxsignwebhook
  docusignwebhook
  # integrationoauth was retired on August 19, 2026. Leaving it here would be
  # actively harmful, not merely stale: this script runs under `set -e`, so the
  # add-iam-policy-binding call for a service that no longer exists aborts the
  # whole run and silently leaves every service listed after it — through
  # zoomwebhook — without its invoker binding.
  # The browser reaches this through the Next relay like any other private
  # Function, so it needs the App Hosting service account as an invoker. It
  # was never listed, so capability routing and the agreement template both
  # failed with a 403 HTML page the relay reports as FUNCTION_ACCESS_DENIED.
  integrationscommand
  integrationoautheast4
  lifecyclesettingscommand
  membershipcommand
  planningcommand
  posteventcommand
  proposalcommand
  publicconsultationscheduling
  publicleadintake
  quickbookswebhook
  saasadmincommand
  sendgrideventwebhook
  sendgridinboundcoi
  sendgridinboundgallery
  sendgridinboundmessage
  signingtemplatesquery
  stripeconnectwebhook
  stripewebhook
  studioimportcommand
  supporttenantsummary
  tenantbrandingcommand
  tenantidentitycommand
  tenantdatacommand
  tenantexportdownload
  tenantonboardingcommand
  workflowcommand
  zoomwebhook
)

scheduler_services=(
  albumreminderscheduler
  automationretryscheduler
  coichasescheduler
  crewcascadeexpiryscheduler
  domaineventoutboxscheduler
  finalinvoicescheduler
  lifecyclemessagescheduler
  operationshealthscheduler
  operationsjobscheduler
  relativedatescheduler
  reviewrequestscheduler
  scheduledemailrelease
  tenantexportscheduler
)

# Cloud Tasks and Pub/Sub workers that are HTTP services, so they carry no
# `eventTrigger` and the discovery below cannot find them.
#
# Cloud Tasks invokes the worker itself with the same runtime identity that
# enqueued the task. Its binding existed but was never listed here, so nothing
# would restore it after this org's next invoker-IAM reset — every queued job
# would then fall back to the hourly scheduler.
event_services=(
  operationstaskworker
)

# Every event-driven function, discovered rather than listed.
#
# This list used to be four names — the job dispatchers — and nothing else.
# Fourteen of the eighteen event-driven functions in production therefore had
# no invoker binding at all, so Eventarc was answered with
# "403 ... lacks {run.routes.invoke}" on every single delivery and the
# functions never ran once. Not the booking automation, not one of the eight
# `readinessOn*` triggers, not the domain-event pipeline. Nothing surfaced,
# because a rejected delivery is logged against the *service* that refused it
# and looks like an unauthenticated caller rather than a broken product.
#
# A hardcoded list is what made that possible and would make it possible
# again: this org resets invoker IAM on every revision, so a name absent here
# is a feature that silently stops working. Discovery means a newly added
# trigger is bound the first time this runs after its deploy, with no one
# needing to remember.
discovered_event_services=()
while IFS= read -r discovered; do
  [[ -n "${discovered}" ]] && discovered_event_services+=("${discovered}")
done < <(gcloud functions list \
  --project="${project_id}" --regions="${region}" \
  --filter='eventTrigger.eventType:*' \
  --format='value(name)' 2>/dev/null | tr '[:upper:]' '[:lower:]' | sort -u)

if (( ${#discovered_event_services[@]} )); then
  event_services+=("${discovered_event_services[@]}")
else
  problems+=("DISCOVERY FAILED  no event-driven functions found — every Eventarc trigger may be left unbound")
fi

echo "App Hosting relay -> private Functions (${#app_services[@]} services)"
# Guarded because this runs under `set -u` and bash 3.2 — the version macOS
# ships — treats "${app_services[@]}" on an empty list as an unbound variable and
# dies with that message instead of doing the work.
if (( ${#app_services[@]} )); then
  for service_name in "${app_services[@]}"; do
    bind_service "${service_name}" "${region}" "${app_hosting_service_account}"
  done
fi

echo
echo "Cloud Scheduler -> schedulers (${#scheduler_services[@]} services)"
# Guarded because this runs under `set -u` and bash 3.2 — the version macOS
# ships — treats "${scheduler_services[@]}" on an empty list as an unbound variable and
# dies with that message instead of doing the work.
if (( ${#scheduler_services[@]} )); then
  for service_name in "${scheduler_services[@]}"; do
    bind_service "${service_name}" "${region}" "${functions_service_account}"
  done
fi

# Eventarc delivers queued provider, email, AI, and PDF jobs using the Functions runtime service
# account. The private Gen 2 dispatcher must allow that identity to invoke its
# backing Cloud Run service or jobs remain queued indefinitely.
echo
echo "Eventarc and Cloud Tasks -> dispatchers (${#event_services[@]} services)"
# Guarded because this runs under `set -u` and bash 3.2 — the version macOS
# ships — treats "${event_services[@]}" on an empty list as an unbound variable and
# dies with that message instead of doing the work.
if (( ${#event_services[@]} )); then
  for service_name in "${event_services[@]}"; do
    bind_service "${service_name}" "${region}" "${functions_service_account}"
  done
fi

echo
echo "Project and service-account grants"
bind_iam "cloudtasks.enqueuer" \
  gcloud projects add-iam-policy-binding "${project_id}" \
  --member="serviceAccount:${functions_service_account}" \
  --role=roles/cloudtasks.enqueuer \
  --condition=None

# The scheduler creates authenticated Cloud Tasks using the Functions runtime
# identity. Let that identity attach itself to the task without granting it
# impersonation rights over any other service account.
bind_iam "iam.serviceAccountUser" \
  gcloud iam service-accounts add-iam-policy-binding "${functions_service_account}" \
  --project="${project_id}" \
  --member="serviceAccount:${functions_service_account}" \
  --role=roles/iam.serviceAccountUser

bind_iam "pubsub.publisher" \
  gcloud projects add-iam-policy-binding "${project_id}" \
  --member="serviceAccount:${functions_service_account}" \
  --role=roles/pubsub.publisher \
  --condition=None

bind_service "studiohub-pdf" "us-east4" "${functions_service_account}"

bind_service "studiohub-file-safety" "us-east1" "${functions_service_account}"

bind_service "filesafetyonfinalize" "us-east1" "${functions_service_account}"

echo
if (( ${#problems[@]} == 0 )); then
  grant_word="grants"; (( bound == 1 )) && grant_word="grant"
  echo "Configured and verified ${bound} ${grant_word} for ${project_id} in ${region}."
  exit 0
fi

# Loud and specific. The previous version printed this same success line whatever
# happened, so "the script ran" carried no information — a missing binding was
# only discovered later, from a 403 with an HTML body somewhere else entirely.
grant_word="grants"; (( bound == 1 )) && grant_word="grant"
echo "PROBLEMS (${#problems[@]}) — ${bound} ${grant_word} verified, the rest are not in place:"
for problem in "${problems[@]}"; do
  echo "  ${problem}"
done
echo
echo "A service listed as MISSING has been retired or renamed: remove it from this"
echo "script. Anything else means the grant is absent, so that Function answers 403"
echo "with an HTML body — which surfaces client-side as \`Unexpected token '<'\`."
exit 1
