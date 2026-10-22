#!/usr/bin/env bash
# Run every Cloud Function from an image StudioCue builds itself — Node 22 and
# our code in one container — instead of Google's auto-updated base image.
#
# 2026-10-22: Google's nodejs22 base for Cloud Run functions moved to a new
# release (nodejs22_20261022_22_23_4_RC01, tagged public-image-next at 20:40
# UTC) and from ~21:14 UTC no function of ours could start a new instance:
# "container failed to start and listen on PORT=8080", no log line, even for an
# image that had started fine that morning. Warm instances kept answering, so
# it spread function by function. A firebase deploy cannot help — it builds on
# the same base — and Cloud Run only accepts "nodejs22", not a pinned release.
# This image has no Google base at all (`--clear-base-image`), so it starts
# whatever Google ships.
#
# Each Cloud Run service keeps its own environment, secrets and
# FUNCTION_TARGET / FUNCTION_SIGNATURE_TYPE; only the image changes. A later
# `firebase deploy --only functions` puts a function back on Google's base —
# check `docs/deployment.md` → "Functions fail to start" before doing that.
#
# Usage (from the repo root, functions built):
#   ./scripts/deploy-functions-self-contained.sh studiohub-prod [service ...]
# With no services, every function in the project.
set -euo pipefail

project_id="${1:-studiohub-prod}"
shift || true
region="us-east4"
tag="${region}-docker.pkg.dev/${project_id}/cloud-run-source-deploy/studiocue-functions:$(git rev-parse --short HEAD)-$(date -u +%Y%m%d%H%M)"

[ -f functions/lib/index.js ] || { echo "Build functions first: cd functions && npm run build"; exit 1; }

work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT
cp functions/package.json functions/package-lock.json "${work}/"
cp -R functions/lib "${work}/lib"
printf 'node_modules\n' > "${work}/.gcloudignore"
framework="$(node -p "require('./functions/node_modules/@google-cloud/functions-framework/package.json').version" 2>/dev/null || echo 3.5.1)"
cat > "${work}/Dockerfile" <<EOF
FROM node:22-slim
ENV NODE_ENV=production PORT=8080
WORKDIR /workspace
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm install --no-save --no-audit --no-fund @google-cloud/functions-framework@${framework}
COPY lib ./lib
USER node
CMD ["npx", "--no-install", "functions-framework"]
EOF

printf 'Building %s\n' "${tag}"
gcloud builds submit "${work}" --tag="${tag}" --project="${project_id}" --region="${region}" --quiet

if [ "$#" -gt 0 ]; then
  targets="$(for name in "$@"; do printf '%s\t%s\n' "${region}" "${name}"; done)"
else
  targets="$(gcloud functions list --project="${project_id}" \
    --format='value(name.segment(3),serviceConfig.service.basename())')"
fi

printf '%s\n' "${targets}" | grep . | xargs -P 8 -L 1 sh -c \
  'gcloud run deploy "$1" --image='"${tag}"' --clear-base-image --region="$0" --project='"${project_id}"' --quiet >/dev/null 2>&1 && echo "  ok    $1" || echo "  FAIL  $1"' \
  | tee "${work}/results"

./scripts/configure-production-function-invokers.sh "${project_id}" "${region}"
if grep -q FAIL "${work}/results"; then
  echo "Some functions did not move; their previous revision still serves." >&2
  exit 1
fi
