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

/**
 * Sports drops the client questionnaire — the organiser sets the terms — and
 * the agreement: GR Productions books sports days without one (2026-10-02,
 * docs/job-types-plan-2026-10-02.md).
 */
const SPORTS_KEYS = [
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
/**
 * Real prerequisites. Emphatically not array order.
 *
 * Every wedding checkpoint used to depend on whichever one preceded it in
 * `weddingCheckpointDefinitions`, on the reasoning that "each step waits on
 * the one before it, so a studio can see the order rather than thirteen
 * independent obligations". Ordering is a display concern and this was a gate:
 * all twelve are `blocking`, and `resolveCheckpoint` refuses any completion
 * whose dependency is unsatisfied. So the chain read
 *
 *   contract → retainer → questionnaire → venue → contacts → coi → schedule
 *   → final-balance → crew-accepted → locations → travel → crew-acknowledged
 *
 * and a studio could not confirm the venue until the couple returned their
 * details form, or record their second shooter accepting until the final
 * balance was paid a fortnight before the day. Four studio-owned judgements
 * sat behind client actions, in the order the array happened to be written.
 * The walk of 2026-09-02 hit it on "Venue confirmed" and got
 * DEPENDENCIES_INCOMPLETE for a phone call to a church.
 *
 * It had bitten before: the note on `crew-acknowledged` below records moving
 * that entry last because three -14 checkpoints depended on something not due
 * until -7. That fixed one symptom of the chain and kept the chain.
 *
 * So: declare only what genuinely cannot precede its prerequisite. There is
 * one. Everything else is independent, and a studio may settle its own
 * judgements in whatever order the job actually happens in.
 */
const CHECKPOINT_DEPENDENCIES: Readonly<Record<string, readonly string[]>> = {
  // Acknowledging the schedule requires a schedule to acknowledge. The crew
  // are confirming they have read the timeline they will shoot from, so an
  // approved run of show is a real precondition rather than a tidy order.
  "crew-acknowledged": ["schedule-approved"],
};

/**
 * The four checks a vendor's job carries, under the names a vendor uses.
 *
 * A makeup artist's wedding was given all twelve of a photographer's —
 * venue, travel, locations, crew acknowledging the schedule, a certificate
 * of insurance — and every one was something to tick or waive (simpler
 * vendor journeys, 2026-10-09). What matters to a vendor is that the job is
 * booked, the form is in, the day's plan is set and the balance is paid; the
 * records answer all four (workflow/checkpoint-evidence.ts), so none is a
 * chore. The rest stay in the template library for a studio that wants them.
 */
const ESSENTIAL_NAMES: Readonly<Record<string, string>> = {
  "contract-completed": "Booked",
  "questionnaire-complete": "Planning form in",
  "schedule-approved": "The day's plan set",
  "final-balance": "Balance paid",
};

/**
 * Each check said in a sentence. "Booked must be verified before event
 * readiness" was the photographer's description with the new name dropped in.
 */
const ESSENTIAL_DESCRIPTIONS: Readonly<Record<string, string>> = {
  "contract-completed": "Signed and the deposit paid.",
  "questionnaire-complete": "The client has sent back the planning form with their answers.",
  "schedule-approved": "The plan for the day is laid out and shared with the client.",
  "final-balance": "The balance is paid.",
};

/**
 * The latest each check falls due, in days before the day.
 *
 * Copied from a photographer's, the form was due six weeks out and the day's
 * plan two weeks out — before a DJ's planner is even due back (thirty days)
 * or a makeup artist's party list (thirty-seven), and before the final
 * planning call a week out that a DJ's plan is drawn from. Every vendor job
 * would have shown both overdue while nothing was late. A kind that wants
 * them sooner (a family session's form, a week out) keeps its own date.
 */
const ESSENTIAL_LATEST_OFFSET: Readonly<Record<string, number>> = {
  "questionnaire-complete": -30,
  "schedule-approved": -7,
};

/** What the essentials need to know about how the trade is paid (trades.ts). */
export type EssentialsOptions = {
  /** Days before the day the balance falls due: `balanceDueDaysBefore`. Fourteen when not said. */
  balanceDueDaysBefore?: number;
  /** The balance is collected on the day: `journey.balanceOnTheDay`. */
  balanceOnTheDay?: boolean;
};

export function starterTemplates(
  readiness: "full" | "essentials" = "full",
  options: EssentialsOptions = {},
): StarterTemplate[] {
  if (readiness === "essentials") {
    const balanceDays = Math.max(0, options.balanceDueDaysBefore ?? 14);
    return starterTemplates("full").map((template) => {
      const checkpointTemplates = template.checkpointTemplates
        .filter((checkpoint) => checkpoint.key in ESSENTIAL_NAMES)
        .map((checkpoint) => {
          const { offsetDays } = checkpoint.dueDateRule;
          const latest = ESSENTIAL_LATEST_OFFSET[checkpoint.key];
          const balance = checkpoint.key === "final-balance";
          return {
            ...checkpoint,
            name: ESSENTIAL_NAMES[checkpoint.key]!,
            description: ESSENTIAL_DESCRIPTIONS[checkpoint.key]!,
            // Nobody approves a vendor's plan of the day: the studio lays it
            // out and the client reads it (trades.ts `scheduleApproval`). So
            // it is the studio's to set, and the client still sees it.
            ...(checkpoint.key === "schedule-approved"
              ? {
                  ownerType: "studio" as const,
                  reminderRules: checkpoint.reminderRules.map((rule) => ({ ...rule, recipient: "studio" as const })),
                }
              : {}),
            dueDateRule: {
              ...checkpoint.dueDateRule,
              // Zero, never -0: the day itself, stored as the plain integer.
              offsetDays: balance ? (balanceDays ? -balanceDays : 0) : latest === undefined ? offsetDays : Math.max(offsetDays, latest),
            },
            // A balance collected on the morning cannot hold the job back
            // from being ready for that morning: it stays on the list, and
            // goes overdue if the day passes unpaid, but it is not a blocker.
            ...(balance && options.balanceOnTheDay ? { blocking: false } : {}),
            dependencies: checkpoint.dependencies.filter((key) => key in ESSENTIAL_NAMES),
          };
        })
        // In the order they fall due: a DJ's balance (two weeks out) comes
        // before the plan of the night (one week out).
        .sort((left, right) => left.dueDateRule.offsetDays - right.dueDateRule.offsetDays);
      const checks = checkpointTemplates.map((checkpoint) => checkpoint.name.charAt(0).toLowerCase() + checkpoint.name.slice(1));
      return {
        ...template,
        // "Wedding", not "Wedding Photography": onboarding adds the trade.
        name: template.eventTypeLabel,
        description: `Before the day: ${
          checks.length > 1 ? `${checks.slice(0, -1).join(", ")} and ${checks.at(-1)}` : (checks[0] ?? "nothing to check")
        }.`,
        checkpointTemplates,
      };
    });
  }
  const wedding = weddingCheckpointDefinitions.map((definition) =>
    checkpointFrom(definition, [
      ...(CHECKPOINT_DEPENDENCIES[definition[0]] ?? []),
    ]),
  );
  const subset = (keys: string[]) =>
    wedding
      .filter((checkpoint) => keys.includes(checkpoint.key))
      .map((checkpoint) => ({
        ...checkpoint,
        // A dependency on a checkpoint this template leaves out would be
        // unsatisfiable, and `instantiateWorkflow` throws
        // INVALID_CHECKPOINT_DEPENDENCY on a key it cannot resolve. Keep the
        // real ones the subset still carries; drop the rest.
        dependencies: checkpoint.dependencies.filter((key) =>
          keys.includes(key),
        ),
      }));

  // A family or portrait session: no agreement, paid in full to book, and
  // the details form goes two weeks out, so it is due a week before.
  const portraits = [
    checkpointFrom(["questionnaire-complete", "Session details complete", "Planning", "client", -7, "form_submitted"]),
    checkpointFrom(["locations-confirmed", "Location confirmed", "Logistics", "studio", -3, "manual"]),
  ];

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
        "Organizer-led sports coverage, with crew and locations confirmed ahead.",
      eventTypeId: "sports",
      eventTypeLabel: "Sports",
      checkpointTemplates: subset(SPORTS_KEYS),
    },
    // Every kind of job gets a workflow: "Family & portraits" and "Other
    // event" had none, so readiness never engaged on them
    // (no_active_template; job-types plan, B4).
    {
      name: "Family & Portrait Sessions",
      description: "A light path for sessions: the details form, then the location.",
      eventTypeId: "portraits",
      eventTypeLabel: "Family & portraits",
      checkpointTemplates: portraits,
    },
    {
      name: "Other Events",
      description: "The general shape for any other dated event.",
      eventTypeId: "other",
      eventTypeLabel: "Other event",
      checkpointTemplates: subset(CORPORATE_KEYS),
    },
  ];
}

/** The certificate check's key, in every template that carries one. */
export const INSURANCE_CHECK_KEY = "coi-approved";

/**
 * The certificate check a vendor's job gains when its venue asks for one.
 *
 * A vendor's four checks leave insurance out, because most of their venues
 * never ask (trades.ts `insuranceByDefault`). When one does, the studio says
 * so on the job ("Our venue needs insurance") and the certificate is asked
 * for, chased and sent exactly as a photographer's is — so readiness has to
 * wait for it as a photographer's does. Same key, method and date as the
 * photographer's check, so the records answer it the same way
 * (checkpoint-evidence.ts: sent to the venue, or not required after all).
 */
export function insuranceCheckpointTemplate() {
  const definition = weddingCheckpointDefinitions.find(([key]) => key === INSURANCE_CHECK_KEY)!;
  return {
    ...checkpointFrom(definition),
    name: "Insurance to the venue",
    description: "The certificate of insurance the venue asked for, approved and sent to them.",
  };
}

/**
 * The note on a check waived because a vendor's journey leaves it out
 * (scripts/backfill-vendor-readiness.mts). Distinct from any reason a person
 * gives, so the certificate check it waived can be taken back up when the
 * venue turns out to ask.
 */
export const VENDOR_JOURNEY_WAIVER = "Not part of a vendor's journey";

/**
 * What a job's certificate check needs now: to be added, to be taken back
 * up, or nothing.
 *
 * Only for a trade that leaves insurance to the venue (a photographer's
 * jobs carry the check from the start and are never touched), and only once
 * the venue has asked. A job with no check gains one. A job whose only check
 * was waived for not being part of a vendor's journey has it reopened. Any
 * other check — open, done, failed, or waived by a person for their own
 * reason — is the job's already, and stays as it is.
 */
export function insuranceCheckChange(input: {
  insuranceByDefault: boolean;
  insuranceRequired: unknown;
  checks: readonly { id: string; templateKey: string; status: string; waiverReason?: unknown }[];
}): { kind: "add" } | { kind: "reopen"; id: string } | null {
  if (input.insuranceByDefault || input.insuranceRequired !== "required") return null;
  const carried = input.checks.filter((check) => check.templateKey === INSURANCE_CHECK_KEY);
  if (!carried.length) return { kind: "add" };
  const setAside = (check: (typeof carried)[number]) =>
    check.status === "waived" && check.waiverReason === VENDOR_JOURNEY_WAIVER;
  if (!carried.every(setAside)) return null;
  return { kind: "reopen", id: carried[0]!.id };
}
