# Contracts written and signed in StudioCue

StudioCue writes each client's contract from the studio's own agreement and
the proposal the couple accepted. The studio reads it and signs for the studio;
the couple signs in their portal; the signed copy is sealed with a certificate
and emailed to them. No signing vendor, no per-contract cost.

Why this and not a vendor: `docs/execution-plan-native-esign-2026-09-25.md`.
Why the signature counts as booking evidence: `docs/adr/0006-studiocue-signing-is-signer-evidence.md`.

## Switching it on

Held per studio until counsel has reviewed the consent and certificate wording.

- A platform admin sets `tenantFeatures/{tenantId}` to
  `{ tenantId, nativeContractSigning: true }` (members may read it; only the
  server writes it — `firestore.rules`).
- To switch it on for everyone, set `NATIVE_SIGNING_GENERALLY_AVAILABLE` to
  `true` in **both** `features/contracts/rollout.ts` and
  `functions/src/contracts/commands.ts` (a test compares them).
- A studio with it on but no saved agreement sees "Set up your agreement" on
  Today; the booking step keeps the old paths until an agreement exists.

## The flow

| Step | Who | Where |
|---|---|---|
| Save the agreement (a new immutable version each time) | Owner / admin | `/studio/contracts/agreement` → `saveAgreementTemplate` |
| Bring in an imported agreement as a draft | Owner / admin | `agreementDraftFromImport` (writes nothing) |
| Contract prepared when a proposal is accepted | System | `bookingProposalAccepted` → `prepareOnAcceptance` |
| Fill anything the records can't answer, re-prepare | Studio | booking step → `prepareContract` |
| Sign for the studio and send | Owner / admin | `sendContract` |
| Open it | Couple | portal `view_contract` |
| Sign | Couple | portal `sign_contract` |
| Seal + certificate + email the copy | System | `pdfJobs/contract_seal_*` |
| Remind at 3 and 7 days if unsigned | System | `contractReminderScheduler` |
| Withdraw an unsigned one | Owner / admin | `voidContract` |

Studio commands are dispatched from `bookingCommand`
(`functions/src/contracts/commands.ts`) and inherit its App Check, identity,
membership, subscription and idempotency handling. The couple's commands run in
`app/api/client/portal/route.ts` (`server/contracts/client-signing.ts`), because
their session, IP and browser are the evidence.

A draft lives in `contractDrafts/{projectId}`, never in `contracts` — every
reader of `contracts` treats a record there as something the couple was sent.

## The agreement format

Plain text with a small markdown subset: `#`/`##` headings, `-` bullets,
`**bold**`, and `{{field}}` tokens. `{{payment.schedule}}` and
`{{package.deliverables}}` on a line of their own render as a table and a list.
Everything else is the studio's wording, untouched.

Fields StudioCue fills (`features/contracts/document.ts`, `contractMergeFields`):
client names and email, event name/type/date/venue, package name, coverage and
deliverables, total, retainer, balance, payment schedule, studio name and legal
name, and the date prepared. **Money and dates only ever come from the accepted
proposal** (`recordOnlyFields`); a studio may type a value only for a field the
records cannot answer, or for its own `{{custom.*}}` fields, and that value is
recorded on the contract as the studio's.

Importing an agreement maps `[CLIENT NAME]`, `<<Event Date>>` and `{{x}}`
placeholders to fields by name (`suggestFieldForPlaceholder`); anything unclear
becomes a named custom field. Paper signature lines are dropped (StudioCue adds
the signatures) and the first line becomes the title.

## What is recorded

- `contracts/{id}` — `provider: "studiocue"`, the resolved `document`, its
  `documentHash`, `templateVersionId`, `mergeOverrides`, `signers`, a summary of
  each signature, and on completion `completionAuthority: "client_signed"` with
  `completionEvidence.kind: "studiocue_signature"`.
- `contractSignatures/{contractId}_{studio|client}` — append-only: signer uid
  and email, typed name, document hash, consent version and a hash of its exact
  words, sign-in method, email-verified state, IP, user agent, time.
- `auditEvents` — `contract.studio_signed_and_sent`, `contract.viewed`,
  `contract.signed_by_client`, `contract.voided`, `project_state_changed`,
  `agreement_template.version_saved`, `contract.auto_send_enabled|disabled`.
- The sealed PDF and its `documents` record (see `docs/pdf-generation.md`).

## Consent wording

`features/contracts/esign-consent.ts`. Each version is kept by id and never
edited in place; the signature records which version and a hash of its words.
The portal refuses a signature under any version but the current one. Changing
the words means a new version — and counsel reads it first.

## Edges

- **A signed contract is never voided or edited.** A change is a new contract.
- **A proposal cannot be corrected once accepted** (reissue refuses
  `accepted`), so a contract's figures cannot move underneath it. If the job's
  records change between preparing and sending, `sendContract` re-resolves and
  refuses with `CONTRACT_CHANGED`.
- **Signed somewhere else?** Recording a signature by hand supersedes a
  StudioCue contract still out for signature, so it cannot be signed later or
  keep collecting reminders.
- **Emails re-check at send time.** `contract_ready` and `contract_reminder`
  are dropped by the worker if the contract is no longer waiting.
- **Quiet imported bookings** never get a contract (they are already signed);
  `contract_reminder` is on the held list regardless.
- **Deleting a job** deletes its signed contract and signature records with
  everything else; the purge preview says so and notes the couple keeps the
  copy they were emailed.
- **Not in v1:** a second client signer, drawn signatures, a cryptographic
  PDF seal, a public verify-by-hash page, amendments.
