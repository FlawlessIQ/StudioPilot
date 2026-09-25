# Execution plan — lead capture from the studio's inbox (2026-09-25)

Companion to `docs/lead-capture-plan-2026-09-25.md` (the why and the
experience). This is the how: every change, where it goes, what proves it, and
the order. Decisions L1–L5 are taken as recommended there.

**Outcome.** A couple submits the studio's existing website form; within two
minutes a fully filled lead is in Today, the date checked, a reply drafted,
duplicates merged, and the couple's answer to that reply comes back into the
same thread. The studio changes nothing on its website.

**Size.** Phase 0 is admin that starts today. Phases 1–4 are ≈6 weeks of build.
Google's review runs alongside and is the only thing that can hold Phase 3.

| Phase | What ships | Build | Blocks on |
|---|---|---|---|
| 0 | Google verification started; Microsoft partner account; real form-email fixtures collected | ½ day ours + Google's clock | — |
| 1 | Forwarding made world-class — covers every Gmail studio, including Gabe | ≈8 days | fixtures |
| 2 | Connect Outlook / Microsoft 365 (Graph) | ≈7 days | publisher verification (free) |
| 3 | Connect Gmail directly (API + push), 30-day backfill | ≈7 days | Google restricted-scope approval + CASA |
| 4 | Reply from the studio's own address (Gmail / Graph send) | ≈5 days | Google sensitive-scope approval |

---

## Phase 0 — Start the clocks (this week)

| # | Task | Owner | Notes |
|---|---|---|---|
| 0.1 | **Google brand verification + publish status** for the `studiohub-prod` OAuth app (already published — confirm in the console), with the existing Calendar scopes (`calendar.freebusy`, `calendar.events.owned`) | Conor (prompt in `docs/google-oauth-verification-prompt.md`) | 2–3 business days for brand; sensitive scopes a few weeks |
| 0.2 | **Choose a CASA lab** (TAC Security's AL1 package is the cheapest listed, ~$540–$1,800/yr), and have their scanner requirements ready | Conor | CASA is requested by Google *after* the restricted-scope submission; knowing the lab shortens it |
| 0.3 | Add `gmail.readonly` and `gmail.send` to the consent screen **only when Phase 3's build can be demoed** — Google wants a demo video of the real flow | us, end of Phase 3 | Submitting unused scopes gets rejected |
| 0.4 | **Microsoft Cloud Partner Program** account + publisher domain verification (`studio-cue.com`) + an Entra app registration | Conor | Free; needed so Microsoft 365 tenants don't block consent |
| 0.5 | **Collect real form emails** — 3–5 from Gabe's Wix form, plus one each from Squarespace, Showit, WordPress CF7, Pixieset, The Knot, WeddingWire (test submissions to our own sites where needed). Saved raw (`.eml`) into `tests/fixtures/form-emails/` | Conor + us | The parser is built against these, not samples (`fixtures-must-match-real-names`) |
| 0.6 | Privacy policy: an "Email connections" section (what's read, what's stored, Limited Use statement) — required for Google review | us | Draft ready for 0.1 |

---

## Phase 1 — A world-class forwarding path (≈8 days)

Everything here is also the core of Phases 2–3: they add new ways to *receive*
mail; the classify → read → capture → review pipeline is built once, here.

### 1A. Receive correctly (1 day)

| # | Change | Where |
|---|---|---|
| 1.1 | Read the HTML part when there is no text part (sanitise → text; keep line structure of tables/`<br>` so `Label: value` survives) | `functions/src/communications/inbound.ts:117, :219`; new `functions/src/communications/html-to-text.ts` |
| 1.2 | Stop `isAutomatedEmail` quarantining **forwarded** form notifications: on the `inquiries+` route, run the inquiry classifier first; automated-mail rules apply only to what it rejects | `inbound.ts:197` |
| 1.3 | Keep the raw message headers the capture needs: `Reply-To`, `From`, `Sender`, `List-Id`, `Auto-Submitted`, original `Message-ID` | `inbound.ts` |
| 1.4 | A capture record for every inquiry-route message: `inboundCaptures/{hash(tenant,messageId)}` — sender, subject, route (forward/graph/gmail), classification + confidence, outcome (`lead_created`, `attached_to`, `maybe`, `ignored`, `quarantined`), leadId | new collection; rules: studio owner/admin read, no client write |

### 1B. Recognise the form (2 days)

| # | Change | Where |
|---|---|---|
| 1.5 | **Form-builder recognisers**, pure and deterministic, one module each: Squarespace (`form-submission@squarespace.info`, `Form Submission - …` subject, Reply-To), Wix (`notifications@wix-forms.com`, `no-reply@crm.wix.com`, `no-reply@wixsiteautomations.com`), Showit (`noreply@showit.co`), WordPress Contact Form 7 (`wordpress@…`, the default template), Pixieset, The Knot, WeddingWire, Zola; returns `{ builder, formName, fields: [{label, value}] }` | `features/intake/form-emails/*.ts` (+ functions mirror, drift test) |
| 1.6 | **Generic `Label: value` reader** for anything unrecognised (tables, bold labels, colon lines) | `features/intake/form-emails/generic.ts` |
| 1.7 | **Label → lead field map** with synonyms ("Big day", "Wedding date", "Event date" → `eventDate`; "Where", "Venue", "Location" → `venue`; "Partner", "Fiancé(e)" → `partnerName`; "How did you hear" → `referralSource`; "Budget", "Investment" → `budget`; "Guests", "Guest count" → `guestCount`; "Photo/Video" → `services`) + the studio's saved per-form overrides | `features/intake/field-map.ts` |
| 1.8 | **Who is it from:** Reply-To → the form's email field → From (only if not a no-reply/platform sender) → forwarded-header block; never the studio's own address | `features/intake/sender.ts`, replaces the logic at `forwarded-inquiry.ts:164-202` |
| 1.9 | **Is it an inquiry:** known builder or marketplace → yes; the studio's learned senders → yes; otherwise the model classifies (`inquiry`, `not_inquiry`, `unsure`) — `unsure` goes to a "Maybe an inquiry" tray, never a lead | `functions/src/intake/classify.ts` |

### 1C. Read everything (1.5 days)

| # | Change | Where |
|---|---|---|
| 1.10 | Run the existing intake extractor (`generateIntake`, `functions/src/ai/copilot.ts:1839-1914`) over the message text for anything the form fields did not give; extend its schema with ceremony time, budget, services, referral source | `functions/src/ai/copilot.ts` → move to `functions/src/intake/extract.ts` and share |
| 1.11 | **Merge with provenance:** form field > studio mapping > model; each lead field records `{ value, source: "form" \| "model" \| "studio", label? }`; the model never overwrites a form value | `features/intake/merge.ts` |
| 1.12 | **Lead fields** added: `partnerName`, `phone`, `venue`, `city`, `ceremonyTime`, `guestCount`, `budget`, `services`, `referralSource`, `formBuilder`, `formName`, `fieldProvenance`, `rawFormFields`, `captureId`; `leadSchema` relaxed to what leads really are (date/city optional) and actually used to validate writes | `features/leads/schema.ts:81-107`, `functions/src/crm/forwarded-lead.ts` |
| 1.13 | Source that says the truth: `source: "website_form"` with `formBuilder` ("Wix"); Today card "From your Wix form" | `features/today/inbox.ts:468` |

### 1D. Don't duplicate; thread the conversation (1.5 days)

| # | Change | Where |
|---|---|---|
| 1.14 | **Duplicate detection:** same email → the open lead or the active job; else same names + date → the same; a match attaches the message to that lead/job's thread and says so ("Emma wrote again") instead of creating a lead | `functions/src/intake/dedupe.ts`; replaces the dead `duplicateKey` at `forwarded-lead.ts:126` |
| 1.15 | **A conversation per lead** from the first captured message; the approved reply goes out with the thread's reply-to address so the couple's answer lands back on the lead | `functions/src/ai/approved-communication.ts:31-49` (carry `leadId`), `functions/src/operations/jobs.ts:477-499, :924-937` (treat lead contact as client), `functions/src/communications/conversation.ts` |
| 1.16 | When a lead becomes a job, its conversation moves with it | `functions/src/crm/commands.ts:667-806` |

### 1E. Review and act (1.5 days)

| # | Change | Where |
|---|---|---|
| 1.17 | **`updateLead` command** (owner/admin/coordinator; audited; provenance becomes `studio`) and **`markLeadNotInquiry`** (archives it, records the sender as not-an-inquiry for this studio) | `functions/src/crm/commands.ts`, `lib/crm/command-client.ts` |
| 1.18 | **Review card** in Today: headline facts, date-availability, source, reply ready → **Send reply** · Edit · Not an inquiry; model-inferred fields marked; phone = compact row + review sheet | `components/today/*`, `components/leads/lead-review-card.tsx` |
| 1.19 | Lead detail becomes editable inline; **Create the job** works without a date (the job's date stays "to confirm") | `components/live/tenant-records.tsx:1061-1274, :1389`; `createProject` accepts a null date only when `leadId` is set |
| 1.20 | "Maybe an inquiry" tray on the Leads page (confirm → lead; dismiss → learned) | `app/studio/leads/page.tsx` |

### 1F. Setup and trust (1.5 days)

| # | Change | Where |
|---|---|---|
| 1.21 | **"Where do your inquiries arrive?"** — MX lookup on the studio's email domain picks the path (Gmail / Workspace / Microsoft 365 / Outlook.com / other) | `functions/src/intake/mailbox-provider.ts`; setup, Today (no inquiry ever), Settings → Inquiries |
| 1.22 | **Builder-aware filter instructions:** the exact Gmail search (`from:(notifications@wix-forms.com OR …)`) for the builder the studio picks, with a deep link to Gmail's filter screen | `components/intake/forwarding-setup.tsx` |
| 1.23 | **Auto-confirm Gmail's forwarding verification:** the inbound route recognises Gmail's confirmation message (`forwarding-noreply@google.com`, "Gmail Forwarding Confirmation"), follows the confirmation link server-side, and marks the step done live. English-language Gmail only; otherwise shows the code for the studio to paste | `inbound.ts`, `functions/src/intake/gmail-forwarding-confirm.ts` |
| 1.24 | **Send a test inquiry:** the setup waits for the next capture, shows what was read and which field went where, and saves the studio's corrections as the form's mapping (`leadCaptureSettings/{tenantId}.forms[]`); the test lead is flagged and excluded from counts | `components/intake/teach-your-form.tsx`, new doc `leadCaptureSettings` |
| 1.25 | **Capture health:** last captured time; silence alert when no capture for 3× the studio's median gap (min 7 days) — in Today and by email | `functions/src/intake/health-scheduler.ts` (+ invoker allowlist) |

### Phase 1 tests

- `tests/form-emails.test.ts` — every fixture in `tests/fixtures/form-emails/` →
  expected builder, sender, fields. **Real emails only.**
- `tests/intake-merge.test.ts` — provenance order, model never overwrites a
  form value, synonyms.
- `tests/intake-dedupe.test.ts` — second submission attaches; different couple
  same date does not.
- `tests/intake-classify.test.ts` — newsletters, receipts, Instagram
  notifications are not inquiries; marketplace + builder senders are.
- `tests/inbound-html-only.test.ts`, `tests/lead-thread.test.ts`,
  `tests/gmail-forwarding-confirm.test.ts`, rules test for `inboundCaptures`
  and `leadCaptureSettings`.
- **Done when:** a real submission of Gabe's Wix form, forwarded by a Gmail
  filter set up through the new flow, becomes a correct lead in Today on
  production within two minutes, and his reply's answer threads back.

---

## Phase 2 — Connect Outlook / Microsoft 365 (≈7 days)

| # | Change | Where |
|---|---|---|
| 2.1 | Provider `microsoft_mail` with capability `inquiries`; Entra multi-tenant app; delegated `Mail.Read` + `offline_access` (+ `Mail.Send` added in Phase 4) | `features/integrations/schema.ts`, `functions/src/integrations/oauth.ts` |
| 2.2 | Tokens in Secret Manager, refresh like other providers | `functions/src/operations/provider-runtime.ts:57-106` |
| 2.3 | **Change notifications** on `/me/mailFolders('inbox')/messages` → an HTTPS webhook relayed through App Hosting like the other webhooks; validation handshake; `clientState` secret per subscription; **renew daily** (limit ≈7 days); lifecycle notifications handled | `functions/src/intake/graph-webhook.ts`, `app/api/webhooks/graph/route.ts` |
| 2.4 | **Delta query** every 15 minutes as the safety net for dropped notifications | `functions/src/intake/graph-delta-scheduler.ts` |
| 2.5 | Fetch only messages from known + learned senders, or unknown senders the classifier needs to see; store nothing that isn't captured | `functions/src/intake/graph-fetch.ts` |
| 2.6 | Feed the Phase 1 pipeline (`route: "graph"`) | shared |
| 2.7 | **30-day backfill** on connect → "Found N inquiries" review list → import selected | `functions/src/intake/backfill.ts`, `components/intake/backfill-review.tsx` |
| 2.8 | Disconnect: delete subscription + secret; say what stops | as other providers |

Tests: Graph webhook validation + clientState rejection; renewal before
expiry; delta catches a missed message; backfill never double-creates.
**Done when:** a Microsoft 365 test mailbox captures a real form email within
two minutes on production.

---

## Phase 3 — Connect Gmail directly (≈7 days build)

| # | Change | Where |
|---|---|---|
| 3.1 | Provider `google_mail`, separate from `google_calendar` (a studio may connect one without the other); scopes `gmail.readonly` (+ `gmail.send` in Phase 4) | `oauth.ts` |
| 3.2 | **Pub/Sub topic** `gmail-inbox` with `gmail-api-push@system.gserviceaccount.com` as publisher; push subscription → a private function | infra script `scripts/configure-gmail-push.sh` |
| 3.3 | `users.watch` on connect and **renewed daily**; `historyId` stored; notification → `history.list` → fetch new messages | `functions/src/intake/gmail-watch.ts`, `gmail-history.ts` |
| 3.4 | Poll `history.list` every 15 minutes as the safety net (notifications can be dropped) | scheduler |
| 3.5 | Query-narrowed fetch (`from:(…known and learned senders…)` plus the classifier for others); store nothing that isn't captured | `gmail-fetch.ts` |
| 3.6 | Backfill 30 days; review; import | shared with 2.7 |
| 3.7 | Studios on forwarding keep working; connecting Gmail offers to remove the filter | setup copy |
| 3.8 | **Demo video + restricted-scope submission** (see prompt), then CASA with the chosen lab | Conor + us |

Until Google approves: `google_mail` is feature-flagged to test users only;
everyone else uses Phase 1 forwarding.

---

## Phase 4 — Reply from the studio's own address (≈5 days)

| # | Change | Where |
|---|---|---|
| 4.1 | `gmail.send` (sensitive) / Graph `Mail.Send`: approved lead replies and later client messages send **as the studio**, in its Sent folder | `functions/src/operations/jobs.ts:691-750` gains a "send via connected mailbox" path |
| 4.2 | Threading: set `In-Reply-To`/`References` to the captured form email so the couple's mail client threads it; replies still captured (Phase 2/3 watch, or the reply-to address for forwarding studios) | same |
| 4.3 | Fallback to SendGrid if the mailbox is disconnected, and say so | same |

---

## Deploy and verification (every phase)

- Gates: `npm run typecheck && npm test && npm run lint && npm run build`,
  `cd functions && npm run build`, rules tests.
- Functions: **all** of them (email templates and shared intake modules touch
  the render worker), then `configure-production-function-invokers.sh` (new
  schedulers and webhooks added to its allowlists in the same change), then
  `verify-deployed-function-freshness.sh`.
- App Hosting rollout created explicitly; confirm `SUCCEEDED` on the commit.
- **Walk it on production** with a real form submission and a real inbox
  before calling a phase done.

## Metrics (tracked from Phase 1)

`inboundCaptures` makes these countable per studio: time-to-lead (median < 2
min), fields pre-filled vs present in the form (≥ 80%), leads edited after
capture (< 20%), false leads (< 2%), "maybe" items confirmed vs dismissed
(tunes the classifier), setup completion time (< 3 min).

## Phase 1 status (2026-09-25)

Built: 1.1–1.17, 1.19–1.25, with these deviations:

- **1.19** Converting a lead with no date asks for the date at the button
  rather than creating a dateless job. Every job surface assumes a date;
  a job created without one would have broken more than it saved.
- **1.23** Gmail's forwarding confirmation is recognised and its code and link
  shown live in setup; the link is **not** followed server-side. Following a
  link out of an inbound email from our own server is a request we'd be making
  on an untrusted body's say-so. One paste is the cost.
- **1.18** Today's inquiry card now names the form ("From your Wix form") and
  says whether the date is free; unsure captures stay off Today. The inline
  Send / Edit / Not-an-inquiry card on Today itself is **not** built — the lead
  page is the review surface for now.
- **1.25** The silence alert is sent by email and shown as "last captured" in
  setup; it is not yet an item on Today.

Open: real notification emails from the pilot studio's own form (the fixtures
follow each builder's documented format), and the production walk.
