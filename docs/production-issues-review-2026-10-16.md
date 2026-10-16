# Production issues reviewed — October 16, 2026

## Inquiry reply: Edit worked on the second click

The report places this in the preceding hour. No `client_error` on a studio
route was present in the preceding two hours of Cloud Logging. That rules out
an *observed* exception, not a silent interaction failure. The exact original
incident is not established without the studio, inquiry and a reproduction.

A concrete weakness exists: Today kept only the selected action ID and derived
the open sheet from the current AI-action query. Record invalidation temporarily
sets that query to null. This could close the sheet and discard edits during a
refresh. Edit also allowed an optional callback to do nothing.

The local change keeps the selected draft and editing mode together, scoped to
the studio. A refresh cannot unmount its editor. A missing draft opens a visible
recovery link and reports `TODAY_DRAFT_NOT_AVAILABLE` through the existing,
privacy-filtered browser error reporter. Without an editor callback, Edit is a
working inquiry link. Decisions remain checked by the server against current
state; retaining a browser draft grants no authority.

## GR Productions: QuickBooks failure dominating Today

Confirmed in production: a payment reconciliation created October 5 at
9:11 a.m. Eastern exhausted its retries by 9:19 a.m. with
`QUICKBOOKS_NOT_CONNECTED`. QuickBooks reconnected at 10:21 a.m. that day,
but the old check remained `dead_letter`; reconnecting did not replay it.
The card's Resolve link led only to Integrations.

The original job was requeued with its original idempotency key, guarded by
its tenant, type, terminal status, error code and connected QuickBooks company.
An audit event preserves the old error and retry count. The production worker
then succeeded on its first attempt with `mock: false`, no affected StudioCue
invoices, no parent invoices and no refund task. No payment or refund was
created. The card disappears on the next fresh Today read.

The local product fix adds Retry check to this specific read-only failure,
including when it is the headline; disconnected accounts get a reconnect
link. A server command checks owner/admin membership, subscription, tenant,
job type/status and company match, audits the previous failure and queues the
same job. It cannot retry invoice creation, payment recording or charges.
Different payment events stay separate; operator-dismissed failures no longer
remain on Today. Retry failure is visible and reports
`TODAY_QUICKBOOKS_CHECK_RETRY_FAILED`.

## Search: “Add packages” returned nothing

Confirmed in source and the supplied screenshot: typed queries searched only
record labels/details using one literal substring. Quick actions were shown
only for an empty query. Packages, settings and help were absent from typed
results, so the requested action could never match.

The local change searches permission-appropriate actions and settings, existing
packages and trade-appropriate help alongside records. It matches words in any
order, common plural/“adding” forms, accented names and ISO dates. Job venues
and message bodies/previews are searchable too. Enter and arrow keys work;
search returns focus when closed. Reads begin only when search opens. Loading
and read failures are distinguished from an actual empty result.

## Additional finding during verification

The Inquiries preview link speculatively fetched the public form before anyone
opened it. That route performs studio lookups; a mock-mode preview request
took over 40 seconds and caused the broad layout check to time out waiting
for network quiet. Public preview links now explicitly disable prefetch, and
a browser check verifies that opening Inquiries does not request the form.
This is evidence of avoidable background work, not proof of the reported
production Edit incident.

## Verification and release scope

New regression coverage checks package discovery, settings/help, names/dates,
role-specific destinations, reconciliation recovery and retry restrictions.
Browser checks exercise the screenshot's subscription-page query and one-click
inquiry editing, including keeping typed text through a viewport change. They
are included in the existing CI browser job, not just a manual test run.
The demo reply's nonexistent lead reference was corrected so this browser
check exercises a real inquiry card rather than an unrelated approval.

Validation completed:

- Full regression suite: **4,425 passed** (the shared checkout also contains
  unrelated job-stage/Cue work; those files were left untouched).
- Final application build and separate Functions build: passed.
- Lint: no errors; 17 existing warnings outside these changes. The changed
  search, Today, preview-link and retry-command files also passed targeted lint.
- Broad browser sweep: 245 passed, with one Inquiries network-idle timeout.
  After removing preview prefetch, the final Inquiries layout rerun and all
  three interaction checks passed (4/4). Search and editor screenshots were
  inspected visually.

Production action completed: the single GR Productions reconciliation above.
Application and function code changes are local and have not been deployed.
The new command lives in `integrationsCommand`; deploy that function and
restore its invoker policy before rolling out the application.

Remaining limits: search still uses the existing bounded record reads rather
than a complete server search index. Browser error reports capture observed
errors and the explicit recovery failures above; they do not retrospectively
prove why every click failed or provide general session replay.
