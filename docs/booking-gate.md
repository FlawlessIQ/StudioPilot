# Booking Gate

The booking gate is deterministic and versioned. AI is not part of the decision.

The default gate requires a completed contract, a QuickBooks retainer invoice, that invoice paid with zero balance or an explicitly approved exception, an available production date, and complete required contacts.

A contract is completed by one of four authorities, and the gate records which:

- a signing vendor's verified webhook (Docusign, Dropbox Sign) — ADR 0003;
- the couple's own signature in StudioCue (`client_signed`, source `studiocue_signature`) — ADR 0006;
- the studio's recorded signature (`manual_attested`) or an imported booking (`imported`) — the studio's word, ADR 0005.

Viewed or partially signed contracts do not pass. Invoice links, views, and StudioCue UI actions do not establish payment. Provider webhooks and reconciliation are the evidence sources.

`BookingGateService` evaluates requirements before side effects. A tenant-scoped idempotency key protects completion. The completion record captures Dropbox folder ID/path, Calendar event ID, workflow run ID, portal-access ID, and time.

The trusted command moves only `RETAINER_PENDING` projects to `BOOKED`, then queues idempotent folders, event, workflow/checkpoint, portal, and confirmation work. Re-running a completed key must not duplicate resources.
