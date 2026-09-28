import {
  OUTSIDE_STEPS,
  type OutsideStepId,
  type OutsideStepStatus,
} from "@/features/outside-steps/registry";

/**
 * Handing an outside step to someone else, asking for help with one, and
 * finding one from a question. Plain functions: the guide renders the links,
 * Cue calls the matcher (features/outside-steps, phase 3).
 */

/** What a studio might ask Cue when it means this step. */
const QUESTION_PATTERNS: Record<OutsideStepId, RegExp> = {
  quickbooks_payments_apply:
    /\b(auto-?pay|quickbooks payments|merchant account|save (a|their) card|card on file|charge (the )?card|take (card )?payments)\b/i,
  quickbooks_payments_reconnect:
    /\b(payments? (permission|scope)|reconnect quickbooks)\b/i,
  inquiry_capture:
    /\b(inquiry capture|lead capture|capture (my |the )?(inquir|enquir|leads)|forward(ing)? (my )?(inquir|enquir|form emails?|leads)|(website|contact) form|inquiries (to|into) studiocue|get (my )?(inquiries|enquiries|leads) in)/i,
};

/**
 * The step a question is about, or null. The reconnect step is only named
 * when asked for by name; "how do I set up autopay" starts at the beginning,
 * with the application.
 */
export function outsideStepForQuestion(question: string): OutsideStepId | null {
  const text = question.trim();
  if (!text) return null;
  if (QUESTION_PATTERNS.quickbooks_payments_reconnect.test(text)) return "quickbooks_payments_reconnect";
  if (QUESTION_PATTERNS.quickbooks_payments_apply.test(text)) return "quickbooks_payments_apply";
  if (QUESTION_PATTERNS.inquiry_capture.test(text)) return "inquiry_capture";
  return null;
}

const plain = (value: string) => value.replace(/\*\*([^*]+)\*\*/g, "$1");

/** The step as plain text: what someone else needs to do it without StudioCue. */
export function outsideStepAsText(id: OutsideStepId, studioName: string): string {
  const step = OUTSIDE_STEPS[id];
  const lines = [
    `${step.title} — for ${studioName}`,
    "",
    step.why,
    step.wait ? `How long: ${step.wait}.` : null,
    "",
    ...step.instructions.flatMap((instruction, index) => [
      `${index + 1}. ${instruction.title}`,
      `   ${plain(instruction.text)}`,
      instruction.path ? `   Where: ${instruction.path.join(" → ")}` : null,
      instruction.link && /^https?:/.test(instruction.link.href)
        ? `   Link: ${instruction.link.href}`
        : null,
      instruction.tip ? `   Tip: ${instruction.tip}` : null,
      "",
    ]),
    "Sent from StudioCue.",
  ];
  return lines.filter((line): line is string => line !== null).join("\n");
}

/**
 * "Send these steps to…": the studio's own email, pre-filled. From their
 * address, to someone who knows them — a bookkeeper, a web designer — rather
 * than a StudioCue email a stranger might ignore.
 */
export function shareStepHref(id: OutsideStepId, studioName: string): string {
  const step = OUTSIDE_STEPS[id];
  const subject = `Could you help with this? ${step.title}`;
  const body = `Hi,\n\nCould you do this for ${studioName}? Everything you need is below.\n\n${outsideStepAsText(id, studioName)}`;
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export const SUPPORT_EMAIL = "support@studio-cue.com";

/**
 * "Stuck? Email us": support with the context attached, so the first reply
 * can be an answer rather than "which step, and where are you up to?".
 * Ids only beside the studio's name: no client details travel in it.
 */
export function supportStepHref(
  id: OutsideStepId,
  status: OutsideStepStatus,
  context: { studioName: string; tenantId: string | null; page: string },
): string {
  const step = OUTSIDE_STEPS[id];
  const subject = `Stuck on: ${step.title}`;
  const body = [
    "Tell us where you got stuck:",
    "",
    "",
    "— Context, added by StudioCue —",
    `Step: ${step.title} (${id})`,
    `Where: ${step.where}`,
    `Status: ${status.label}${status.detected ? " (seen by StudioCue)" : ""}`,
    status.since ? `Since: ${status.since}` : null,
    `Studio: ${context.studioName}${context.tenantId ? ` (${context.tenantId})` : ""}`,
    `Page: ${context.page}`,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
