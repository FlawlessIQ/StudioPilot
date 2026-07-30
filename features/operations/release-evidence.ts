export type EvidenceRecord = Record<string, unknown> & { id?: string };

export type ReleaseGateStatus = "passed" | "failed" | "needs_evidence";

export type ReleaseGate = {
  key:
    | "critical_defects"
    | "authority_boundaries"
    | "automation_reliability"
    | "verified_time_reduction"
    | "crew_staffing";
  label: string;
  status: ReleaseGateStatus;
  evidence: string;
};

type ReleaseEvidenceInput = {
  productEvents: EvidenceRecord[];
  aiActions: EvidenceRecord[];
  actionReceipts: EvidenceRecord[];
  automationRuns: EvidenceRecord[];
  crewCascades: EvidenceRecord[];
  providerJobs: EvidenceRecord[];
  incidents: EvidenceRecord[];
};

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const finiteNumber = (value: unknown): number | null => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const durationMinutes = (startedAt: unknown, completedAt: unknown) => {
  const start = Date.parse(String(startedAt ?? ""));
  const end = Date.parse(String(completedAt ?? ""));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start)
    return null;
  return (end - start) / 60_000;
};

const percentage = (numerator: number, denominator: number) =>
  denominator ? Math.round((numerator / denominator) * 100) : null;

const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
};

function authorityViolation(action: EvidenceRecord) {
  const status = String(action.status ?? "");
  const boundary = String(action.authorityBoundary ?? "");
  const decision = record(action.decision);
  const validation = record(action.validation);
  const issues = Array.isArray(validation.issues)
    ? validation.issues.map(record)
    : [];
  if (status !== "executed") return false;
  if (
    boundary === "provider_evidence_required" ||
    boundary === "never_ai_authoritative"
  )
    return true;
  if (
    ["draft_requires_review", "human_approval_required"].includes(boundary) &&
    decision.action !== "approved"
  )
    return true;
  return issues.some((issue) => issue.severity === "blocking");
}

export function summarizeReleaseEvidence(
  input: ReleaseEvidenceInput,
) {
  const verifiedHandling = input.productEvents.flatMap((event) => {
    const handling = record(event.handling);
    const saved = finiteNumber(handling.verifiedSecondsSaved);
    const method = String(handling.measurementMethod ?? "");
    return saved !== null &&
      saved >= 0 &&
      ["timer", "workflow_timestamps", "pilot_observation"].includes(method)
      ? [saved]
      : [];
  });
  const ownerEstimatedHandling = input.productEvents.flatMap((event) => {
    const handling = record(event.handling);
    const saved = finiteNumber(handling.verifiedSecondsSaved);
    return saved !== null &&
      saved >= 0 &&
      handling.measurementMethod === "owner_estimate"
      ? [saved]
      : [];
  });

  const decidedAiActions = input.aiActions.filter((action) =>
    ["approved", "rejected", "dismissed", "executed"].includes(
      String(action.status),
    ),
  );
  const aiOutcomes = decidedAiActions.reduce<{
    approved: number;
    edited: number;
    rejected: number;
    dismissed: number;
  }>(
    (counts, action) => {
      const decision = record(action.decision);
      const editDelta = record(decision.editDelta);
      const decisionName = String(decision.action ?? action.status);
      if (
        decisionName === "approved" &&
        Object.keys(editDelta).length > 0
      )
        counts.edited += 1;
      else if (decisionName === "approved") counts.approved += 1;
      else if (decisionName === "rejected") counts.rejected += 1;
      else if (decisionName === "dismissed") counts.dismissed += 1;
      return counts;
    },
    { approved: 0, edited: 0, rejected: 0, dismissed: 0 },
  );
  const aiDecisionCount = Object.values(aiOutcomes).reduce(
    (sum, count) => sum + count,
    0,
  );

  const receipts = input.actionReceipts.filter((receipt) =>
    [
      "completed",
      "failed",
      "cancelled",
      "retry_scheduled",
    ].includes(String(receipt.status)),
  );
  const automationRuns = input.automationRuns.filter((run) =>
    ["completed", "failed", "dead_letter", "cancelled"].includes(
      String(run.status),
    ),
  );
  const completedAutomation =
    receipts.filter((receipt) => receipt.status === "completed").length +
    automationRuns.filter((run) => run.status === "completed").length;
  const failedAutomation =
    receipts.filter((receipt) => receipt.status === "failed").length +
    automationRuns.filter((run) =>
      ["failed", "dead_letter"].includes(String(run.status)),
    ).length;
  const terminalAutomation = completedAutomation + failedAutomation;

  const staffingMinutes = input.crewCascades.flatMap((cascade) => {
    const duration = durationMinutes(
      cascade.handlingStartedAt ?? cascade.createdAt,
      cascade.handlingCompletedAt ?? cascade.filledAt,
    );
    return duration === null ? [] : [duration];
  });
  const staffingMedianMinutes = median(staffingMinutes);
  const staffingUnderTarget = staffingMinutes.filter(
    (minutes) => minutes < 15,
  ).length;

  const providerFailures = input.providerJobs.filter((job) =>
    ["failed", "dead_letter"].includes(String(job.status)),
  ).length;
  const openCriticalIncidents = input.incidents.filter(
    (incident) =>
      ["S1", "S2"].includes(String(incident.severity).toUpperCase()) &&
      !["resolved", "closed"].includes(
        String(incident.status).toLowerCase(),
      ),
  ).length;
  const authorityViolations = input.aiActions.filter(authorityViolation).length;
  const automationReliability = percentage(
    completedAutomation,
    terminalAutomation,
  );

  const gates: ReleaseGate[] = [
    {
      key: "critical_defects",
      label: "No open S1/S2 defects",
      status: openCriticalIncidents === 0 ? "passed" : "failed",
      evidence:
        openCriticalIncidents === 0
          ? "No open S1 or S2 incident records."
          : `${openCriticalIncidents} open critical incident${openCriticalIncidents === 1 ? "" : "s"}.`,
    },
    {
      key: "authority_boundaries",
      label: "No AI authority violations",
      status:
        input.aiActions.length === 0
          ? "needs_evidence"
          : authorityViolations === 0
            ? "passed"
            : "failed",
      evidence:
        input.aiActions.length === 0
          ? "Run the pilot with AI actions to produce evidence."
          : `${authorityViolations} prohibited execution${authorityViolations === 1 ? "" : "s"} across ${input.aiActions.length} AI actions.`,
    },
    {
      key: "automation_reliability",
      label: "Automation success ≥ 95%",
      status:
        automationReliability === null
          ? "needs_evidence"
          : automationReliability >= 95
            ? "passed"
            : "failed",
      evidence:
        automationReliability === null
          ? "No terminal automation sample yet."
          : `${automationReliability}% across ${terminalAutomation} terminal executions.`,
    },
    {
      key: "verified_time_reduction",
      label: "Verified handling-time reduction",
      status: verifiedHandling.length ? "passed" : "needs_evidence",
      evidence: verifiedHandling.length
        ? `${Math.round(verifiedHandling.reduce((sum, value) => sum + value, 0) / 60)} verified minutes saved.`
        : "Complete a timer, timestamp, or observed pilot measurement.",
    },
    {
      key: "crew_staffing",
      label: "Median staffing under 15 minutes",
      status:
        staffingMedianMinutes === null
          ? "needs_evidence"
          : staffingMedianMinutes < 15
            ? "passed"
            : "failed",
      evidence:
        staffingMedianMinutes === null
          ? "No completed staffing cascade sample yet."
          : `${Math.round(staffingMedianMinutes * 10) / 10} minute median across ${staffingMinutes.length} cascades.`,
    },
  ];

  return {
    verifiedMinutesSaved: Math.round(
      verifiedHandling.reduce((sum, value) => sum + value, 0) / 60,
    ),
    ownerEstimatedMinutesSaved: Math.round(
      ownerEstimatedHandling.reduce((sum, value) => sum + value, 0) / 60,
    ),
    verifiedHandlingEventCount: verifiedHandling.length,
    ai: {
      ...aiOutcomes,
      decided: aiDecisionCount,
      acceptanceRate: percentage(
        aiOutcomes.approved + aiOutcomes.edited,
        aiDecisionCount,
      ),
      editRate: percentage(aiOutcomes.edited, aiDecisionCount),
      authorityViolations,
    },
    automation: {
      completed: completedAutomation,
      failed: failedAutomation,
      retries:
        receipts.filter((receipt) => receipt.status === "retry_scheduled")
          .length +
        input.productEvents.filter(
          (event) => event.name === "automation.retried",
        ).length,
      cancelled:
        receipts.filter((receipt) => receipt.status === "cancelled").length +
        automationRuns.filter((run) => run.status === "cancelled").length,
      reliability: automationReliability,
    },
    crew: {
      completedCascades: staffingMinutes.length,
      medianMinutes: staffingMedianMinutes,
      underFifteenMinutesRate: percentage(
        staffingUnderTarget,
        staffingMinutes.length,
      ),
    },
    providers: {
      jobs: input.providerJobs.length,
      failures: providerFailures,
      health:
        input.providerJobs.length === 0
          ? "unmeasured"
          : providerFailures === 0
            ? "healthy"
            : "attention",
    } as const,
    incidents: { openCritical: openCriticalIncidents },
    gates,
    ready:
      gates.every((gate) => gate.status === "passed") &&
      providerFailures === 0,
  };
}
