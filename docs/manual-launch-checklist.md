# StudioCue Manual Launch Checklist

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
  `https://studio-cue.com/api/webhooks/sendgrid/inbound?token=...`
- confirm `inbound.studio-cue.com` has an MX record with priority `10` pointing
  to `mx.sendgrid.net`
- set the matching `SENDGRID_INBOUND_DOMAIN`
- enable the SendGrid Event Webhook at:
  `https://studio-cue.com/api/webhooks/sendgrid/events`
- enable signed event webhooks and store the public verification key as
  `SENDGRID_WEBHOOK_VERIFICATION_KEY`
- test delivery, bounce, open, click, unsubscribe, a valid COI PDF reply, a
  non-PDF rejection, and an oversize attachment rejection
- approve the tenant-branded message copy and reply-to behavior
- configure and save each pilot studio’s name, accent color, HTTPS email logo,
  and reply-to address in **Studio setup → Settings → Email branding**
- test the branded client invitation, resend, revoke, verification, forgot
  password, reset completion, and expired-link paths
- keep non-production environments in mock mode; production live mode still
  requires the controlled acceptance tests above before inviting pilot clients

## 3. Provider endpoint URLs to paste into each console

Every provider posts to the **web app**, not to a Cloud Function. The functions
are private Cloud Run services with `invoker: "private"` — a provider cannot
mint a Google ID token — so each one is fronted by a route under
`app/api/webhooks/` that forwards the raw body upstream with a service
identity attached. Giving a provider a `*.run.app` URL will 403 every delivery.

Until the custom domain in section 6 is connected, the origin is the App
Hosting URL:

```
https://studiohub--studiohub-prod.us-east4.hosted.app
```

| Provider console setting | Path |
|---|---|
| Docusign Connect | `/api/webhooks/docusign` |
| Dropbox Sign callback | `/api/webhooks/dropbox-sign` |
| QuickBooks change notifications | `/api/webhooks/quickbooks` |
| Stripe (platform billing) | `/api/webhooks/stripe` |
| Stripe Connect (connected accounts) | `/api/webhooks/stripe-connect` |
| Zoom event subscription | `/api/webhooks/zoom` |
| SendGrid Event Webhook | `/api/webhooks/sendgrid/events` |
| SendGrid Inbound Parse | `/api/webhooks/sendgrid/inbound?token=…` |

Two things about these that are easy to get wrong:

- **Dropbox Sign's endpoint must answer `GET`.** Its console verifies the URL
  with a GET and expects the literal body `Hello API Event Received`. Every
  other route answers 405 to GET on purpose.
- **Re-paste all of them when the custom domain is connected.** The origin is
  the only part that changes, but a provider left pointing at the App Hosting
  URL keeps working, so nothing will fail loudly to remind you.

`npm run certify:providers` posts directly at the functions, so it proves each
signature scheme but not this hop. `tests/webhook-relay-headers.test.ts` covers
the hop by asserting every header a handler reads is one its route forwards.

## 4. OAuth integrations

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
- Dropbox Sign: provide the production client/secret and API key; verify the
  callback and event endpoint; test template roles, decline, cancellation,
  completion evidence, and completed-document retrieval
- Stripe Connect: configure the production Connect client ID and separate
  connected-account webhook; test customer matching, retainer/final invoice,
  partial payment, failure, void, and reconciliation in the studio-owned account

After successful provider acceptance testing, explicitly change
`PROVIDER_MOCK_MODE` to `false`. Do not change this flag merely because OAuth
completed.

## 5. Stripe commercial launch

- confirm the Stripe account legal entity, bank payout, support contact,
  statement descriptor, tax posture, and customer emails
- verify the $69 Solo, $199 Studio, and $399 Multi-Brand monthly products and
  annual price IDs in the production environment
- configure the Customer Portal cancellation, upgrade, downgrade, proration,
  and invoice-history policy
- perform one real low-value end-to-end subscription with a controlled account,
  confirm webhook entitlement updates, then refund it
- decide whether sales tax will be handled by Stripe Tax or external advice
- confirm new Checkout sessions receive the application-enforced 14-day trial;
  the immutable Stripe Price objects intentionally do not carry a default trial

## 6. Twilio and SMS

- create the production Twilio account, compliant sender, and messaging service
- supply credentials through Secret Manager
- complete required US A2P/10DLC or applicable regional registration
- approve opt-in language, STOP/HELP behavior, quiet hours, emergency use,
  retention, and per-plan usage limits
- run carrier delivery tests before enabling the `smsEnabled` entitlement

SMS should remain disabled until this section is complete.

## 7. Brand, domain, legal, and policy

- connect and verify the production custom domain
- provide final logo, favicons, email logo, brand colors, legal business name,
  support address, and default timezone/currency/tax settings
- obtain legal review of Privacy, Terms, subscription/cancellation language,
  contract templates, COI workflow wording, electronic-signature wording, data
  retention, deletion, and subcontractor documents
- obtain specialist legal advice before using sports/minor workflows; StudioCue
  does not certify COPPA, FERPA, insurance, tax, or employment compliance
- choose retention periods and run one tenant export and deletion rehearsal

## 8. Security and operations

- enforce MFA for Google Cloud, Firebase, GitHub, Stripe, SendGrid, and every
  provider administrator
- review IAM and remove temporary broad access; retain least-privilege runtime
  service accounts
- set the production platform-admin custom claim for the approved operator and
  verify no ordinary user has it
- provide and configure Sentry projects/DSNs for web, Functions, and Cloud Run
- configure alert destinations, uptime checks, budget alerts, error-rate alerts,
  dead-letter alerts, and an incident owner — **done, see below**
- configure backup/restore retention and execute a restore drill — **schedules
  and drill done, see below**
- review App Check enforcement after confirming all supported browsers and PWA
  clients obtain valid tokens
- document credential rotation, breach response, customer support access, and
  tenant suspension procedures

### What is configured in `studiohub-prod`

**Alerting.** One email notification channel (`StudioCue operations (owner)`)
and three policies, all enabled:

| Policy | Fires on |
|---|---|
| operational error or dead-lettered job | any occurrence in 5 minutes |
| server errors (Cloud Run 5xx) | more than 5 in 5 minutes, grouped by service |
| app unreachable | uptime check below 50% for 5 minutes |

The first depends on a code change worth knowing about.
`captureOperationalError` began with `if (!dsn) return`, and the production
`SENTRY_DSN` secret exists with **no versions** — so it returned on its first
line every time. A job that exhausted its retries and went to `dead_letter`
produced no signal anywhere: no log line, no alert, nothing to notice it by
except reading Firestore. It now writes a structured Cloud Logging entry
unconditionally, and the log-based metric `studiocue_operational_errors` counts
entries carrying `jsonPayload.studiocueOperationalError`. **Renaming that field
silently breaks the alert.** Sentry remains the richer destination if a DSN is
ever supplied.

Drilled on 2026-08-31 by writing a synthetic entry with `code: ALERT_DRILL`
and confirming the metric counted it. Whether the email arrives is the one part
that has to be confirmed from the inbox.

**Backups.** Two schedules on `(default)`: daily with 14-day retention, weekly
with 84-day retention. Restore drilled on 2026-08-31 from the 2026-08-30
backup into a separate `restore-drill` database, which was deleted afterwards
— production was never the restore target.

Point-in-time recovery is **disabled**. It is the difference between losing up
to a day and losing up to a minute, and it costs extra storage, so it is a
deliberate decision rather than an oversight — worth revisiting before real
customer data lands.

**App Check is UNENFORCED for every service.** The client is configured with a
real reCAPTCHA Enterprise site key and `getFirebaseClient` throws without one,
so browsers do attest — but enforcement was deliberately left off. Turning it
on when any supported client fails to attest locks that client out of a live
app, the App Check verified/unverified split is only visible in the Firebase
console, and the PWA and service-worker paths have not been observed. Enable it
from the console after watching that split, not before.

## 9. Pilot acceptance

Run a real pilot from a clean account:

1. register and subscribe
2. invite a staff member
3. submit an inquiry and convert it to a project
4. schedule a Calendar/Zoom consultation
5. select a package; draft, review, approve, generate, send, view, and accept a
   proposal; verify the branded PDF attachment and SendGrid delivery events
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
