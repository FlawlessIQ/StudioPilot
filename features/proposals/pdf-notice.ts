/**
 * What to say after approving a proposal, given what happened to the PDF.
 *
 * The workspace announced "Approved. The branded PDF is being generated." from
 * a static message map, and the panel two inches below read "PDF generation
 * failed" off the record. Both were on screen at once, and the failing panel's
 * own sub-copy said "The document worker usually finishes within a minute" —
 * reassurance printed over a failure.
 *
 * The record decides. A queued PDF is being generated; a failed one is not.
 */

export type ProposalPdfState =
  | "not_requested"
  | "queued"
  | "ready"
  | "failed"
  | string;

/** The notice for a command whose result includes a PDF state. */
export function proposalPdfNotice(
  approved: boolean,
  pdfState: ProposalPdfState,
): string {
  if (pdfState === "failed") {
    return approved
      ? "Approved, but the PDF could not be generated — sending needs it. Try Regenerate PDF."
      : "The PDF could not be generated, and sending needs it. Try Regenerate PDF.";
  }
  if (pdfState === "ready") {
    return approved
      ? "Approved. The branded PDF is ready."
      : "The branded PDF is ready.";
  }
  return approved
    ? "Approved. The branded PDF is being generated."
    : "A fresh PDF is being generated.";
}

/** The sub-line under the PDF status panel. */
export function proposalPdfDetail(pdfState: ProposalPdfState): string {
  switch (pdfState) {
    case "ready":
      return "Stored privately until this proposal is sent.";
    case "failed":
      // Not "usually finishes within a minute" — it already stopped.
      // Sending is gated on a ready PDF, both here and in the command, so
      // "send it without one" would be advice the product cannot honour.
      return "Nothing was produced, and the proposal cannot be sent without it.";
    default:
      return "The document worker usually finishes within a minute.";
  }
}

/**
 * Whether a notice is still true, given what the record now says.
 *
 * A notice is a snapshot of one command's response; the PDF finishes later.
 * "A fresh PDF is being generated." was still on screen after the worker had
 * failed and the panel beside it had already flipped to "PDF generation
 * failed" — the response was honest when it was written and stale a second
 * afterwards. A notice that promises generation is dropped once the record
 * says it stopped.
 */
export function proposalNoticeStillHolds(
  notice: string | null,
  pdfState: ProposalPdfState,
): boolean {
  if (!notice) return false;
  if (pdfState !== "failed") return true;
  return !/being generated/.test(notice);
}
