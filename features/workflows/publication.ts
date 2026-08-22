/**
 * Which templates a publish supersedes, and what to warn the reader.
 *
 * Two keys were doing one job badly. `createWorkflowTemplate` versioned and
 * superseded by **name**; `autoInstantiateWorkflow` selects at booking time
 * by **event type**. So two differently-named active templates for the same
 * event type both stayed active, tied on version, and the one that actually
 * ran was whichever Firestore returned first — silently, and not
 * necessarily the same one twice.
 *
 * The rule is now: version by name, so a template's own history reads v1,
 * v2, v3; supersede by event type, because "the workflow for weddings" is
 * what the runtime resolves and there can only usefully be one.
 *
 * This module is the pure half — what the form says before you press the
 * button. The command applies the same rule inside its transaction, which
 * is the half that counts; this exists so the interface can promise
 * accurately rather than guess.
 */
export type PublishableTemplate = {
  id: string;
  name: string;
  eventTypeId: string;
  status: string;
  version?: number;
};

export type PublishEffect = {
  /** The version number the new template will carry. */
  version: number;
  /** Active templates this publish will retire. */
  superseding: PublishableTemplate[];
  /** True when this continues an existing template rather than starting one. */
  isNewVersionOf: PublishableTemplate | null;
};

const normalize = (value: string): string => value.trim().toLowerCase();

/**
 * What publishing `input` would do to `existing`.
 *
 * A draft supersedes nothing — it does not run, so it cannot displace
 * anything that does.
 */
export function publishEffect(input: {
  name: string;
  eventTypeId: string;
  status: string;
  existing: PublishableTemplate[];
}): PublishEffect {
  const name = normalize(input.name);
  const eventTypeId = normalize(input.eventTypeId);

  const sameName = input.existing.filter(
    (template) => normalize(template.name) === name,
  );
  const version =
    sameName.reduce(
      (highest, template) => Math.max(highest, Number(template.version ?? 0)),
      0,
    ) + 1;

  // The prior active version of this same template, if any — the thing the
  // reader thinks of as "the one I am replacing".
  const priorSameName =
    sameName.find((template) => template.status === "active") ?? null;

  if (input.status !== "active") {
    return { version, superseding: [], isNewVersionOf: priorSameName };
  }

  const superseding = input.existing.filter(
    (template) =>
      template.status === "active" &&
      (normalize(template.name) === name ||
        normalize(template.eventTypeId) === eventTypeId),
  );

  return { version, superseding, isNewVersionOf: priorSameName };
}

/**
 * One sentence about what pressing publish will do.
 *
 * Returns null when there is nothing worth saying — a first template for an
 * event type displaces nothing, and the button's own label covers it.
 */
export function describePublishEffect(
  effect: PublishEffect,
  eventTypeLabel: string,
): string | null {
  if (!effect.superseding.length) return null;
  const event = eventTypeLabel.toLowerCase();
  const names = effect.superseding.map((template) => template.name);
  const unique = [...new Set(names)];
  const list =
    unique.length === 1
      ? `“${unique[0]}”`
      : `${unique.slice(0, -1).map((entry) => `“${entry}”`).join(", ")} and “${unique.at(-1)}”`;
  return `Publishing replaces ${list} as the workflow for new ${event} jobs. Jobs already running keep the version they started on.`;
}
