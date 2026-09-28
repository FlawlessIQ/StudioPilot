# Document access plan — 2026-09-28

**Problem.** A studio can't reliably open the files StudioCue already holds.
Signed contracts, proposal PDFs, questionnaire answers, COIs, run-of-show PDFs
and crew documents are all stored, but most have no link anywhere in the
studio UI. Where a link does exist, it usually goes to a list page filtered by
project, so the user still has to find the right row, and the row may not be
clickable at all. The /studio/questionnaires list is the clearest example:
every row is a bare `<article>`.

**Goal.** Any document StudioCue holds opens in **one click** from every place
it's mentioned: the completed step on the job, the job history, and the list
pages. Preview happens in place and the user never leaves the job.

## What exists today (audit)

### Stored files and where their pointer lives

| Document | Pointer | Opened anywhere in studio UI? |
|---|---|---|
| Native e-sign signed contract | `contracts.signedDocumentId` → `documents/signed_contract_{id}` | Only "Signed copy" in `native-contract-step.tsx:189`. It rebuilds the path itself instead of reading the record. |
| Contract certificate | `contracts.certificateDocumentId` | No |
| Manually recorded or imported signed contract | `contracts.signedDocumentId` holds a **raw storage path**, and there is no `documents` record | No |
| Proposal PDF | `proposals.pdfDocumentId` → `documents/generated_{job}` | Yes, "Open PDF" on the proposal workspace |
| Run of show PDF | `schedules.pdfDocumentId` | No |
| Closeout summary PDF | `projectCloseouts.summaryDocumentId` | No |
| COI (arrives by email) | `insuranceRequests.temporaryObject` (a `gs://` URL); `documents/coi_{id}` once approved | No |
| Questionnaire file answers | `answers[field].storagePath` | No. The wedding brief shows the filename only. |
| Client message attachments | `messages.attachmentReferences[].storagePath` | No. The studio inbox doesn't render them at all. |
| Crew assignment files | `crewAssignments.requirements[].documentId` (a path) | No. The requirement row has Approve but no link to the file. |
| Crew W-9 and insurance | `crewProfiles.w9DocumentPath` / `insuranceDocumentPath` | No |
| Studio import source files | `studioImportItems.storageObjectKey` | No |
| Invoices | `invoiceReferences.hostedUrl` (external) | No |
| Delivery gallery | `deliveryRecords.galleryUrl` (external) | Shown as text on /studio/delivery, not as a link |

### The viewers we have

- **`components/documents/live-document-viewer.tsx`** is a full-page viewer at
  `/studio/documents/[id]`. It resolves `downloadUrl`, `storagePath` or
  `providerFileId` using `getDownloadURL` and shows PDFs in an iframe. The
  resolving logic is good. The problem is that it only accepts a `documents`
  id.
- **`lib/contracts/command-client.ts:102` `signedCopyUrl(path)`** turns a path
  into a URL and handles the emulator.
- There is no shared file chip, preview sheet or lightbox.
  `components/ui/sheet-dialog` exists and is the obvious container for one.
- `storage.rules` already lets studio owners, admins and coordinators read
  every project file once `scanStatus == "clean"`, including questionnaire and
  message uploads. **None of this work needs a rules change.**

### The job page

- **Journey rail** (`ThreadMinimap`, `project-thread.tsx:872`): a completed
  step shows a check and a title linked to `step.record.href`. Those hrefs
  (`features/journey/steps.ts:1007`) are almost all list pages with
  `?project=`, because `use-project-journey.ts` passes only status strings
  into the engine. **No record ids reach the rail.**
- **Job history** (`ThreadHistory`, fed by `use-project-thread.ts`): it has
  the full records, but only proposals link to a specific record. The "sent",
  "signed" and "paid" entries are `system` entries with `artifact: null`, so
  they have no link. The invoice link goes to `/studio/invoices` without even
  a project filter.
- **Bug found along the way:** `live-project-detail.tsx:842` reads collection
  `deliveries`, but every writer uses `deliveryRecords`.

## Design

### One primitive, used everywhere

Build this once. Every surface then just says "this record has these files".

1. **`features/documents/file-ref.ts`** (pure, and unit-tested):
   ```ts
   type FileRef =
     | { kind: "document"; id: string; label: string }      // documents/{id}
     | { kind: "storage"; path: string; label: string; contentType?: string }
     | { kind: "external"; url: string; label: string };   // Stripe invoice, gallery
   ```
   It also includes `fileRefsFor(record, type)`, one function per record type.
   This is where the inconsistencies get absorbed:
   - `signedDocumentId` starts with `tenants/` → `storage`; otherwise → `document`.
   - A `gs://` value → `storage`, since `ref()` accepts `gs://` URLs.
   - Questionnaire `file` answers → `storage`.
   - `hostedUrl` and `galleryUrl` → `external`.
2. **`lib/documents/resolve-file.ts`**: the URL resolution lifted out of
   `LiveDocumentViewer` and merged with `signedCopyUrl`. It returns
   `{url} | {pending: "scanning"} | {error}`.
   - A permission-denied on a file that has only just been uploaded means
     "still being checked", not "broken".
   - Don't trust the `scanStatus` copied into questionnaire answers. It is
     never updated after the scan.
3. **`components/documents/file-link.tsx`**: a chip that shows a type icon,
   the name and "View". Clicking it opens **`DocumentPreviewSheet`**, which
   is a `SheetDialog` containing:
   - PDF → iframe
   - image → `<img>`
   - anything else → name, size, "Open" and "Download"
   - always an "Open in new tab" link.
   - `external` refs skip the sheet and open in a new tab.
4. `/studio/documents/[id]` is rebuilt on the same pieces, so there's one
   viewer and not two.

**Mobile:** iOS Safari shows only the first page of a PDF inside an iframe. On
narrow screens the chip should open the file in a new tab, which uses the
phone's own PDF viewer, instead of the sheet. This follows the
compact-on-mobile rule.

### Surfaces

**A. Completed steps on the job (journey rail)**
- Add `files: FileRef[]` and a record-specific `record.href` to `JourneyStep`.
  The engine stays pure because the hook passes the ids and refs in as plain
  data.
- A completed step renders its chips directly under the title. For example,
  Contract ✓ shows `Signed contract.pdf` and `Certificate.pdf`.

| Step | Chips | Title links to |
|---|---|---|
| Proposal | Proposal PDF (accepted version) | `/studio/proposals/{id}` |
| Contract | Signed PDF, certificate | booking section of the job |
| Retainer / final balance | Invoice (hosted, external) | invoices, with `?project=` |
| Schedule form | Response | `/studio/questionnaires/{id}` (new) |
| Run of show | Schedule PDF | `/studio/schedules/{id}`, which exists but is unused |
| COI | COI PDF | insurance, with `?project=` |
| Delivery | Gallery (external) | delivery, with `?project=` |

**B. Job history**
- Add `files: FileRef[]` to `ThreadEntry` (`features/journey/thread.ts:45`).
- Give the "sent", "signed" and "paid" system entries their record's files, so
  that "Contract signed" carries the signed PDF.
- Replace the list-page hrefs with the specific record wherever a detail route
  exists. Add the missing `?project=` to the invoice link.

**C. Questionnaire response view (new: `/studio/questionnaires/[id]`)**
- Read-only. It renders `templateSnapshot.sections` + `answers`, with file
  answers shown as chips. It also includes the AI review insights, the change
  history and submitted/due dates.
- Build a small **read-only renderer**. Don't reuse `ClientQuestionnaireForm`,
  because it carries client-only upload and autosave code and hides
  `internalOnly` fields that the studio should see.
- Add `href` to the `questionnaires` config in `live-domain-view.tsx:203`.
  That makes the rows in the screenshot clickable.
- The wedding brief's file answers become chips.

**D. Peripheral list pages**
- Add an optional **`files?: (record) => FileRef[]`** to the
  `live-domain-view` config and render the chips in the row's actions cell.
  Then turn it on for:
  - contracts (signed PDF, certificate)
  - insurance (COI PDF)
  - invoices (hosted invoice)
  - schedules (PDF, plus `href` → `/studio/schedules/{id}`)
  - delivery (gallery link)
- Also add chips to:
  - crew requirement rows (`live-record-detail.tsx:382`), next to Approve;
    also crew W-9 and insurance
  - the studio message inbox, for attachments
  - AI import review, for the source file
- Contracts have no detail route. A contract row should open the job's
  booking section, and the chip opens the PDF.

**E. Client portal** (optional, same primitive)
- `/client/documents` only links records that already carry a URL. Resolving
  paths through the same resolver fixes this, and the rules already allow
  `client` and `shared` visibility.
- The client's own questionnaire file answers become links.
- Hand-recorded signed copies are never shown to the client today. That is a
  **product decision**: should a paper-signed contract appear in the portal?

### Data clean-up (server)
- When a signed copy is attached by hand or by import, **write a `documents`
  record**, the same way sealed contracts get one. This touches
  `booking/commands.ts:1134` and `imports/commands.ts:395`. It makes
  `signedDocumentId` always a document id going forward.
- The resolver still handles legacy raw paths, so a backfill is optional. If
  we do one, it's a one-off emulator-tested script.
- Fix the `deliveries` → `deliveryRecords` read in `live-project-detail.tsx:842`.

### Guard test
- The UI-audit precedent: a test that fails when a `live-domain-view` config
  reads a collection known to carry files (from a list kept in
  `file-ref.ts`) but has neither `href` nor `files`.
- A second test: `fileRefsFor` returns a ref for every document field listed
  in the audit table. Without it, a new document type ships unlinked again.

## Security note

`getDownloadURL` returns a token URL that works for **anyone who has it** until
the token is revoked. That is how the signed-copy button and the documents
viewer already behave, and it's acceptable for studio staff viewing their own
files. The stricter option is a Functions endpoint that mints 5–15 minute V4
signed URLs after the usual membership and assignment checks. Recommendation:
**ship on `getDownloadURL` now**, keeping the resolver as the single place to
swap it out, and revisit before client-facing sharing grows.

## Ship order

| # | Slice | Size | Unblocks |
|---|---|---|---|
| 1 | `FileRef` + resolver + `FileLink` + preview sheet; rebuild `/studio/documents/[id]` on them | M | everything |
| 2 | Questionnaire response page + clickable rows | M | the screenshot |
| 3 | Journey rail chips + record-specific hrefs | M | "completed steps" |
| 4 | Job history files on entries + specific hrefs | S | "history section" |
| 5 | `files` on live-domain-view configs + guard test | S | peripheral pages |
| 6 | Crew, messages, import source chips | S | the rest of the sweep |
| 7 | `documents` record on hand/import attach (+ optional backfill); `deliveryRecords` fix | S | consistency |
| 8 | Client portal (optional) | S | the couple's side |

Slices 1–5 are all app-side, with no Functions deploy. Slice 7 touches
`functions/`, so the deploy order and freshness check in CLAUDE.md apply.

**Walk on prod before calling it done.** Open a sealed contract, a
hand-attached contract, a questionnaire with a file answer, and a COI from the
job rail, the history and the list page, on desktop and on a phone.

## Open decisions

1. **Where does preview open?** Recommended: a side sheet on desktop and a new
   tab on mobile. The alternative is always a new tab, which is simpler but
   takes the user off the job.
2. **Is the client portal (slice 8) in scope now?**
3. **Should hand-recorded signed contracts show to the couple?**
4. **Download URLs:** accept `getDownloadURL` now (recommended), or build
   short-lived signed URLs first?
