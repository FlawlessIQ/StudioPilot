#!/usr/bin/env bash
set -euo pipefail

project_id="${1:-studiohub-prod}"
region="${2:-us-east4}"
project_number="$(gcloud projects describe "${project_id}" --format='value(projectNumber)')"
app_hosting_service_account="firebase-app-hosting-compute@${project_id}.iam.gserviceaccount.com"
functions_service_account="${project_number}-compute@developer.gserviceaccount.com"

app_services=(
  aiactioncommand
  aicommunicationscommand
  aicopilotcommand
  aischedulecommand
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
  integrationoautheast4
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
  stripeconnectwebhook
  stripewebhook
  studioimportcommand
  supporttenantsummary
  tenantbrandingcommand
  tenantdatacommand
  tenantexportdownload
  tenantonboardingcommand
  workflowcommand
  zoomwebhook
)

scheduler_services=(
  albumreminderscheduler
  automationretryscheduler
  crewcascadeexpiryscheduler
  domaineventoutboxscheduler
  finalinvoicescheduler
  operationshealthscheduler
  operationsjobscheduler
  relativedatescheduler
  reviewrequestscheduler
  scheduledemailrelease
  tenantexportscheduler
)

event_services=(
  aijobtaskdispatch
  emailjobtaskdispatch
  pdfjobtaskdispatch
  providerjobtaskdispatch
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

# Eventarc delivers queued provider, email, AI, and PDF jobs using the Functions runtime service
# account. The private Gen 2 dispatcher must allow that identity to invoke its
# backing Cloud Run service or jobs remain queued indefinitely.
for service_name in "${event_services[@]}"; do
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

# The scheduler creates authenticated Cloud Tasks using the Functions runtime
# identity. Let that identity attach itself to the task without granting it
# impersonation rights over any other service account.
gcloud iam service-accounts add-iam-policy-binding "${functions_service_account}" \
  --project="${project_id}" \
  --member="serviceAccount:${functions_service_account}" \
  --role=roles/iam.serviceAccountUser \
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
