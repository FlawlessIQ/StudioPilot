# Proposal Lifecycle

StudioCue proposals are versioned sales documents built from a project's
immutable `packageSnapshot`. The browser can edit presentation copy and dates,
but it cannot submit pricing, client identity, project identity, or package
totals as authoritative values.

## Authoritative lifecycle

The server permits only these authoring transitions:

```text
draft -> internal_review -> approved -> sent -> viewed -> accepted
          |                 |
          +----> draft <----+

sent/viewed -> declined
sent/viewed -> expired
sent/viewed/declined/expired -> superseded by a newly sent version
```

- Studio Owners, Studio Admins, and assigned Studio Coordinators can create and
  edit drafts.
- Only Studio Owners and Studio Admins can approve, generate the approved PDF,
  send, or resend.
- Returning a reviewed or approved proposal to draft increments its draft
  revision and invalidates the prior generated PDF.
- Accepted and superseded versions are terminal.
- A sent version becomes client-visible only through the sanitized client
  portal API. Clients do not read proposal documents directly from Firestore.

## Versioning and idempotency

Each proposal preserves:

- client and event snapshots
- package snapshot identifier
- line items, discount, tax, retainer, and total
- payment dates
- client-facing introduction and terms summary
- expiration
- proposal version and draft revision
- approval, send, view, and decision evidence
- PDF document, email job, and delivery evidence

Creating a new draft does not supersede a client-visible version. Older sent
versions become `superseded` only when the replacement version is actually
sent. Every command uses a tenant-scoped idempotency key and writes its result
to `commandExecutions`, preventing duplicate PDFs and emails on retry.

## PDF and delivery

Approval queues a private `proposal_pdf` job. The isolated Cloud Run renderer
receives only validated, server-derived snapshot data and produces a branded
PDF containing project/version metadata, offer lines, payment dates, terms,
expiration, and the contract boundary.

The generated file remains studio-only until the send command succeeds. Sending
then:

1. validates the approved proposal and generated PDF;
2. queues one branded `proposal_sent` email;
3. attaches the exact approved PDF;
4. marks the document client-visible;
5. transitions a consultation project to `PROPOSAL`;
6. records an immutable audit event.

SendGrid processed, delivered, deferred, bounced, dropped, opened, and clicked
events update delivery evidence. A click or view never implies acceptance.

## Client decision boundary

Clients can accept the current, unexpired sent/viewed proposal or request
changes. Acceptance advances only from `PROPOSAL` to `CONTRACT_PENDING`. It does
not sign a contract, collect a payment, approve insurance, or make the project
booked. Those remain separate deterministic provider and booking-gate steps.
