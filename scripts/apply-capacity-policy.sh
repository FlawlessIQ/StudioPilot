#!/usr/bin/env bash
set -euo pipefail

project_id="${1:-studiohub-prod}"
region="${2:-us-east4}"

gcloud run services update studiohub-pdf \
  --project "$project_id" --region "$region" \
  --cpu 1 --memory 1Gi --concurrency 4 --timeout 600 \
  --min-instances 0 --max-instances 4

gcloud run services update studiohub-file-safety \
  --project "$project_id" --region us-east1 \
  --cpu 1 --memory 2Gi --concurrency 2 --timeout 600 \
  --min-instances 0 --max-instances 4

if gcloud run services describe studiohub-ai --project "$project_id" --region "$region" >/dev/null 2>&1; then
  gcloud run services update studiohub-ai \
    --project "$project_id" --region "$region" \
    --cpu 1 --memory 1Gi --concurrency 8 --timeout 600 \
    --min-instances 0 --max-instances 6
fi
