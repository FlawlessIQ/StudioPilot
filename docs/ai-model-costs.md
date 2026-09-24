# Gemini model costs (Vertex AI)

Prices below are pulled from the **Cloud Billing Catalog API**, service
`C7E2-9256-1C43` (Vertex AI) — not from documentation or third-party
write-ups, both of which have been wrong about this in the past. Re-derive
them rather than trusting this file after a quarter:

```bash
gcloud auth print-access-token > /tmp/gt.txt
# then GET https://cloudbilling.googleapis.com/v1/services/C7E2-9256-1C43/skus
```

Match SKU descriptions **exactly**. `startswith("Gemini 3.5 Flash")` also
matches "Gemini 3.5 Flash Lite", which is a different model at a fifth of the
price, and the catalog carries Off-Peak, Flex, Priority, Batch, Long-context
and Tuned variants of nearly every row. Only `… Text {Input,Output} -
Predictions` is standard on-demand.

## Standard on-demand, $ per 1M tokens

| Model | Endpoint | Input | Output | Status |
|---|---|---|---|---|
| Gemini 2.5 Flash Lite | regional | $0.10 | $0.40 | GA |
| Gemini 3.1 Flash Lite | global | $0.25 | $1.50 | GA |
| Gemini 2.5 Flash | regional | $0.30 | $2.50 | GA |
| Gemini 3.5 Flash Lite | global | $0.30 | $2.50 | GA |
| Gemini 3 Flash | regional | $0.50 | $3.00 | preview |
| Gemini 2.5 Pro | regional | $1.25 | $10.00 | GA |
| Gemini 3.6 / 3.7 / 3.8 Flash | global | $1.50 | $7.50 | GA |
| Gemini 3.5 Flash | global | $1.50 | $9.00 | GA |
| Gemini 3.0 / 3.1 Pro | global | $2.00 | $12.00 | preview |

## The deadline

**Gemini 2.5 Pro, Flash and Flash-Lite retire on October 16, 2026.** That is
in the Vertex AI release notes, published April 2, 2026: *"The retirement dates
for Gemini 2.5 Pro, Gemini 2.5 Flash-Lite, and Gemini 2.5 Flash have been
updated to October 16, 2026."*

Two traps in confirming this, both of which caught this analysis first time:

- The **deprecations index** does not list it, and neither does the model
  lifecycle page. The date lives only in the release notes. Not finding it on
  the obvious page is not evidence it does not exist.
- The **Gemini API and Vertex AI disagree.** `ai.google.dev` still says "No
  shutdown date announced" for stable `gemini-2.5-pro`. That is the other
  product. We are on Vertex. Google's own Vertex pages also disagree with each
  other — release notes say October 16, the lifecycle page says October 20 —
  so plan against October 16.

**StudioCue no longer runs any Gemini 2.5 model.** Migrated 23 September 2026:

| Purpose | Was | Now |
|---|---|---|
| Copilot answer | `gemini-2.5-pro` | `gemini-3.8-flash` |
| Copilot retrieval | (the answer model) | `gemini-3.1-flash-lite` |
| Drafting | `gemini-2.5-flash` | `gemini-3.5-flash-lite` |
| Extraction | `gemini-2.5-flash` | `gemini-3.5-flash-lite` |
| Risk | `gemini-2.5-flash` | `gemini-3.5-flash-lite` |
| Schedule | `gemini-2.5-flash` | `gemini-3.5-flash-lite` |

Before the switch, each candidate was called against `studiohub-prod` for every
capability the product actually depends on — a 256-token thinking budget, a
`responseSchema` structured output, a `functionDeclarations` tool call, and a
PDF read — because "it is a newer Gemini" is an assumption and the certificate
extractor reading a document is not a thing to assume. All four worked on all
four models. `VERTEX_AI_LOCATION` now applies only to Gemini 2.x and
non-Gemini models, and is consulted nowhere else.

## The blocker is the endpoint, not the model

The 3.x line is served **only from `global`**, and `global` uses a different
host from a regional endpoint — `aiplatform.googleapis.com`, not
`us-east4-aiplatform.googleapis.com`. Setting `VERTEX_AI_LOCATION=global`
today produces `global-aiplatform.googleapis.com`, which does not resolve.

There are **nine** hardcoded `${location}-aiplatform.googleapis.com` template
strings across `functions/src` (copilot, schedule, communications,
signed-agreement, studio-import, and four in `operations/ai-pdf.ts`; one of
them defaults to `us-central1` rather than `us-east4`, which is its own latent
bug). Every one breaks on `global`.

So the migration's first step is not choosing a model. It is deriving host and
location **from the model** in one place, so a single purpose can move to 3.x
while the rest stay on 2.5. Without that, the cutover is all-or-nothing on a
deadline, which is the worst possible shape for it.

All six candidate models were probed against `studiohub-prod` on `global` and
all six answered. The path works; only the URL builder is in the way.

## Three things in the price table are not obvious:

- **3.5 Flash is dearer than 3.6, 3.7 and 3.8.** Newer is cheaper here, which
  is the opposite of the usual assumption. There is no reason to run 3.5.
- **The 3.x Flash tier costs more than 2.5 Pro on input** ($1.50 vs $1.25) and
  less on output ($7.50 vs $10.00). Whether it saves anything depends entirely
  on a workload's input:output ratio. Ours is input-heavy, so it does not.
- **2.5 Pro is the only GA Pro model.** Every 3.x Pro is `-preview`, which is
  not something to put under a studio's billing.

Regional models are unavailable on `global` and vice versa. The 3.x line is
`global`-only, and `VERTEX_AI_LOCATION` is `us-east4`, so moving to any 3.x
model needs a location override before it needs anything else.

## Other tiers

- **Flex** is exactly 50% of standard across every 3.x model, in return for a
  deferred SLA. That is the largest single discount available and it is
  unusable for an interactive copilot turn — but it is the right tier for any
  batch AI we add later (overnight extraction, bulk summarisation).
- **Priority** is 1.8×. Nothing we run justifies it.
- **Off-Peak** (3.5–3.8 Flash only) is also 50%, on Google's clock, not ours.
- **Long-context** rates apply above the standard window and are roughly 1.5–2×.
  Our turns are far below the threshold.

## What a turn costs

The copilot makes ~3 model calls per turn: two retrieval calls that carry most
of the *input* (project overview, tool schemas, tool results — client messages
alone run to ~4k tokens), and one answer call that carries most of the
*output* (prose plus thinking tokens, which are billed as output).

`recordUsage` in `functions/src/ai/copilot.ts` now writes real per-turn token
counts to `aiInteractions/{id}.diagnostics.tokens`. **Until a week of those
have accumulated, the split below is an estimate** — ~14k in / 0.6k out for
retrieval, ~6k in / 1.9k out for the answer.

| Retrieval model | Answer model | $/turn | vs today | Status |
|---|---|---|---|---|
| 2.5 Pro | 2.5 Pro | $0.0500 | — today | **retires Oct 16** |
| 3.1 Flash Lite | 3.6 / 3.7 / 3.8 Flash | $0.0277 | −45% | GA |
| 3.5 Flash Lite | 3.8 Flash | $0.0290 | −42% | GA |
| 3.1 Flash Lite | 3.5 Flash | $0.0305 | −39% | GA |
| 3.1 Flash Lite | 3.1 Pro | $0.0392 | −22% | preview |

There is **no GA Pro model on 3.x** — every 3.x Pro is `-preview`. So the
copilot's answer model cannot move Pro-to-Pro. It either drops to a 3.x Flash
(GA, and cheaper on output than 2.5 Pro) or takes on preview risk for a model
that costs more than the thing it replaces. The Flash tier is the answer.

A probe of a trivial prompt shows why the retrieval/answer split survives the
migration: 3.6/3.7/3.8 Flash each burned 55–83 **thinking** tokens on "reply
OK", while 3.1 and 3.5 Flash Lite burned zero. Thinking is billed as output.
Flash Lite does not reason and should never write the answer; it is exactly
right for choosing which tool to call.

For the other four purposes, all on 2.5 Flash today, **3.5 Flash Lite is the
price-identical swap** ($0.30/$2.50, matching 2.5 Flash to the cent) and 3.1
Flash Lite is cheaper on both axes. Google's suggested replacement for 2.5
Flash is 3.6 Flash, which costs 5× the input and 3× the output — do not take
that recommendation without reading the price.

Today's row is the current deployed configuration:
`VERTEX_AI_COPILOT_RETRIEVAL_MODEL` is unset, so 2.5 Pro answers *and* does the
retrieval — paying Pro rates for two calls whose entire job is choosing which
tool to call.

Splitting retrieval onto a Lite model is the whole saving. Which Lite model
barely matters (−36% to −44%); whether retrieval is split at all matters a
great deal. What it costs in quality is a question for `features/ai/cue-eval.ts`,
not for this file — a retrieval model that picks the wrong project is not cheap
at any price.
