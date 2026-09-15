/**
 * The wedding brief: one page for everything planning needs to be true.
 *
 * Planning was six separate areas (client details, timeline, crew, venue and
 * insurance, files, event day) plus a readiness percentage and a list of
 * checkpoints, and the studio assembled the picture itself. The brief reads the
 * same journey steps the job page uses, so it never disagrees with it, and
 * says only three things: what needs the studio, what is out with someone
 * else, and what the day looks like from the couple's own answers.
 *
 * Pure. The component loads records; this decides what they mean.
 */

import {
  categorizePlanningFacts,
  type PlanningFactCategory,
} from "@/features/planning/intelligence";
import type { JourneyStep, JourneyStepKey } from "@/features/journey/steps";

/** The journey steps that make up planning, in the order a studio meets them. */
export const BRIEF_STEP_KEYS: readonly JourneyStepKey[] = [
  "schedule_form",
  "run_of_show",
  "crew",
  "coi",
  "final_balance",
  "day_before",
];

export type BriefItem = {
  key: JourneyStepKey;
  title: string;
  detail: string;
  href: string | null;
  actionLabel: string | null;
};

export type BriefStatus = {
  needsYou: BriefItem[];
  waiting: BriefItem[];
  done: number;
  total: number;
};

export function briefStatus(steps: readonly JourneyStep[]): BriefStatus {
  const planning = steps.filter((step) => BRIEF_STEP_KEYS.includes(step.key));
  const item = (step: JourneyStep): BriefItem => ({
    key: step.key,
    title:
      step.status === "current" && step.action?.kind === "link"
        ? step.action.label
        : step.title,
    detail: step.detail,
    href:
      step.action?.kind === "link" ? step.action.href : (step.record?.href ?? null),
    actionLabel: step.action?.kind === "link" ? step.action.label : step.record ? "Open" : null,
  });
  return {
    needsYou: planning.filter((step) => step.status === "current").map(item),
    waiting: planning
      .filter((step) => step.status === "waiting_client" || step.status === "waiting_other")
      .map(item),
    done: planning.filter((step) => step.status === "complete").length,
    total: planning.length,
  };
}

export type BriefFact = { label: string; value: string };

export type BriefFacts = Record<PlanningFactCategory, BriefFact[]>;

const EMPTY_FACTS = (): BriefFacts => ({
  schedule: [],
  family_formals: [],
  vendors: [],
  logistics: [],
  preferences: [],
});

/** A questionnaire answer as one readable line. */
export function answerText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean")
    return value === true ? "Yes" : value === false ? "No" : String(value);
  if (Array.isArray(value))
    return value.map(answerText).filter(Boolean).join(", ");
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const named = ["name", "label", "title", "formatted", "address"]
      .map((key) => answerText(record[key]))
      .find(Boolean);
    if (named) {
      const extra = ["relationship", "role", "phone", "time"]
        .map((key) => answerText(record[key]))
        .filter(Boolean);
      return extra.length ? `${named} (${extra.join(", ")})` : named;
    }
    return Object.values(record).map(answerText).filter(Boolean).join(" · ");
  }
  return "";
}

/**
 * The couple's answers, grouped the way a photographer reads them.
 *
 * Fields marked internal-only never reach the brief's couple-facing sections
 * (they are the studio's own notes), and empty answers are dropped.
 */
export function briefFacts(input: {
  responseId: string;
  fields: ReadonlyArray<{ id: string; label: string; internalOnly?: boolean; type?: string }>;
  answers: Record<string, unknown>;
}): BriefFacts {
  const facts = EMPTY_FACTS();
  const usable = input.fields.filter(
    (field) =>
      !field.internalOnly && field.type !== "information" && field.type !== "acknowledgement",
  );
  for (const fact of categorizePlanningFacts({
    responseId: input.responseId,
    fields: usable,
    answers: input.answers,
  })) {
    const value = answerText(fact.value);
    if (value) facts[fact.category].push({ label: fact.label, value });
  }
  return facts;
}

/** Sections parsed from a response's template snapshot, tolerating old shapes. */
export function snapshotFields(
  templateSnapshot: unknown,
): Array<{ id: string; label: string; internalOnly: boolean; type: string }> {
  const sections =
    typeof templateSnapshot === "object" && templateSnapshot !== null
      ? (templateSnapshot as { sections?: unknown }).sections
      : null;
  if (!Array.isArray(sections)) return [];
  return sections.flatMap((section) => {
    const fields =
      typeof section === "object" && section !== null
        ? (section as { fields?: unknown }).fields
        : null;
    if (!Array.isArray(fields)) return [];
    return fields.flatMap((field) => {
      if (typeof field !== "object" || field === null) return [];
      const value = field as Record<string, unknown>;
      if (typeof value.id !== "string" || typeof value.label !== "string") return [];
      return [
        {
          id: value.id,
          label: value.label,
          internalOnly: value.internalOnly === true,
          type: typeof value.type === "string" ? value.type : "text",
        },
      ];
    });
  });
}
