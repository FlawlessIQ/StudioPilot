# StudioCue vs. the Real Wedding Workflow

**Gap analysis + AI-leverage roadmap**
Source A: Gabriel Rhodes (GR Productions, NJ) end-to-end walkthrough video, recorded Jul 29 (15.5 min, transcribed + frame-reviewed)
Source B: Live click-through of `studiohub--studiohub-prod` studio workspace, Aug 6, 2026 (FlawlessIQ tenant, solo plan)

---

## 1. Executive summary

Gabriel's process is ~14 manual steps across 8 tools (Wix, Apple Notes, Gmail, Word, Dropbox Sign, QuickBooks, Zenfolio, Google Calendar). He estimates **5–6 hours of admin per client, excluding communications**, plus **1 hour to a full day per event for crew staffing**. StudioCue's architecture already maps to almost every step, and several of his explicit wishes (crew cascade, client portal, booking gate) are built. The biggest gaps are not missing screens — they are **missing AI drafts at the moments where Gabriel actually spends time**: the inquiry reply email, the proposal, the contract assembly, the T-minus communications, and the delivery/review follow-ups. Today the app gives him structured *forms* where he needs *drafts to approve*.

Three headline findings:

1. **The moment-of-truth AI surfaces are thin or broken.** The AI schedule generator — the single feature that most directly matches his workflow — failed in prod with a raw Zod validation dump rendered into the page. Package creation, questionnaires, proposals, and emails have no visible "draft this for me" entry point from their own screens.
2. **The communications layer is the largest gap.** Nearly everything Gabriel does is an email he writes by hand from an Apple Notes template. StudioCue has a Communications library page but no AI-drafted, milestone-triggered outbound messaging visible in the product loop.
3. **The approval architecture is exactly right — use it harder.** "Prepared for you, never decided for you," the AI review queue, and the evidence-controlled booking gate are the correct trust design. The opportunity is to route *many more* AI-prepared actions through that queue so the photographer's day becomes: open queue → approve/edit → done.

---

## 2. Gabriel's current end-to-end workflow (from the video)

| # | Step | How he does it today | Time/pain signals |
|---|------|---------------------|-------------------|
| 1 | Inquiry | Wix contact form → email notification | — |
| 2 | First reply | Manually pastes "WEDDING EMAIL" note from Apple Notes, adjusts, adds links (packages, reviews on WeddingWire/TheKnot, Zenfolio samples) | Every inquiry, by hand; couldn't even find his own form URL on camera ("this is pathetic") |
| 3 | Info form | Client fills Wix "wedding info form" (bride/groom contacts, event date, venues, ceremony/reception times, guest count) | Form data lands in email, is re-typed later |
| 4 | Consultation | He emails available dates; books Zoom / phone / in-person | Manual availability check |
| 5 | Proposal | Next day, emails photo + video package lists (Word doc / site pages) | Manual |
| 6 | Contract | **Cut-and-pastes** info-form data + chosen packages into a Word contract, exports PDF | Re-typing everything |
| 7 | Signature | Dropbox Sign: manually adds both signers, **drags every signature/date/name field** each time | Repeated field placement per contract |
| 8 | Retainer | $1,000 × crew member (e.g. 2 stills + 1 video = $3,000). **QuickBooks invoice built from scratch** | Manual every time |
| 9 | Schedule form | Sends Wix "wedding schedule form" (prep locations/times, ceremony, reception, photo start/end, family names) | — |
| 10 | Run of show | Builds day-of schedule manually in Word from the form using **his rules**: start 2h before ceremony; ~30-min blocks (robe/PJ shot, dress, groom); 1h bridal party; travel time **doubled**; 30–45 min venue photos; then cocktail/dinner/dances blocks | Manual per wedding |
| 11 | COI | Emails his insurance contact for a certificate, then manually emails it to the venue | Multi-hop email chase |
| 12 | T-minus 1 month | Re-sends schedule PDF to confirm times + sends **final QuickBooks invoice** (package total − retainer + sales tax) | Manual math + invoice |
| 13 | Day before | "So excited" email/text: dress on hanger, shoes, flowers, rings, invitations ready | "Saves us about 20 minutes on site. Every photographer does this." |
| 14 | Delivery | Uploads to Zenfolio, sends album link + instructional email/video for album selection ("heart" favorites); designs album; sends Dropbox video links | Client forgets; needs reminders |
| 15 | Reviews | Asks for Google (primary), WeddingWire, TheKnot | "Most people ignore that email" |
| 16 | Crew staffing | Wants ranked cascade: offer job to #1, accept/decline, falls to next | **1 hour to a full day per event** |

His stated dream state: client portal with signed contract, current schedule, COI, album + video links in one place; crew portal with schedules and auto Google Calendar invites; ranked crew offers.

---

## 3. What the live app already covers well

- **Project Command Center** — lifecycle (Inquiry → Proposal → Planning → Event → Delivery), readiness score, "who needs to do what next" (studio / client / crew / StudioCue), recommended next action. This is the right operational spine.
- **Inquiry pipeline** — tenant-branded public inquiry form (privacy/human-review framing, budget bands, consent), spam + duplicate protection, Open/Converted/Lost.
- **Booking gate** — contract (Docusign authority, **Dropbox Sign import** explicitly supported — directly answers step 7), retainer via QuickBooks reference, deterministic server-side confirmation that AI cannot override. Matches his flow and his trust needs.
- **Crew cascade** — "Fill a role in one reviewed cascade": ranked eligible collaborators, sequential release, accept stops / decline advances. **This is exactly the feature he described wanting** (steps 16), including rate, arrival/departure, response window.
- **Integrations + capability routing** — Zoom, Docusign, Dropbox Sign, QuickBooks, Dropbox connected; Google Calendar ready; routing per capability.
- **Event Copilot** — permission-aware, grounded Q&A with verified facts and source links; worked correctly in test ("What is blocking my next wedding?").
- **AI Import Studio** — upload files / paste an email / import a form page → import plan → approval. The "5–6 hrs → <1 hr" framing on this page shows the team already knows Gabriel's number.
- **AI review queue** — receipts, human authority retained.
- **Delivery** — gallery record with expiration, review destination + URL, album flag, "remember for future projects."

---

## 4. Gap analysis

Severity: 🔴 blocks the promise · 🟠 major friction survives · 🟡 polish

### A. AI drafting gaps (the core ask)

| Gabriel's step | App today | Gap | Sev |
|---|---|---|---|
| 2. Inquiry reply email | Inquiry row exists; no reply surface seen | **No AI-drafted first response** in his voice with availability + package/review/sample links. This is his highest-frequency task. | 🔴 |
| 4. Consultation booking | Calendar with open slots exists | No client-facing self-serve booking link; no AI-drafted "here are my available dates" email pulling from the calendar | 🔴 |
| 5. Proposal | Packages catalog (empty; deterministic form only) | No "draft proposal from consultation + packages" flow; no AI package builder from his existing Word/price lists on the packages screen itself | 🔴 |
| 6–7. Contract | Contract step consumes accepted proposal; Dropbox Sign import | Right design — but with no proposal AI upstream, the pipeline still starts with manual typing. Contract *content* drafting (custom clauses, notes) has no AI assist | 🟠 |
| 10. Run of show | **AI generator exists but failed** with raw Zod "Invalid ISO datetime" error dump; timing-rules section is the right idea | Broken in prod; also no way to *learn* his rules ("count back 2h, double travel") from an uploaded past schedule | 🔴 |
| 12–13. T-minus comms | Nothing visible | No scheduled 1-month confirmation, final-invoice draft (total − retainer + tax), or day-before checklist email/SMS — all pure-template wins he called out explicitly | 🔴 |
| 14. Delivery follow-ups | "Run delivery follow-up" AI shortcut on Home | Entry point exists, but no album-selection reminder loop, no instructional-video embed, no gallery-provider integration (Zenfolio is manual URL) | 🟠 |
| 15. Reviews | Review destination + URL on delivery record | No staged review-request sequence (Google-first, follow-up after N days), no AI-personalized ask referencing the couple's actual day | 🟠 |
| All email | Communications library page | No visible AI email drafting anywhere; Gabriel's whole life is templated email | 🔴 |

### B. Product/UX bugs found during the click-through

| Issue | Detail | Sev |
|---|---|---|
| AI schedule generation fails | Prod error: model output rejected by ISO-datetime validation; **raw Zod error JSON rendered into the page** | 🔴 |
| Insights nav | First sidebar click highlights but doesn't navigate (second click needed); `/studio/insights` 404s (real route `/studio/reports`) | 🟡 |
| Project row not clickable | Only the small arrow at row-end opens the project; clicking the project name does nothing | 🟡 |
| Search / ⌘K | Clicking the search box did not open the command palette | 🟡 |
| "Create with AI" | Top-right button appeared inert on some pages (e.g. on the import page itself) | 🟡 |
| Project tab context | Project tabs (Tasks, Client details, Booking…) navigate to global pages filtered by project; "Client details" actually lands on Questionnaires — label/expectation mismatch | 🟡 |

### C. Structural gaps vs. his dream state

| Need (from video) | Status | Gap |
|---|---|---|
| Client portal: contract + schedule + COI + album/video links | Portal exists per README ("Portal active" on client) | Verify all four artifact types surface; album/video links depend on delivery record being filled |
| Crew auto Google Calendar invite + schedule ack | Ack exists (crew ops); GCal not connected by default | Auto-invite on assignment acceptance not evidenced in UI |
| COI request → chase → forward to venue | COI ops exist (human-approved, per README); not reachable from project nav in walkthrough | Automation loop (request, remind, forward, confirm receipt) not visible |
| Zenfolio / gallery provider | Manual URL entry | No provider integration or upload trigger; even auto-detecting "gallery is live" would unlock delivery follow-ups |
| SMS / text | Not present | Day-before message is a *text* in his practice ("if you don't send that text, they never have it") |

---

## 5. AI-leverage roadmap — remove steps, keep approval

Design rule (matches existing architecture): **every item below produces a draft in the AI review queue with sources, diff-style preview, and one-tap approve/edit/dismiss. Nothing sends or posts without approval.** Over time, add per-action "auto-approve after N consecutive unedited approvals" as an owner-controlled setting.

### Tier 1 — kills the most hours, mostly template + data plumbing (do first)

1. **Inquiry Concierge.** New inquiry → AI drafts the reply in the studio's voice (learned from his imported "WEDDING EMAIL" note): availability answer from calendar, package links, review links, sample galleries, next step (book consultation). One approve → sent + lead moved. *Replaces step 2 entirely.*
2. **Consultation scheduling link.** Client picks from real open slots (already modeled in Calendar); Zoom link auto-created (already integrated); confirmation + reminder emails auto-drafted. *Replaces step 4.*
3. **Proposal from consultation.** After the meeting, AI assembles proposal from selected/likely packages + info-form data; drafts the cover email. Immutable proposal record on approval (engine already exists). *Replaces step 5.*
4. **No-retype contract chain.** Accepted proposal + questionnaire answers auto-fill the contract template; signer fields persist on the template (Dropbox Sign import already promises this); retainer invoice auto-computed from crew-count rule ($1,000 × crew) and drafted in QuickBooks. *Replaces steps 6–8 minus one approval each.*
5. **Lifecycle comms pack.** Milestone-triggered drafts: 1-month schedule confirmation (re-attach current PDF), final invoice (total − retainer + sales tax — deterministic math, not AI), day-before checklist (email + SMS via Twilio-class provider). *Replaces steps 12–13.* These were his most emphatic "every photographer does this" items.

### Tier 2 — the differentiators

6. **Fix + finish the run-of-show generator.** (a) Fix the datetime validation failure and replace raw error dumps with "We couldn't draft this — retry" + auto-retry with repair prompt. (b) Learn timing rules from uploads: he gives one past schedule PDF, AI proposes timing rules ("ceremony −2h start", "double travel", "1h bridal party") into the *studio-owned knowledge* section he approves once — then every draft uses his rules. (c) Travel legs via Maps distance, doubled per his rule, per venue pair from the schedule form.
7. **COI autopilot.** Trigger at booking: AI drafts request to his insurance contact; chases on a cadence; on receipt, files to project + drafts the forward to the venue; portal shows status. *Replaces step 11.*
8. **Delivery & album loop.** When gallery URL recorded (or detected), AI drafts delivery email with selection instructions + his tutorial video; schedules selection reminders until the client "hearts" their picks (or confirms); album-design task created when selections arrive. *Replaces step 14's chasing.*
9. **Review sequencing.** Post-delivery: Google-first ask with direct review link, personalized from event facts ("the Park Savoy at golden hour…"); polite follow-up after N days; WeddingWire/TheKnot as secondary profile links. Track conversion in Reports. *Fixes "most people ignore that email."*
10. **Crew calendar closure.** On cascade acceptance: auto Google Calendar invite with schedule link + portal access; ack tracked (exists). Fully delivers his staffing dream and the "3 hours, sometimes a whole day" recovery.

### Tier 3 — compounding intelligence

11. **Onboarding in one afternoon.** Point AI Import Studio at a Wix URL + a folder of Word/PDFs (his exact artifacts: packages doc, contract, schedule template, notes file) → complete import plan: packages with prices, questionnaire fields, contract template with mapped fields, timing rules, email templates. The screens exist; make the extraction handle *his* real files (proved possible — I extracted all of this from his video alone).
12. **Copilot with hands.** Extend Event Copilot from Q&A to command drafting: "send Maya the day-before checklist" → prepared action in review queue. The permission model already forbids it deciding; let it *prepare* everything.
13. **Portfolio-wide daily brief.** Morning digest: drafts awaiting approval, clients who went quiet, unpaid balances, unstaffed roles, weather for this week's events — each line deep-linking to a one-tap action.
14. **Auto-approve maturity dial.** Per action type, owner can graduate from "review each" → "auto-send after 5 unedited approvals" → "always auto, notify me." This is the honest path from 5–6 hrs to the promised <1 hr without breaking the trust boundary.

---

## 6. Metrics to hold the roadmap accountable

- Admin hours per booked wedding (his baseline: 5–6 hrs + comms) — target < 1 hr
- Staffing time per event (baseline 1 hr–1 day) — target < 10 min
- Inquiry → first-response time (baseline: whenever he checks email) — target < 15 min with approval, < 1 min at auto-approve maturity
- % AI drafts approved without edit (proxy for voice fidelity)
- Review conversion rate post-delivery (baseline: "most ignore")

---

## Appendix — walkthrough evidence

- **Video:** 186 frames sampled at 5 s; audio transcribed locally (whisper base.en). Key artifacts on screen: Wix `infoform` + `wedding-schedule-form`, Apple Notes "WEDDING EMAIL", Word contract "2027 Madeline Selvaggi PHOTO and VIDEO" (Gold Photo Package $4,999, cinematography packages $2,499/$2,999, $200 bundle discount), Dropbox Sign field-dragging, QuickBooks invoice #3224 from scratch, day-of schedule table (robe/PJ 1:30, ceremony 3:00–4:15, bridal party 4:15–4:45, travel doubled, photo concludes 11:00), Zenfolio galleries.
- **App:** landing → sign-in → Home → Inquiries → Projects → Smith Wedding (all 8 tabs) → AI review → Calendar → Clients → Library (Packages) → Reports → Studio setup → Integrations → AI Import Studio → public inquiry preview → Delivery → Event Copilot (live grounded answer verified).
