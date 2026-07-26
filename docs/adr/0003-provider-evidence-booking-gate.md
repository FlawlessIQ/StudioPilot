# ADR 0003: Provider evidence controls booking

Status: accepted

StudioHub uses normalized Docusign and QuickBooks evidence as inputs to a deterministic, versioned booking gate. UI actions and AI output cannot establish contract or payment completion.

This makes signature verification, webhook idempotency, scheduled reconciliation, auditable exceptions, and stable side-effect idempotency keys security-critical.
