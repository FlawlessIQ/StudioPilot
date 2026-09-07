# AI command chat — plan (2026-09-07)

## The ask
A single chat surface where the studio owner talks to an assistant — like Claude
or ChatGPT — and **gets everything done**: asks questions, gets answers grounded
in their real studio data, and has work carried out (emails drafted *and sent*,
proposals prepared, next steps advanced) from the conversation.

## Verdict: yes — and most of the spine already exists
This is StudioCue's north star ("AI prepares, human approves") made into a single
surface. It is **not** a greenfield agent build. The primitives are already here:

| Need | Already built |
|---|---|
| Conversational input + drafting | `functions/src/ai/copilot.ts` (`aiCopilotCommand`: ask / project-intake extract / proposal draft), `components/ai/copilot-workspace.tsx`, `/studio/copilot` ("Ask or create") |
| AI produces a *structured, executable* action | `aiActions` records carry `structuredOutput` + `downstreamCommand` + `capability` + `validation.issues` |
| Human approves → the action executes | `aiActionCommand` + `requireReviewer` runs the `downstreamCommand` on **approve** (rejects on unresolved blocking issues) |
| Approval surface | `/studio/ai-queue` ("AI review") |
| Safe model calls | `AiProvider` (routing task + Zod output schema, rejects on schema failure), `consumeAiQuota` (entitlement), audit events |
| The actual work | the command endpoints — `crmCommand`, `planningCommand`, `bookingCommand`/`proposalCommand`, `communicationsCommand`, `crewCommand`, … |

The feature = wrap these in a **conversational agent loop** and a **chat UX with
inline approval cards**, replacing the current split between "copilot" (ask/draft)
and "ai-queue" (approve) with one thread.

## The one inviolable rule — which is also the selling point
**AI prepares, the human approves, the command executes.** The agent reads and
drafts freely, but every *side-effectful or irreversible* action is an inline
approval card the owner taps:

- **Immediate (no card):** retrieval/answers, and pure drafts (nothing leaves the
  studio, nothing changes state).
- **Approval card required:** send/queue an email or message, send a proposal,
  request an e-signature, advance a project stage, create/modify a project or
  lead, invoice or charge, delete, change permissions/roles.

On approve, the **existing downstream command runs with the owner's own identity**
and passes every server-side check (identity → tenant → role → assignment →
entitlement → schema). The agent gets **no privilege the owner doesn't already
have**, and the browser still never authorizes a mutation. The AI never sends on
its own. This is the product promise — *"it drafts everything and sends the moment
you say so"* — not a limitation, and it keeps the trust boundary intact.

## Architecture
```
 chat (stream)                orchestrator (tool loop)              existing layer
 ────────────      ───────────────────────────────────────      ───────────────────
 owner types  ──▶  Claude + tool registry                        (unchanged)
                    ├─ READ tools  ─── run now ───────────────▶  tenant-scoped repos
                    │   (projects, readiness, schedule,          (server/repositories,
                    │    messages, clients, invoices)             TenantRepository)
                    │        ◀── grounded facts ────────────────
                    └─ ACT tools  ── emit a proposal ─────────▶  aiActions record
                                     (structuredOutput +          (+ validation)
                                      downstreamCommand +
                                      capability)
 approval card ◀──────────── proposal ────────────────────────
 owner approves ─────────────────────────────────────────────▶ aiActionCommand
                                                                 → downstreamCommand
                                                                 (full authz, idempotent,
                                                                  audited)
```

- **Orchestrator** (evolve `functions/src/ai/copilot.ts`, or a new `functions/src/ai/agent.ts`):
  a tool-use loop over `AiProvider`. Two tool classes:
  - **Read tools** execute immediately against tenant-scoped repositories and
    return facts to the model. This is the *grounding* — answers are about the
    studio's real projects/readiness/schedule, not invented.
  - **Act tools** map 1:1 to existing command endpoints. The agent does **not**
    call them; it emits an `aiActions` proposal (validated by the command's own
    Zod schema), which becomes an approval card. Approve → `aiActionCommand`
    executes the `downstreamCommand` — the loop that already exists.
- **Reuse, don't rebuild:** `AiProvider` (schema-validated), `consumeAiQuota`
  (charge entitlement before the model runs), `requireReviewer`, the command
  endpoints, audit events, idempotency keys.
- **Grounding context pack:** the orchestrator assembles a tenant-scoped snapshot
  (the current project/thread, what's outstanding, readiness) so the model starts
  oriented; read tools fill in the rest on demand.

## UX
- Evolve `/studio/copilot` ("Ask or create") into the primary **assistant thread**:
  streaming replies, inline **approval cards** (Preview · Edit · Send), a visible
  ledger of what was done, and context chips (which job the chat is about).
- Unify with `/studio/ai-queue`: a card approved in chat and one in the queue are
  the **same `aiActions` record** — the queue becomes the asynchronous view of the
  same proposals.
- Fits the "Today & Jobs" direction already in motion (inbox-first Today, job
  threads, conversational setup): the chat is the conversational spine those point
  toward. From Today, "handle this" opens the assistant with that job in context.

## Trust & safety mapping (explicit)
- **AI-write-boundary preserved:** the model may DRAFT but never WRITE legal /
  payment / signature / permission / readiness-completion fields — those only move
  through a human-approved command. (Same rule as today's `ai-write-boundary` test.)
- **Every outward/irreversible action is approval-gated;** reads and pure drafts
  are free.
- **Idempotency** on every executed command; **audit** both the proposal and the
  execution; **entitlement/quota** charged before the model runs.
- **Tenant isolation** via the existing command authorization; the agent runs as
  the owner, with no elevation and no cross-tenant reach.

## Phasing
1. **P1 — Conversational read + grounding.** Ask about the studio, summarise a job,
   "what needs my attention today", retrieval tools only, **no mutations.** Proves
   grounding accuracy and the loop. Lowest risk.
2. **P2 — Draft-and-propose (the core of the ask).** Compose emails / messages /
   proposals / replies as approval cards → existing send commands on approve.
   *"Chat drafts everything; you send with one tap."*
3. **P3 — Multi-step orchestration.** "Prep the Smith wedding's next steps" → the
   agent chains drafts (schedule, COI request, client update) as a batch of
   approval cards (approve each / approve all).
4. **P4 — Proactive.** The agent surfaces the day's needed actions (ties to Today /
   attention ordering), still approval-gated.

## Non-goals / guardrails
- Not an autonomous sender. Not a bypass of the command layer. Not a writer of
  protected fields. Not cross-tenant. Not unbounded (entitlement-gated, rate-limited).

## Effort / risk
- **L, multi-week, phased.** The mutation layer is reused, so risk concentrates in
  orchestration quality, grounding accuracy, and the approval UX — not in
  authorization. Guards to land with it: a tool-registry test (the agent can only
  propose whitelisted act-tools, each mapping to a real command + capability), the
  protected-field boundary test extended to the agent path, and an e2e for
  propose → approve → execute.

## Open product decisions (for Conor)
1. **Surface:** evolve `/studio/copilot` into the main assistant (my recommendation),
   or a new home and keep copilot separate?
2. **First act-tools (P2):** which commands to expose first. Suggested: send/queue
   client & crew messages, draft + send proposal, advance a stage, create
   project/lead.
3. **Approval granularity:** per-action cards vs. a "review all proposed steps"
   batch for multi-step (P3).
4. **Autonomy dial (later):** ever let a few low-risk actions (internal note,
   schedule *draft*) execute without a card? Default: no — everything outward is
   approved.

## Where to start
P1 is the safe, fast proof: a grounded read-only assistant in the existing copilot
surface. It de-risks grounding and the tool loop before any mutation is exposed,
and P2 (the "drafts and sends" core) builds directly on it.
