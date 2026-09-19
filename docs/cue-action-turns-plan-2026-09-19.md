# Cue action turns — execution plan (2026-09-19)

Gabe live-tested Cue and tried four times to put Albert Gershengoren on the
DeMattia wedding as second photographer. It worked on the second attempt and he
could not tell. This plan is about that: **an action asked of Cue should read as
one action, on the thing and the person named, with an outcome that survives a
reload.**

## What happened, from `aiInteractions`

| Time | Asked | Cue |
|---|---|---|
| 19:44:01 | "Can you invite Albert Gershengoren as second photographer on…" | no flow — *"I found 11 matching weddings… Which one should we start with?"* |
| 19:44:56 | "Staff 2nd photographer for 2/6/27" | `flow: crew_offer` launched |
| 19:49:41 | "can we add albert gershengoren to 2nd photogrpaher for erin and joe demattia" | `flow: crew_offer` launched |
| 19:59:20 | "who is my second photographer for erin and joe demattia" | *"An offer has been sent, but it hasn't been accepted."* |

The flows launched and an offer went out. Nothing was broken in the sense of
throwing. The product simply never told him, and buried the one control he
wanted under an audit of six unrelated blockers.

## The four causes

None of these is specific to crew. Each will recur on every flow.

1. **The subject is discarded.** `CopilotFlow` is `{ type, projectId, title,
   reason }`. There is nowhere to carry "Albert". He named him in three of four
   questions and got a generic picker every time. "Use the Gold Cinematic
   package for the Rivera wedding" will collapse the same way.
2. **The blocker audit outranks the action.** `JobObject` renders its full
   `attention` list whenever a project is referenced — six red "blocks" rows
   about final balance, questionnaire and venue, above a staffing request. The
   same rule was already applied correctly to `suggestions`, which are hidden
   when a flow owns the turn; the job card was missed.
3. **The flow renders last** — below verified facts, citations and prepared
   actions. The answer to the question is the furthest thing down the page.
4. **A completed flow forgets it completed.** `sent` is local component state
   and `FlowRunner` has no guard, so re-opening the thread renders the picker
   again as though nothing had happened. This is the most likely reason for the
   repeat attempts.

## Constraints this must not break

- **The model never authors an identifier.** `flow-runner.tsx` states the rule:
  the model chooses a flow type and a project; every option shown is a real
  record and the operator makes the choice. A subject must therefore travel as
  the operator's own words, matched client-side against records already loaded.
- **Nothing sends without a human tap.** Pre-selecting is not pre-sending.
- **The flow schema is deliberately lenient.** A strict schema previously
  rejected whole answers (`VERTEX_AI_PARSE_FAILED on flow.projectId`) and a
  later fix dropped the flow silently. Anything added is optional, and an
  unparseable value degrades to today's behaviour.
- **Cue has no roster tool.** It sees a project overview, `get_project_detail`
  and `find_across_projects` — no list of crew. It cannot resolve "Albert" to an
  id, and should not be given the chance to guess one.

---

## A · The action is the answer

Lowest risk, fixes the confusion Gabe reported. No server change.

**A1 — Move `FlowRunner` directly under the answer.**
`components/ai/copilot-workspace.tsx:700` → above `Verified facts`, citations
and `PreparedActions`.

**A2 — Reduce the job card when a flow owns the turn.**
`JobObject` gains `compact?: boolean`, set from `Boolean(result.flow)`. Compact
keeps identity, date, venue and the stage rail; it drops `attention` and the
readiness segments. The job is still named — the operator must see which job
they are acting on — but six unrelated blockers stop competing with the action.

**A3 — Guard it.** `tests/cue-action-turn.test.ts`: on a result carrying a
flow, the rendered order puts the flow before facts/citations, and `attention`
rows are absent. Asserted against the component source, in the style of
`tests/refresh-after-write.test.ts`.

**Risk:** changes every answer's layout, not only flow answers. Mitigated by
gating strictly on `Boolean(result.flow)` — informational answers are untouched.

---

## B · The subject travels with the flow

This is Gabe's actual complaint.

**B1 — Schema (`functions/src/ai/copilot.ts`).** `flow` gains:

```ts
subject: z.string().max(120).nullish()   // the operator's own words
```

Optional, `.nullish()`, outside the required set — an absent or malformed value
leaves today's behaviour exactly as it is.

**B2 — Prompt.** One sentence: when the operator names a specific person,
package or form, copy their words into `flow.subject` verbatim; never invent or
correct a name, and never emit an identifier.

**B3 — A deterministic matcher** — `features/ai/flow-subject.ts`, pure:

```ts
matchSubject(subject, candidates: {id, name}[]): 
  | { kind: "matched"; id: string }
  | { kind: "ambiguous"; ids: string[] }
  | { kind: "unmatched" }
```

Normalised (case, punctuation, accents), exact-or-all-tokens-present only. No
fuzzy distance: offering a wedding to the wrong person is worse than asking.
Ambiguity resolves to a picker with the near matches first, never a guess.

**B4 — `CrewOfferFlow` consumes it.** On `matched`: pre-select that person,
open on the form step, fill the rate from their profile, and head the panel
"Albert Gershengoren · offering at his standard rate." The send button is
unchanged — the human still presses it. On `unmatched`: say so plainly —
*"Albert Gershengoren isn't in your crew list. Add them under People, or choose
someone below"* — which is the answer Gabe should have had in the first place,
and then the normal picker.

**B5 — The other two flows.** `PackageSelectFlow` matches package names,
`QuestionnaireSelectFlow` template names. Same matcher, same three outcomes.

**B6 — Tests.** `tests/flow-subject-match.test.ts` over the pure matcher:
exact, case/punctuation-insensitive, token-subset ("albert gershengoren" →
"Albert Gershengoren"), ambiguity between two Alberts, unmatched, empty. Plus a
component-source guard that each flow renders the unmatched sentence rather than
silently falling through to a picker.

**Risk:** a wrong pre-selection. Mitigated by exact-or-token-subset matching,
by always naming who was matched, and by never auto-sending.

---

## C · A completed flow stays completed

**C1 — Derive done-ness from records, not component state.** On mount,
`CrewOfferFlow` checks whether this project already carries a live offer for
this role (`draft|invited|viewed|accepted`) — the `spokenFor` set it already
computes. If so it renders the done state — "Second photographer: offered to
Albert Gershengoren, waiting on their answer" — with a quiet "offer someone else
instead" escape, rather than the picker.

This needs no new collection and no server write: the assignment created by the
send *is* the record of what happened, and it is already loaded.

**C2 — Same for the other flows.** A package already selected, a questionnaire
already sent: show what is true rather than the chooser.

**C3 — Test.** Given assignments containing a live offer for the project, the
flow renders the done state; given only `declined`/`expired`, it renders the
picker (re-offering is legitimate — see `features/crew/offer-moment.ts`).

---

## D · The multi-project ask

At 19:44:01 Gabe asked to invite Albert "on [several dates]" and Cue answered
*"I found 11 matching weddings… Which one should we start with?"* — correct
(it must not fan out) but a dead end in prose.

**D1** — when the model declines for ambiguity it should return the candidate
projects as `suggestions`, so the reply is a row of taps rather than a question.
The suggestion machinery already exists and is already suppressed when a flow
owns the turn, so this costs a prompt sentence and nothing else.

Lowest priority: it is a real edge, but one attempt in four.

---

## Order, and why

1. **A** — cheapest, no server change, and it is what made the experience read
   as confusing.
2. **B** — the actual complaint. Needs a deploy of functions (prompt + schema)
   *before* the app, per the deploy order in CLAUDE.md.
3. **C** — stops the repeat attempts that made him doubt it had worked.
4. **D** — if it still grates after the rest.

A and C are client-only. B touches `functions/`, so: functions first, IAM
reconfigure, freshness check, read the deployed bundle, then the app rollout.

## Verification

- Unit tests as above — the matcher is pure and deserves real cases.
- Render the three real questions from the log against a synthetic result in
  mock mode at desktop and 375px, checking the flow is above the fold.
- Then the only test that counts: Gabe re-runs "add albert gershengoren as 2nd
  photographer for erin and joe demattia" and either gets Albert pre-selected
  with one tap to send, or is told plainly he isn't on the roster.

## Open question

**Should a named, matched, unambiguous subject skip straight to the form step,
or still show the picker with that person ticked?** Skipping is what Gabe asked
for and is one tap; showing the picker is more conservative and keeps every
flow shaped the same. This plan assumes skipping, with the person named in the
panel header so the choice is visible and reversible.
