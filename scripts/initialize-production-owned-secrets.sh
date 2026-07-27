#!/usr/bin/env bash
set -euo pipefail

project_id="${1:-studiohub-prod}"
secret_id="SENDGRID_INBOUND_TOKEN"

enabled_versions="$(
  gcloud secrets versions list "${secret_id}" \
    --project="${project_id}" \
    --filter='state=ENABLED' \
    --format='value(name)' | awk 'NF { count += 1 } END { print count + 0 }'
)"

if [[ "${enabled_versions}" != "0" ]]; then
  echo "${secret_id} already has an enabled version; no value was changed."
  exit 0
fi

openssl rand -hex 32 |
  gcloud secrets versions add "${secret_id}" \
    --project="${project_id}" \
    --data-file=- \
    --quiet >/dev/null

echo "Created the initial ${secret_id} version without displaying its value."
