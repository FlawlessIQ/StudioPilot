import { logger } from "firebase-functions/v2";
import { vertexEndpoint, type VertexMethod } from "./vertex-endpoint.js";

/**
 * A model call that survives the model being retired.
 *
 * Every Gemini model StudioCue uses is named in functions/.env (Cue, drafting,
 * extraction, scheduling, risk) and Google retires them on its own schedule —
 * Gemini 2.5 went on 2026-10-16. A retired model answers 404, which nothing
 * retried, so the feature behind it simply stopped (2026-10-22 review). Now a
 * 404 alerts once and the same request goes to VERTEX_AI_FALLBACK_MODEL (or
 * the Cue model), so studios keep working while the setting is updated.
 */
export const DEFAULT_FALLBACK_MODEL = "gemini-3.8-flash";

/** The model to try instead of `model`, or null when there is nowhere else to go. */
export function fallbackModelFor(model: string, env: Record<string, string | undefined> = process.env): string | null {
  const fallback = env.VERTEX_AI_FALLBACK_MODEL || env.VERTEX_AI_COPILOT_MODEL || DEFAULT_FALLBACK_MODEL;
  return fallback && fallback !== model ? fallback : null;
}

const warned = new Set<string>();

export async function vertexFetch(
  project: string,
  model: string,
  init: RequestInit,
  method: VertexMethod = "generateContent",
): Promise<Response> {
  const response = await fetch(vertexEndpoint(project, model, method), init);
  if (response.status !== 404) return response;
  const fallback = fallbackModelFor(model);
  if (!warned.has(model)) {
    warned.add(model);
    logger.error("vertexModelUnavailable", {
      studiocueOperationalError: true,
      code: "VERTEX_MODEL_UNAVAILABLE",
      model,
      fallback,
      detail: (await response.clone().text().catch(() => "")).slice(0, 300),
    });
  }
  if (!fallback) return response;
  return fetch(vertexEndpoint(project, fallback, method), init);
}
