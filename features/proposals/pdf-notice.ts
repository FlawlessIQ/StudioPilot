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
      ? "Approved, but the PDF could not be built. You can still send the proposal as a link, or try again."
      : "The PDF could not be built. You can still send the proposal as a link, or try again.";
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
      /**
       * Not "usually finishes within a minute" — it already stopped.
       *
       * This used to end "and the proposal cannot be sent without it",
       * which was true when written and stopped being true when the server
       * started accepting `pdfState: "failed"` on the send path. The
       * confirmation three inches below it already said the opposite —
       * "this sends the branded email with a link to the proposal and no
       * attachment" — so the screen both refused and offered the same
       * action, and the discouraging half was the one an anxious owner read
       * first. See the note at studio-proposal-workspace.tsx on the send
       * branch: "The server allows it now".
       */
      return "Nothing was produced. You can still send the proposal as a link, or try again.";
    default:
      return "We're building the PDF — usually under a minute.";
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
