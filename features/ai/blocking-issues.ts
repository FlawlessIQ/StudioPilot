/**
 * Why a prepared AI action can't be approved as it stands.
 *
 * decideAiAction refuses to approve an action with a blocking validation issue
 * (functions/src/ai/actions.ts), except LOW_CONFIDENCE when the studio sends
 * an edit with it. Today offered "Approve" on exactly those actions and the
 * booking brief tried to approve them, so GR Productions got "We couldn't
 * draft this. Try again." on every press, for an AI that hadn't picked a
 * package (2026-09-30). Surfaces read this first and send the studio to where
 * the missing decision is made instead.
 */
export type BlockingIssue = { code: string; message: string; field: string | null };

export function blockingIssues(
  action: object,
  options: { withEdit?: boolean } = {},
): BlockingIssue[] {
  const validation =
    "validation" in action && action.validation && typeof action.validation === "object"
      ? (action.validation as Record<string, unknown>)
      : {};
  const issues = Array.isArray(validation.issues) ? validation.issues : [];
  return issues
    .filter((issue): issue is Record<string, unknown> => Boolean(issue) && typeof issue === "object")
    .filter((issue) => issue.severity === "blocking")
    .filter((issue) => !(options.withEdit && issue.code === "LOW_CONFIDENCE"))
    .map((issue) => ({
      code: String(issue.code ?? ""),
      message: String(issue.message ?? ""),
      field: typeof issue.field === "string" ? issue.field : null,
    }));
}

/**
 * The booking work a person finishes on the booking brief — picking the
 * packages, then drafting the proposal — rather than by approving the AI.
 */
export const BOOKING_BRIEF_CAPABILITIES = new Set(["package_recommendation", "proposal_draft"]);
