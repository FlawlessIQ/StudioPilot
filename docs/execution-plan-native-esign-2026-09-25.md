# Execution plan — native click-to-sign contracts (2026-09-25)

StudioCue writes the studio's own agreement into a contract, the couple signs it
in their portal, and the signature is booking evidence. No signing vendor, no
per-envelope cost.

**Why this option.** The vendor comparison (2026-09-25) found that Dropbox Sign
starts at $75/mo and DocuSign embedded signing at $480/mo, while every
photographer CRM a studio would leave for us (HoneyBook, Dubsado, Studio Ninja,
Táve, 17hats) signs natively. A simple electronic signature with intent,
consent, attribution, association with the record and tamper-evident retention
is enforceable for service contracts under ESIGN/UETA (US) and eIDAS/ECA 2000
(EU/UK). None of the ESIGN §7003 exceptions touch a photography contract.

**Size.** About 14–17 working days across eight phases. Phases 1–5 are the
shippable core (≈11 days); 6–7 make it safe to leave on.

---

## What exists today (and what it means for the build)

| Fact | Consequence |
|---|---|
| No signing app is offered in production (`features/integrations/schema.ts:74-79`); every studio records signatures by hand via `recordSignedAgreement` (`functions/src/booking/commands.ts:930-1123`). | Nothing to migrate. Native signing is additive; the manual path stays as the fallback. |
| The studio import already captures the agreement: `agreementTemplates/imported_agreement_{assetId}` with `body.body` (≤20k chars plain text) and detected `variables` (`functions/src/studio-import/review.ts:721-733`, `studio-import/extraction.ts:98-112, 204-210`). **Nothing reads it.** | The content exists for Gabe and every imported studio. We need a reader, a merge-field mapping and a versioned template — not an import. |
| No contract text editor exists anywhere. | Phase 2 builds a minimal one. |
| The client portal's writes run in the Next route `app/api/client/portal/route.ts` (Admin SDK), not a Cloud Function. `save_card` already captures consent, IP and user agent (`route.ts:1416-1425`) and audits `billing.autopay_consent_given`. | Signing belongs in that route, following `save_card`. The functions relay (`app/api/functions/[functionName]/route.ts:108-113`) does **not** forward `x-forwarded-for` / `user-agent`, so a relayed function would lose the signer's evidence. |
| Proposal acceptance requires a Firebase account (invite token → account). By the time a contract exists the couple has a portal login. | No unauthenticated signing link is needed. Attribution rides on the existing account + verified email. |
| There is **no shared "complete a contract" function**. Both webhooks (`functions/src/booking/webhooks.ts:~96, 258-313`) and `recordSignedAgreement` write completion inline. `bookingContractCompleted` (`functions/src/booking/orchestration.ts:309-464`) is a trigger on `contracts/{id}` and drives the retainer invoice. | Extract `completeContract(tx, …)` once; native signing calls it. Writing the contract to `completed` with the orchestration's `contractId` fires the rest of the chain unchanged. |
| Gate fold: `contractCompleted = completed && !studioVouched` (`commands.ts:1965-1983`, `orchestration.ts:576-588`, `features/imports/existing-booking.ts:34`). | A new authority that is **not** in `studioVouchedAuthorities` counts as signer evidence. That is the intended reading, and it needs an ADR. |
| `contractSchema` has drifted from what is written: `provider` allows only `docusign \| dropbox_sign`, and `completionAuthority`, `providerState`, `testMode`, `supersededAt/By`, `queued`, `failed`, `superseded` are written but not declared (`features/contracts/schema.ts:4-43`). | Fix the schema first (Phase 1), or the new fields land on a schema nobody trusts. |
| `cloud-run/pdf` is Python 3.13 + FastAPI + ReportLab; endpoints `/v1/{proposals,schedules,closeouts}/pdf`; caller `runPdfJob` (`functions/src/operations/ai-pdf.ts:737-801`) stores to `tenants/{t}/projects/{p}/generated/{jobId}.pdf` with sha256 on the `documents` record. | Add `/v1/contracts/pdf`. The storage, hashing and auth pattern is reusable as-is. |

---

## The design in one screen

```
Studio                          StudioCue server                       Couple (portal)
──────                          ────────────────                       ───────────────
Agreement template  ─────►  agreementTemplateVersions (immutable)
(edited once)
                            proposal accepted
                                   │
                            prepareContract: resolve merge fields
                            → ContractDocument (block JSON)
                            → documentHash = sha256(canonical JSON)
                            → preview PDF                 
Review + "Sign & send" ◄──── contract: draft
(studio signs first)  ─────► contract: sent ── contract_ready email ──► /client/contract
                                                                       read, tick consent,
                                                                       type full name, Sign
                            sign_contract (portal route) ◄──────────── (sends documentHash)
                            ├─ contractSignatures/{id}  (immutable)
                            ├─ completeContract(tx)  → RETAINER_PENDING
                            │     └─ bookingContractCompleted → retainer invoice (unchanged)
                            └─ sealJob → signed PDF + certificate page
                                           └─ contract_signed email (copy to couple)
```

Five rules that make it evidence and not a checkbox:

1. **The document is data, and the hash is over the data.** A contract is a
   `ContractDocument` — canonical block JSON (headings, paragraphs, lists,
   the resolved merge values). `documentHash = sha256(canonicalJson)`. The
   portal HTML and the PDF are both *renderings* of it; PDF bytes are not
   deterministic, the JSON is.
2. **The couple signs the hash they were shown.** The portal sends back the
   `documentHash` it rendered; `sign_contract` rejects a mismatch. What was
   signed is provably what was sent.
3. **Only the couple can produce the couple's signature.** The command
   requires `role: "client"` on an active membership listing the project,
   the signed-in email equal to the contract's signer email, and **no studio
   membership (owner/admin/coordinator/crew) for that uid in that tenant**.
   A studio user cannot sign as their client.
4. **Signatures are append-only records.** `contractSignatures/{id}` is
   written once and never updated; the contract references it.
   `firestore.rules`: no client write, no update, no delete.
5. **Completion does not wait on the PDF.** The signature record is the
   evidence; the sealed PDF follows. A PDF-service outage delays the copy,
   never the booking.

---

## Phase 0 — Decisions and ADR (½ day)

- **0.1 Write ADR 0006 "StudioCue signing ceremony is signer evidence"**,
  amending ADR 0003. It states: a signature captured by StudioCue's server
  from the client's own authenticated session is the *client's* act, not the
  studio's word, so it is not in `studioVouchedAuthorities`; the five rules
  above are the conditions; UI and AI still cannot establish completion.
- **0.2 Settle the open decisions** at the end of this doc. The plan below
  assumes the recommended answers.
- **0.3 Rename the state-machine authority** `"docusign"` → `"contract"`
  (`features/projects/state-machine.ts:52, 58`). Type label only; nothing
  branches on the string today. Update the comment that names it in
  `tests/offered-providers-agree.test.ts:125`.

## Phase 1 — Deterministic core in `features/contracts/` (2 days)

No I/O. Where most of the tests point.

| # | Change | Where |
|---|---|---|
| 1.1 | **Fix `contractSchema` drift.** `provider: z.enum(["docusign","dropbox_sign","studiocue"]).nullable()`; declare `completionAuthority`, `providerState`, `testMode`, `supersededAt/By`, `proposalId`; add `queued`, `failed`, `superseded` to the status enum. New native fields: `templateVersionId`, `documentHash`, `document` (the block JSON), `studioSignatureId`, `clientSignatureIds[]`, `mergeOverrides`, `voidedAt/By/reason`. | `features/contracts/schema.ts` |
| 1.2 | **Merge-field catalogue.** A fixed set, each with a resolver from proposal/package/studio data: `client.names`, `client.email`, `event.name`, `event.type`, `event.date`, `event.venue`, `event.timezone`, `package.name`, `package.deliverables`, `package.coverage` (via `resolveCoverage` — see coverage memory), `price.total`, `price.retainer`, `price.balance`, `payment.schedule` (a table block), `studio.name`, `studio.owner_name`, `studio.email`, `contract.date`. Money is integer cents formatted at render. | `features/contracts/merge-fields.ts` |
| 1.3 | **Template body format.** A small markdown subset: `#`/`##` headings, paragraphs, numbered and bulleted lists, `**bold**`, and `{{field}}` tokens. Parser → blocks. No HTML, no images, no links. | `features/contracts/template-format.ts` |
| 1.4 | **Resolver.** `resolveContractDocument(templateVersion, sources, overrides)` → `{ document, unresolved[] }`. Pure. An unresolved field blocks sending; an override is recorded on the contract with who set it. | `features/contracts/resolve.ts` |
| 1.5 | **Canonical hash.** Stable key order, NFC-normalised strings, no timestamps inside the hashed body. Shared by the functions copy (drift test like `booking-gate.test.ts:250`). | `features/contracts/document-hash.ts` + `functions/src/contracts/document-hash.ts` |
| 1.6 | **Consent text, versioned.** `ESIGN_CONSENT_V1`: agreement to use electronic records and signatures, right to a paper copy and how to ask, right to withdraw consent before signing, how to get a copy afterwards, system requirements (a current browser + email). Stored by version id; the signature records the id. **Counsel reviews before launch.** | `features/contracts/esign-consent.ts` |
| 1.7 | **Gate fold.** New authority `client_signed`, deliberately absent from `studioVouchedAuthorities`. Gate label source `studiocue_signature` → "Signed by {name} in StudioCue". | `features/booking/schema.ts:51`, `server/services/booking-gate-service.ts:7-10, 51`, `components/studio/live-domain-view.tsx:459-464` (also add the missing `imported` label) |
| 1.8 | **Signing policy.** `canSignContract(contract, signer, membership, studioMemberships)` returning a typed refusal (`NOT_SENT`, `ALREADY_SIGNED`, `VOIDED`, `WRONG_SIGNER`, `SIGNER_IS_STUDIO_MEMBER`, `HASH_MISMATCH`, `CONSENT_REQUIRED`, `NAME_REQUIRED`). The portal route calls this; the tests pin it. | `features/contracts/signing-policy.ts` |

## Phase 2 — The agreement template in the studio (2–3 days)

The imported agreement becomes something the studio owns and edits.

| # | Change | Where |
|---|---|---|
| 2.1 | **Collections + rules.** `agreementTemplates/{id}` (mutable head: name, status, `currentVersionId`) and `agreementTemplateVersions/{id}` (immutable: body, fieldMap, createdBy/At). Both owner/admin read, all client writes `false`. Indexes start with `tenantId`. | `firestore.rules`, `firestore.indexes.json` |
| 2.2 | **Convert the import.** For each `imported_agreement_*`: map detected `variables` (`[CLIENT NAME]`, `<<date>>`, `{{x}}`) to catalogue fields. **Cue proposes the mapping; the studio approves it** — the AI never writes a template version on its own. Unmapped placeholders stay visible as "fill per contract". | `functions/src/contracts/template-commands.ts`, reuse `functions/src/studio-import/extraction.ts` |
| 2.3 | **Editor.** One page: the body in a textarea with a live preview beside it, a merge-field picker that inserts `{{field}}`, and a sample render against the studio's most recent accepted proposal. Save = new immutable version. Mobile: preview-first with an edit sheet (see mobile-compact memory). | `app/settings/contract/page.tsx`, `components/contracts/agreement-editor.tsx` |
| 2.4 | **Commands.** `saveAgreementTemplateVersion`, `setDefaultAgreementTemplate` (owner/admin, idempotent, audited `agreement_template.version_saved`). | `functions/src/contracts/template-commands.ts`, `lib/contracts/command-client.ts`, relay allowlist, invoker script |
| 2.5 | **Setup truth.** `hasAgreementTemplate` becomes "a template version exists" (native) OR the old provider condition. The Today card and setup conversation stop saying "StudioCue doesn't write your contract" **only for studios with a template**. | `features/today/setup-gaps.ts:76-110`, `components/setup/use-setup-state.ts:89`, `components/setup/setup-conversation.tsx:58` |

## Phase 3 — Prepare, review and send (2–3 days)

| # | Change | Where |
|---|---|---|
| 3.1 | **`prepareContract` command.** Preconditions match `recordSignedAgreement`: project `CONTRACT_PENDING`, an accepted proposal, no completed contract. Resolves the document from the proposal's immutable snapshots + package snapshot + studio profile; writes `contracts/{id}` as `draft`, `provider: "studiocue"`, `documentHash`, `templateVersionId`; queues a preview PDF. Idempotent on `(projectId, proposalId, templateVersionId)`. | `functions/src/contracts/commands.ts` |
| 3.2 | **`/v1/contracts/pdf` endpoint.** Renders `ContractDocument` blocks with studio branding, page numbers, contract id + `documentHash` in the footer, and an empty signature block (studio + client). | `cloud-run/pdf/main.py`, new `contract.py`, fixture + `render_fixture.py` case |
| 3.3 | **Review screen.** On the job's booking workspace: the rendered contract, any unresolved fields as inline inputs (recorded as `mergeOverrides`), and one primary action **"Sign & send to {client}"**. The studio owner types their name to sign first — the countersignature happens at send, so the couple's signature completes the contract in one step. | `components/booking/project-booking-workspace.tsx`, new `components/contracts/contract-review.tsx` |
| 3.4 | **`sendContract` command.** Owner/admin only. Re-resolves and rejects if the hash changed since review (proposal corrected underneath). Writes the studio `contractSignatures` record, moves the contract to `sent`, creates/repoints `bookingOrchestrations/{projectId}` exactly as `createEnvelope` does (`commands.ts:729-929`) so `bookingContractCompleted` will fire, and queues `contract_ready`. | `functions/src/contracts/commands.ts` |
| 3.5 | **`contract_ready` email.** Primary action = `${APP_URL}/client/contract`. Studio-initiated, so **not** in `clientAutomationEmailTypes`. New template case → **this touches `operationsTaskWorker`; deploy and verify it** (see Phase 8). | `functions/src/communications/email-templates.ts`, `components/communications/email-template-designer.tsx` |
| 3.6 | **Send on acceptance (optional, off by default).** `bookingProposalAccepted` (`orchestration.ts:100-307`) today hard-requires a connected provider (:127). Add a native branch: if the studio has a default template **and** has turned on auto-send, prepare + send using the owner's stored signature adoption. Default off — "AI prepares, human approves." | `functions/src/booking/orchestration.ts` |

## Phase 4 — The couple signs (2–3 days)

| # | Change | Where |
|---|---|---|
| 4.1 | **Portal read.** Extend the contract field allowlist (`route.ts:226-234`) with `document`, `documentHash`, `status`, the studio signature's name/time, and the signed PDF link once sealed. Stop exposing `signingUrl` for native contracts. | `app/api/client/portal/route.ts` |
| 4.2 | **`view_contract` command.** First view moves `sent → viewed`, audited `contract.viewed` with IP/UA. Idempotent. | `route.ts` |
| 4.3 | **`sign_contract` command.** Input: `contractId`, `documentHash`, `typedName`, `consent: z.literal(true)`, `consentVersion`, idempotency key. Runs `canSignContract`, then in **one transaction**: writes `contractSignatures/{id}` (signer uid, email, typed name, `sign_in_provider` from the ID token, email-verified flag, IP from `x-forwarded-for`, user agent, server timestamp, `documentHash`, consent version + text hash), calls `completeContract(tx, { authority: "client_signed", evidence })`, audits `contract.signed_by_client`. Idempotency via `commandExecutions/client_sign_{sha256(...)}` exactly like `decide_proposal` (`route.ts:948-968`). App Check and the existing rate limit apply. | `route.ts`, `server/contracts/sign-contract.ts` |
| 4.4 | **Extract `completeContract(tx, …)`.** One function that sets `status: completed`, `completedAt`, `completionAuthority`, `completionEvidence`, advances `CONTRACT_PENDING → RETAINER_PENDING` with `stateVersion + 1` and audits `project_state_changed`. Replace the three inline copies: the Dropbox Sign webhook, the DocuSign webhook, `recordSignedAgreement`. Needs a functions copy + a server copy, or better: move it to one place the portal route can import (the route already uses the Admin SDK). Guarded by `transaction-read-before-write.test.ts`. | `server/contracts/complete-contract.ts`, `functions/src/booking/webhooks.ts`, `functions/src/booking/commands.ts` |
| 4.5 | **Signing UI.** `/client/contract` renders the document (same blocks as the PDF), a sticky footer with the consent checkbox + the consent text behind "Read the full terms", a "Type your full name" field shown in a signature font as they type, and **Sign contract**. After signing: a confirmation state with "A signed copy is on its way to {email}" and the download link when ready. Mobile first: the couple will open this from an email on their phone. | `components/client/live-client-views.tsx:2033-2188` (replace the provider link-out for native contracts), new `components/client/contract-signing.tsx` |
| 4.6 | **Studio notification.** `studio_contract_signed` email + Today item "Emma signed — retainer invoice is next". | email templates, `features/today/` |

## Phase 5 — Seal and certificate (1–2 days)

| # | Change | Where |
|---|---|---|
| 5.1 | **`/v1/contracts/sealed` endpoint.** Renders the same document with both signature blocks filled (typed name in signature style, date, signer email) plus a **Certificate of Completion** page: contract id, `documentHash`, template version, each event (prepared, studio signed, sent, viewed, client signed) with timestamp, IP, user agent and authentication method, and the consent version. | `cloud-run/pdf` |
| 5.2 | **Seal job.** A `pdfJobs` kind triggered when a native contract completes. Stores to `tenants/{t}/projects/{p}/contracts/signed/{contractId}.pdf`, `visibility: shared`, sha256 into `contracts.fileHash`, sets `signedDocumentId` and `certificateDocumentId`. Never regenerates once written. | `functions/src/operations/ai-pdf.ts`, `jobs.ts` |
| 5.3 | **`contract_signed` email** to the couple with the PDF link (and attachment, as `proposal_sent` does at `jobs.ts:736`). This is the ESIGN "copy to the signer" — required, not a nicety. Queued by the seal job, so it cannot go out without a PDF. | email templates, `jobs.ts` |
| 5.4 | **Documents list.** The signed contract appears in the client portal Documents tab and the studio's job documents. | existing `documents` path |

## Phase 6 — Lifecycle edges (1–2 days)

| # | Change | Where |
|---|---|---|
| 6.1 | **Void and reissue.** Owner/admin can void a `sent`/`viewed` contract (reason required, audited, couple emailed that it was withdrawn). A signed contract is never voided or edited. | `functions/src/contracts/commands.ts` |
| 6.2 | **Proposal correction (R2) interplay.** Correcting a proposal after a contract is sent voids the unsigned contract and prompts a reissue; `sendContract`'s hash recheck is the backstop. | `functions/src/booking/proposals.ts` |
| 6.3 | **Reminder.** `contract_reminder` at 3 and 7 days unsigned. It is automated, so it goes **in** `clientAutomationEmailTypes` and must **re-read the contract and project at send time** (scheduled-client-email memory: a queued reminder for a contract signed yesterday must not go). | `functions/src/imports/existing-booking.ts:258-266`, lifecycle scheduler |
| 6.4 | **Quiet imports.** An imported booking never gets a native contract (it is already `BOOKED`/`PLANNING`); the `prepareContract` precondition already enforces it. Add the test. | `tests/quiet-imported-bookings.test.ts` |
| 6.5 | **Purge.** `features/projects/purge-policy.ts`: a job holding a client-signed contract needs an explicit second confirmation ("this deletes the signed contract your client also holds"). The couple's emailed copy survives either way. | purge policy + UI |
| 6.6 | **Decline (deferred).** v1 has no "decline" button; the couple replies to the studio. Declines are rare and a message is better than a status. | — |

## Phase 7 — Copy sweep, docs and tests (1½ days)

Sweep **by claim**, not by directory (copy-outlives-the-change memory). Every
place below asserts "StudioCue doesn't sign" or "connect a signing app":

- `features/today/setup-gaps.ts:96-110`, `components/setup/setup-conversation.tsx:58`
- `components/booking/project-booking-workspace.tsx:436-450, 862-867, 1005-1013, 1095`
- `components/booking/record-signed-agreement.tsx:95` (becomes "Signed somewhere else?")
- `components/integrations/agreement-template.tsx:156-199`, `components/integrations/integration-manager.tsx:204-212, 802`, `app/integrations/page.tsx:66-72`
- `features/integrations/capability-readiness.ts:98-99`, `features/journey/steps.ts:533`, `lib/ai/friendly-error.ts:283-287`
- Cue's system instructions and `docs/cue-scenarios.md` wherever Cue explains contracts
- `tests/contract-path-honesty.test.ts` — rewrite to the new truth: native signing is claimed **only** when a template exists

Docs: ADR 0006, update `docs/booking-gate.md` (still says DocuSign is the only
evidence), `docs/pdf-generation.md`, `docs/data-model.md`, `docs/proposals.md`,
`docs/communications.md`, `docs/security.md` (signer evidence), and a new
`docs/contracts.md`.

**Tests** (each added to the explicit `test` list in `package.json`):

| File | Pins |
|---|---|
| `tests/contract-merge-fields.test.ts` | every catalogue field resolves from a real-shaped proposal; money formatting; unresolved detection; overrides recorded |
| `tests/contract-template-format.test.ts` | parser round-trips; `{{x}}` inside bold/lists; hostile input (HTML, 20k chars) stays text |
| `tests/contract-document-hash.test.ts` | stable across key order and Unicode forms; changes on any body/value change; functions copy agrees |
| `tests/contract-signing-policy.test.ts` | every refusal code, especially `SIGNER_IS_STUDIO_MEMBER` and `HASH_MISMATCH` |
| `tests/native-contract-flow.test.ts` | prepare → send → view → sign → completed → `RETAINER_PENDING`; the orchestration's `contractId` matches so the retainer trigger fires; replaying `sign_contract` returns the first result |
| `tests/booking-gate.test.ts` (extend) | `client_signed` satisfies the gate as signer evidence and is **never** reported as studio-attested or as a vendor's |
| `tests/firestore-rules.test.ts` (extend) | no client read/write on `contractSignatures`, `agreementTemplates*`; no update/delete ever |
| `tests/email-triggers.test.ts` (extend) | `contract_reminder` held while `clientAutomationsPaused`; `contract_ready` not held |
| **Fixture check** | the fixtures use Gabe's real imported agreement shape (`[CLIENT NAME]`, `<<Event Date>>`), not a clean `{{x}}` sample — fixtures-must-match-real-names memory |
| e2e | desktop + Pixel 7: couple signs on mobile |

## Phase 8 — Ship and walk it on prod (1 day)

Order matters (CLAUDE.md "Working on main"):

1. `npm run typecheck && npm test && npm run lint && npm run build`, `cd functions && npm run build`, rules tests via the emulator.
2. Deploy `cloud-run/pdf` (new endpoints) first.
3. Deploy **all** functions — this change touches email templates, so
   `operationsTaskWorker` must move. Add every new HTTP function to
   `scripts/configure-production-function-invokers.sh` and the relay
   allowlist, then run the invoker script and
   `./scripts/verify-deployed-function-freshness.sh studiohub-prod us-east4`.
   Read the deployed bundle for `contract_ready` to confirm the render worker
   has it.
4. `firebase deploy --only firestore:rules,firestore:indexes`.
5. Create the App Hosting rollout explicitly and match its commit.
6. **Walk it on prod with a real inbox and a real phone** (walk-it-on-prod
   memory): template from an imported agreement → proposal → accept → sign &
   send → open `contract_ready` on a phone → sign → confirm `RETAINER_PENDING`,
   the retainer invoice, the sealed PDF, the certificate page, and the
   `contract_signed` email with a working link.

**Rollout.** A per-tenant flag `contractSigning: "studiocue"`, on for our test
tenant, then Gabe, then default for new studios. The manual "record a signed
agreement" path stays available for contracts signed elsewhere.

---

## Deliberately not in v1

- **More than one client signer** (both partners). The proposal has one
  `clientSnapshot`; add a second signer in v2 with `secondary_client`, which
  the signer schema already has.
- **Drawn signatures.** Typed name + consent carries the same legal weight;
  a canvas pad is polish.
- **A PAdES digital seal** on the PDF (pyHanko with a platform certificate).
  The Firestore signature record + hash is the v1 integrity; a cryptographic
  seal makes the PDF self-verifying later.
- **A public "verify this contract" page** by hash.
- **Amendments to a signed contract.** Today: void is impossible once signed;
  a change is a new contract.
- **Removing the Dropbox Sign / DocuSign adapters.** They stay dormant.

## Open decisions (need an answer before Phase 3)

| # | Question | Recommendation |
|---|---|---|
| D1 | When does the studio countersign? | **At send** (owner types their name on "Sign & send"). One step for the couple; the contract completes when they sign. |
| D2 | Who signs on the client side in v1? | **The primary contact only.** Second partner in v2. |
| D3 | Auto-send on proposal acceptance? | **Available, off by default.** The studio reviews the first few before trusting it. |
| D4 | Typed or drawn signature? | **Typed** in v1. |
| D5 | Consent and certificate wording | **Counsel review** before the flag goes on for Gabe. Engineering can proceed on draft text. |
| D6 | Purge of a job with a client-signed contract | **Allowed with a second confirmation** (6.5), not blocked. |

---

## As built (2026-09-25)

All phases shipped. Decisions D1–D6 were taken as recommended: the studio signs
at send; one client signer; auto-send available and off by default; typed
signatures; a purge proceeds. Where the build differs from the plan above:

- **No draft PDF (3.2).** The studio reviews the contract on screen, rendered
  from the same blocks as the sealed copy. The PDF service renders one thing:
  the signed contract with its certificate (`/v1/contracts/pdf`).
- **Drafts live in `contractDrafts/{projectId}`**, not as `contracts` records
  with status `draft`. Every existing reader of `contracts` treats a record as
  sent; keeping drafts out means none of them had to change.
- **`completeContract` is not shared across packages (4.4).** The portal route
  (Next) and the vendor webhooks (functions) are separate packages; the native
  completion writes the same fields the webhook does, and `bookingContractCompleted`
  runs downstream unchanged. The vendor paths were not touched.
- **6.2 needed no code.** A proposal cannot be reissued once accepted, and a
  contract only exists after acceptance, so a correction can never move a sent
  contract's figures. `sendContract` still re-resolves and refuses on any change.
- **Purge (6.5):** typing the job's name is already the confirmation; the
  preview now names signature records and states that the couple keeps the copy
  they were emailed.
- **Rollout** is `tenantFeatures/{tenantId}.nativeContractSigning`, written only
  by the platform, until counsel signs off the consent wording.
- **Added, not planned:** a hand-recorded signature supersedes a StudioCue
  contract still out for signature; contract emails are re-checked at send
  time; saving an agreement that still contains the starter's "[Replace with …]"
  text is refused; an imported agreement's first line becomes its title.

Found by walking it on the emulator, and fixed: "getting ready location" was
mapped to the venue; the imported title printed twice; a single contact's
short name ("Priya & Jordan") beat the accepted proposal's full names; the
signing panel was pinned over the text it asked people to read.
