# Onboarding & Training Assessment — 2026-09-10

**Question:** Could a brand-new studio owner, with no help from us, understand
how to use StudioCue and know what they need to do?

**Verdict: Partially — not reliably.** The forced parts of the flow (account,
billing, and a single first-run nudge) will get a determined, reasonably
technical owner to first value, and the empty states are polite rather than
blank. But there is **no guided first-run, no product tour, no in-app help or
lifecycle explainer, and the one rich getting-started checklist is dead code.**
A typical solo photographer will hit friction and confusion at several specific
points and would generate support questions. Understanding *what StudioCue is
and how its pieces connect* is largely left to the user to infer.

Assessed from the code (no live account was created — signup is a real,
card-required trial). Evidence cited as `file:line`.

## The new-user path, as built

1. **Register** (`app/auth/register/page.tsx`) → email verification (forced).
2. **Onboarding** — a 4-field form: studio name, legal name, timezone, currency
   (`features/auth/onboarding-form.tsx:194`). Tenant creation is **forced** —
   a user with no memberships is routed here and can't reach the app without it
   (`features/auth/workspace-routing.ts:31`).
3. **Subscription** — a full-page nav to `/studio/subscription`, a card-required
   plan picker; the subscription is created `incomplete` and the app gate blocks
   the workspace until Stripe Checkout completes
   (`onboarding-form.tsx:141`, `functions/src/saas/onboarding.ts:159`).
4. **Land on Today** (`app/studio/page.tsx:10`) — the inbox, not a welcome screen.
5. **First-run nudge on Today** — for a brand-new studio, the hero becomes
   "Let's get you set up." with a card "{n} of 4 answered…" linking to
   `/studio/setup` (`components/today/today-inbox.tsx:269, 387-417`).
6. **Setup conversation** (`/studio/setup`) — four skippable questions: what do
   you charge, what agreement do clients sign, what do you ask couples, when do
   you take consultations (`components/setup/setup-conversation.tsx:33-79`),
   each feeding the import machinery.
7. **Just-in-time gaps** — skipped items resurface in Today only when real work
   is blocked (`features/today/setup-gaps.ts:61-73`).

## What works well

- **The flow is forced and coherent** through account + billing, so nobody
  lands in a half-made state.
- **The Today first-run nudge is genuinely good** — it persists until all four
  setup answers exist (not until the first project, a bug they fixed), and it
  points at an elegant 4-question conversational setup instead of a tool dump.
- **The gaps engine is smart** — it nags only when a real project is blocked,
  respecting a new-but-empty studio instead of scolding it.
- **Starter data prevents the worst dead-ends.** New production tenants are
  seeded with starter **workflow templates** and **questionnaire templates**
  inside the onboarding transaction (`onboarding.ts:191-245`), so readiness
  engages and the "Questionnaire complete" checkpoint isn't a dead-end.
- **Empty states are polite and explanatory**, most with a next-step CTA
  (`components/studio/live-domain-view.tsx:83-92, 760-783`;
  `components/library/library-shelves.tsx:46-85`).
- **"AI prepares, human approves" is taught by osmosis** — reinforced across
  Today lanes, Cue's promise line, and inline copy
  (`today-inbox.tsx:441, 466`; `copilot-workspace.tsx:351`).

## Where a new owner gets stuck (ranked)

1. **The best onboarding checklist is dead code.** `SetupChecklist` — a 5-step
   tracker with progress (preview inquiry form, import offerings, connect
   calendar, create first project, invite team) — lives only inside
   `StudioDashboard` (`components/dashboard/setup-checklist.tsx`,
   `studio-dashboard.tsx:527`), and `StudioDashboard` is **mounted nowhere**
   (grep: zero references outside its own file). The user only ever gets the
   4-question conversation via one Today strip.
2. **Setup is fully skippable and self-demoting.** Every question is skippable
   (`setup-conversation.tsx:79`), and once any job exists the Today prompt
   shrinks to a quiet strip. An owner who creates a project first can leave
   packages/agreement/availability unset and only discover the hole when a job
   silently can't advance.
3. **No packages/agreement/availability seeded**, so core actions dead-end
   early — a studio literally can't price a proposal until it adds a package
   (`setup-gaps.ts:61-73`), and first-run only links to `/studio/import`.
4. **Cue looks like the guide but can't teach the product.** It's grounded in
   tenant *data*, not product knowledge; its prompts are all data queries
   (`copilot-workspace.tsx:44-63`), and on an empty account it auto-asks "What
   needs my attention today?" (`:204`) — which returns near-nothing. A newcomer
   asking Cue "how do I book a client?" gets no tutorial.
5. **No in-app help anywhere.** The studio nav has no Help / Docs / Support /
   Guide entry (`components/layout/app-shell.tsx:48-78`); no tooltips or "learn
   more" on booking, proposals, readiness, crew, or integrations. `/support`
   and `/docs/*` are marketing-site routes, not linked from the workspace.
6. **The core lifecycle and vocabulary are never mapped.** Nothing in-app
   explains Today→Jobs→project, or what "readiness"/"booking gate"/"in motion"
   mean; empty states describe *when* records appear, not *what to do*.
7. **No welcome, tour, or coach marks** beyond the setup nudge (grep found no
   tour libraries). The only "Product tour" link is a pre-signup marketing page.

## Recommendations (prioritized)

**P0 — turn the assistant into the guide (highest leverage, on-brand).**
Cue is already a nav pillar and the product's identity. Give it
product-knowledge grounding so "how do I…" questions get real answers, and seed
the empty-account Cue with onboarding prompts ("Help me set up", "How does
booking work?") instead of data queries that return nothing. This replaces a
bolted-on tour with the assistant the product is built around.

**P0 — make a getting-started checklist actually visible.** Either revive the
dead `SetupChecklist` on Today (or in a persistent nav slot), or fold its five
steps into the Today first-run so progress is always reachable — not a single
strip that shrinks the moment a job appears.

**P0 — add an in-app Help entry** in the studio nav, even if it only links to a
short getting-started guide and the existing marketing docs. Right now there is
nowhere to turn inside the workspace.

**P1 — guard the dead-ends inline.** Where an action can't proceed because setup
is incomplete (e.g. proposal blocked with no package), show the reason and a
one-tap link to fix it, rather than a silent stall.

**P1 — define the vocabulary in place.** Lightweight info popovers on
"readiness", "booking gate", and the phase track the first time they appear.

**P2 — a seeded, explorable example project** (clearly marked, deletable) so the
Today→Jobs→project lifecycle is learnable by doing, not by inference.

## Bottom line

The scaffolding is unusually thoughtful for an early product — forced setup,
a just-in-time gap engine, and honest empty states. The failure mode is not a
broken flow; it's **silence**: the richest checklist never renders, setup is
easy to skip past, the assistant can't teach, and there's no help or lifecycle
map anywhere. Closing the three P0s — Cue-as-guide, a visible checklist, and an
in-app Help entry — would move the answer from "not reliably" to "yes, for most
owners, without our help."
