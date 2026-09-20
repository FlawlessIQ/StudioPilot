# Execution plan — closing the 2026-09-20 audit

Everything still open from `ux-audit-2026-09-20.md`, plus the items in
`backlog-2026-09-18.md` that no amount of code will move.

Four phases. Phases 1–3 are one working day and ship together. Phase 4 is
yours, and two of its items are worth more than anything in phases 1–3.

---

## Phase 1 — Cue runs offline

**The problem.** `cloudAccessToken()` reads `metadata.google.internal`, which
exists only on GCP, so no local run, no staging run and no test can drive a Cue
turn end to end. Every one of the four causes fixed in the G batch was a turn
*shape* defect — subject discarded, blocker audit outranking the action, flow
rendering last, completed flow forgetting — and not one of them needed a real
model to find. They were found by reading a production transcript after the
reference studio had already hit them. That is the thing to change.

**The seam is already there.** Four call sites share one shape —
`cloudAccessToken()` then `fetch(vertexUrl(…), body)`:

| Site | What it does |
|---|---|
| `copilot.ts:512` | `generateStructuredBody` — one structured answer |
| `copilot.ts:612` | the streaming answer |
| `copilot.ts:888` | `runToolLoop` — the retrieval loop |
| `copilot.ts:1281` | the flow/action pass |

### 1.1 Extract the transport
New `functions/src/ai/vertex-transport.ts`:

```ts
export async function vertexGenerate(
  body: unknown,
  method: "generateContent" | "streamGenerateContent",
): Promise<Response>
```

All four sites call it. No behaviour change. This alone is worth doing: the
error handling at those sites is currently four copies of the same
`VERTEX_AI_COPILOT_FAILED:${status}` construction.

### 1.2 Script it behind `PROVIDER_MOCK_MODE`
`functions/src/ai/vertex-script.ts` — a fixture list of
`{ match: RegExp, reply: CopilotReply }`, consulted only when
`process.env.PROVIDER_MOCK_MODE === "true"` (the switch every other adapter
already reads — `extraction.ts:667`, `signed-agreement.ts:165`,
`booking/commands.ts:370`).

It must cover the turns that have actually gone wrong:

- `add <name> as second photographer for <couple>` → a `crew_offer` flow
  carrying `subject: "<name>"`, so subject matching is exercised
- the same for a **videographer** role, so trade ranking is exercised
- a question with no action → an answer with facts and citations, no flow
- a `package` and a `questionnaire` flow
- one deliberate failure, so the "Cue could not answer" path is walkable

### 1.3 The part that keeps it honest
Every scripted reply is parsed through the **real** `responseSchema`
(`copilot.ts:111`) before it is returned. A fixture that drifts from what the
model must produce fails the test instead of quietly teaching the UI a shape
production will never send.

`tests/cue-offline.test.ts` asserts: every fixture parses; the mock is
unreachable unless `PROVIDER_MOCK_MODE` is on; and no call site reaches
`fetch` directly any more.

### 1.4 What it buys immediately
A Playwright case that types Gabe's actual sentence — *"add albert gershengoren
to 2nd photogrpaher for erin and joe demattia"* — and asserts the turn: the
flow renders first, the named person is pre-selected, the job card is compact,
and a second visit shows what happened rather than a fresh picker. That is
`tests/cue-action-turn.test.ts` promoted from reading source to driving the
product.

**Done when:** `npm run dev` against the emulator answers a Cue request with no
credentials, and the Playwright case passes.

---

## Phase 2 — The job page

Findings 6 and 7 are one defect seen from two sides. Today:

```
<div className="job-page-grid">   thread 556px │ rail 1374px   ← 818px void
<section className="project-now-next">   lanes + prepared      ← full width
<ProjectCrewPanel />                                           ← full width, 2768px
<details className="project-detail-disclosure">
```

### 2.1 Move the full-width sections into the grid's left column
`live-project-detail.tsx:1219` — `project-now-next` and `ProjectCrewPanel`
become children of the left column beside the rail. The left column then runs
~1400px against the rail's 1374: the void closes because the column has
something to hold, and the crew panel lands near 1300 instead of 2768.

The mobile branch is a separate `.job-mobile` tree, so it is untouched — but
re-measure it anyway, because that is exactly the assumption that put the
delete control above the fold.

### 2.2 Name the crew where the question is already asked
The rail says **"Crew confirmed · All 1 offered role accepted"** at ~700px and
names nobody. Add the names to that row. Then "who is on this job" is answered
without scrolling at all, and 2.1 becomes about layout rather than about
findability.

**Done when:** measured offsets are in the report, not asserted from source —
the crew panel above 1400px on a 900px viewport, and no column more than ~200px
shorter than its neighbour on a job with an empty thread.

---

## Phase 3 — The batch

| # | Change | File |
|---|---|---|
| 10 | Hint on Specialties: "The kind of event they shoot — weddings, corporate." | `create-crew-profile-form.tsx` + the two other crew forms |
| 11 | Neither crew count individually required; validate the **total** ≥ 1 — "A package has to send at least one person." | `app/studio/packages/new` form + `features/packages/coverage.ts` |
| 12 | `title` on truncated row text | `live-domain-view.tsx` |
| 13 | Collapse the Cue quick-actions rail below ~1200px | `.cue-rail`, `globals.css:12934` |
| 14 | Stop the status badge clipping below 900px | `.live-domain-table` media block |
| — | Playwright: tick a trade, fill, submit, assert the stored value | `tests/e2e/` |

That last one closes the audit's one unresolved observation — a profile that
saved `trades: []` after the box was visibly ticked, which I could not
reproduce. A test is the honest way to settle it either way.

---

## Ship

One deploy for all three phases, in the order CLAUDE.md requires:

```bash
cd functions && npm run build
firebase deploy --only functions --project production
./scripts/configure-production-function-invokers.sh studiohub-prod us-east4
./scripts/verify-deployed-function-freshness.sh studiohub-prod us-east4
firebase apphosting:rollouts:create studiohub --git-branch main --project production --force
```

Then confirm the rollout's **build commit message** is the one expected — a
green rollout of the previous commit looks identical to a green rollout of
yours.

Phase 1 touches `functions/src/ai/`, which several functions import, so this is
a deploy-all, not a selective one. The freshness script is the check, not the
judgement.

**Gate before any of it:** `npm run typecheck && npm test && npm run lint &&
npm run build`, plus `cd functions && npm run build`.

---

## Phase 4 — Only you can do these

Ordered by what it costs a real couple.

### 4.1 SendGrid link branding for studio-cue.com — **do this first**
Every link in client mail ships as `u57073990.ct.sendgrid.net/ls/click?…`. A
couple about to accept a priced proposal sees an unfamiliar host. The account
already has validated branding for `ad-helm.com` and `adjustly.org`; SPF and
DKIM are in place. SendGrid → Sender Authentication → Link Branding →
studio-cue.com → two CNAMEs in Cloudflare → Validate.

Do **not** fix it by disabling click tracking:
`functions/src/communications/sendgrid-events.ts` consumes `click`/`open` to
set `clickedAt`/`openedAt`, which drives "They have opened it" on the booking
workspace. `scripts/verify-production-integration-config.sh` already fails on
this and passes once the CNAMEs validate.

### 4.2 The production-write permission
Ten active packages name "GR Productions Videographer(s)" in the description a
client reads on a proposal. The fix is written, read-verified and idempotent at
`~/Documents/studiocue/production-fixes/` — run `fix-copy-and-tasks.mjs`, or
grant the permission and I will. Two malformed task documents go with it.

Parked in the same place: the price list was imported twice (2026-08-14 and
2026-09-17), leaving **nine exact duplicate active packages**. Not a bug — the
same list uploaded twice. Whether to archive the older set or teach the import
to recognise a re-upload is a decision, not a correction.

### 4.3 The crew phone walk (backlog D1)
A live offer is still standing on `conor+rivera@flawlessiq.com` for the Wren
Calloway job, left there deliberately. Sign in as that persona on a phone, open
the offer, hand the session over — I can drive from there: offer card →
acceptance → day-of brief → schedule acknowledgement. Every crew fix so far
came from the studio side or a desktop browser, so this is where the next
cluster of findings is. Cancel and archive that job afterwards.

### 4.4 Housekeeping
- Reconnect Zoom (`ZOOM_REAUTH_REQUIRED` — needs a human through OAuth)
- Void QuickBooks invoice #10 from a dry run

### 4.5 Dated — 2026-09-25, five days out
Two `albumReminders` are scheduled against the archived Iris & Theo wedding.
With `clientOutreachStop` deployed they should move to `skipped` with
`stoppedByProject: "put_away"`, and nothing should reach
conor+iris@flawlessiq.com. **If either says `sent`, the guard did not take.**
Worth checking that morning.

### 4.6 The actual launch gate
`docs/acceptance-pilot.md`. A fresh production tenant, real personas, human
timing (crew accepting inside 15 minutes).
`tests/clean-account-pilot.test.ts` is the synthetic ceiling and has been
reached. This is the last thing between here and launch, and nothing in phases
1–3 substitutes for it.

---

## Sequencing

Phase 1 first, and not because it is the biggest. It is the only item that
changes **where defects are found** — today Cue's problems are found by the
reference studio, because that is the only place Cue runs. Everything else on
this list fixes something that already happened; Phase 1 is the one that
catches the next one.

Then 2, then 3, then ship all three.

Phase 4.1 can happen in parallel and costs ten minutes.
