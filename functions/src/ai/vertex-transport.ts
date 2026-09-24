import { cloudAccessToken } from "./vertex-token.js";
import { scriptedVertexResponse } from "./vertex-script.js";
import { vertexEndpoint } from "./vertex-endpoint.js";

/**
 * The one place Cue talks to a model.
 *
 * Four call sites in copilot.ts each built the same request and the same error
 * by hand — the structured answer, the streamed answer, the retrieval tool
 * loop, and the intake extractor. That repetition was the seam, and pulling it
 * out is what makes the rest of this file possible.
 *
 * ## Why this exists at all
 *
 * `cloudAccessToken()` reads `metadata.google.internal`, which exists only on
 * GCP. So Cue could not run locally, could not run in staging, and could not be
 * driven by a test — and the four defects fixed in the 2026-09-19 batch were
 * all **turn shape** problems (the subject discarded, a blocker audit
 * outranking the action, the flow rendering last, a completed flow forgetting
 * itself). None of them needed a real model to find. Every one of them was
 * found by reading a production transcript after the reference studio had
 * already hit it, because production was the only place Cue ran.
 *
 * With `PROVIDER_MOCK_MODE=true` this answers from a script instead, in the
 * exact wire shape Vertex uses, so every caller is unchanged and the whole turn
 * — retrieval, answer, flow, the UI that renders it — is walkable offline.
 */

export { DEFAULT_VERTEX_LOCATION, vertexLocationForModel } from "./vertex-endpoint.js";

/**
 * Which model a call should use.
 *
 * A Cue question is not one model call. The retrieval loop runs up to four
 * times deciding *which records to fetch* — mechanical work, no judgement —
 * and each of those calls resends the whole context, so they carry most of the
 * input cost. The final answer is the turn's one act of judgement.
 *
 * Paying the judgement price for the fetching was invisible while tokens went
 * unrecorded. `VERTEX_AI_COPILOT_RETRIEVAL_MODEL` lets the loop run on a
 * cheaper model while the answer keeps the better one; unset, everything uses
 * the answering model exactly as before.
 */
export type VertexPurpose = "answer" | "retrieval";

export function vertexModelFor(purpose: VertexPurpose): string | undefined {
  const answering = process.env.VERTEX_AI_COPILOT_MODEL;
  if (purpose === "answer") return answering;
  return process.env.VERTEX_AI_COPILOT_RETRIEVAL_MODEL || answering;
}

export function vertexUrl(
  method: "generateContent" | "streamGenerateContent",
  purpose: VertexPurpose = "answer",
): string {
  const project = process.env.VERTEX_AI_PROJECT_ID;
  const model = vertexModelFor(purpose);
  if (!project || !model) throw new Error("VERTEX_AI_COPILOT_NOT_CONFIGURED");
  return vertexEndpoint(project, model, method);
}

export function vertexMockMode(): boolean {
  return process.env.PROVIDER_MOCK_MODE === "true";
}

/**
 * One model call, or one scripted answer.
 *
 * Returns the raw `Response` rather than a parsed body, because the three
 * callers read it three different ways — one JSON candidate, an SSE stream, and
 * a tool-call loop — and a transport that understood all three would be the
 * thing it replaced.
 */
export async function vertexGenerate(
  body: unknown,
  method: "generateContent" | "streamGenerateContent",
  purpose: VertexPurpose = "answer",
): Promise<Response> {
  if (vertexMockMode()) return scriptedVertexResponse(body, method);
  const token = await cloudAccessToken();
  return fetch(vertexUrl(method, purpose), {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

/**
 * The failure every caller raised by hand, in one place.
 *
 * Coded, because `copilot.ts` now returns only coded errors to the browser — a
 * studio was once shown the words "fetch failed" as Cue's answer.
 */
export async function vertexFailure(response: Response): Promise<Error> {
  const detail = response.ok
    ? "no response body"
    : await response.text().catch(() => "");
  return new Error(
    `VERTEX_AI_COPILOT_FAILED:${response.status}:${detail.slice(0, 500)}`,
  );
}
