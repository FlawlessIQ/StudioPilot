# One-send booking agreement + add-ons — plan, 2026-09-28

Two requests from Conor, planned together because they touch the same money
and the same document.

1. **One send, two signatures.** Today a studio sends the proposal, the couple
   accepts it, the studio then sends a contract, and the couple signs it. The
   new flow is one send. Section 1 is the studio's **own contract wording**
   (uploaded, parsed and turned into a template), followed by a signature.
   Section 2 is the **chosen packages and add-ons**, followed by a second
   signature. The couple gets everything in one go, and every term is visible
   before they sign anything.
2. **Add-ons.** A studio can attach extras to a job, either from a reusable
   **add-on library** or as a **custom one-off** for that job only, such as
   "special family shots".

---

## What exists today (audit)

### Contracts and native e-sign (shipped ac38b65)

- **Template:** `agreementTemplates` holds versions in
  `agreementTemplateVersions`. A version is a markdown subset with `{{field}}`
  merge fields, and it resolves to a `ContractDocument` of heading, paragraph,
  list and payment_schedule blocks (`features/contracts/document.ts`).
  **There is no signature block and no sections.**
- **Upload and parse half-exists:**
  - Studio Import classifies a contract (`studio-import/extraction.ts:79`).
  - `convertImportedAgreement` (`document.ts:811`) maps placeholders to merge
    fields, drops paper signature lines, detects headings, and prepends a
    details section.
  - The editor then loads the result as a draft.
  - The gaps: **there is no "upload your contract" button on the agreement
    editor itself**; the only way in is the Studio Import tour. The setup copy
    still says "StudioCue doesn't write your contract"
    (`setup-conversation.tsx:87`).
- **Signing:**
  - One contract has one document hash, one studio signature (made at send)
    and one client signature. The ids are `${contractId}_studio` and
    `${contractId}_client`.
  - The sealed PDF draws one row of signatures at the end
    (`cloud-run/pdf/contract.py:237`).
  - The client signs with a typed name and consent wording V2.
- **Sequencing:**
  - The contract is only prepared **after** the proposal is accepted
    (`bookingProposalAccepted` → `prepareOnAcceptance`).
  - Signing is only allowed in `CONTRACT_PENDING`
    (`features/contracts/signing-policy.ts:45`).
  - `/client/proposal` and `/client/contract` are separate pages, and the
    proposal page says that accepting "does not sign a contract".
- **Gating:** native signing is per studio
  (`tenantFeatures.nativeContractSigning`) and is not generally available.
  **Counsel review of the consent and certificate wording is still owed**
  (esign plan D5).

### Proposals and packages

- **Proposal pricing:** `pricingSnapshot.lineItems[]` is a list of
  `{description, quantity, unitPriceCents, totalCents}` with no type, no id
  and no optional flag. It supports one primary package plus up to 3
  additional ones.
- **Add-ons are half-built:**
  - Already done:
    - `packageAddOnSchema` (`features/packages/schema.ts:11`)
    - the `selectedAddOns` selection
    - snapshot copying
    - the pricing math
    - a client checkbox screen before a package is locked
      (`live-client-views.tsx:1800-1970`).
  - Missing:
    - The **studio has no way to create an add-on**, because
      `create-package-form.tsx:155` hard-codes `addOns: []` and
      `updatePackage` can't change `addOns`.
    - There is no library.
    - There are no custom lines.
    - The composer sends `selectedAddOns: []`
      (`studio-proposal-workspace.tsx:991`).
- **"Add another package alongside" can't be reached:** `selectPackage`
  throws `PACKAGE_ALREADY_SELECTED` once a primary exists
  (`crm/commands.ts:1317`).

### Money bugs found (fix these first, because add-ons flow through them)

| # | Bug | Where |
|---|---|---|
| M1 | **The discount is taken off twice.** The snapshot's `subtotalCents` is already net of the discount, and `combinePricing` subtracts `discountCents` again. **Any live proposal with a discount shows a total that is too low.** | `create-snapshot.ts:84` + `proposals.ts:483` + `combined-pricing.ts:85` |
| M2 | **The final invoice uses the primary package snapshot's total**, so it leaves out extra packages and any proposal-level lines. | `invoice-scheduler.ts:34-68` |
| M3 | **An overridden retainer always flags `RETAINER_EVIDENCE_MISMATCH`**, because the check compares against the snapshot's retainer, not the agreed one. | `invoice-scheduler.ts:77` |
| M4 | **The payment schedule at create time uses the primary total only.** Update rebuilds it from the combined pricing. | `proposals.ts:485` vs `:719` |
| M5 | **Tax ignores each add-on's `taxable` flag.** | `create-snapshot.ts:85`, `crm/commands.ts:1360` |
| M6 | **The same pricing logic is written three times**, and the copies drift. | `create-snapshot.ts`, `crm/commands.ts:1328`, `app/api/client/portal/route.ts:837` |
| M7 | **The PDF renderer's limits are tighter than the schema**, and it takes the retainer and balance from the snapshot, not the schedule. | `cloud-run/pdf/main.py:64`, `ai-pdf.ts:795` |

**M1 is live.** It should be checked against production (are there any
proposals with `discountCents > 0`?) and fixed regardless of the rest of this
plan.

---

## Design

### Part A — Add-ons

**Where they live.** Add-ons go on the **proposal**, not inside the package
snapshot. Package snapshots stay immutable and reusable. The proposal version
is already the immutable record of the deal, and a reissue creates a new
version, so a studio can change add-ons up to the point the couple signs.

1. **Add-on library.** A new collection `addOns/{id}`, scoped by tenant:
   `name`, `description`, `unitPriceCents`, `taxable`,
   `allowQuantity`, `category`, `active`, `archivedAt`. It is managed in
   Library → Add-ons.
2. **Suggested per package.** The package editor gets an "Add-ons" picker
   that stores library ids (plus an optional price override). This replaces
   the hard-coded `addOns: []` and lets `updatePackage` change them.
3. **Composer.** A new "Add-ons" block on the proposal:
   - the package's suggested add-ons appear first, then the rest of the
     library;
   - **"+ Custom add-on"** takes a name, description, price, quantity and
     taxable flag;
   - a **"Save to library"** checkbox turns a one-off into a reusable
     add-on.
4. **Typed lines.** `pricingSnapshot.lineItems[]` gains
   `kind: "package" | "add_on" | "discount"`, a `source`
   (`library | custom | package`) and a `sourceId`. The old untyped lines
   still read as `package`.
5. **One pricing function** in `features/pricing/`, used by the snapshot, the
   selection command, the portal and the proposal. This fixes M1, M4, M5
   and M6 in one place, backed by unit tests.
6. **Downstream:**
   - the final invoice reads the accepted proposal's total (fixes M2 and M3);
   - the retainer percentage applies to the total **including** add-ons,
     while a fixed retainer stays fixed;
   - the PDF shows add-ons as their own group;
   - contract merge fields gain `price.lineItems` and `price.addOns`.
7. **Later, not v1:**
   - An add-on that **adds crew** (for example, a second shooter), using the
     same `{role, count}` coverage. Backlog 2026-09-25 already rejected
     add-ons as a workaround for coverage for exactly this reason.
   - An add-on that drops a line into the shot list or run of show.

### Part B — One-send booking agreement

**Shape:** one **agreement** made of sections. Each section carries its own
content hash and its own client signature. An envelope hash binds the
sections together, so neither section can be swapped out afterwards.

```
Booking agreement (one send, one portal page, one sealed PDF)
├─ Section 1 — Terms & conditions   ← studio's own wording (template version)
│    signature: client  (+ studio countersign at send)
├─ Section 2 — Your coverage         ← packages, add-ons, total, payment schedule
│    signature: client  (+ studio countersign at send)
└─ Certificate                       ← signers, IP/UA, consent version, hashes
```

1. **Uploading the contract (B1):**
   - "Upload your contract" (PDF or DOCX) goes **directly on the agreement
     editor**. It reuses the Studio Import extraction and
     `convertImportedAgreement` and opens the result in the editor for
     review. **AI prepares, the human approves.**
   - It detects the studio's own **pricing or package clauses** and flags
     them, because Section 2 now covers pricing and two prices must never
     disagree.
   - The setup copy that says "StudioCue doesn't write your contract" gets
     fixed.
2. **Sectioned documents (B2):**
   - `ContractDocument` gains `sections[]`, plus two new block types:
     `line_items` and `signature`.
   - Signatures become `${contractId}_${role}_${sectionKey}`, and each one
     records `sectionHash` and `envelopeHash`.
   - A single-section document stays exactly as it is today, so current
     contracts are untouched.
   - The renderer (`contract.py`) draws a signature row after each section.
3. **Send (B3):**
   - "Send proposal" in combined mode resolves Section 1 from the template,
     with the job and the proposal's pricing as the merge sources. It builds
     Section 2 from the proposal and shows the studio a preview of the whole
     thing.
   - The studio countersigns both sections at send, as today (esign D1).
   - The hash check is the same as now: if anything changes between the
     preview and the send, the send is refused.
4. **Client signing (B4):**
   - One portal page: **Review & sign**. The couple reads Section 1 and
     signs, then reads Section 2 and signs. It is the same typed-name +
     consent capture as today.
   - One server command writes both signatures and then makes **two
     evidence-controlled transitions in one transaction**:
     `PROPOSAL → CONTRACT_PENDING` (proposal accepted) and
     `CONTRACT_PENDING → RETAINER_PENDING` (contract signed).
   - The state machine and the booking gate don't change; the couple just
     gets there in one action.
   - Both signatures or neither: signing Section 1 alone saves nothing.
   - A **"Request changes"** button is needed here; the esign plan deferred
     it. With a single send it matters more, because it is the couple's only
     way to push back.
5. **Seal (B5):** one sealed PDF containing both sections and the
   certificate. The existing `contract_signed` email goes out, and the
   retainer invoice flows exactly as today.
6. **Opt-in per studio (B6):**
   - A setting, "Send the contract with the proposal", **off by default**.
   - Studios on DocuSign or other signing providers, or that sign outside
     StudioCue (Gabe, for now), keep today's two-step flow unchanged.
   - It needs `nativeContractSigning` to be on.

**Legal gate:** two signatures in one ceremony, with the terms signed before
the pricing, is a change **counsel should see** alongside the D5 review that
is already owed. Build behind the flag and turn it on for FlawlessIQ first.

---

## Ship order

| # | Slice | Size | Notes |
|---|---|---|---|
| 0 | **M1 discount fix** + a prod check for affected proposals | S | Independent. Do it now. |
| 1 | One pricing function; fix M2–M7; typed line items | M | Needed before anything adds lines |
| 2 | Add-on library + package suggested add-ons | M | Library → Add-ons; `updatePackage` takes add-ons |
| 3 | Composer add-ons (library + custom + save-to-library), PDF, portal | M | Useful on its own, before Part B |
| 4 | Upload contract on the agreement editor + pricing-clause flag | S–M | Reuses import extraction |
| 5 | Sectioned document + per-section signatures + renderer | L | Old single-section contracts unchanged |
| 6 | Combined send + Review & sign portal page + dual transition | L | Behind the studio setting |
| 7 | Combined seal, emails, Request changes | M | |
| 8 | Walk on prod (FlawlessIQ), counsel review, then offer to studios | — | Needs Conor + counsel |

Slices 0–3 deliver add-ons with no legal exposure. Slices 4–7 are the
agreement work. Everything from slice 1 on touches `functions/`, so the deploy
order, the render-worker check and the freshness check in CLAUDE.md all apply.

---

## Open decisions

1. **Who chooses the packages and add-ons?**
   - **(a) The studio picks them before sending (recommended).** The couple
     signs exactly what was sent, and the studio countersigns at send, as
     today.
   - (b) The couple picks in the portal, then signs. This is more flexible,
     but the document changes after the studio has seen it, so the studio
     would have to countersign after the couple signs.
2. **Retainer percentage:** applied to the total including add-ons
   (recommended)?
3. **The studio's own pricing clauses in their uploaded contract:** strip
   them and let Section 2 govern (recommended), or keep them?
4. **Combined mode per studio, opt-in** (recommended), or a replacement for
   the current flow for everyone?
5. **Add-ons that add crew** (a second shooter): v2 (recommended), or v1?
6. **Counsel:** send them the two-signature ceremony with the D5 wording
   review?
