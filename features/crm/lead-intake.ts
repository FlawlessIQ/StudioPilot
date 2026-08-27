/**
 * What is genuinely still missing from an inquiry.
 *
 * The lead page rendered "The essential intake details are complete" from
 * `lead.missingInformation` alone — a field the intake writes when it has an
 * opinion and leaves empty otherwise. So an inquiry with no email address and
 * no phone number, whose own Contact panel read "EMAIL Not provided / PHONE
 * Not provided" two inches above, was declared complete.
 *
 * The record is the authority. A couple with no way to reach them cannot be
 * replied to, cannot be sent a proposal, and cannot be invited to a portal, so
 * that gap is named whatever the intake thought.
 */

export type LeadContactFacts = {
  email: string | null;
  phone: string | null;
  eventDate: string | null;
  declaredMissing: readonly string[];
};

const has = (value: string | null): boolean =>
  typeof value === "string" && value.trim().length > 0;

/**
 * The gaps, in the words a photographer would use, most blocking first.
 *
 * Contact routes are one requirement, not two: an inquiry with a phone number
 * and no email is workable, so it is listed only when *both* are absent.
 */
export function leadIntakeGaps(facts: LeadContactFacts): string[] {
  const gaps: string[] = [];
  if (!has(facts.email) && !has(facts.phone)) {
    gaps.push("a way to reach them — no email address or phone number");
  } else if (!has(facts.email)) {
    gaps.push("an email address, needed for the proposal and their portal");
  }
  if (!has(facts.eventDate)) gaps.push("the event date");
  for (const declared of facts.declaredMissing) {
    const label = declared.replaceAll("_", " ").trim();
    if (!label) continue;
    if (gaps.some((gap) => gap.includes(label))) continue;
    gaps.push(label);
  }
  return gaps;
}
