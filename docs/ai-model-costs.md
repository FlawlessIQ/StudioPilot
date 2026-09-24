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

Three things in that table are not obvious:

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

| Retrieval model | Answer model | $/turn | vs today | $/1k turns |
|---|---|---|---|---|
| 2.5 Pro | 2.5 Pro | $0.0500 | — today | $50.00 |
| 2.5 Flash | 2.5 Pro | $0.0322 | −36% | $32.20 |
| 3.1 Flash Lite | 2.5 Pro | $0.0309 | −38% | $30.90 |
| 2.5 Flash Lite | 2.5 Pro | $0.0281 | −44% | $28.14 |
| 2.5 Flash Lite | 3.8 Flash | $0.0249 | −50% | $24.89 |

Today's row is the current deployed configuration:
`VERTEX_AI_COPILOT_RETRIEVAL_MODEL` is unset, so 2.5 Pro answers *and* does the
retrieval — paying Pro rates for two calls whose entire job is choosing which
tool to call.

Splitting retrieval onto a Lite model is the whole saving. Which Lite model
barely matters (−36% to −44%); whether retrieval is split at all matters a
great deal. What it costs in quality is a question for `features/ai/cue-eval.ts`,
not for this file — a retrieval model that picks the wrong project is not cheap
at any price.
