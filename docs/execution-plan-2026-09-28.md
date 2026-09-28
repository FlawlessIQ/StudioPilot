# Execution plan — 2026-09-28

This turns the 2026-09-28 build queue (backlog H1–H5, roadmap "Build queue")
into one ordered plan. The detail for each item lives in its own plan. This
document gives the order, the dependencies, the deploys, the checks, and the
questions still open.

| Item | Plan |
|---|---|
| H1 Documents open in one click | [`document-access-plan-2026-09-28.md`](./document-access-plan-2026-09-28.md) |
| H2 One-send agreement + add-ons | [`proposal-agreement-and-addons-plan-2026-09-28.md`](./proposal-agreement-and-addons-plan-2026-09-28.md) |
| H3 COI automation | [`coi-automation-plan-2026-09-28.md`](./coi-automation-plan-2026-09-28.md) |
| H4 Post-wedding delivery (photo + video) | [`delivery-plan-2026-09-28.md`](./delivery-plan-2026-09-28.md) |
| H5 Inquiry form performance | [`inquiry-form-performance-investigation-2026-09-28.md`](./inquiry-form-performance-investigation-2026-09-28.md) |

**How it's ordered:**

1. First, anything that is **wrong today in front of a couple, or with
   money**.
2. Then the **front door** (the inquiry form), because every other feature
   depends on inquiries arriving.
3. Then the pieces that **other items build on**: the H1 file preview is used
   by H3 and H4.
4. Then **Gabe's real workflow** (video delivery).
5. The **largest item, which also has a legal gate** (H2's one-send
   agreement), comes last.

---

## Phase 0 — Fix what is wrong today (one sitting each) — **DONE 2026-09-28**

**Shipped in `1246502`.**
- **Functions:** all 90 deployed, invoker grants re-applied, and the
  freshness check reports 89 current and 0 behind. The deployed bundles of
  `postEventCommand`, `sendgridInboundCoi` and `proposalCommand` were read
  and contain the fixes.
- **App:** `build-2026-09-28-031` SUCCEEDED on the same commit.
- **0.1:** production has 0 discounted proposals or snapshots, so nothing
  was affected.
- **0.5:** walked on production; City stays empty while a venue is typed.
- **Also:** delivery notes are now internal only. The portal API returned
  them without ever showing them.
- **0.2 and 0.3 walked on production (FlawlessIQ, "Delivery Walk Test",
  since archived).** A real double-click on Release produced exactly **1
  delivery, 1 delivery email (1 in the inbox), 2 review requests and 0 AI
  drafts**. The button showed "Releasing…" and locked.
- **Found by that walk and fixed in the follow-up commit:**
  - **A quiet imported job could not be marked shot.** The quiet card hid
    "Yes, we shot it", so Gabe's imported weddings could never reach
    editing or delivery unless he brought the couple in first. Now shown,
    because it contacts no one.
  - **The checklist matched a `"SHOT"` state that doesn't exist**, so a shot
    wedding was told "Opens after the event". It now matches
    `EVENT_COMPLETE`.
  - **The delivery step promised "the email drafts itself"**, which stopped
    being true with 0.3. For a shot job it now reads "Confirm editing has
    started, then record the gallery".
- **Walk friction, not fixed yet:**
  - Import refuses past-dated weddings, so a studio can't import one it has
    already shot and still has to deliver. **This belongs to H4.**
  - "Did this go ahead?" in the rail links to the event-day page, which has
    no way to answer it.
- **Not walked yet:** 0.4 (COI inbound). It needs a real email to a `coi+`
  address.

These are independent of each other and of every later phase.

| # | Fix | From | Reaches |
|---|---|---|---|
| 0.1 | **The proposal discount is taken off twice** (`combined-pricing.ts:85`). Fix it, then check prod for proposals with `discountCents > 0` and say which ones are affected. **Any correction to a sent or accepted proposal is decided with Conor, never automatically.** | H2 M1 | money, couples |
| 0.2 | **A double-click on Release creates 2 deliveries, 2 emails and 4 review requests.** Disable the button while it runs, keep the idempotency key stable, and read inside a transaction. | H4 D1 | couples |
| 0.3 | **2 delivery emails per release.** Drop the chained AI `delivery_note` draft, because the server already sends the email. | H4 D2 | couples |
| 0.4 | **A late COI PDF overwrites an approved one.** Inbound should accept a PDF only in the requesting states. Also give the correction email its `coi+` reply address. | H3 C1, C2 | data loss |
| 0.5 | **The venue box overwrites City while you type.** Fill City only from a chosen suggestion, and only if City is empty. | H5 cause 2 | couples |
| 0.6 | **One-liners:** the job page reads `deliveries` instead of `deliveryRecords` (H1/H4 D8), answer-facts look for a `"delivered"` status that doesn't exist (D7), and delivery notes must be labelled as visible to the couple (D4). | H4 | studio, couples |

**Deploy:** functions (0.1–0.4), then the app.

- 0.3 and 0.4 change email jobs, so after deploying, **check the
  `operationsTaskWorker` bundle** and run
  `verify-deployed-function-freshness.sh`.
- Create the App Hosting rollout explicitly and match it on the commit.

**Check on prod:**

- Record one delivery with a double-click: exactly 1 record and 1 email.
- Send a COI PDF to an approved request: rejected, and logged.

---

## Phase 1 — The inquiry form is fast (H5)

**Step 1 is to profile. No fixes before the numbers exist.**

| # | Step |
|---|---|
| 1.1 | Get Gabe's link, phone, browser and in-app context. Then profile `/inquiry` on production with 4× CPU and Fast 3G throttling: time until interactive, INP per field, and typing straight after the page appears. Also get places-route latency from the logs. |
| 1.2 | **Keep what was typed before hydration.** Add a Playwright test that types before hydration and checks the value survives. |
| 1.3 | **Venue field:** keep its typing state local and stop validating on every keystroke. (0.5 has already fixed the City overwrite.) |
| 1.4 | **Places route:** cache slug → tenant, run the two lookups in parallel, use a cheaper rate-limit counter, and log latency. |
| 1.5 | **Light public shell** for `/inquiry` and `/i/[token]`: their own layout and a small stylesheet. No app-wide CSS, no service worker, no observers. |
| 1.6 | **Firebase and App Check are dynamic-imported.** App Check is pre-warmed when the first field gets focus. |
| 1.7 | **Wrap `studioForSlug` in `cache()`** and run its queries in parallel. |
| 1.8 | **Budget guard:** a test that fails if `/inquiry` JavaScript goes over 250 KB or CSS over 50 KB. |

- **Coordination:** `/i/[token]` and `couple-inquiry-page.tsx` are another
  session's work in progress. Message that session (`ListAgents`) before
  touching them.
- **Deploy:** app only.
- **Check:** re-run the 1.1 profile. Targets:
  - interactive in < 2 s on a mid-range phone;
  - INP < 100 ms per keystroke;
  - suggestions within ~400 ms of a pause.
- Then ask Gabe to try it again.

---

## Phase 2 — Documents open in one click (H1, first half)

| # | Step |
|---|---|
| 2.1 | **The primitive:** `FileRef` + `resolveFile` + a `FileLink` chip + `DocumentPreviewSheet` (a sheet on desktop, a new tab on mobile). Rebuild `/studio/documents/[id]` on it. |
| 2.2 | **A questionnaire response page** `/studio/questionnaires/[id]`, read-only, with file answers as chips. The list rows become clickable. |
| 2.3 | **Journey rail:** completed steps show their document chips and link to the specific record. |
| 2.4 | **Job history:** "signed", "sent" and "paid" entries carry their files, and hrefs point to specific records. |
| 2.5 | **List pages:** a `files` config on `live-domain-view` for contracts, insurance, invoices, schedules and delivery, plus the guard test. |

- **Deploy:** app only. No rules change is needed.
- **Check on prod** from the job rail, the history and the list page, on
  desktop and a phone:
  - a sealed contract
  - a hand-attached contract
  - a questionnaire with a file answer
  - a COI.

---

## Phase 3 — Photo and video delivery (H4)

| # | Step |
|---|---|
| 3.1 | **Deliverables model:** add `mediaType`, `kind`, `label` and `final` to `deliveryRecords`. Detect the provider from the URL, including video hosts. |
| 3.2 | **Repeatable release:** one click can release photos and a film together. The job becomes `DELIVERED` when every final deliverable has been sent. Review requests and the album workflow run **once per job**. |
| 3.3 | **Copy by media type:** a preview of the release email, "Your photos" / "Your films" sections in the portal, and review wording that isn't photo-only. |
| 3.4 | **Package deliverables:** a structured list with turnaround times, giving each job its expected deliverables and due dates. This replaces the hard-coded 42 days. |
| 3.5 | **Gallery inbox v2:** recognise video hosts, unwrap tracking links, classify the kind, tick only the matching track, and support discard/supersede. |
| 3.6 | **`/d/{token}` redirect** so "viewed" is real; **backup-only gate** on the checklist. |
| 3.7 | *(optional)* A gallery expiry reminder to the couple. |

- **Deploy:** all functions, then the app. Delivery copy has gone out stale
  twice before (the `operationsTaskWorker` render worker missed a deploy both
  times), so **read the deployed bundle** for the new template strings.
- **Check on prod:** one job, photos by the inbox, then a highlight film by
  paste, then a full film, ideally with Gabe's real Vimeo link. Check that
  the portal shows all three, that there are 3 emails with the right wording,
  and that reviews go out only after the last final deliverable.

---

## Phase 4 — COI automation (H3)

**Depends on:**

- Phase 0.4 (the inbound fix);
- Phase 1 (the COI question goes into the rebuilt light form);
- Phase 2 (the "COI ready" card uses the file preview).

| # | Step |
|---|---|
| 4.1 | **Insurance settings:** `coiSettings`, with an agent or a self-serve insurer, the lead time, the chase settings and the dial. Add it to Settings → Insurance and add a sixth setup question. |
| 4.2 | **Inquiry capture:** a Yes / No / Not sure COI question and the venue coordinator's contact, in both schemas, emailed forms and enrichment. Keep the venue place, and map both at conversion. |
| 4.3 | **Venue memory:** requirements keyed by place. |
| 4.4 | **`coiAutoRequest`:** runs once the job is booked, subject to the timing rule. It rechecks the job at send time, uses an idempotency key, and shows a "missing details" card when something is missing. |
| 4.5 | **Chasing v2:** every 3 days, including corrections, with follow-up wording and an escalation card. |
| 4.6 | **The "COI ready" card in Today:** checks + preview + **Approve & send to venue**. Also C3/C4 (the journey and readiness agree) and C5 (venue acknowledgement). |
| 4.7 | *(optional)* "Not sure" → a prepared email asking the venue. |

- **Deploy:** all functions + app, with the render-worker check (new email
  wording).
- **Check on prod:** Conor's own address acts as the agent and a test address
  as the venue. Run the whole loop with no manual steps except the one
  approval.

---

## Phase 5 — Pricing core and add-ons (H2, part A)

| # | Step |
|---|---|
| 5.1 | **One pricing function** in `features/pricing/`, replacing the 3 copies. Fixes M2–M7: the final invoice from the proposal total, the retainer override, the payment schedule, per-line tax, and the PDF limits. Adds typed line items. |
| 5.2 | **Add-on library** (`addOns`) and suggested add-ons per package. `updatePackage` accepts add-ons. |
| 5.3 | **Add-ons in the composer:** from the library, or a custom one-off with save-to-library. They appear in the PDF, the portal, and the contract merge fields. |

- **Deploy:** functions + app + the **cloud-run PDF renderer** (it has its
  own deploy).
- **Check on prod:** a proposal with one library add-on and one custom
  add-on, followed through to the retainer and final invoice amounts.

---

## Phase 6 — One-send booking agreement (H2, part B)

| # | Step |
|---|---|
| 6.1 | **Upload your contract** on the agreement editor, and flag its pricing clauses. |
| 6.2 | **Sectioned document:** a hash per section plus an envelope hash, per-section signatures, and renderer support. |
| 6.3 | **Combined send** and the portal's **Review & sign** page. One command makes both transitions, proposal → contract → retainer. |
| 6.4 | **Combined seal**, emails, and **Request changes**. |
| 6.5 | The studio setting, **off by default**. |

- **Gate:** counsel reviews the two-signature ceremony together with the D5
  wording. Until then it is on for FlawlessIQ only.
- **Deploy:** functions + app + the cloud-run renderer.

---

## Phase 7 — The rest of H1 (fill-in work, any time after Phase 2)

- File chips on crew requirement rows and the crew W-9, studio message
  attachments, and AI-import source files.
- A server `documents` record when a signed copy is attached by hand or by
  import, plus an optional backfill. **This needs functions.**
- The client portal documents, which depends on Q4.

---

## Dependencies at a glance

```
Phase 0 ──────────────► (everything; do first)
Phase 1 ──────────────► Phase 4.2 (COI question goes into the light form)
Phase 2.1 ────────────► Phase 4.6 (COI preview), Phase 7
Phase 3 ── independent of 4–6
Phase 5.1 ────────────► Phase 5.2–5.3 ─► Phase 6 (Section 2 renders typed lines)
Counsel ──────────────► Phase 6 beyond FlawlessIQ
```

**Rules for every phase** (CLAUDE.md):

- `git fetch` before starting.
- Stage explicit paths only, because another session shares this checkout.
- Run the full verification gate:
  `typecheck && test && lint && build`, plus `functions` build when
  `functions/` changed.
- Deploy functions before the app, followed by the invoker script and the
  freshness check.
- Create the rollout explicitly and match it on the commit.
- **Walk it on prod, or it is not done.**

---

## Questions (recommendation first)

### Order and fixes

- **Q1. Phase order.** **DECIDED 2026-09-28: the order above.** *Recommended:* the order above: fixes → form speed →
  documents → delivery → COI → add-ons → agreement.
  - Alternative: delivery first, for Gabe.
  - Alternative: the agreement first, as the selling point.
- **Q2. Phase 0 now, including the production read for discounted
  proposals?** **DECIDED: yes, now.**
- **Q3. Run the production typing test** on the FlawlessIQ form? It only
  types; nothing is submitted. **DECIDED: yes** (Conor approved
  2026-09-28).

### H1 — Documents

- **Q4. Preview:** *Recommended:* a side sheet on desktop and a new tab on
  mobile.
- **Q5. Is the client portal in scope now?** *Recommended:* no. Phase 7,
  after the studio side has been walked.
- **Q6. Should contracts signed on paper and recorded by hand show to the
  couple?** *Recommended:* yes, behind a "share with couple" toggle on each
  contract, **on by default**. It's their contract.
- **Q7. Download links:** *Recommended:* use `getDownloadURL` now, and
  revisit short-lived signed URLs before client sharing grows.

### H2 — Agreement + add-ons

- **Q8. Who picks the packages and add-ons?** **DECIDED: the studio,
  before sending.** *Recommended:* the studio,
  before sending. The couple signs exactly what was sent. If they want
  changes, they use "Request changes".
- **Q9. Does the retainer percentage include add-ons?** *Recommended:* yes.
  A fixed retainer stays fixed.
- **Q10. The pricing clauses in the studio's uploaded contract:**
  *Recommended:* flag them and let Section 2 govern.
- **Q11. Combined send for everyone, or opt-in per studio?**
  *Recommended:* opt-in per studio, off by default.
- **Q12. Add-ons that add crew** (a second shooter): *Recommended:* v2.
- **Q13. Counsel review of the two-signature ceremony:** *Recommended:* yes,
  bundled with the D5 review that is already owed.

### H3 — COI

- **Q14. When to ask the agent:** *Recommended:* once the job is booked, and
  no earlier than 60 days before the event (the studio can change this).
- **Q15. Dial default:** *Recommended:* `prepare`. StudioCue drafts the
  request, and the studio approves the first ones.
- **Q16. Chasing:** *Recommended:* every 3 days, at most 4 chases, then
  escalate to the studio.
- **Q17. Self-serve insurers** (Hiscox, NEXT) **in v1?** *Recommended:* yes.
- **Q18. One click to approve and send to the venue when every check
  passes?** *Recommended:* yes.
- **Q19. Is the COI question required on the inquiry form?** *Recommended:*
  optional, with a "Not sure" answer.

### H4 — Delivery

- **Q20. When is a job "delivered"?** **DECIDED: after the last final
  deliverable.** *Recommended:* when every final
  deliverable has been sent, with a manual override.
- **Q21. When do review requests go out?** **DECIDED: after the last final
  deliverable.** *Recommended:* after the **last**
  final deliverable.
- **Q22. Delivery email approval:** *Recommended:* the release click is the
  approval, with an inline preview and personal note.
- **Q23. Checklist gates:** *Recommended:* only "backup verified" is
  required.
- **Q24. View tracking** through a StudioCue redirect: *Recommended:* yes.
- **Q25. Editors submitting deliverables, and the gallery expiry reminder:**
  *Recommended:* editors in v2, and the expiry reminder as an optional
  Phase 3.7.

---

## Only Conor can do these

1. Answer Q1–Q25. Silence means the recommendation.
2. Ask Gabe which inquiry link, phone and browser he used (Phase 1.1).
3. Approve any correction to proposals with a double-counted discount
   (Phase 0.1).
4. Send the two-signature ceremony to counsel (Q13).
5. Walk the prod checks at the end of each phase, with Gabe for Phase 3.
