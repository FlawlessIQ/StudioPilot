# StudioCue Clean-Account Acceptance Pilot

The last launch gate in [`production-readiness.md`](./production-readiness.md)
(gate 10) is a **real** acceptance pilot: run one clean production account
through the whole photography lifecycle with real owner, client, and crew
people, and clear every amber gate on **Reports → Release evidence**
(`/studio/reports/release-evidence`).

This is not the synthetic pilot in `tests/clean-account-pilot.test.ts` — that
proves the code holds the authority boundary; it cannot prove the product saves
a real studio time or staffs a real crew quickly. Only real people doing real
work produce that evidence. This document is the script they follow.

## What "accepted" means

Acceptance = the Release-evidence page shows **all five gates green** on the
pilot tenant, **and** you have made a conscious decision about provider health.
Nothing here is cleared by editing data — a gate turns green only when live
records earn it.

### The five gates and the exact evidence each needs

The page runs `features/operations/release-evidence.ts` over the tenant's own
records. What actually flips each gate:

| Gate | Turns green when | Produced by |
|---|---|---|
| **No open S1/S2 defects** | Zero `incidentRecords` with severity S1/S2 left `open`/`investigating` | Log real incidents during the pilot; resolve any S1/S2 before sign-off |
| **No AI authority violations** | ≥1 decided AI action **and** 0 violations (nothing AI-authoritative was executed without human approval) | Use Cue: approve/reject/edit drafts and run the flows (crew, package, questionnaire, proposal draft) |
| **Automation success ≥ 95%** | ≥1 terminal automation run and completed/terminal ≥ 95% | Let real emails and jobs run to completion (invites, questionnaire send, reminders) |
| **Verified handling-time reduction** | ≥1 `handling.session_completed` event with `verifiedSecondsSaved` set and `measurementMethod` ∈ {`timer`, `workflow_timestamps`, `pilot_observation`} | Measure at least one real task (see [Measuring time](#measuring-time-the-one-gate-that-needs-deliberate-capture)) — `owner_estimate` does **not** count |
| **Median staffing < 15 min** | Median of completed crew cascades (`handlingStartedAt`→`handlingCompletedAt`) under 15 minutes | A real crew member accepts a real cascade within 15 minutes |

`ready` also requires **zero failing provider jobs**. On the current test tenant
four are failing — e-signature, accounting, and calendar jobs that have not
completed production OAuth/certification. Decide before the pilot (see
[Pre-flight](#pre-flight), step 4) whether you certify those or run money and
signatures via attestation and accept provider certification as a separate gate.

## Pre-flight

1. **Clean tenant.** Provision a fresh production tenant with no demo/seed data.
   Do not reuse the FlawlessIQ test tenant — its cascades and events carry test
   artifacts (e.g. the 24-hour staffing median) that will drag the gates.
2. **Real personas, real contact details.**
   - **Owner** — the studio operator running the pilot.
   - **Client** — a real inbox you control (couple/planner persona).
   - **Crew** — at least two real people with crew profiles and availability,
     reachable by the email/phone on file, briefed to respond fast.
3. **Measurement discipline.** Nominate one **observer** who records handling
   time as tasks happen. Decide the method up front (timer or observation) and
   keep an evidence log (template at the end).
4. **Integration decision.** Either (a) complete production OAuth + certification
   for Dropbox Sign, QuickBooks, and Calendar per
   [`manual-launch-checklist.md`](./manual-launch-checklist.md) so their jobs
   succeed and provider health goes healthy, or (b) run the contract-signature
   and deposit steps through the booking gate's **"record it"** attestation and
   note in the log that provider certification is deferred to its own gate.
5. **Incident channel.** Agree where S1/S2 issues are logged the moment they
   occur, so the defects gate reflects reality rather than silence.

## The lifecycle walk

Walk the stages in order on the clean tenant. Each stage names the persona, the
real actions, and the gate evidence it produces. Capture timings and anything
that breaks as you go.

1. **Import / setup** *(owner)* — import or create the studio's packages,
   questionnaire templates, and crew profiles + availability. No shortcuts: this
   is what the client and crew will really see.
2. **Inquiry → consultation** *(client → owner)* — client submits a real
   inquiry; owner books a consultation. *(Feeds automation reliability via the
   confirmation email.)*
3. **Proposal → booking** *(owner → client)* — select a package, send the
   proposal, client accepts; complete the contract signature and deposit
   (certified provider **or** "record it" attestation per the pre-flight
   decision). The booking gate must confirm on real evidence. *(Watch the
   provider jobs on Release evidence.)*
4. **Planning** *(owner → client)* — send the planning questionnaire (Cue →
   *Send the questionnaire* flow), client completes it; run the COI request and
   the human review. *(Feeds AI-authority evidence and automation reliability.)*
5. **Crew cascade** *(owner → crew)* — staff a required role via Cue's crew
   flow. **The crew persona accepts within 15 minutes.** This is the only way
   the staffing gate clears; brief the crew member to be at their phone.
   *(Feeds median staffing.)*
6. **Readiness → event** *(owner)* — clear the readiness checkpoints and mark
   the event complete. **Measure a real task here** (see below).
7. **Delivery → review** *(owner → client)* — deliver the gallery, request the
   review; confirm the album-reminder stop condition fires (reminders stop once
   the album is delivered/declined, not forever).
8. **Closeout** *(owner)* — close the project. Confirm no automation is left
   retrying and no S1/S2 incident is open.

## Measuring time (the one gate that needs deliberate capture)

Every other gate is produced as a side effect of doing the walk. Verified
time-reduction is not — it needs an explicit measurement of at least one real
task, recorded with an approved method:

- **`timer`** — use the in-app session timer where the task offers one
  (`handling.session_started` → `handling.session_completed`).
- **`pilot_observation`** — the observer times the task start→finish by the
  clock and records the observed seconds saved versus the studio's manual
  baseline. This is exactly the method the synthetic pilot uses.
- **`workflow_timestamps`** — derived automatically where the workflow records
  start and end (the crew cascade already does this).

Pick one or two high-value tasks the studio does today by hand (e.g. preparing
and sending a proposal, or staffing a second shooter), record the manual
baseline and the StudioCue-assisted time, and log the difference. Do **not**
use `owner_estimate` — the gate deliberately excludes it.

## Acceptance criteria

The pilot is accepted when, on the pilot tenant's Release-evidence page:

- [ ] No open S1/S2 defects — **Pass**
- [ ] No AI authority violations — **Pass** (with a real decided-action sample)
- [ ] Automation success ≥ 95% — **Pass**
- [ ] Verified handling-time reduction — **Pass** (measured, not estimated)
- [ ] Median staffing < 15 minutes — **Pass**
- [ ] Provider health — **Healthy**, or **explicitly deferred** with the
      integration-certification gate tracked separately
- [ ] Every issue found is triaged; no S1/S2 left open

## If a gate stays amber or red

- **Amber (needs evidence)** — the walk did not produce that record. Re-run the
  missing step (usually the time measurement, or a decided AI action). Amber is
  never cleared by editing data.
- **Red (not met)** — a real threshold was missed. Staffing over 15 min means a
  crew member was slow (re-run with a briefed, ready crew) or a stale cascade is
  dragging the median (start clean). Automation under 95% means a job actually
  failed — diagnose it as a real defect, do not paper over it.
- **Provider failing** — an integration is not certified. Either finish its
  OAuth/certification or record the corresponding step via attestation and track
  provider certification as its own launch gate.

## Evidence log template

Keep this with the pilot record; it is the artifact that backs sign-off.

```
Pilot tenant:        __________________________   Date(s): ____________
Personas:            owner ____  client ____  crew ____ / ____
Integration mode:    [ ] certified   [ ] attestation ("record it")

Stage timings / notes
  Inquiry→consult:   __________________________________________________
  Proposal→booking:  __________________________________________________
  Planning:          __________________________________________________
  Crew cascade:      accepted in ____ min  (target < 15)
  Readiness→event:   __________________________________________________
  Delivery→review:   __________________________________________________
  Closeout:          __________________________________________________

Time measurement
  Task measured:     __________________________________________________
  Method:            [ ] timer  [ ] pilot_observation  [ ] workflow_timestamps
  Manual baseline:   ______   Assisted: ______   Saved: ______

Release-evidence result (screenshot attached)
  Gates green: ____/5     Provider health: ____________
  Incidents opened: ____  S1/S2 open at sign-off: ____

Accepted by: ______________________   Date: ____________
```
