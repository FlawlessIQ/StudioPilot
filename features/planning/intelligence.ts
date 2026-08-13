export type PlanningSourceType =
  | "project_fact"
  | "questionnaire_answer"
  | "timing_rule"
  | "package_fact"
  | "crew_fact"
  | "assumption";

export type PlanningSourceReference = {
  type: PlanningSourceType;
  sourceId: string;
  label: string;
};

export type TimingRule = {
  id: string;
  name: string;
  eventTypeId: string;
  anchor: string;
  offsetMinutes: number;
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  active: boolean;
  source: "studio" | "import";
};

export type PlanningFactCategory =
  | "schedule"
  | "family_formals"
  | "vendors"
  | "logistics"
  | "preferences";

export function categorizePlanningFacts(input: {
  responseId: string;
  fields: ReadonlyArray<{ id: string; label: string }>;
  answers: Record<string, unknown>;
}) {
  return input.fields.flatMap((field) => {
    const value = input.answers[field.id];
    if (
      value === null ||
      value === undefined ||
      value === "" ||
      (Array.isArray(value) && value.length === 0)
    ) return [];
    const normalized = `${field.id} ${field.label}`.toLowerCase();
    const category: PlanningFactCategory =
      /family|formal|portrait|group|shot list/.test(normalized)
        ? "family_formals"
        : /vendor|planner|coordinator|dj|florist|venue contact|cater/.test(normalized)
          ? "vendors"
          : /time|timeline|schedule|coverage|ceremony|reception|first look/.test(normalized)
            ? "schedule"
            : /location|address|travel|parking|access|transport/.test(normalized)
              ? "logistics"
              : "preferences";
    return [{
      fieldId: field.id,
      label: field.label,
      category,
      value,
      source: {
        entityType: "questionnaire_response" as const,
        entityId: input.responseId,
        locator: `answers.${field.id}`,
      },
    }];
  });
}

const normalized = (value: unknown) =>
  String(value ?? "")
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, " ");

const projectFactAliases: ReadonlyArray<{
  aliases: string[];
  key: string;
  label: string;
}> = [
  {
    aliases: ["event date", "wedding date", "date"],
    key: "eventDate",
    label: "Project event date",
  },
  {
    aliases: ["venue", "venue name", "ceremony venue"],
    key: "venueName",
    label: "Project venue",
  },
  {
    aliases: ["venue address", "event address", "ceremony address"],
    key: "venueAddress",
    label: "Project venue address",
  },
  {
    aliases: ["client", "couple", "client name", "couple names"],
    key: "clientName",
    label: "Project client",
  },
  {
    aliases: ["timezone", "time zone"],
    key: "timezone",
    label: "Project timezone",
  },
];

export function verifiedQuestionnairePrefill(input: {
  projectId: string;
  project: Record<string, unknown>;
  fields: ReadonlyArray<{ id: string; label: string }>;
}) {
  const answers: Record<string, unknown> = {};
  const provenance: Record<
    string,
    {
      sourceType: "project_fact";
      sourceId: string;
      sourceField: string;
      label: string;
      verified: true;
    }
  > = {};
  for (const field of input.fields) {
    const target = normalized(field.label || field.id);
    const match = projectFactAliases.find((candidate) =>
      candidate.aliases.some((alias) => target === alias),
    );
    if (!match) continue;
    const value = input.project[match.key];
    if (
      value === null ||
      value === undefined ||
      (typeof value === "string" && !value.trim())
    )
      continue;
    answers[field.id] = value;
    provenance[field.id] = {
      sourceType: "project_fact",
      sourceId: input.projectId,
      sourceField: match.key,
      label: match.label,
      verified: true,
    };
  }
  return { answers, provenance };
}

export function evaluateQuestionnaireChange(input: {
  priorAnswers: Record<string, unknown>;
  nextAnswers: Record<string, unknown>;
  priorProvenance: Record<string, unknown>;
  actorType: "client" | "studio";
  now: string;
}) {
  const provenance: Record<string, unknown> = {
    ...input.priorProvenance,
  };
  const changes: Array<{
    fieldId: string;
    before: unknown;
    after: unknown;
    affectsPlanning: true;
  }> = [];
  for (const [fieldId, after] of Object.entries(input.nextAnswers)) {
    const before = input.priorAnswers[fieldId];
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    changes.push({ fieldId, before: before ?? null, after, affectsPlanning: true });
    provenance[fieldId] = {
      sourceType: `${input.actorType}_answer`,
      sourceId: fieldId,
      label: `${input.actorType === "client" ? "Client" : "Studio"} answer`,
      verified: input.actorType === "studio",
      changedAt: input.now,
      changedFrom: before ?? null,
    };
  }
  return { provenance, changes };
}

export function traceScheduleDraft(input: {
  items: ReadonlyArray<{
    id: string;
    title: string;
    sourceReferences?: readonly PlanningSourceReference[];
  }>;
}) {
  const items = input.items.map((item) => {
    const sources =
      item.sourceReferences?.filter(
        (source) => source.sourceId.trim() && source.label.trim(),
      ) ?? [];
    return {
      ...item,
      sourceReferences:
        sources.length > 0
          ? sources
          : [
              {
                type: "assumption" as const,
                sourceId: `assumption_${item.id}`,
                label: "Human-reviewed schedule assumption",
              },
            ],
    };
  });
  return {
    items,
    traceable: items.every((item) => item.sourceReferences.length > 0),
    assumptionCount: items.filter((item) =>
      item.sourceReferences.some((source) => source.type === "assumption"),
    ).length,
  };
}

export function reconcileFinalInvoice(input: {
  packageTotalCents: number;
  taxCents: number;
  retainerExpectedCents: number;
  retainerPaidCents: number;
  providerBalanceCents: number | null;
}) {
  const subtotalCents = input.packageTotalCents - input.taxCents;
  const expectedBalanceCents =
    input.packageTotalCents - input.retainerPaidCents;
  const discrepancies: string[] = [];
  if (input.retainerPaidCents !== input.retainerExpectedCents)
    discrepancies.push("RETAINER_EVIDENCE_MISMATCH");
  if (
    input.providerBalanceCents !== null &&
    input.providerBalanceCents !== expectedBalanceCents
  )
    discrepancies.push("QUICKBOOKS_BALANCE_MISMATCH");
  return {
    lines: [
      {
        label: "Approved package and add-ons",
        amountCents: subtotalCents,
        source: "accepted_package_snapshot",
      },
      {
        label: "Approved tax",
        amountCents: input.taxCents,
        source: "accepted_package_snapshot",
      },
      {
        label: "Retainer payment received",
        amountCents: -input.retainerPaidCents,
        source: "quickbooks_payment_evidence",
      },
    ],
    expectedBalanceCents,
    providerBalanceCents: input.providerBalanceCents,
    discrepancies,
    readyForProviderDraft: discrepancies.length === 0,
    authority: "quickbooks" as const,
    requiresHumanReview: true as const,
  };
}
