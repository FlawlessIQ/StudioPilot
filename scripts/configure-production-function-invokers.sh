#!/usr/bin/env bash
set -euo pipefail

project_id="${1:-studiohub-prod}"
region="${2:-us-east4}"
project_number="$(gcloud projects describe "${project_id}" --format='value(projectNumber)')"
app_hosting_service_account="firebase-app-hosting-compute@${project_id}.iam.gserviceaccount.com"
functions_service_account="${project_number}-compute@developer.gserviceaccount.com"

app_services=(
  aiactioncommand
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
  integrationoauth
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
  stripewebhook
  studioimportcommand
  supporttenantsummary
  tenantbrandingcommand
  tenantdatacommand
  tenantexportdownload
  tenantonboardingcommand
  workflowcommand
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

for service_name in "${app_services[@]}"; do
  gcloud run services add-iam-policy-binding "${service_name}" \
    --region="${region}" \
    --project="${project_id}" \
    --member="serviceAccount:${app_hosting_service_account}" \
    --role=roles/run.invoker \
    --quiet >/dev/null
done

for service_name in "${scheduler_services[@]}"; do
  gcloud run services add-iam-policy-binding "${service_name}" \
    --region="${region}" \
    --project="${project_id}" \
    --member="serviceAccount:${functions_service_account}" \
    --role=roles/run.invoker \
    --quiet >/dev/null
done

gcloud projects add-iam-policy-binding "${project_id}" \
  --member="serviceAccount:${functions_service_account}" \
  --role=roles/cloudtasks.enqueuer \
  --condition=None \
  --quiet >/dev/null

gcloud projects add-iam-policy-binding "${project_id}" \
  --member="serviceAccount:${functions_service_account}" \
  --role=roles/pubsub.publisher \
  --condition=None \
  --quiet >/dev/null

gcloud run services add-iam-policy-binding studiohub-pdf \
  --region=us-east4 \
  --project="${project_id}" \
  --member="serviceAccount:${functions_service_account}" \
  --role=roles/run.invoker \
  --quiet >/dev/null

gcloud run services add-iam-policy-binding studiohub-file-safety \
  --region=us-east1 \
  --project="${project_id}" \
  --member="serviceAccount:${functions_service_account}" \
  --role=roles/run.invoker \
  --quiet >/dev/null

gcloud run services add-iam-policy-binding filesafetyonfinalize \
  --region=us-east1 \
  --project="${project_id}" \
  --member="serviceAccount:${functions_service_account}" \
  --role=roles/run.invoker \
  --quiet >/dev/null

echo "Configured private Function invokers for ${project_id} in ${region}."
