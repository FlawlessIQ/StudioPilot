# Bill clients yourself — plan (2026-10-09, rev 2)

**Status**

| Phase | State |
|---|---|
| 0 — Foundation (per-job choice, settings, numbering, no dead ends) | Live 2026-10-09 (f98f2cb3) |
| 1 — The PDF invoice (`/v1/invoices/pdf`, `invoice_pdf` jobs, portal, sample preview) | Live 2026-10-09 (70b20acf) |
| 2 — Deposits: drafted on signing / no-agreement booking, emailed with the PDF or marked sent, Today card, booking panel, PDF re-rendered on payment/void | Live 2026-10-09 (779fbd93) |
| 3 — Finals, single bills, booking changes, closeout: the final-bill core drafts the studio's own final (taxed on the whole price, deposit shown as paid), "Create the final invoice" on Today/Invoices, closeout reads the standing final or a paid-in-full bill | Built 2026-10-10 |
| 4–6 | Not started |

Phase 2 decisions made while building: a deposit is never taxed (tax goes on
the bill that completes the price, as QuickBooks does on its final); the
"Connect payments" Today nudge became "Add how {client} can pay you"; a
QuickBooks studio is asked "QuickBooks or bill it myself" in the agreement
send dialog when the job hasn't chosen.

Decisions (Conor, 2026-10-09): every recommendation below accepted — paid
deletes leave a money-free settled stub, deletes scrub audit amounts, one
optional tax rate per studio, QuickBooks jobs delete StudioCue's copy only.

**Ask (Conor):**
- Every journey that invoices or waits for money must work without QuickBooks.
- A studio that **never connects QuickBooks** bills on its own, through StudioCue.
- A studio **with QuickBooks** chooses **job by job**: there is no studio-wide
  either/or.
- StudioCue produces **PDF invoices**.
- The studio can **delete its invoice records** during or after the job.

## Where we are

Most of the plumbing already exists. A no-provider invoice is a real record today:
`invoiceReferences` with `provider: null`, `providerState: "not_applicable"`,
`completionAuthority: "manual_attested"`, written by `recordRetainerPayment` /
`recordFinalPayment` / `recordInvoicePayment`. The booking gate and closeout both
accept it. `cloud-run/pdf` already renders branded proposal and contract PDFs from
`pdfJobs`.

What's missing:
- A per-job choice.
- A record that exists **before** payment: "$2,400 due Oct 30, sent, not paid".
- An invoice document.
- A way to delete.

What breaks or misleads without QuickBooks:

| # | Problem | Where |
|---|---|---|
| 1 | Queues a QuickBooks job that can only fail, then marks the invoice `failed` (family, portrait and no-agreement deposit jobs) | `functions/src/booking/orchestration.ts` `bookWithoutAgreement` (~L999) |
| 2 | Buttons that can only error: "Create retainer invoice", "Send the final bill" (the main action on Today and Invoices), and Cue's `create_retainer_invoice` / `send_final_balance` cards | `project-booking-workspace.tsx`, `final-balance-actions.tsx`, `ai/actions/booking-actions.tsx` |
| 3 | Balance owed after an amendment gets no bill and no card, and the 28-day scheduler skips the job without a word (`no_provider_customer`) | `amendment-apply.ts` ~L345, `invoice-scheduler.ts` |
| 4 | QuickBooks wording on screens that aren't about QuickBooks: Invoices header, "resend it from QuickBooks", "Final QuickBooks balance settled", gate `source: "quickbooks"` | Invoices page, `features/today/inbox.ts`, `post-event/commands.ts`, `booking-gate-service.ts` |
| 5 | `paid_in_full` jobs have no `final` invoice, so closeout's `final_balance` needs a $0 record | `post-event/commands.ts` ~L900 |
| 6 | `paymentsConnected()` counts Stripe, but the server doesn't offer Stripe, so they can disagree | `features/booking/deposit-by-studio.ts` |
| 7 | The schema has drifted from what's written: no `provider: null`, `failed`, `superseded` or `review_required` | `features/invoices/schema.ts` |
| 8 | Group events: payments are recorded per parent, but there are no invoices or payment instructions | `eventParticipants` |

## The model

### 1. Who bills: decided per job

- `project.billing.method`: `"quickbooks" | "studio"`.
- **No QuickBooks connected:** always `studio`. Nobody is asked, and the QuickBooks
  option never appears.
- **QuickBooks connected:** the job's **first bill** asks "Bill through QuickBooks /
  Bill it myself". This is on the Today card, the booking page and Cue's card. The
  answer is saved on the job, and every later bill on that job follows it.
  - The default selection is whatever the studio picked last time. That's a
    convenience only, never a setting.
  - "Change how this job is billed" is on the job. Bills already raised stay where
    they are; only new bills follow the new choice.
- Server: one pure resolver `billingMethodFor(project, connections)` in
  `features/billing/` (plus the functions copy), used by every creation point. It
  replaces the `"quickbooks"` fallback in `resolveProviderForTenant` for client
  billing.
- If QuickBooks is disconnected mid-job, its open bills stay recorded as QuickBooks
  bills, and the job is asked again on its next bill.

### 2. A studio bill is a real invoice, issued by StudioCue

Same `invoiceReferences` doc and kinds (`retainer`, `final`, single bill,
`amendment`/`adjustment`). Additions:

- `provider: null`, `billedBy: "studio"`
- `number`: per-studio sequence (`INV-0042`), allocated in a transaction on a
  counter doc. Numbers are never reused, even after a delete.
- `status`: `draft` → `sent` → `partially_paid` → `paid` (plus `overdue`, `voided`,
  `superseded`)
- `issuedAt`, `dueDate`, `sentAt`, `sentBy`
- `lines[]`: from the package snapshot, add-ons and amendments, with the amounts the
  server computed
- `taxCents` (see tax below)
- `pdf`: a storage path + hash
- `payLink`: optional, the studio's own link (Square, PayPal, Stripe Payment Link).
  When it's set, the portal's **Pay** button and the PDF both point to it.
- Payments: the existing `studioPayments[]` and record-payment commands. Optional
  "paid a different amount (fees)", with a note in the audit.

**PDF:** a new `cloud-run/pdf` endpoint, `/v1/invoices/pdf`, queued as
`pdfJobs/invoice_{invoiceId}_{rev}` and built the same way as contract PDFs.
- Content: studio logo, name and address, the invoice number and dates, the client
  and billing address (we already collect it), the job and date, lines, tax, amount
  paid so far, balance due, payment instructions and the pay link.
- Each change to an invoice (a payment, a void, a correction) renders a new
  revision. The latest one is what the client sees.

**Sending**, which the studio picks on each send:
- **Email it from StudioCue**: the `self` variant of `retainer_invoice` /
  `final_invoice` / `final_payment_reminder`, with the PDF attached plus the
  portal/pay-link button.
- **Download, and I'll send it myself**: marks it sent.
- The client always sees it in the portal's Payments panel.

**New billing settings** (they shape the PDF; none of them chooses a provider):
- Business name, address and logo (prefilled from the studio)
- Payment instructions: free text plus quick picks for Zelle, Venmo, check payable
  to, bank transfer
- Default due terms
- An optional sales tax rate and label. Default is none. QuickBooks jobs keep
  QuickBooks tax.
- Optional invoice footer / notes

### 3. Deleting invoice records

The studio can delete an invoice record at any time during or after the job:
- **One bill:** "Delete this invoice"
- **The job:** "Delete all invoice records for this job"

This is a **third hard-delete exception** beside tenant deletion and the job purge
([[hard-delete-is-one-exception]]), so it follows the same rules:

- **Discovery, not a list.** It finds everything carrying the `invoiceId`: the
  invoice doc, PDF revisions in Storage, the `documents` rows, `pdfJobs`, queued
  `emailJobs` for it, `providerJobs`, `autopayCharges` and payment reminders. Every
  candidate is tenant-checked first. Protected collections (`commandExecutions`,
  `webhookEvents`) are left alone.
- **Resumable.** The invoice doc is deleted last.
- **Owner/admin only.** The confirm sheet says what goes and what stays. It offers
  "Download the PDFs first", and the studio must type the job name for a whole-job
  delete.
- **The job doesn't go backwards.** A booked job stays booked and a closed job stays
  closed. Deleting writes a **money-free settlement stub** on the job, e.g.
  `billing.settled.retainer = { at, by, deleted: true }`. It has no amounts, numbers
  or methods, and the booking gate and closeout accept it as evidence. Deleting an
  **unpaid** bill writes no stub, so the requirement reopens. The sheet says so.
- **Audit:** one tombstone, `invoice.deleted` (invoice number, who, when, no
  amounts). Existing `auditEvents` that carry amounts for that invoice are scrubbed
  of money fields, which is the same exception the purge makes. Decision needed,
  below.
- **QuickBooks bills:** delete removes StudioCue's copy only and says plainly that
  the invoice stays in QuickBooks.
- **Refused** while a payment is in flight: autopay charging or a provider job
  running.
- `npm run test:invoice-purge` runs it against the emulator: tenant isolation,
  storage, second run is a no-op, gate still passes on a paid delete.

## Phases

### Phase 0 — Foundation
- `billingMethodFor` + `project.billing.method` + a `setJobBillingMethod` command.
- The billing settings (business details, instructions, terms, tax, footer) with the
  Settings UI.
- The invoice number counter.
- Fix `features/invoices/schema.ts` to match what's written, plus the new fields
  (#7).
- `paymentsConnected()` uses the server resolver (#6).
- **Guard test:** every bill-raising action resolves the job's method first, so no
  button can only error (#2).

### Phase 1 — The PDF invoice
- `/v1/invoices/pdf` + fixture + visual review (Poppler), US Letter.
- The pdfJob queue and storage at `tenants/{t}/projects/{p}/invoices/{id}/{rev}.pdf`,
  with visibility `client`.
- Portal Payments panel: invoice list, PDF, pay link, instructions.

### Phase 2 — Deposits, every journey
- `bookWithoutAgreement`, `bookingContractCompleted`, combined-agreement signing:
  resolve the method. For `studio`, draft the invoice and queue the PDF, with no
  provider job (#1).
- Today card "Maya's deposit invoice · $1,200 · INV-0042": **Send** / **Download** /
  **Paid** / Open. With QuickBooks it shows the per-job choice first.
- The booking page shows the same choices, and gate labels become provider-neutral
  (#4).

### Phase 3 — Balances, single bills, amendments
- `sendFinalBalance`, the 28-day scheduler, single bills (`on_the_day`,
  `invoice_after`), vendor on-the-day balances and `amendment-apply.ts` all take the
  `studio` branch. The scheduler drafts the bill and a Today card. It never emails on
  its own, because nothing is billed without a person choosing to. Every skip reason
  is logged (#3).
- Closeout: no-balance jobs pass `final_balance` without a $0 record. Rename to
  "Final balance settled" (#5).
- Note: another session currently has `final-balance-actions.tsx` and
  `final-bill-words.ts` dirty. Coordinate before touching them.

### Phase 4 — Tracking
- Overdue from `dueDate`. The overdue card says "Chase it", and Cue's reminder
  (`payment-reminders.ts`) attaches the latest PDF.
- Invoices page becomes the ledger for both methods: number, client, source
  (QuickBooks / StudioCue), due / sent / overdue / paid, and totals outstanding.
- CSV export, and a zip of PDFs for a date range (for the bookkeeper, and before
  deleting).

### Phase 5 — Delete
- Purge policy in `features/billing/invoice-purge-policy.ts`, the command in
  `bookingCommand`, and the settlement stub read by the gate and closeout.
- Confirm sheet (one bill / whole job), the emulator sweep test, and the audit
  scrub.
- Update the Privacy Policy/DPA retention wording to say studios can delete invoice
  records. Counsel review is already owed for the legal set.

### Phase 6 — Cue, copy, group events, walk
- Cue: `choose_job_billing`, `send_invoice`, `delete_invoice` (prepare → approve
  like every action). `find_quickbooks_payments` is only offered with QuickBooks.
- Copy sweep by claim ([[copy-outlives-the-change]]), plus a pinned guard on
  "QuickBooks" outside Integrations and QuickBooks-only cards.
- Setup: no billing question for studios without QuickBooks. They are asked only for
  payment instructions.
- The `connect-payments` nudge becomes "Add how clients pay you".
- Group events: an invoice per parent (same PDF), sent from the roster.
- Walk on prod ([[walk-it-on-prod-or-it-is-not-done]]):
  - a studio with no QuickBooks: wedding deposit → amendment → final → closeout →
    delete
  - family paid in full, sports on the day, corporate invoice after, makeup/hair on
    the day
  - FlawlessIQ with QuickBooks: one job per method
  - Screenshot every changed screen at desktop + phone, and run layout integrity.

## Deploy notes
- This touches shared billing and email modules, so deploy **all** functions, then
  run `verify-deployed-function-freshness.sh`. The render worker must pick up the PDF
  attachment emails.
- The `cloud-run/pdf` service deploys separately.
- There's no new HTTP function: everything rides `bookingCommand` / `crmCommand`.

## Decisions for Conor
1. **Audit trail on delete:** should the deletion also scrub amounts from existing
   audit events (recommended, otherwise "delete" leaves the money behind), or keep
   the audit intact and delete only the invoice, PDFs and emails?
2. **Settlement stub:** after deleting a *paid* invoice, does the job keep a
   money-free "deposit settled" marker so it stays booked/closed (recommended), or
   does it reopen?
3. **Tax on StudioCue invoices:** a single optional rate per studio (recommended for
   v1), or none at all in v1?
4. **Deleting QuickBooks-billed records:** allowed, deleting StudioCue's copy only
   (recommended), or only for StudioCue-issued invoices?
