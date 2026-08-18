#!/usr/bin/env bash
# Read-only audit of the integration configuration that is actually deployed.
#
# Both failures this catches were silent until an external service complained:
#
#   * OAUTH_CALLBACK_URL had drifted to the *.hosted.app App Hosting host while
#     every provider console had the custom domain registered. Nothing in the
#     app reported it; Zoom answered "Invalid redirect ... (4,700)" only after
#     a studio owner clicked Connect.
#   * SENDGRID_FROM_EMAIL was missing while EMAIL_DELIVERY_MODE=live, so
#     sendEmailJob() threw SENDGRID_NOT_CONFIGURED. retryableJobFailure()
#     classes that as permanent, so client email dead-lettered with no retry.
#
# A deployed Function's environment cannot be checked by tsc, the unit suite,
# or the e2e suite — none of them can see it. Run this after every
# `firebase deploy --only functions`.
set -euo pipefail

project_id="${1:-studiohub-prod}"
region="${2:-us-east4}"
oauth_function="${3:-integrationOAuthEast4}"
email_function="${4:-operationsJobScheduler}"

failures=0
note() { printf '  %s\n' "$1"; }
fail() { printf '  FAIL %s\n' "$1"; failures=$((failures + 1)); }
pass() { printf '  ok   %s\n' "$1"; }

deployed_env() {
  gcloud functions describe "$1" \
    --region "${region}" --project "${project_id}" --gen2 \
    --format='value(serviceConfig.environmentVariables)' | tr ';' '\n'
}

value_of() {
  printf '%s\n' "$2" | sed -n "s/^$1=//p" | head -1
}

origin_of() {
  printf '%s\n' "$1" | sed -E 's#^(https?://[^/]+).*#\1#'
}

printf '\nOAuth callback (%s)\n' "${oauth_function}"
oauth_env="$(deployed_env "${oauth_function}")"
app_url="$(value_of NEXT_PUBLIC_APP_URL "${oauth_env}")"
callback="$(value_of OAUTH_CALLBACK_URL "${oauth_env}")"

if [ -z "${callback}" ]; then
  fail "OAUTH_CALLBACK_URL is unset — integrationOAuth returns 503 OAUTH_CALLBACK_URL_REQUIRED"
elif [ -z "${app_url}" ]; then
  fail "NEXT_PUBLIC_APP_URL is unset, so the callback origin cannot be verified"
elif [ "$(origin_of "${callback}")" != "$(origin_of "${app_url}")" ]; then
  fail "OAUTH_CALLBACK_URL origin $(origin_of "${callback}") != NEXT_PUBLIC_APP_URL $(origin_of "${app_url}")"
  note "providers reject the authorize request; see docs/integration-production-readiness.md"
else
  pass "callback matches the canonical origin ${app_url}"
fi

case "${callback}" in
  *.hosted.app/*)
    fail "OAUTH_CALLBACK_URL uses the *.hosted.app host, not the custom domain"
    ;;
esac

# A per-provider override that merely repeats the default is drift, not
# configuration: it survives a change to OAUTH_CALLBACK_URL and silently
# pins one provider to the old host.
while IFS= read -r line; do
  case "${line}" in
    *_OAUTH_CALLBACK_URL=*)
      name="${line%%=*}"
      if [ "${line#*=}" = "${callback}" ]; then
        fail "${name} duplicates OAUTH_CALLBACK_URL — remove the redundant override"
      else
        note "${name} deliberately overrides the default"
      fi
      ;;
  esac
done <<< "${oauth_env}"

printf '\nEnabled providers have server-side credentials\n'
enabled="$(sed -n '/NEXT_PUBLIC_ENABLED_OAUTH_PROVIDERS/,/value:/p' apphosting.yaml \
  | sed -n 's/.*value: *//p' | head -1)"
if [ -z "${enabled}" ]; then
  fail "NEXT_PUBLIC_ENABLED_OAUTH_PROVIDERS not found in apphosting.yaml"
else
  note "UI offers: ${enabled}"
  oauth_secrets="$(gcloud functions describe "${oauth_function}" \
    --region "${region}" --project "${project_id}" --gen2 \
    --format='value(serviceConfig.secretEnvironmentVariables)')"
  for provider in ${enabled//,/ }; do
    key="$(printf '%s' "${provider}" | tr '[:lower:]' '[:upper:]')_CLIENT_ID"
    if printf '%s\n' "${oauth_env}" | grep -q "^${key}=" \
      || printf '%s\n' "${oauth_secrets}" | grep -q "${key}"; then
      pass "${provider}: ${key} present"
    else
      fail "${provider} is offered in the UI but ${key} is not on ${oauth_function}"
      note "Connect would fail with OAUTH_PROVIDER_NOT_CONFIGURED"
    fi
  done
fi

printf '\nOutbound email (%s)\n' "${email_function}"
email_env="$(deployed_env "${email_function}")"
delivery_mode="$(value_of EMAIL_DELIVERY_MODE "${email_env}")"
from_email="$(value_of SENDGRID_FROM_EMAIL "${email_env}")"
inbound_domain="$(value_of SENDGRID_INBOUND_DOMAIN "${email_env}")"
note "EMAIL_DELIVERY_MODE=${delivery_mode:-<unset>}"

if [ "${delivery_mode}" = "live" ]; then
  if [ -z "${from_email}" ]; then
    fail "SENDGRID_FROM_EMAIL is unset while delivery is live"
    note "every queued email fails SENDGRID_NOT_CONFIGURED and dead-letters"
  else
    pass "SENDGRID_FROM_EMAIL=${from_email}"
    from_domain="${from_email##*@}"
    app_host="$(origin_of "${app_url}")"; app_host="${app_host#https://}"
    if [ "${from_domain}" != "${app_host}" ]; then
      note "from domain ${from_domain} differs from ${app_host} — confirm it is SendGrid-authenticated"
    fi
  fi
  if [ -z "${inbound_domain}" ]; then
    note "SENDGRID_INBOUND_DOMAIN unset — COI requests fail COI_INBOUND_DOMAIN_NOT_CONFIGURED"
  else
    pass "SENDGRID_INBOUND_DOMAIN=${inbound_domain}"
  fi
else
  note "delivery is not live; SendGrid variables are not required"
fi

printf '\n'
if [ "${failures}" -gt 0 ]; then
  printf '%s check(s) failed.\n\n' "${failures}"
  exit 1
fi
printf 'Deployed integration configuration is consistent.\n\n'
