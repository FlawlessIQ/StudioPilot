# Copilot conversational flows — design & build plan

_2026-09-08. Owner: copilot / AI command-chat. Related: [ai-command-chat-plan-2026-09-07.md](ai-command-chat-plan-2026-09-07.md), memory `ai-command-chat`._

## 1. Summary

The copilot today has two interaction shapes: **answer** (grounded Q&A) and
**propose** (a one-tap approval card that runs a single, fully-resolved command).
That covers actions where the model can safely resolve everything except the
final yes/no — send this email, create this task, flag insurance.

It does **not** cover actions that need the operator's *judgment and numbers*
mid-flight: staffing a crew (who? what pay?), requesting a COI (which agent?),
picking a package. Today those live in separate workspaces.

This plan adds a third interaction shape: a **conversational flow** — a
multi-turn, AI-orchestrated sequence with embedded input steps:

> **gather** (AI shows real options) → **select** (you choose) → **form** (you
> fill a small form, including any money) → **act** (you send).

The AI does the legwork — noticing the need, fetching real options, pre-filling
everything it safely can — and you supply only judgment and the numbers that
must be yours. It is the primitive that lets the operator *conduct everything
from the copilot without navigating away*, while keeping the one rule below
intact.

## 2. The inviolable rule (unchanged)

**The model never authors money, identities, the recipient, or the decision.**
A conversational flow does not weaken this — it strengthens it, by making the
human-authored parts explicit form fields instead of hidden model output:

- Options shown in a `gather` step are **deterministic reads** of real records
  (real crew, real availability), never model-invented.
- The `select` step is the **human's choice**.
- Any money or terms in the `form` step are **typed by the human**; the model
  pre-fills only safe, derivable values (a role label, an arrival time taken
  from the event's own schedule).
- The `act` step is the **approval tap**, and the server resolves all ids and
  fires the real command with its own authorization — exactly as the one-tap
  cards do today.

## 3. Core concept

### 3.1 A Flow is a sequence of Steps

```
Flow {
  type: FlowType            // "crew_offer" | "request_coi" | "select_package" | …
  projectId: string         // scope-checked; set when the flow launches
  title: string             // "Staff the Smith Wedding"
  steps: Step[]
}
```

Four step kinds cover every case:

| Step   | Who acts | What it is | Data source |
|--------|----------|------------|-------------|
| `gather` | server | fetch + show real options | deterministic read (scope-checked) |
| `select` | human | pick one/many from the options | — |
| `form` | human | fill a small structured form (incl. money) | human input; model pre-fills safe fields |
| `act` | human → server | the approval tap; runs the real command | existing command endpoint |

A flow is usually `gather → select → form → act`, but steps compose: a simple
flow can skip `select` (single option) or `gather` (nothing to fetch); a rich
one can loop `select`+`form` per item (offer three crew at different rates).

### 3.2 The AI's role vs. the flow's role

- **AI (copilot function):** recognizes that a flow is the right response
  (from the conversation, or proactively), **launches** it with the correct
  `type` + scope-checked `projectId`, and provides safe **pre-fill**. That's it.
- **Flow (deterministic):** everything after launch — fetching options,
  collecting the human's choices and numbers, resolving ids, firing the command
  — is deterministic client orchestration over existing read/command endpoints.
  No model output drives an irreversible effect.

This split is what keeps a powerful, open-ended interaction safe: the model's
only new power is *choosing which safe, pre-defined flow to start*.

## 4. Architecture

### 4.1 State ownership — decision: **client-driven, AI-launched (v1)**

A flow is multi-turn, so something holds its in-progress state. Two options:

- **(A) Client-driven (chosen for v1):** the flow lives in a `FlowRunner`
  component in the chat. The copilot returns a **flow directive** in its result;
  the client renders the wizard and calls existing read/command endpoints per
  step. State is ephemeral (the chat turn). Reuses everything; no new
  persistence; ships fast.
- **(B) Server-persisted flows:** flow documents, resumable across devices/
  sessions. More robust but much heavier, and needs its own rules + lifecycle.

**Recommendation: build (A) now, keep (B) as Phase 4** for flows long enough
that losing progress on navigation would hurt. Crew/COI/package flows are short
(seconds), so ephemeral state is acceptable; note the limitation (navigating
away mid-flow restarts it) and revisit if it bites.

### 4.2 The flow directive contract

The copilot's final answer gains an optional `flow` alongside `proposals` /
`actionProposals` (all three are ways the answer can end):

`functions/src/ai/copilot.ts` — `RESPONSE_SCHEMA_JSON` + zod `responseSchema`:

```ts
flow: {                    // optional; at most one per answer
  type: "crew_offer" | "request_coi" | "select_package",
  projectId: string,       // must be in the overview / permitted scope
  reason: string,          // one line shown as the flow's intro
}
```

Server handling (mirrors `buildCommandProposalActions`):
- Validate `type` against a server allowlist and `projectId` against
  `allowedProjectIds` (drop otherwise — a flow for an out-of-scope project never
  launches).
- Return `flow: { type, projectId, title, reason }` in the payload (a new
  `CopilotResult.flow` field). No aiAction is created at launch; the flow's
  `act` step is where an aiAction/command happens.

Client: `AssistantTurn` renders a `<FlowRunner flow={result.flow} />` when
present, exactly where it renders `PreparedActions` today.

### 4.3 Why not make the flow itself agentic?

Each step is deterministic on purpose. The model launches the flow and can
pre-fill, but it does **not** drive step-to-step (no tool-calling loop inside a
flow), because a flow touches money and outward sends and must be predictable.
Determinism here is a feature, not a limitation.

## 5. First flow: `crew_offer` (the template)

Scenario: "Do I need crew for the Smith Wedding?" → the copilot launches the
crew-offer flow.

### 5.1 Steps

1. **gather — available crew.** New read endpoint
   `crewCommand`/query `listAvailableCrew(projectId, role?)` (or a `crmCommand`-
   style read): joins `crewAvailability` (status `available` for the event's
   date/window) with active `crewProfiles` in the tenant. Returns real profiles:
   `{ crewProfileId, userId, displayName, roles, availabilityStatus }`.
   *Deterministic; scope-checked; the model never lists a person.*
2. **select — who + role.** A multi-select `OptionList` of the returned crew;
   the operator picks one or more and the role each is offered.
3. **form — terms.** One compact `FlowForm` per selected crew member:
   - `role` — pre-filled (the role being staffed), editable.
   - `compensationCents` + `compensationType` (`hourly`/`event`) — **human types
     the pay.** `currency` defaults `USD`.
   - `compensationVisibleToCrew` — toggle (studio-pref default).
   - `arrivalAt` / `departureAt` — **pre-filled from the event's schedule /
     event date**, editable.
   - `locations` — pre-filled from the venue, editable.
4. **act — send offers.** "Send N offers" button. For each selection the server
   resolves `scheduleItemIds` + `currentScheduleId` + `currentScheduleVersion`
   from the project's current schedule (deterministic) and fires
   `crewCommand` `inviteAssignment` (single) or `createCrewCascade` (ranked).
   Each is recorded as an aiAction via the existing `recordAiExecution` path, so
   it lands in the audit trail like every other copilot action.

### 5.2 Field authority (the safety contract, made concrete)

| `inviteAssignment` field | Source | Authored by |
|---|---|---|
| `projectId` | flow context | scope-checked |
| `crewProfileId`, `userId` | `select` step (from the real availability list) | human choice |
| `role` | pre-fill, editable | model pre-fill / human |
| `compensationCents`, `compensationType`, `currency` | `form` | **human** |
| `compensationVisibleToCrew` | `form` toggle | human |
| `arrivalAt`, `departureAt`, `locations` | pre-fill from event schedule/venue, editable | records / human |
| `scheduleItemIds`, `currentScheduleId`, `currentScheduleVersion` | resolved server-side from current schedule | records |

No money, id, or recipient originates in the model.

## 6. Generalization

The same Flow/Step abstraction absorbs the other deferred actions — each is
just a different registry entry:

| Flow | gather | select | form (human authors) | act |
|---|---|---|---|---|
| `crew_offer` | available crew | who + role | pay, terms | inviteAssignment / createCrewCascade |
| `request_coi` | venue requirements the AI can find | confirm venue | agent email, coverage limits, dates | createCoiRequest |
| `select_package` | tenant package catalog | which package | add-ons, overrides | selectPackage (→ enables `create_proposal_draft`) |
| `publish_schedule` | current draft schedule | confirm items | timezone, notes | publishSchedule |

Once the primitive exists, each new flow is a registry entry + one read + a form
spec — no new interaction plumbing.

## 7. Client components

New, in `components/ai/`:

- **`FlowRunner`** — owns ephemeral flow state (current step, collected values),
  renders the current step, advances on completion, calls read/command
  endpoints. Renders inside `AssistantTurn`.
- **`FlowOptionList`** — selectable list for `gather`+`select` (single/multi).
- **`FlowForm`** — structured inputs from a field spec (text, money, enum,
  datetime, toggle), with a money component that keeps integer cents.
- **`FlowConfirm`** — the `act` step: summary + "Send N offers" / consequence
  sentence, reusing `approval-consequence` copy.

New, in `lib/ai-flows/`:

- **`flow-registry.ts`** — pure, testable: maps `FlowType` → step definitions,
  the read endpoint for `gather`, the field spec for `form`, and the command for
  `act` (domain:op, mirroring `PROPOSED_COMMAND_ALLOWLIST`).
- **`flow-runner-client.ts`** — thin callers for the per-step reads and the
  final command (reusing `sendCrewCommand`, `runProposalCommand`, etc.).

Styling: reuse the premium card/surface tokens; a flow reads as one evolving
card in the thread, not a modal — it should feel like the conversation
continuing.

## 8. New / changed endpoints

- **Read (new):** `listAvailableCrew(projectId, role?)` — availability + profile
  join, scope-checked. Likely a read branch on `crewCommand` or a dedicated
  query function. *(Confirm at build: is there an existing availability query to
  reuse? `features/crew/availability-moment.ts` + `crewAvailability` exist.)*
- **Read (new, small):** current-schedule resolver so the flow can pre-fill
  arrival/departure and the server can resolve `scheduleItemIds` — may already
  exist inside the crew command; confirm.
- **Commands (reused):** `inviteAssignment`, `createCrewCascade`, `createCoiRequest`,
  `selectPackage`, `publishSchedule` — no changes; the flow assembles their
  inputs from human + records.
- **Copilot (changed):** `flow` field on `RESPONSE_SCHEMA_JSON` + zod schema +
  `CopilotResult`; server validation + passthrough; prompt guidance on when to
  launch a flow vs. answer vs. propose a one-tap card.

## 9. Trust-boundary invariants (must hold in review)

1. A `gather` step only ever renders records returned by a scope-checked read.
2. The model supplies `flow.type` + `flow.projectId` (validated) and pre-fill for
   non-sensitive fields only — never money, ids, or recipients.
3. Every read and the final command enforce their own auth server-side; the flow
   is just a client assembling inputs.
4. The `act` step is an explicit human tap; nothing sends before it.
5. Ids for the command (`crewProfileId`, `scheduleItemIds`, …) come from the
   selected records / server resolution, not from free text or the model.
6. Money stays integer cents end-to-end; the form never round-trips a float.

## 10. Phased build plan

- **Phase 1 — the primitive + `crew_offer`.** `flow` directive contract
  (server + client), `FlowRunner` + `FlowOptionList` + `FlowForm` + `FlowConfirm`,
  `flow-registry`, `listAvailableCrew` read, the crew-offer field spec, and the
  `inviteAssignment`/`createCrewCascade` act. Ship crew end-to-end. _(Largest
  phase — this is the new layer.)_
- **Phase 2 — generalize.** Add `request_coi`, `select_package` (+ unlock
  `create_proposal_draft` after a package is selected) as registry entries on the
  same primitive.
- **Phase 3 — proactive launch.** The copilot suggests starting a flow unprompted
  ("Smith Wedding has no second shooter and is 3 weeks out — want to staff it?"),
  and the daily brief can surface a flow launcher. (Builds on the existing
  proactive brief.)
- **Phase 4 — server-persisted, resumable flows.** Only if ephemeral state proves
  limiting (cross-device, long forms, "come back to this").

## 11. Testing

- **Pure (unit, no Firebase):** `flow-registry` — every `FlowType` maps to a read
  + a field spec + an allowlisted `act` command; a flow whose `act` command is
  not on the command allowlist is rejected (mirrors `proposed-command.test.ts`).
- **Field-authority guard:** a test asserting the crew-offer field spec marks
  `compensation*` as human-input and never model-prefillable (encodes the safety
  contract so a future edit can't silently let the model set pay).
- **Shape:** any aiAction a flow records validates against `aiActionSchema`
  (reuse `copilot-action-shape` patterns).
- **Live (per phase):** on the test tenant — launch → gather shows real crew →
  select → form → send → assignment + email created + recorded.

## 12. Risks & open questions

1. **Availability source of truth.** Confirm how "available on date X" is
   computed (`crewAvailability` status vs. absence of a conflicting accepted
   assignment). The `gather` read must match what the crew workspace considers
   available, or the two surfaces will disagree.
2. **`inviteAssignment` completeness.** It's a heavy payload; Phase 1 must map
   *every* required field to pre-fill, human input, or server resolution (see
   §5.2) or the send 400s (as `createTask`/`setInsuranceRequirement` did — those
   were caught by the retry state, but a flow should validate before `act`).
3. **Ephemeral state.** Navigating away mid-flow loses progress (v1). Acceptable
   for short flows; Phase 4 addresses it.
4. **Model launching the right flow.** Mitigated by a small, explicit flow
   allowlist + the reason line; if the model over-launches, tighten the prompt.
5. **Coexistence with one-tap cards.** Flows are for multi-input actions; one-tap
   cards stay for single-step ones. The answer picks one shape; both can appear
   in a thread over time.
6. **COI coverage limits (Phase 2).** These are legal/money values — the form
   must require the human to enter them; never pre-fill a limit the model
   guessed.

## 13. Recommendation

Build Phase 1 (`crew_offer`) as the reference implementation of the primitive,
then Phase 2 reuses it for COI and packages. Keep the `act` tap permanent. This
is the layer that turns "the copilot can answer and prepare" into "the operator
runs the studio from the copilot" — without ever letting the AI author what only
the operator should.
