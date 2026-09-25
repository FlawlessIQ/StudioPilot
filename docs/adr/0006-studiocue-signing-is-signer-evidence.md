# ADR 0006: StudioCue's own signing ceremony is signer evidence

Status: accepted (2026-09-25)

Amends [ADR 0003](0003-provider-evidence-booking-gate.md). Sits beside
[ADR 0005](0005-imported-booking-evidence.md).

## Context

ADR 0003 made provider evidence the authority for booking: a signing vendor's
verified webhook completes a contract, and UI actions and AI output cannot.
Two other authorities followed, both the studio's word rather than a
vendor's: `manual_attested` (a signature taken elsewhere, recorded by an owner)
and `imported` (a booking that predates StudioCue).

Signing vendors charge more than a studio at our scale can justify (Dropbox
Sign from $75/mo, DocuSign embedded from $480/mo), and every photographer CRM a
studio would leave for us signs natively. So StudioCue now writes the contract
from the studio's own agreement and the couple signs it in their portal.

That signature has to be evidence the gate can rely on. It is not a vendor's
webhook, and it is not the studio's word either: it is the couple's own act.

## Decision

1. **A new completion authority, `client_signed`.** It means: the couple named
   on the contract signed it themselves, in StudioCue, and StudioCue captured
   the act server-side. It is **not** in `studioVouchedAuthorities`, so the
   gate reads it as a completed contract (signer evidence), and the gate
   labels it "Signed by the client in StudioCue" with source
   `studiocue_signature` — never as a vendor's, never as the studio's word.
2. **It is evidence only under five conditions**, each enforced in code:
   - *The document is data and the hash is over the data.* The contract is a
     block document; `documentHash = sha256(canonicalJson(document))`. The
     portal page and the sealed PDF are renderings of it.
   - *The couple signs the hash they were shown.* The portal sends back the
     hash it rendered; `sign_contract` refuses a mismatch, and re-hashes the
     stored document before accepting.
   - *Only the couple can produce the couple's signature.* The signer must hold
     an active `client` membership on the project and be signed in with the
     email the contract is addressed to. One membership per user per tenant
     means a studio member cannot also be the client.
   - *Signatures are append-only.* `contractSignatures/{id}` is written once
     by the server; `firestore.rules` refuses every client write, update and
     delete, and no server path updates one.
   - *Completion does not wait on the PDF.* The signature record is the
     evidence; the sealed copy follows.
3. **The studio signs first, at send.** An owner or admin types their name
   and signs for the studio; the couple's signature then completes the
   contract in one step. A studio may adopt its signature for automatic sending
   on acceptance — recorded as `authMethod: "adopted_signature"`, with who
   adopted it and when.
4. **What is recorded with each signature:** signer uid and email, the typed
   name, the document hash, the consent version and a hash of its exact words,
   the Firebase sign-in method, email-verified state, IP address, user agent,
   and the server timestamp.
5. **UI and AI still cannot establish completion.** The only writer of a
   `client_signed` completion is the portal route's signing transaction, acting
   on the couple's own session.

## Consequences

- The booking chain is unchanged: completing a contract fires
  `bookingContractCompleted` as a vendor's webhook would.
- Money and dates in a contract are read from the accepted proposal and never
  typed by the studio; a studio may fill only fields the records cannot answer.
- A signed StudioCue contract is never voided or edited. A change is a new
  contract.
- The consent wording is legal text: each version is kept, and counsel reviews
  a version before it becomes current. Until the first review, the capability
  is switched on per studio (`tenantFeatures/{tenantId}.nativeContractSigning`)
  rather than for everyone.
