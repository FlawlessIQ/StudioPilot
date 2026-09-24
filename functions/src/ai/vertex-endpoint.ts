/**
 * The one place that decides where a Vertex model is served from.
 *
 * Thirteen call sites each built this URL by hand, every one of them shaped
 * `https://${location}-aiplatform.googleapis.com/...` with `location` read from
 * `VERTEX_AI_LOCATION`. That was correct for as long as every model we ran was
 * regional, and it stops being correct on 16 October 2026, when Gemini 2.5
 * retires and the whole product has to move to a line that is served **only**
 * from `global`.
 *
 * `global` is not a region. Its host has no region prefix —
 * `aiplatform.googleapis.com`, not `global-aiplatform.googleapis.com` — so
 * setting `VERTEX_AI_LOCATION=global` on the old code resolves to a hostname
 * that does not exist, and does so identically at all thirteen sites. The
 * migration's first obstacle was never which model to choose.
 *
 * Deriving the location from the *model* rather than from one environment
 * variable is what makes the cutover survivable: extraction can move to 3.x
 * while the copilot stays on 2.5, each purpose proved on its own, instead of
 * one all-or-nothing flip against a deadline.
 */

export const DEFAULT_VERTEX_LOCATION = "us-east4";

/**
 * The major version of a Gemini model id, or null for anything else.
 *
 * Both spellings occur in the wild — `gemini-2.5-pro` and `gemini-3-flash-preview`
 * — so the separator after the major version may be a dot or a dash. Anything
 * that is not a Gemini model (an embedding model, an Imagen model) returns
 * null and keeps the configured region, because the global-only rule below is
 * a fact about the Gemini 3 line and not about Vertex generally.
 */
function geminiMajorVersion(model: string): number | null {
  const match = /^gemini-(\d+)[.-]/.exec(model);
  if (!match) return null;
  const major = Number(match[1]);
  return Number.isInteger(major) ? major : null;
}

/**
 * Gemini 3 and later are global-only; everything else honours the configured
 * region.
 *
 * Expressed as "major >= 3" rather than as a list of model ids so that 3.9 and
 * 4.0 do not each need a code change — and so that the rule reads as what it
 * is, a statement about a product line, rather than as an allowlist somebody
 * has to remember to extend.
 */
export function vertexLocationForModel(model: string): string {
  const major = geminiMajorVersion(model);
  if (major !== null && major >= 3) return "global";
  return process.env.VERTEX_AI_LOCATION ?? DEFAULT_VERTEX_LOCATION;
}

export function vertexHostForLocation(location: string): string {
  return location === "global"
    ? "aiplatform.googleapis.com"
    : `${location}-aiplatform.googleapis.com`;
}

export type VertexMethod = "generateContent" | "streamGenerateContent";

export function vertexEndpoint(
  project: string,
  model: string,
  method: VertexMethod = "generateContent",
): string {
  const location = vertexLocationForModel(model);
  const suffix =
    method === "streamGenerateContent"
      ? "streamGenerateContent?alt=sse"
      : "generateContent";
  return `https://${vertexHostForLocation(location)}/v1/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(model)}:${suffix}`;
}
