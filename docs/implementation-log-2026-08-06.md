# Implementation log — execution plan Phases 0–3 (2026-08-06)

Companion to `docs/execution-plan-2026-08-06.md`. Four passes, all verified
against `npm run typecheck`, `npm run lint`, `npm test` (202 passing, 12 new),
and `cd functions && npm run build`.

## Pass 1 — Phase 0 fixes

- **Run-of-show generator repaired** (`functions/src/ai/schedule.ts`). Root
  cause: the system prompt demanded ISO timestamps *with offsets* while the
  Zod schema (`z.string().datetime()`) rejected offsets. Fix: a
  `flexibleDatetime` transform normalizes any parseable ISO form to UTC, plus
  a one-shot repair pass that feeds validation issues back to the model
  before failing.
- **No more raw error dumps.** Server catch blocks only emit short codes;
  `lib/ai/friendly-error.ts` maps codes to calm copy everywhere
  (schedule generator, copilot client, new AI surfaces). Failure notices get
  the `form-notice-error` treatment.
- **Whole-row click targets** for all `.crm-table` rows (stretched-link CSS).
- **`/studio/insights` → `/studio/reports` redirect** (no more 404).
- **⌘K palette**: added "Draft a run of show" quick action.
- **Project tab labels**: "Client details" → "Questionnaires", "Planning" →
  "Vendors & venues".

## Pass 2 — Phase 1 drafting core

- **`features/messaging/`** (new, unit-tested): trigger catalog, lifecycle
  due-message engine (`dueLifecycleMessages`), deterministic draft renderers
  (schedule confirmation, final balance with exact total − retainer math,
  day-before checklist). Mirrored in
  `functions/src/communications/lifecycle-core.ts` per the repo's
  separate-package convention.
- **`aiMessageDraftCommand`** (new): the single entry point for AI-prepared
  client messages (inquiry reply, consultation dates, proposal cover,
  delivery note, album reminder, review request + lifecycle triggers). Every
  draft lands in the AI review queue as `review_required`; recipients are set
  deterministically, never by the model. Lifecycle triggers render without a
  model call or quota.
- **`lifecycleMessageScheduler`** (new): daily, walks projects inside 32 days
  of their event, creates due lifecycle drafts idempotently
  (`ai_lifecycle_{tenant}_{project}_{trigger}`).
- **`dispatchDraft` communications command** (new): sends an approved-unsent
  draft (the AI queue's inquiry replies) as an email job.
- **DraftCard in the AI queue**: message drafts render a friendly preview and
  subject/body editor instead of raw JSON; approving an inquiry reply keeps
  the card up with one-tap **Send reply now**.
- **Inquiry Concierge**: "Review reply" button on the lead detail page
  creates the draft; the existing reply card links to the queue.
- **Per-crew-member retainers**: `retainerRule` gains
  `{ type: "per_crew_member", amountPerCrewCents }` ($1,000 × crew, capped at
  package total) across features, CRM command, client portal API, and the
  package form (retainer type selector).

## Pass 3 — Phase 2 differentiators

- **Timing rules learned from a past schedule** (`aiTimingRulesCommand` +
  "Learn from a past schedule" in the timing-rule editor): paste a run of
  show → proposals with rationale → owner approves each into the
  studio-owned knowledge store via the existing deterministic
  `saveTimingRule`. Advisory only; nothing persists without approval.
- **COI autopilot chase** (`coiChaseScheduler`): outstanding
  `insuranceRequests` re-queue their original branded request weekly, up to 3
  chases, idempotent per chase number, audited. Receipt of a certificate
  stops the chase automatically.
- **Crew calendar closure**: cascade acceptance now queues an
  `add_crew_calendar_invite` provider job; the new handler creates the
  Google Calendar event with the crew member as attendee (mock-safe) and
  stamps `calendarStatus: "invited"` + link on the assignment.
- **Delivery draft chaining**: recording a gallery automatically prepares the
  delivery email draft in the review queue.
- **Client portal**: verified the home already shows contract / payment /
  schedule / COI / gallery / video / album tiles — no change needed.

## Pass 4 — Phase 3 intelligence

- **Trust dial** (`lifecycleSettingsCommand`, owner-only, audited +
  `LifecyclePackPanel` in Communications): per lifecycle message, On/Off and
  "Review each time" vs "Send automatically". Auto-send applies only to
  deterministic template-rendered messages with a recipient and zero missing
  facts; it writes an executed aiAction + receipt + email job. AI-personalized
  drafts always require review, regardless of the dial.
- **Copilot with hands**: grounded answers citing a project now end with
  prepared-action chips (day-before checklist, delivery email, review
  request) that create queue drafts — Copilot still never sends.
- **Daily brief**: the dashboard priority strip leads with "Drafts waiting
  for approval" deep-linking to the AI queue.
- **Import-in-an-afternoon**: existing AI Import Studio already covers
  files / pasted email / page import; no change this pass. Remaining work:
  end-to-end validation against a real Wix site + Word docs corpus.

## Configuration notes

- New env (functions): `VERTEX_AI_MESSAGE_MODEL` (falls back to
  `VERTEX_AI_SCHEDULE_MODEL`).
- New scheduled functions to deploy: `lifecycleMessageScheduler` (daily
  13:00 UTC), `coiChaseScheduler` (daily 14:00 UTC).
- New HTTP functions: `aiMessageDraftCommand`, `aiTimingRulesCommand`,
  `lifecycleSettingsCommand`; new communications command type
  `dispatchDraft`; new provider job type `add_crew_calendar_invite`.
- New test file registered in `package.json`: `tests/lifecycle-messaging.test.ts`.

## Follow-ups (not yet built)

- Self-serve consultation booking link surfaced on the public inquiry
  confirmation (page exists at `/schedule/consultation`; needs linking from
  the inquiry acknowledgement email template).
- SMS channel for the day-before checklist (Twilio-class provider behind
  capability routing).
- Review-conversion metric in Reports.
- Auto-approve maturity ("auto after 5 clean approvals") for AI-personalized
  drafts — the dial currently governs deterministic lifecycle messages only,
  deliberately.

## Pass 5 — The Journey (easy-flow UX reimagining)

Feedback: the product still read as an operations console; Gabriel thinks in
one thread per couple. This pass makes that thread the primary UI.

- **`features/journey/steps.ts`** (new, 8 unit tests): deterministic engine
  that turns a project's real records (lead, consultation, proposal,
  contract, invoices, questionnaire, schedule, crew, COI, delivery, drafts)
  into Gabriel's 15-step journey. Every step gets a plain-English status —
  complete / current / waiting on the client / in motion / upcoming — and
  exactly ONE step is ever "current", carrying the single next action.
  Waiting-on-client steps never block the studio's own next move.
- **`ProjectJourney`** (new component): replaces the "Project lifecycle"
  phase rail on the project page. Vertical timeline, progress count, and the
  one next action inline — as a link to the right surface or a one-tap draft
  button (day-before checklist, review request) that feeds the AI queue.
- **`JourneyUpNext`** (new component): the dashboard "Next actions" panel is
  now "Up next" — every active project contributes its single current journey
  step, ordered by event date; waiting-on-client projects say so instead of
  demanding attention. Top-to-bottom is the workday.

No new endpoints or nav items; the journey composes existing commands and
surfaces. Verified: typecheck, lint, 210 unit tests passing.
