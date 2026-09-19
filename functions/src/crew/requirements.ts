/**
 * What a crew member has to supply before they work a job.
 *
 * This list was written out three times — the cascade screen, the copilot flow
 * and the booking-time staffing plan — each hard-coding liability insurance as
 * required. The reference studio's answer to that was blunt: "Get rid of
 * insurance. Most studios will operate under their insurance. Make them upload
 * their w9!" He is right for his business and wrong for some others, so it is a
 * studio setting rather than a deletion, and it defaults to **off**: a
 * subcontractor is covered by the studio's policy unless the studio says
 * otherwise.
 *
 * Not the venue certificate. `insuranceRequired` on a *project* — requesting a
 * COI and sending it to the venue — is a different obligation, is part of the
 * same studio's own workflow, and is untouched by this.
 *
 * Pure and deterministic.
 *
 * The functions copy. features/crew/requirements.ts is the source of truth;
 * functions/ is a separate package with no "@/features" path, so the rule is
 * duplicated and tests/crew-requirements.test.ts asserts the two files stay
 * byte-identical below their headers.
 */

export type CrewRequirement = {
  id: string;
  name: string;
  kind: "w9" | "insurance" | "acknowledgement";
  required: boolean;
  dueAt: string | null;
  instructions: string;
};

/** How this studio staffs. Absent fields read as the defaults below. */
export type CrewRequirementSettings = {
  /** Off unless the studio turns it on. */
  requireInsurance?: boolean | null;
};

const W9: CrewRequirement = {
  id: "w9",
  name: "W-9 on file",
  kind: "w9",
  required: true,
  dueAt: null,
  instructions: "Upload a current signed W-9 for studio review.",
};

const INSURANCE: CrewRequirement = {
  id: "insurance",
  name: "Liability insurance",
  kind: "insurance",
  required: true,
  dueAt: null,
  instructions: "Upload a current certificate of liability insurance.",
};

const SCHEDULE: CrewRequirement = {
  id: "schedule",
  name: "Current schedule acknowledged",
  kind: "acknowledgement",
  required: true,
  dueAt: null,
  instructions:
    "Review and acknowledge the current schedule before event day.",
};

export function requireInsuranceOf(
  settings: CrewRequirementSettings | null | undefined,
): boolean {
  return settings?.requireInsurance === true;
}

/**
 * The obligations to attach to an offer.
 *
 * The W-9 is not optional — it is how the studio pays them — and the schedule
 * acknowledgement is how they turn up to the right place at the right time.
 * Only the certificate is a choice.
 */
export function crewRequirementsFor(
  settings: CrewRequirementSettings | null | undefined,
): CrewRequirement[] {
  return requireInsuranceOf(settings)
    ? [W9, INSURANCE, SCHEDULE]
    : [W9, SCHEDULE];
}
