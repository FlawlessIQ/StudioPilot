/**
 * What sending a message actually did, said as it is.
 *
 * Cue's reply card answered every send with "Sent." — in preview mode, where
 * nothing is persisted and nothing goes; when a coordinator's message about
 * money was held for the owner's approval; and when it had only been queued
 * for the email worker. A studio told "Sent." does not check again.
 *
 * `result` is what `sendCommunicationsCommand` returns. Pure.
 */
export function sendOutcomeCopy(result: {
  mode: "preview" | "live";
  payload?: unknown;
}): string {
  if (result.mode === "preview") return "Preview mode — nothing was sent.";
  const payload =
    typeof result.payload === "object" && result.payload !== null
      ? (result.payload as Record<string, unknown>)
      : {};
  if (payload.requiresApproval === true)
    return "Saved for the owner's approval. It goes to them once it's approved.";
  return "Queued to send — it goes out in a minute or so, and shows in the thread once it has.";
}
