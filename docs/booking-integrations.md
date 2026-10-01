# Booking Integration Adapters

Milestone 4 normalizes Google Calendar, Zoom, Docusign, QuickBooks Online, and Dropbox behind typed provider contracts.

OAuth refresh tokens are never sent to browsers or stored as Firestore plaintext. `integrationConnections.encryptedCredentialRef` points to tenant-scoped encrypted material managed in Secret Manager.

- Google Calendar handles availability and event lifecycle with saved provider IDs.
- Zoom handles meeting lifecycle, join URLs, waiting room, and password policy.
- Docusign handles templates, signers, envelopes, completion evidence, and completed downloads.
- QuickBooks handles customer matching, invoice creation, hosted payment URLs, and balance reconciliation.
- Dropbox handles folders and files by ID, revision, canonical path, and scoped temporary link.

Every create call accepts an idempotency key. Webhooks normalize to internal domain events. Development mocks are explicit and return stable IDs without implying a live connection.

## Busy time from every connected calendar (Google, Outlook, Apple)

Consultation availability (`functions/src/booking/consultation-availability-query.ts`,
`public-scheduling.ts` `slotsForTenant`, and the amendment clash check) subtracts busy
time from **every** calendar the studio has connected, unioned:
`getCalendarBusyIntervals` in `functions/src/operations/provider-runtime.ts` lists the
tenant's connected busy-time providers (`BUSY_TIME_PROVIDERS` in
`functions/src/integrations/busy-time.ts`), asks each in parallel, and merges the
intervals. A provider that fails is logged (`calendar_busy.provider_skipped`) and
skipped; the others still count. Only when nothing connected answers is the result
`ok:false`, which callers treat as "no extra busy time" — the slot list never fails
because a calendar did.

Outlook and Apple are **busy time only**: their `providerCapabilities` are empty, so
they never take the `calendar` capability (putting consultation events on a calendar),
which stays with Google.

### Outlook / Microsoft 365 (`outlook_calendar`)

OAuth 2.0 authorization-code flow (with PKCE) against the Microsoft identity platform
`common` authority, scopes `offline_access Calendars.Read` — read-only. Busy time comes
from Graph `GET /me/calendarView` (`Prefer: outlook.timezone="UTC"`), keeping
`showAs` busy / tentative / oof, skipping cancelled events, and placing all-day events
on the studio's own calendar day. `calendarView` rather than `getSchedule` because
getSchedule needs the mailbox address, caps a request at 62 days and is not available
to personal outlook.com accounts.

The client id is `MICROSOFT_CLIENT_ID` (plain env, `functions/.env.studiohub-prod`).
The client secret `MICROSOFT_CLIENT_SECRET` lives in Secret Manager and is **read at run
time** (`functions/src/integrations/platform-secret.ts`), not bound with `secrets:` —
binding a secret that has no version yet fails the deploy of every Function carrying
it, and the busy-time readers include the public scheduling link. Until both exist the
connect start answers `OAUTH_PROVIDER_NOT_CONFIGURED`, and the Integrations card says
"Coming soon" for as long as `outlook_calendar` is absent from
`NEXT_PUBLIC_ENABLED_OAUTH_PROVIDERS`.

**Switching Outlook on** (once):

1. Azure portal → Microsoft Entra ID → App registrations → New registration.
   - Name: `StudioCue`.
   - Supported account types: **Accounts in any organizational directory and personal
     Microsoft accounts**.
   - Redirect URI: platform **Web**, `https://studio-cue.com/api/integrations/oauth/callback`
     (the shared `OAUTH_CALLBACK_URL`; never the `*.hosted.app` host).
2. App → API permissions → Add → Microsoft Graph → **Delegated** → `Calendars.Read` and
   `offline_access`. Leave `User.Read` (added by default) or remove it; nothing uses it.
   No admin-consent-only permission is requested.
3. App → Certificates & secrets → New client secret. Copy the **Value** (not the ID).
   Note its expiry: Azure caps secrets at 24 months, and an expired one makes every
   Outlook refresh fail with `OUTLOOK_CALENDAR_TOKEN_REFRESH_FAILED`.
4. App → Branding & properties: publisher domain `studio-cue.com`, and complete
   **publisher verification** (Microsoft Partner Network ID). Many work tenants only let
   users consent to verified publishers' apps; without it those studios see "Need admin
   approval".
5. Store the values:
   ```bash
   ./scripts/configure-production-secrets.sh studiohub-prod provision   # creates + grants MICROSOFT_CLIENT_SECRET
   printf '%s' '<secret value>' | gcloud secrets versions add MICROSOFT_CLIENT_SECRET --data-file=- --project=studiohub-prod
   ```
   and set `MICROSOFT_CLIENT_ID=<Application (client) ID>` in `functions/.env.studiohub-prod`.
6. Deploy functions (all of them — `provider-runtime.ts` is shared), then add
   `outlook_calendar` to `NEXT_PUBLIC_ENABLED_OAUTH_PROVIDERS` in `apphosting.yaml` and
   roll out the app. `scripts/verify-production-integration-config.sh` checks
   `MICROSOFT_CLIENT_ID` for it.

### Apple Calendar / iCloud (`apple_calendar`)

iCloud has no OAuth for calendars. The studio enters its Apple ID email and an
**app-specific password** (account.apple.com → Sign-In and Security → App-Specific
Passwords) on the Integrations card. `integrationOAuth` (`action: "connect_apple"`)
checks the role, refuses anything that is not app-specific-password shaped, proves the
credential with CalDAV discovery against `https://caldav.icloud.com`
(`current-user-principal` → `calendar-home-set` → event calendars), stores the password
in Secret Manager exactly as OAuth tokens are stored, and only then writes the connection
document — Apple ID, calendar URLs and names, never the password
(`appleConnectionRecord` in `functions/src/integrations/apple-calendar.ts` takes no
password argument). A wrong password writes nothing.

Busy time is a CalDAV `REPORT calendar-query` per calendar with a `time-range` filter and
`<expand>`, parsed for VEVENT DTSTART/DTEND/DURATION (UTC, TZID, floating, all-day on the
studio's day), skipping `TRANSP:TRANSPARENT` and `STATUS:CANCELLED`; simple RRULEs are
expanded locally if the server leaves them unexpanded. Credentials are only ever sent to
`caldav.icloud.com` / `pNN-caldav.icloud.com`; redirects are followed by hand and only
there. A refused password marks the connection `error / APPLE_CALENDAR_AUTH_FAILED` so
the card asks for a reconnect. Disconnect destroys the secret's versions like any other
provider. Nothing to configure on StudioCue's side; the card is live wherever the
integration Functions are.

## QuickBooks invoices, line by line (GR Productions, 2026-10-01)

QuickBooks invoices used to be one line — the word "retainer" or "final", quantity 1,
the whole amount. They now follow how GR Productions builds them by hand. The rules are
pure functions in `functions/src/operations/quickbooks-invoice-lines.ts` (pinned by
`tests/quickbooks-invoice-lines.test.ts`); `quickbooks-invoice-plan.ts` gathers the job's
accepted proposal, package snapshots and the studio package's retainer rule for them.

**Customer.** Created with `GivenName`, `FamilyName` (the contact's first/last name, else
the display name split), `PrimaryEmailAddr`, `PrimaryPhone` and `BillAddr` from the
contact's optional `billingAddress` (studio Clients → Edit; `updateContact`). An existing
customer — matched by email, by name, stored on the contact, or carried by the invoice —
is only ever **filled where blank**, by a sparse update: whatever the studio typed in
QuickBooks stays. A refused fill is logged (`quickbooks.customer_fill_skipped`) and never
stops the invoice. The address matters because QuickBooks' Automated Sales Tax
attributes tax by the customer's address.

**Retainer invoice.** Line 1 is the retainer: `Qty = billed crew`, `UnitPrice = amount per
crew member` when the package bills per crew member (packages sharing a rate are one line,
crew added up), else `1 × the retainer`. Then every package (and extra) from the accepted
proposal at **$0**, described as the proposal reads — "Gold Photo Package — 2
photographers, 8 hours" and its bullets. When the retainer StudioCue bills is not the sum
of the parts (set by hand, percentage, capped), it is one line of the whole amount. The
lines always total the retainer. Retainer lines are never taxable.

**Final invoice.** Every package and extra at its **pre-tax** price (taxable when the job
is taxed: the package always, an extra per its own flag), the discount as a negative
taxable line, **"Retainer received" as a negative non-taxable line**, any later payments as
another — and the sales tax QuickBooks works out. Lines that don't add up to the agreed
pre-tax price (an amendment) collapse to one taxable "Packages" line of the right amount.

### Sales tax: QuickBooks is the authority (2026-10-01, replaces StudioCue's own tax)

Owner decision: QuickBooks' Automated Sales Tax computes the tax from the couple's billing
address, and the studio confirms it on every final invoice before it goes. Everything
below applies only to a studio switched on (`tenantFeatures/{tenantId}
.quickbooksItemisedInvoices`, `QUICKBOOKS_ITEMISED_FLAG`); **off, the invoice is exactly the
single line it always was.** (The earlier design — StudioCue's agreed tax sent as a
`TxnTaxDetail.TotalTax` override — was only ever reachable with the switch on, and is
gone: the plan now carries `gated` and `createQuickBooksInvoice` hands every switched-on
invoice to `createGatedQuickBooksInvoice`, `functions/src/operations/quickbooks-held-invoice.ts`.)

**The balance is pre-tax** (`functions/src/booking/final-tax-authority.ts`): pre-tax package
total − retainer paid − earlier payments, and QuickBooks adds its tax. The pre-tax total is
the agreed total less the agreed tax. For bookings signed while StudioCue added its own tax,
that tax is inside the signed total; taking it out is what stops it being charged twice
(recorded as `calculation.agreedTaxExcludedCents`). Bookings signed pre-tax have tax 0 and
read the same. `calculation.taxAuthority: "quickbooks"` marks such a bill; the screens'
figure for it is `outstandingFinalBalance({ …, excludeAgreedTax: true })`.

How the tax is worked out (`chooseQuickBooksTaxStrategy`, pure in
`quickbooks-final-tax.ts`, pinned by `tests/quickbooks-final-tax.test.ts`):

| Situation | Lines | Tax |
|---|---|---|
| Not taxed: a retainer (never), job exempt (`projects.salesTaxExempt`), or `billingSettings.salesTax.mode` "none" | every line NON (no codes if the company has no sales tax) | none |
| US, Automated Sales Tax | TAX on taxable lines, NON on retainer/payment lines | **QuickBooks computes it from BillAddr — no override, ever** |
| US, older manual sales tax with a default code (`TaxPrefs.TaxGroupCodeRef`) or exactly one active rate code | TAX / NON | `TxnTaxDetail.TxnTaxCodeRef` = that code; QuickBooks computes |
| Manual with several codes, sales tax off in QuickBooks, or tax codes refused (400) | every line NON | the studio's `estimateRateBasisPoints` as a "Sales tax (estimated at 8.25%)" line, said so on the review; no rate → no tax, said so |

400 retries are kept: without the online-payment flags, then without tax codes (falling to
the estimate line). `EmailStatus: "NotSet"` and no `/send` call: QuickBooks creating the
invoice never reaches the couple — StudioCue emails it.

**Read-back** (`quickBooksTaxReadBack`). `TotalAmt` and `TxnTaxDetail.TotalTax` (plus an
estimate line) become the bill: `amountCents`/`balanceCents` are QuickBooks', and
`taxCents`, `providerTotals { totalCents, taxCents, subtotalCents }`, `providerLines
{ taxAuthority: "quickbooks", taxStrategy, taxLocation }` are stored. Tax is QuickBooks'
figure, not a mismatch; `providerAmountMismatch` (`basis: "pre_tax"`) is raised only when
QuickBooks' pre-tax subtotal differs from StudioCue's. An invoice whose BillAddr has no
street, city or postal code is held with "Add the couple's billing address so QuickBooks can
work out the tax." and "Send with tax" refused until it's fixed.

**Held for the studio.** Every final (and a retainer when `billingSettings
.holdRetainerForReview`) lands in `review_required` with `sendReview { state:
"awaiting_studio", subtotalCents, taxCents, totalCents, taxLocation, billingAddressMissing,
sendWithTaxBlocked, note }`, no pay link stored and no email. A QuickBooks webhook cannot
turn it into "sent" (`providerReportedInvoice` keeps `review_required`; paid/voided still
win), and the couple's portal shows it as being prepared (`atProvider` false). "Check and
send" (`components/booking/held-invoice-review.tsx` — Invoices card, booking page for a
retainer, Cue's final-bill card; Today links to it) reads:

> Packages $X · Discount · Retainer received −$Y · Sales tax $Z (calculated by QuickBooks
> for Austin, TX) · Balance due $T — [Send with tax] [Send without tax] [Edit]

bookingCommand `sendHeldInvoice` (`functions/src/booking/held-invoice-send.ts`,
owner/admin, audited `invoice.sent_with_tax` / `invoice.sent_without_tax` /
`invoice.retainer_released` / `invoice.tax_recalculation_requested`, idempotent) checks the
confirmed figure and queues `release_quickbooks_invoice`. The job re-reads QuickBooks; for
"without tax" it sparse-updates every line to NON (dropping an estimate line), reads back
and refuses if tax remains; for "work the tax out again" it re-sends the contact's billing
address and re-reads. Then the pay link, the record (`awaiting_delivery`), and StudioCue's
email. If QuickBooks' total changed underneath, the bill goes back to the studio instead of
out. A job that gives up returns the bill to `awaiting_studio` with the error. Edit = void
(`voidInvoice`) and send a corrected bill.

**Not yet verified against a real company.** On a sandbox (US, Automated Sales Tax on,
QuickBooks Payments): that AST computes tax on create from the customer's BillAddr with
TAX/NON lines and no TxnTaxDetail; what it does with no BillAddr (0, or the company
address); that the sparse update to NON lines drops the tax to 0 and the pay link still
works; that a negative "Retainer received" line is accepted; that `EmailStatus: "NotSet"`
sends nothing; and on a manual-tax company, that `TxnTaxCodeRef` is honoured.

## QuickBooks from inside StudioCue: settings, items, test invoice, money moving back (2026-10-01)

QuickBooks is the sales-tax authority. The foundation the invoice tax flow builds on:

- **`billingSettings/{tenantId}`** — `{ tenantId, salesTax: { mode: "quickbooks" | "none",
  estimateRateBasisPoints: number | null }, holdRetainerForReview, quickbooksItems:
  { retainerItemId, packageItemId }, updatedAt, updatedBy }`. Pure rules in
  `features/billing/sales-tax-settings.ts` (copied to `functions/src/billing/`, parity-tested):
  `normaliseBillingSettings`, `defaultBillingSettings` (no tax, unless the connected company has
  sales tax on → "quickbooks" suggested), `salesTaxApplies(settings, project)`,
  `estimatedSalesTaxCents(subtotal, settings)`. Saved by integrationsCommand `setBillingSettings`
  (owner/admin, audited); the item ids only by the item setup. Rules: studio staff read, no writes.
- **`projects.salesTaxExempt`** — bookingCommand `setJobSalesTaxExempt` (owner/admin, audited);
  the browser may not write the field. Toggle on the job's booking page and the Cue final-bill card.
- **Settings → Integrations → QuickBooks** (`?tab=quickbooks`) — `quickbooksSetupCommand`
  (`status` / `setUpItems` / `sendTestInvoice`; holds the QuickBooks client credentials). Items:
  "Retainer" (non-taxable) and "Photography package" (taxable), found by name else made; the
  invoice worker uses them per line (`itemKeyForLine`) and sets them up on the first invoice,
  falling back to the old single service item if it can't. The test invoice is $1.00 to
  "StudioCue test (you)" at the studio's own address, read back for its pay link, then voided;
  nothing is emailed. Mock mode passes deterministically.
- **Money moving back.** Payment, CreditMemo and RefundReceipt webhooks were stored as
  `ignored / UNSUPPORTED_ENTITY`. They now queue `reconcile_quickbooks_money_event`, which
  re-runs the ordinary invoice reconcile for the invoices touched (a deleted payment: every
  paid / part-paid QuickBooks invoice). An invoice QuickBooks no longer shows paid reopens and
  raises "QuickBooks no longer shows the … paid" on Today; a refund raises "Refund of $X recorded
  in QuickBooks" and does not reopen anything (QuickBooks keeps the invoice paid).
  **The Intuit app's webhook subscription must include Payment, CreditMemo and RefundReceipt**
  (Intuit Developer → Webhooks), or none of these events arrive.
- **Sandbox walk** — `scripts/uat/quickbooks-sandbox-walk.mts` (env only; refuses prod and any
  non-sandbox base URL).
