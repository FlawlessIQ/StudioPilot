#!/usr/bin/env bash
set -euo pipefail

project_id="${1:-studiohub-prod}"
action="${2:-provision}"
project_number="$(gcloud projects describe "${project_id}" --format='value(projectNumber)')"
functions_service_account="${project_number}-compute@developer.gserviceaccount.com"

# Secrets consumed by implemented Cloud Functions. Access is granted only on
# these individual secret resources, never at the project level.
runtime_secrets=(
  STRIPE_SECRET_KEY
  STRIPE_WEBHOOK_SECRET
  STRIPE_CONNECT_WEBHOOK_SECRET
  GOOGLE_CALENDAR_CLIENT_SECRET
  ZOOM_CLIENT_SECRET
  ZOOM_WEBHOOK_SECRET_TOKEN
  DROPBOX_CLIENT_SECRET
  DOCUSIGN_CLIENT_SECRET
  DOCUSIGN_WEBHOOK_HMAC_SECRET
  DROPBOX_SIGN_CLIENT_SECRET
  DROPBOX_SIGN_API_KEY
  QUICKBOOKS_CLIENT_ID
  QUICKBOOKS_CLIENT_SECRET
  QUICKBOOKS_WEBHOOK_VERIFIER_TOKEN
  SENDGRID_API_KEY
  SENDGRID_INBOUND_TOKEN
  SENDGRID_WEBHOOK_VERIFICATION_KEY
  SENTRY_DSN
)

# Reserved names provide a stable credential-entry contract. They intentionally
# have no runtime accessor until the corresponding implementation is deployed.
reserved_secrets=(
  DROPBOX_WEBHOOK_SECRET
  TWILIO_AUTH_TOKEN
  SESSION_COOKIE_SECRET
  GUEST_LINK_SIGNING_SECRET
  INTEGRATION_TOKEN_ENCRYPTION_KEY
)

all_secrets=("${runtime_secrets[@]}" "${reserved_secrets[@]}")

secret_exists() {
  gcloud secrets describe "$1" \
    --project="${project_id}" \
    --format='value(name)' >/dev/null 2>&1
}

enabled_version_count() {
  gcloud secrets versions list "$1" \
    --project="${project_id}" \
    --filter='state=ENABLED' \
    --format='value(name)' 2>/dev/null | awk 'NF { count += 1 } END { print count + 0 }'
}

runtime_access_present() {
  gcloud secrets get-iam-policy "$1" \
    --project="${project_id}" \
    --flatten='bindings[].members' \
    --filter="bindings.role=roles/secretmanager.secretAccessor AND bindings.members=serviceAccount:${functions_service_account}" \
    --format='value(bindings.members)' 2>/dev/null | awk 'NF { found = 1 } END { print found + 0 }'
}

if [[ "${action}" == "provision" ]]; then
  gcloud services enable secretmanager.googleapis.com \
    --project="${project_id}" \
    --quiet >/dev/null

  for secret_id in "${all_secrets[@]}"; do
    if ! secret_exists "${secret_id}"; then
      gcloud secrets create "${secret_id}" \
        --project="${project_id}" \
        --replication-policy=automatic \
        --labels=application=studiohub,environment=production,managed-by=repository \
        --quiet >/dev/null
      echo "Created ${secret_id}."
    else
      echo "Kept existing ${secret_id}."
    fi
  done

  for secret_id in "${runtime_secrets[@]}"; do
    gcloud secrets add-iam-policy-binding "${secret_id}" \
      --project="${project_id}" \
      --member="serviceAccount:${functions_service_account}" \
      --role=roles/secretmanager.secretAccessor \
      --quiet >/dev/null
    echo "Bound ${secret_id} to the Functions runtime."
  done

  echo "Secret containers and resource-level access are configured for ${project_id}."
  echo "No credential values were created or read."
elif [[ "${action}" == "status" ]]; then
  printf '%-42s %-10s %-16s %-10s\n' "SECRET" "EXISTS" "ENABLED_VERSIONS" "ACCESS"
  for secret_id in "${all_secrets[@]}"; do
    if ! secret_exists "${secret_id}"; then
      printf '%-42s %-10s %-16s %-10s\n' "${secret_id}" "no" "0" "none"
      continue
    fi

    access="none"
    if [[ "$(runtime_access_present "${secret_id}")" == "1" ]]; then
      access="functions"
    fi
    printf '%-42s %-10s %-16s %-10s\n' \
      "${secret_id}" \
      "yes" \
      "$(enabled_version_count "${secret_id}")" \
      "${access}"
  done
else
  echo "Usage: $0 [project-id] [provision|status]" >&2
  exit 2
fi
