/**
 * "What do you shoot?" — the kinds of work setup offers each trade, and the
 * inquiry form a studio's answer saves.
 *
 * Setup offered a photographer eleven kinds and saved the trade's default
 * inquiry form filtered down to the ones ticked. The default form only ever
 * had the five types it started with (weddings, portraits, sports, corporate,
 * other), so a studio that ticked Quinceañera or Bar & bat mitzvah read "your
 * inquiry form offers just these" and got a form without either of them
 * (onboarding audit, 2026-10-24). A kind the form doesn't have yet is added
 * here, with that kind's own "your day" fields.
 *
 * Pure, no I/O.
 */

import { JOB_KIND_LABELS, JOB_KINDS, type JobKind } from "@/features/job-kinds/job-kinds";
import {
  dayFieldsForKind,
  defaultInquiryFormFor,
  INQUIRY_FORM_LIMITS,
  inquiryIdFor,
  type InquiryEventType,
  type InquiryFormConfig,
} from "@/features/leads/inquiry-form-config";
import { tradeOf } from "@/features/trades/trades";

/** The kinds setup leaves out for each trade, by what its forms cover; a trade not listed is offered every kind (a photographer). */
const NOT_OFFERED: Partial<Record<string, readonly JobKind[]>> = {
  dj: ["sacrament", "prom", "portraits", "sports"],
  makeup: ["sacrament", "portraits", "corporate", "sports"],
  hair: ["portraits", "corporate", "sports"],
  planner: ["sacrament", "prom", "portraits", "sports"],
};

/** The kinds "What do you shoot?" offers this trade, in the order it lists them. */
export function setupOfferedKinds(trade: unknown): JobKind[] {
  const left = NOT_OFFERED[tradeOf(trade)] ?? [];
  return JOB_KINDS.filter((kind) => !left.includes(kind));
}

/**
 * The trade's inquiry form, offering exactly the kinds chosen, plus its
 * general question. Types the form already has keep their labels and fields
 * (a DJ's "Party"); a chosen kind it lacks gets a type of its own.
 */
export function inquiryFormForKinds(trade: unknown, chosen: readonly JobKind[]): InquiryFormConfig {
  const base = defaultInquiryFormFor(tradeOf(trade));
  const types: InquiryEventType[] = [];
  const taken = base.eventTypes.map((type) => type.id);
  for (const kind of JOB_KINDS) {
    if (!chosen.includes(kind)) continue;
    const existing = base.eventTypes.filter((type) => type.kind === kind);
    if (existing.length) {
      types.push(...existing);
      continue;
    }
    const label = JOB_KIND_LABELS[kind].slice(0, INQUIRY_FORM_LIMITS.typeLabel);
    const id = inquiryIdFor(label, taken, kind);
    taken.push(id);
    types.push({ id, label, kind, ...dayFieldsForKind(kind) });
  }
  const general = base.eventTypes.filter((type) => type.kind === "general");
  return {
    ...base,
    eventTypes: [...types.slice(0, INQUIRY_FORM_LIMITS.eventTypes - general.length), ...general],
  };
}

/** What a saved inquiry form offers, in words: "Wedding and Portraits". Null when there is nothing to say. */
export function offeredKindsSummary(eventTypes: unknown): string | null {
  if (!Array.isArray(eventTypes)) return null;
  const labels = eventTypes
    .filter(
      (type): type is { label: string; kind: string } =>
        typeof type === "object" &&
        type !== null &&
        typeof (type as { label?: unknown }).label === "string" &&
        (type as { kind?: unknown }).kind !== "general",
    )
    .map((type) => type.label.trim())
    .filter(Boolean);
  if (!labels.length) return null;
  if (labels.length === 1) return labels[0]!;
  return `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
}
