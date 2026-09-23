# Execution plan — 2026-09-23

Everything open after the UAT walk, the fixture audit, the crew phone walk, the
Cue scaffolding and today's review of the approval card.

Ordered by leverage, not by size. The rule from the last plan still holds: a
change that moves **where defects are found** beats a change that fixes one
defect. Phase 2 is the only item here that does that, and it is the one to do
first if only one gets done.

---

## Phase 0 — The approval card, one sitting

From reviewing a real Cue turn on production. All small, all visible, and the
first two are one change each.

| # | Change | Where |
|---|---|---|
| 0.1 | **The card's headline is the action, not the reason.** `title: (proposal.rationale \|\| label)` puts the justification in the headline and demotes "Draft a proposal for Erin & Joe DeMattia Wedding" — the only line saying what Approve does — into the box below. Swap them. | `functions/src/ai/copilot.ts:1340` |
| 0.2 | **Drop "70% confidence."** Hardcoded `0.7` at both construction sites, so every card has always read 70%. It carries no information and invites a judgement it cannot support. | `copilot.ts:1197`, `:1367`, `ai-approval-queue.tsx:288` |
| 0.3 | **Stop printing the reason twice.** With 0.1 done the rationale belongs once, inside "Why StudioCue prepared this" — which is currently the only place it is *not*. | `ai-approval-queue.tsx:383` |
| 0.4 | **Say the job name once.** It appears three times in one card: the job chip above, the card subtitle, and the inner title. | `ai-approval-queue.tsx` |
| 0.5 | **Suppress the suggestion chip that duplicates an attached action.** "Create the proposal?" sat directly above a card offering to draft the proposal — two affordances, one action, different semantics. The prompt already suppresses suggestions when a flow is set; extend that to action cards. | `COPILOT_SYSTEM_INSTRUCTION` |

**Not in this phase, because it needs a decision:** Reject and Dismiss are two
unexplained "no" buttons (`rejected` / `dismissed` server-side, identical on
screen), with Snooze — the only explained one — between them. See Phase 5.

The 70% number is the crew cascade's deleted score wearing a different hat. The
reasoning is already written down in `crew-cascade-workspace.tsx`: *"A number
implying precision the data does not have is worse than the order itself."*

---

## Phase 1 — Gabe's account is not using what he asked for

He asked for videographers, we built it, and on his data it is inert. Read off
production 2026-09-22:

| | His account |
|---|---|
| Active packages | 9, **0 carrying videographer coverage** |
| Crew profiles | 1 (Albert), **trades unset** |
| Imported contracts | 10, **1 with a signed copy attached** |

His packages describe videographers in their text; the structured coverage
behind all nine still says photographers, and that is what drives who gets
offered the job, what the couple sees, and the retainer on a per-crew package.

- **1.1 Backfill the nine packages** rather than asking him to re-save each by
  hand. Coverage gains the field only on the next save, which is why nothing
  moved. Idempotent, read-verified, and he approves before it runs.
- **1.2 Tell him the four things to switch on** — package counts, Albert's
  trade, adding his videographers, the nine contracts. A feature list invites
  "thanks"; a switch-on list gets used.

---

## Phase 2 — The feedback flywheel *(do this one)*

Today the path from "Gabe hit something odd" to "a test that prevents it" runs
through a person reading a transcript. That is the bottleneck, and it is why
the ampersand bug took two attempts and an audit to actually fix.

Every turn now records what the model asked for, which tools ran and which
records it saw. Add one control on a turn — *this wasn't right* — and capture
that bundle with the question. It becomes a scenario in
`tests/cue-eval.test.ts` without anyone watching.

**Done when** a rejected turn produces a runnable eval case, and the eval set
has grown from something other than me writing it.

---

## Phase 3 — Safety that does not depend on the model behaving

One injection payload, on one vector, on one model, declined cleanly. That is
not a property, it is an anecdote.

- **3.1 A deterministic output guard.** If an answer contains crew emails or
  rates and the question was not about crew, refuse to render it and log it.
  Model-independent, cheap, and turns "we tested it once" into something
  standing.
- **3.2 A red-team suite of twenty, not one.** Jailbreak phrasings, payloads in
  different fields, non-English, encoded. Run nightly against the real model.
- **3.3 Keep the enum closed.** Already guarded by
  `tests/untrusted-content.test.ts`. Worth restating as policy: fencing bounds
  what an injection can make Cue **say**; the three-command enum bounds what it
  can make Cue **do**, and it is the load-bearing one.

---

## Phase 4 — Reach and answer quality

**4.1 Widen what Cue can see.** It cannot read client messages, questionnaire
answers or leads, so it cannot answer *"what did the couple actually ask
for?"* — among the most natural questions a photographer has, and one where the
records genuinely beat memory. That narrowness was right when nothing marked
untrusted text; with fencing in place it is now a limitation. Open messages and
questionnaire answers next, fenced, and measure.

**4.2 Never restate what the page already shows.** Most hollow answers are
restatements of visible state. Bias toward what is *unusual* or *next* and Cue
stops competing with the job page.

**4.3 Per-studio vocabulary.** Gabe types "2nd photogrpaher" and shortens every
couple's name. A learned alias list per tenant, feeding the matchers, would have
prevented the whole name-matching thread — and it is deterministic, not model
work.

**4.4 Say when it does not know.** "I cannot see the client's messages" beats a
confident guess.

**4.5 Show me why.** Click a verified fact, see the record behind it. Facts and
citations already render; making them traceable turns trust from a claim into
something checkable.

**4.6 Cue where the question is.** On the job page, not only its own tab.

---

## Phase 5 — Decisions, then work

Each of these is a product call first.

- **Reject vs Dismiss.** What should each mean? Suggested: *Reject* = the
  suggestion was wrong (and feeds Phase 2); *Dismiss* = fine, not now. Whatever
  is chosen, the card must say it.
- **More flows.** Chasing an unsigned contract, requesting a COI, rescheduling
  a consultation are all natural. Each widens the injection surface, so the
  shape matters more than the count: prepare-then-approve only.
- **Model routing.** Pro for action turns, Flash for lookups. You are paying Pro
  prices for "how many weddings in June". Worth doing *after* Phase 2, so the
  eval can show whether it costs anything.
- **Limits and a kill switch.** Per-tenant rate and spend caps, and a switch
  that degrades Cue to read-only rather than erroring.

**What not to do:** make Cue more autonomous. The closed enum is why today's
injection was survivable and why the destructive scenarios were structurally
safe. The north star is "AI prepares, human approves" — treat that enum as a
load-bearing wall.

---

## Phase 6 — Only you can do these

- **The acceptance pilot.** Needs a fresh tenant (so a payment-path decision,
  since the comped list is now just the reference studio), two crew briefed to
  be at their phone, a real client inbox, an observer with a stopwatch, and the
  certify-or-attest call on integrations. I can do the owner-side setup so the
  people only spend time on the parts that need people. See
  `acceptance-pilot.md`, including the rehearsal note.
- **The crew closeout path** — hours, expenses, deliverables. Unreachable until
  after an event.
- **Zoom.** Review still open with them; nothing to do but wait.
- **Gabe's QuickBooks test connection**, and he has never connected Zoom.
- **The price-list re-upload question** — a decision, not a defect.

## Loose ends

- The remaining Cue scenarios in `cue-scenarios.md`: groups C, D, E, G, I and J
  are unrun. D (a question must not launch a flow) and J (the trade dimension)
  are the two worth doing next.
- The UAT tenant carries two deliberate artifacts: the injection task on the
  DeMattia job, and a false `schedule: complete` on Marco's assignment. Both
  disposable; recorded so nobody mistakes them for real.
