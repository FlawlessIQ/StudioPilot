/**
 * The workflows a studio starts with.
 *
 * A new tenant was created with a subscription, a membership and nothing
 * else — no workflow template, which means `autoInstantiateWorkflow` finds
 * nothing at booking, which means readiness never engages. So the feature
 * that the whole product's sense of "what is blocking this job" rests on
 * was switched off until a photographer went and authored one, in a form
 * that gave them no reason to believe it would do anything.
 *
 * Nobody should have to design their process before their first job. These
 * three are published at signup — one per event type, which is exactly the
 * shape the runtime resolves — so readiness works on day one and the first
 * edit a studio makes is a tweak rather than an authoring exercise.
 *
 * The definitions came from `scripts/seed.ts`, where they had been sitting
 * as demo content: thirteen wedding checkpoints with real stages, owners,
 * offsets and completion methods. They were always the good answer; they
 * were only ever shown to people looking at a demo.
 *
 * Duplicated into `functions/src/workflow/starter-templates.ts` — functions/
 * is a separate package with no "@/features" path. `tests/workflow-starter-
 * templates.test.ts` fails if the two copies drift.
 */

/** key, name, stage, owner, days before the event, how it completes. */
type Definition = readonly [
  string,
  string,
  string,
  "client" | "studio" | "subcontractor",
  number,
  string,
];

export const weddingCheckpointDefinitions: readonly Definition[] = [
  ["contract-completed", "Contract completed", "Booking", "client", -120, "contract_completed"],
  ["retainer-paid", "Retainer paid", "Booking", "client", -120, "invoice_paid"],
  ["questionnaire-complete", "Questionnaire complete", "Planning", "client", -45, "form_submitted"],
  ["venue-confirmed", "Venue confirmed", "Planning", "studio", -30, "manual"],
  ["primary-contacts", "Primary contacts confirmed", "Planning", "studio", -30, "manual"],
  // Derivable, not a judgement: `sendCoiToVenue` writes the very status this
  // reads, and the closeout reconciler already treats sent_to_venue /
  // venue_acknowledged as proof. Declaring it manual made a studio tick
  // something StudioCue had just done itself.
  ["coi-approved", "COI approved and sent", "Insurance", "studio", -21, "system_rule"],
  ["schedule-approved", "Final run of show approved", "Schedule", "client", -14, "schedule_approved"],
  ["final-balance", "Final balance paid", "Payments", "client", -14, "invoice_paid"],
  ["crew-accepted", "Required crew accepted", "Crew", "subcontractor", -14, "assignment_accepted"],
  ["locations-confirmed", "Locations confirmed", "Logistics", "studio", -14, "manual"],
  ["travel-confirmed", "Travel requirements confirmed", "Logistics", "studio", -14, "manual"],
  // Last, at one week out: the crew confirm against a schedule that is by
  // then settled. In the inherited demo ordering this sat mid-list at -7
  // with three -14 checkpoints after it, and because each step depends on
  // the one before, those three could not be completed on time — their
  // prerequisite was not due until a week later. Harmless in a demo
  // nobody drove; not harmless as every new studio's default.
  ["crew-acknowledged", "Crew acknowledged current schedule", "Crew", "subcontractor", -7, "assignment_accepted"],
];

/** A corporate shoot has no venue, no COI and no travel by default. */
const CORPORATE_KEYS = [
  "contract-completed",
  "questionnaire-complete",
  "primary-contacts",
  "schedule-approved",
  "crew-accepted",
  "locations-confirmed",
];

/** Sports drops the client questionnaire — the organiser sets the terms. */
const SPORTS_KEYS = [
  "contract-completed",
  "primary-contacts",
  "schedule-approved",
  "crew-accepted",
  "locations-confirmed",
];

export function checkpointFrom(
  definition: Definition,
  dependencies: string[] = [],
) {
  const [key, name, category, ownerType, offsetDays, completionMethod] =
    definition;
  return {
    key,
    name,
    description: `${name} must be verified before event readiness.`,
    category,
    ownerType,
    assignedUserId: null,
    assignedContactId: null,
    dueDateRule: {
      type: "relative" as const,
      anchor: "event_date" as const,
      offsetDays,
    },
    visibility:
      ownerType === "client"
        ? ("shared" as const)
        : ownerType === "subcontractor"
          ? ("crew" as const)
          : ("studio" as const),
    blocking: true,
    dependencies,
    completionMethod,
    requiredEvidence:
      completionMethod === "manual" ? ["studio approval"] : ["provider evidence"],
    reminderRules: [
      { daysBeforeDue: 7, channel: "email" as const, recipient: ownerType },
    ],
    escalationRules: [{ daysOverdue: 1, notifyRole: "studio_admin" as const }],
    waiverAllowed: true,
  };
}

export type StarterTemplate = {
  name: string;
  description: string;
  eventTypeId: string;
  eventTypeLabel: string;
  checkpointTemplates: ReturnType<typeof checkpointFrom>[];
};

/**
 * One published template per event type.
 *
 * Deliberately not competing: `autoInstantiateWorkflow` resolves by event
 * type, so three templates across three types is the correct shape and
 * none of them shadows another.
 */
export function starterTemplates(): StarterTemplate[] {
  // Each step waits on the one before it, so a studio can see the order
  // rather than thirteen independent obligations.
  const wedding = weddingCheckpointDefinitions.map((definition, index) =>
    checkpointFrom(
      definition,
      // The functions package builds with noUncheckedIndexedAccess, so the
      // previous entry is narrowed rather than asserted.
      index === 0 ? [] : [weddingCheckpointDefinitions[index - 1]?.[0] ?? ""],
    ),
  );
  const subset = (keys: string[]) =>
    wedding
      .filter((checkpoint) => keys.includes(checkpoint.key))
      .map((checkpoint) => ({ ...checkpoint, dependencies: [] }));

  return [
    {
      name: "Wedding Photography",
      description:
        "Everything a wedding needs between booking and the day itself.",
      eventTypeId: "wedding",
      eventTypeLabel: "Wedding",
      checkpointTemplates: wedding,
    },
    {
      name: "Corporate Photography",
      description: "Scope, approvals, crew and delivery for a corporate shoot.",
      eventTypeId: "corporate",
      eventTypeLabel: "Corporate",
      checkpointTemplates: subset(CORPORATE_KEYS),
    },
    {
      name: "Sports Photography",
      description:
        "Organiser-led sports coverage, with crew and locations confirmed ahead.",
      eventTypeId: "sports",
      eventTypeLabel: "Sports",
      checkpointTemplates: subset(SPORTS_KEYS),
    },
  ];
}
