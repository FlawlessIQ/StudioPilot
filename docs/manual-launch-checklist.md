# StudioHub Manual Launch Checklist

Everything in this list requires an external account decision, provider console
approval, legal/business judgment, or a real-world acceptance test. The
application should remain in its safe mock state until the applicable section is
complete.

## 1. Rotate credentials shared in chat

Before a pilot, rotate every provider secret that was pasted into a chat or
shown in a screenshot. Create replacements for SendGrid, Stripe, Dropbox,
Google OAuth, and Zoom as applicable. Add only the replacement values to Google
Secret Manager and revoke the exposed versions in each provider console.

Do not paste production secrets into source files, Firestore, screenshots, issue
trackers, or support messages.

## 2. SendGrid and outbound email

- authenticate the sending domain and verify the production From address
- choose an inbound subdomain, create the required MX record, and configure
  SendGrid Inbound Parse to:
  `https://studiohub--studiohub-prod.us-east4.hosted.app/api/webhooks/sendgrid/inbound?token=...`
- set the matching `SENDGRID_INBOUND_DOMAIN`
- enable the SendGrid Event Webhook at:
  `https://studiohub--studiohub-prod.us-east4.hosted.app/api/webhooks/sendgrid/events`
- enable signed event webhooks and store the public verification key as
  `SENDGRID_WEBHOOK_VERIFICATION_KEY`
- test delivery, bounce, open, click, unsubscribe, a valid COI PDF reply, a
  non-PDF rejection, and an oversize attachment rejection
- approve the tenant-branded message copy and reply-to behavior
- only then change `EMAIL_DELIVERY_MODE` from `mock` to `live`

## 3. OAuth integrations

Connect and test each provider from **Studio → Integrations** with a non-critical
pilot account:

- Google Calendar: choose the production calendar; test conflict lookup,
  consultation create/update/cancel, and a production date block
- Zoom: promote the app to Production when ready; verify its redirect URL and
  meeting create/update/cancel scopes; test waiting-room behavior and confirm
  recording remains disabled
- Dropbox: apply for Production, confirm App Folder scope, test the configured
  root, booking folder creation, COI upload, and replacement behavior
- Docusign: provide a production integration key/secret and webhook HMAC;
  select and map the approved contract templates; test every signer order,
  decline, void, completion certificate, and completed-document download
- QuickBooks Online: provide the production client/secret and verifier token;
  connect the correct company; map products/tax codes; test customer matching,
  retainer/final invoice, partial payment, refund, void, hosted link, and
  reconciliation

After successful provider acceptance testing, explicitly change
`PROVIDER_MOCK_MODE` to `false`. Do not change this flag merely because OAuth
completed.

## 4. Stripe commercial launch

- confirm the Stripe account legal entity, bank payout, support contact,
  statement descriptor, tax posture, and customer emails
- verify the $69 Solo, $199 Studio, and $399 Multi-Brand monthly products and
  annual price IDs in the production environment
- configure the Customer Portal cancellation, upgrade, downgrade, proration,
  and invoice-history policy
- perform one real low-value end-to-end subscription with a controlled account,
  confirm webhook entitlement updates, then refund it
- decide whether sales tax will be handled by Stripe Tax or external advice

## 5. Twilio and SMS

- create the production Twilio account, compliant sender, and messaging service
- supply credentials through Secret Manager
- complete required US A2P/10DLC or applicable regional registration
- approve opt-in language, STOP/HELP behavior, quiet hours, emergency use,
  retention, and per-plan usage limits
- run carrier delivery tests before enabling the `smsEnabled` entitlement

SMS should remain disabled until this section is complete.

## 6. Brand, domain, legal, and policy

- connect and verify the production custom domain
- provide final logo, favicons, email logo, brand colors, legal business name,
  support address, and default timezone/currency/tax settings
- obtain legal review of Privacy, Terms, subscription/cancellation language,
  contract templates, COI workflow wording, electronic-signature wording, data
  retention, deletion, and subcontractor documents
- obtain specialist legal advice before using sports/minor workflows; StudioHub
  does not certify COPPA, FERPA, insurance, tax, or employment compliance
- choose retention periods and run one tenant export and deletion rehearsal

## 7. Security and operations

- enforce MFA for Google Cloud, Firebase, GitHub, Stripe, SendGrid, and every
  provider administrator
- review IAM and remove temporary broad access; retain least-privilege runtime
  service accounts
- set the production platform-admin custom claim for the approved operator and
  verify no ordinary user has it
- provide and configure Sentry projects/DSNs for web, Functions, and Cloud Run
- configure alert destinations, uptime checks, budget alerts, error-rate alerts,
  dead-letter alerts, and an incident owner
- configure backup/restore retention and execute a restore drill
- review App Check enforcement after confirming all supported browsers and PWA
  clients obtain valid tokens
- document credential rotation, breach response, customer support access, and
  tenant suspension procedures

## 8. Pilot acceptance

Run a real pilot from a clean account:

1. register and subscribe
2. invite a staff member
3. submit an inquiry and convert it to a project
4. schedule a Calendar/Zoom consultation
5. select a package and generate a proposal
6. complete a Docusign agreement and QuickBooks retainer
7. pass the booking gate once and verify Calendar/Dropbox side effects
8. activate a client portal and submit a questionnaire
9. request, receive, review, correct, approve, archive, and deliver a COI
10. invite crew, accept the job, and acknowledge a published schedule
11. generate an AI schedule draft and an AI Copilot answer; verify citations
12. complete post-production, delivery, review request, and closeout
13. verify reports, audit events, provider health, failed-job rerun, export, and
    subscription usage

Record sign-off from the Studio Owner, coordinator, photographer, client, and
subcontractor personas before inviting pilot customers.
