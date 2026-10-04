# StudioCue legal package for counsel — October 4, 2026

Operator: **FlawlessIQ LLC**, 2 Green Village Rd, Suite 209, Madison, NJ 07940 (New Jersey).
Live at https://studio-cue.com/legal since October 5, 2026. Everything here is generated from
the text the site renders (`scripts/legal/export-counsel-package.ts`).

## What is in this folder

| File | Document | Version | Effective |
| --- | --- | --- | --- |
| `terms.md` | Terms of Service | 1.0 | October 5, 2026 |
| `privacy.md` | Privacy Policy | 2.0 | October 5, 2026 |
| `dpa.md` | Data Processing Addendum | 1.0 | October 5, 2026 |
| `acceptable-use.md` | Acceptable Use Policy | 1.0 | October 5, 2026 |
| `cookies.md` | Cookie and Browser Storage Notice | 1.0 | October 5, 2026 |
| `client-terms.md` | Client and Crew Terms | 1.0 | October 5, 2026 |
| `esign.md` | Electronic Signature Disclosure and Consent | 2 | October 5, 2026 |
| `subprocessors.md` | Subprocessors | 1.0 | October 5, 2026 |
| `copyright.md` | Copyright Policy | 1.0 | October 5, 2026 |
| `esign-consent.md` | Electronic signature consent (signer-facing) | esign-consent-v2 | — |
| `agreement-text.md` | Wording StudioCue writes into studios' contracts | — | — |
| `notices.md` | Signup consent, inquiry notice, email footer | — | — |

## Decisions already made (please confirm or change)

- New Jersey law; Morris County courts / D.N.J.; jury waiver; no class actions; one-year limit on claims.
- Liability cap: fees paid in the prior 12 months, or $100 if greater.
- Refunds: none for partial periods; annual plans refundable in full within 14 days of the first annual charge.
- Failed payment: 7 days of full access, then read-only (view and export only) and client messages held, not dropped.
- Cancellation: 30 days to export, deletion within 90 days (backups age out in 84).
- No DPA signature step: the DPA is incorporated by reference in the Terms.
- AI: Gemini via Vertex AI in StudioCue's Google Cloud project; no training on customer data; human review of every send.

## Open questions

1. Courts vs arbitration (currently courts, with a jury waiver and class waiver).
2. Automatic-renewal laws: are CA/NY/other renewal reminders needed beyond Stripe's trial-ending email and the in-app notice three days before?
3. Is a separately signable DPA (or SCCs) needed for larger or non-US studios?
4. Minors: family and sports jobs — guardian as client, no child accounts; is the current wording sufficient (COPPA, state minors' privacy laws)?
5. Sales tax on the subscription (Stripe Tax not yet on).
6. The nine e-signature questions in `docs/esign-consent-review.md`.
7. The starter agreement leaves cancellation, copyright and liability for each studio to write. Should StudioCue offer suggested clauses, and with what disclaimer?
8. DMCA agent registered (DMCA-1081859); anything else needed for the safe harbor?

## How changes ship

Counsel's edits ship as version 1.1 (2.1 for the Privacy Policy). The Terms
promise 30 days' email notice for material changes. Record each change here:

| Document | Section | Change | Material? | Notice sent | Effective |
| --- | --- | --- | --- | --- | --- |
| | | | | | |
