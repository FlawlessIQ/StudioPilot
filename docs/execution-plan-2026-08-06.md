# StudioCue Execution Plan

**From gap analysis → shippable phases.** Companion to `docs/video-gap-analysis-2026-08-06.md`.
Design principles: **ease of use and simplicity first.** Every phase below is judged against them before anything else.

---

## 0. Design principles (apply to every item)

1. **One next action per screen.** Gabriel should never scan a page wondering what to do. Each surface leads with a single primary action; everything else is secondary. (The "Recommended next move" card is the right pattern — make it universal.)
2. **Drafts, not blank forms.** Anywhere the app currently shows an empty form, it should instead show a pre-filled draft with an "Edit" affordance. AI fills; the human corrects. A blank textarea is a failure state.
3. **Approve / Edit / Skip — always the same three buttons.** Every AI-prepared thing (email, invoice, schedule, cascade order) gets the identical review pattern in the identical place (AI review queue + inline). No novel UI per feature.
4. **Never show plumbing.** No raw errors, no provider jargon, no state-machine vocabulary in the UI. "We couldn't draft this — Retry" is the worst message a user may ever see.
5. **Progressive trust.** Everything starts as "review each time." After 5 unedited approvals of an action type, offer "auto-send and notify me." Owner-controlled, per action type, reversible.
6. **Don't add nav items.** Ship all of this inside the existing 9 sidebar items. If a feature needs a new top-level page, the design is wrong.

---

## Phase 0 — Fix the floor (week 1–2)

Small, high-embarrassment items. No new features until these are done because they undermine trust in the AI promise.

| # | Item | What to do | Where |
|---|------|-----------|-------|
| 0.1 | **Run-of-show generator failure** | Root-cause the ISO-datetime schema rejection (model returns non-ISO datetimes). Add a repair pass: on Zod failure, re-prompt with the validation errors once before surfacing failure. | `functions/src/ai`, `lib/ai` |
| 0.2 | **Human-readable AI errors** | Global rule: AI failures render "We couldn't draft this — Retry" + one-line plain-English reason. Raw validation output goes to logs only. Audit all AI call sites. | `components/`, `lib/ai` |
| 0.3 | **Clickable project rows** | Entire row is the link target, not just the arrow. Same for leads, clients, crew rows. | `components/projects` |
| 0.4 | **Insights nav** | Fix first-click navigation; redirect `/studio/insights` → `/studio/reports` (or rename route to match label). | `app/` |
| 0.5 | **⌘K palette** | Make the search box click open the palette; palette includes actions ("Generate schedule for Smith Wedding") not just navigation. | `components/` |
| 0.6 | **Project tab labels** | "Client details" → "Questionnaires" (or make it a real client-details surface). Keep project context visible in tab pages (persistent project header instead of "Back to project" banner). | `app/`, `components/` |

**Acceptance:** schedule draft succeeds on the Smith Wedding demo data; zero raw error strings reachable in UI; every list row navigates on click.

---

## Phase 1 — The Drafting Core (weeks 2–6)

> Kills the biggest share of Gabriel's 5–6 hrs. One new system, five applications of it.

### 1A. New foundation: **Message Studio** (the only genuinely new subsystem)

A single template + drafting engine every feature reuses. Not a new nav item — it lives inside Library → Communications.

- **Data:** versioned message templates (immutable versions, like packages) with merge fields (`{{couple}}`, `{{venue}}`, `{{package_total}}`…), per-tenant voice profile learned from imported emails.
- **Server:** one `draftMessage` command (project + trigger type → rendered draft), one `sendMessage` command (approval-gated, via SendGrid, logged to project comms history).
- **UI:** one reusable `<DraftCard>` component: rendered message, editable inline, source chips ("from: schedule form, package snapshot"), Approve/Edit/Skip. Used everywhere; never redesigned per feature.
- **AI boundary:** AI writes body text only; money figures, dates, and links are merge-field injected deterministically (AI never computes an invoice total).

### 1B. Features built on it

| # | Feature | UX (simplicity spec) | Replaces |
|---|---------|----------------------|----------|
| 1.1 | **Inquiry Concierge** | New inquiry row shows one button: **"Review reply"** → DraftCard with availability (from Calendar), package/review/gallery links. Approve = send + lead advances. Inbox becomes: open → approve → done. | Apple Notes "WEDDING EMAIL" ritual |
| 1.2 | **Self-serve consultation booking** | Public `/book/{studio}` page listing real open slots; picking one creates the Zoom consult + confirmation draft. Studio-side setting is one toggle: "Let clients book consultations." | "Here are my available dates" emails |
| 1.3 | **Proposal draft** | After consult, project card's next move = **"Review proposal"**: packages pre-selected from consult notes/questionnaire, cover email drafted. Approve = immutable proposal + send. | Next-day manual proposal email |
| 1.4 | **No-retype contract chain** | Accepted proposal auto-fills contract template (fields mapped once at import, reused forever); retainer auto-computed (`$1,000 × crew` as a tenant pricing rule); QuickBooks invoice drafted. UI = three stacked DraftCards on the existing Booking page: Contract → Retainer → Send. | Word cut/paste + field dragging + invoice from scratch |
| 1.5 | **Lifecycle comms pack** | Per project type, a default timeline of triggered drafts: T-30d schedule confirmation (+ current PDF), T-30d final invoice (deterministic: total − retainer + tax), T-1d checklist (email + SMS). Surfaced only as queue items when due — no new screens. Settings = a simple list with on/off toggles per message. | 1-month + day-before manual sends |

**New integration:** SMS provider (Twilio or MessageBird) behind the existing capability-routing pattern. Day-before message defaults to text + email.

**Acceptance:** demo wedding can go inquiry → booked with ≤ 5 approvals and zero typed paragraphs; every sent message visible in project comms history with its source template version.

---

## Phase 2 — The Differentiators (weeks 6–10)

| # | Feature | UX (simplicity spec) | Notes |
|---|---------|----------------------|-------|
| 2.1 | **Run-of-show v2: learned timing rules** | Upload one past schedule → AI proposes timing rules in plain sentences ("Start 2 hours before ceremony", "Double all travel times"). Owner approves once; rules live in the existing *studio-owned knowledge* box. Every future draft uses them. Travel legs computed from Maps distance between form addresses — shown as "Travel: 22 min → planned 45" so the doubling is visible, not magic. | Extends existing Timing rules section — no new UI concept |
| 2.2 | **COI autopilot** | Booking confirmation triggers: draft COI request to insurer → auto-chase weekly → on receipt, draft forward-to-venue. Status = one line on project Overview ("COI: requested · received · sent to venue ✓"). All sends are DraftCards until trust dial says otherwise. | Uses existing human-approved COI ops |
| 2.3 | **Delivery & album loop** | Recording a gallery URL triggers: delivery DraftCard (link + selection instructions + tutorial video embed), then selection reminders on a cadence until client marks done in portal. Album-design task auto-created when selections land. | Builds on existing Delivery page + "Run delivery follow-up" shortcut |
| 2.4 | **Review sequencing** | Post-delivery: Google-first review ask personalized from event facts, one follow-up after N days, secondary WeddingWire/TheKnot links. Reports gains one number: review conversion. | Review destination fields already exist |
| 2.5 | **Crew calendar closure** | Cascade acceptance → Google Calendar invite (schedule link + portal access) sent automatically; ack tracking already exists. Requires finishing the GCal connection UX (currently "ready to connect"). | Completes his staffing dream end-to-end |
| 2.6 | **Client portal completeness pass** | Portal home = four tiles: Contract · Schedule · Insurance · Your Photos & Films. Each shows status or artifact. Nothing else on the page. | Matches his stated dream verbatim |

**Acceptance:** from booking to event day, the studio's only manual work is approving queue items; crew staffing for a 3-role wedding completes in < 10 minutes including calendar invites.

---

## Phase 3 — Compounding intelligence (weeks 10–14)

| # | Feature | UX (simplicity spec) |
|---|---------|----------------------|
| 3.1 | **Import-in-an-afternoon** | AI Import Studio accepts a Wix/site URL + a drag-in of Word/PDF files; output is one reviewable import plan (packages w/ prices, contract template w/ mapped fields, questionnaire, timing rules, email templates). Target: a Gabriel-class studio fully configured in one sitting. |
| 3.2 | **Copilot with hands** | Copilot answers can end with a prepared action chip ("Draft the day-before checklist for Maya & Theo →") that deep-links to a DraftCard. Copilot still never sends. |
| 3.3 | **Daily brief** | Home hero becomes the brief: approvals waiting, quiet clients, unpaid balances, unstaffed roles — each line is a one-tap deep link. (Optional email/push version.) |
| 3.4 | **Trust dial** | Studio setup gains one simple panel: per action type, Review each time / Auto after 5 clean approvals / Always auto + notify. Backed by the audit trail that already exists. |

---

## UI updates summary (cross-cutting, mostly Phase 0–1)

1. **DraftCard** — the one new reusable component; identical everywhere (Approve / Edit / Skip, source chips, voice-preserving edit box).
2. **Universal "next move"** — every page (not just project Overview) surfaces exactly one recommended action; empty states always offer the AI path first ("Draft it from what I have") with manual creation as the quiet secondary link.
3. **Row-level ergonomics** — full-row click targets, consistent back behavior, persistent project context header across project tabs.
4. **Plain-English status language** — audit of all copy: no "PROPOSAL state", no provider names in primary UI ("Signature: waiting on client", not "Docusign envelope pending").
5. **Queue as the home for work** — AI review queue gets grouping by project, batch-approve for same-type items, and a count badge in the sidebar. The pitch to photographers becomes: *live in the queue, not in the tabs.*
6. **No new sidebar items** — everything above fits in Home, Inbox, Projects, AI review, Calendar, People, Library, Insights, Studio setup.

---

## Sequencing logic & dependencies

```
Phase 0 (fixes) ─────────────► ship immediately
Message Studio (1A) ─┬─► 1.1 Inquiry Concierge
                     ├─► 1.3 Proposal draft ─► 1.4 Contract chain (needs pricing rule engine)
                     ├─► 1.5 Lifecycle comms (needs SMS provider)
                     ├─► 2.2 COI autopilot
                     ├─► 2.3 Delivery loop ─► 2.4 Review sequencing
                     └─► 3.2 / 3.3
1.2 Booking link ──► needs Calendar + Zoom (already connected)
2.1 Timing rules ──► needs Phase 0.1 fix; Maps API new
2.5 Crew calendar ─► needs GCal connection finished
3.1 Import ────────► extends existing AI Import Studio
```

Layer order per feature (per repo convention): `features/` (schemas, deterministic rules) → `server/` (repos/services) → `functions/` (commands/schedulers) → `lib/` (client callers) → `components/` + `app/` (UI). AI never writes legal/payment/signature/readiness fields — DraftCard approval is what commits, consistent with the existing trust boundary.

---

## Measures of success (unchanged from gap analysis)

| Metric | Baseline | Phase 1 target | Phase 3 target |
|---|---|---|---|
| Admin hrs / wedding | 5–6 h | ≤ 2 h | < 1 h |
| Staffing time / event | 1 h – 1 day | — | < 10 min |
| Inquiry → first response | ad hoc | < 15 min (approved) | < 1 min (auto) |
| AI drafts approved unedited | — | > 60% | > 85% |
| Review conversion | "most ignore" | measured | +2× baseline |

The single demo that proves the product: **run one wedding end-to-end on stage — inquiry to review request — touching only Approve.**
