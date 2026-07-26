# Booking Integration Adapters

Milestone 4 normalizes Google Calendar, Zoom, Docusign, QuickBooks Online, and Dropbox behind typed provider contracts.

OAuth refresh tokens are never sent to browsers or stored as Firestore plaintext. `integrationConnections.encryptedCredentialRef` points to tenant-scoped encrypted material managed in Secret Manager.

- Google Calendar handles availability and event lifecycle with saved provider IDs.
- Zoom handles meeting lifecycle, join URLs, waiting room, and password policy.
- Docusign handles templates, signers, envelopes, completion evidence, and completed downloads.
- QuickBooks handles customer matching, invoice creation, hosted payment URLs, and balance reconciliation.
- Dropbox handles folders and files by ID, revision, canonical path, and scoped temporary link.

Every create call accepts an idempotency key. Webhooks normalize to internal domain events. Development mocks are explicit and return stable IDs without implying a live connection.
