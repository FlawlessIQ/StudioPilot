import type { ConsoleStudio } from "./model";
import { funnelStage, type SourceChannel } from "./sources";

/**
 * Console → Pipeline (docs/console.md, "Pipeline"): photographers who might
 * become studios, before they sign up.
 *
 * Conor, 2026-10-07: the Console should work as a CRM for selling StudioCue.
 * A lead arrives from "Book a demo" on the website, or is added by hand: a
 * photographer Gabe met, one a partner mentioned. It moves New → Contacted →
 * Demo booked by hand. Once the photographer signs up with the same email the
 * lead is linked to their studio, and from then on the studio decides where it
 * stands: in a trial, paying (won), or canceled (lost). Nobody has to move it.
 *
 * Pure. The stage list is mirrored in functions/src/console/handlers/leads.ts.
 */

export const LEAD_STAGES = ["new", "contacted", "demo_booked", "trial", "won", "lost"] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

/** The stages a person sets; the rest follow the studio. */
export const MANUAL_LEAD_STAGES = ["new", "contacted", "demo_booked", "lost"] as const;

export const LEAD_STAGE_LABELS: Record<LeadStage, string> = {
  new: "New",
  contacted: "Contacted",
  demo_booked: "Demo booked",
  trial: "In trial",
  won: "Won",
  lost: "Lost",
};

export const LEAD_STAGE_TONES: Record<LeadStage, "info" | "warn" | "accent" | "ok" | "neutral"> = {
  new: "warn",
  contacted: "info",
  demo_booked: "accent",
  trial: "info",
  won: "ok",
  lost: "neutral",
};

/** `saasLeads/{leadId}`. */
export type Lead = {
  id: string;
  name: string;
  studioName?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  instagram?: string | null;
  location?: string | null;
  stage: LeadStage;
  source?: SourceChannel | null;
  sourceDetail?: string | null;
  partnerId?: string | null;
  ownerUid?: string | null;
  ownerEmail?: string | null;
  nextStep?: string | null;
  nextStepAt?: string | null;
  lostReason?: string | null;
  /** What they wrote on the demo form. */
  message?: string | null;
  preferredTimes?: string | null;
  /** "How did you hear about StudioCue?" on the demo form. */
  heard?: string | null;
  tenantId?: string | null;
  origin?: "demo_form" | "manual";
  createdAt?: string;
  updatedAt?: string;
  stageChangedAt?: string;
};

/** Where a lead stands now: its studio decides once it has one. */
export function effectiveLeadStage(lead: Pick<Lead, "stage" | "tenantId">, studio: Pick<ConsoleStudio, "subscriptionStatus" | "comped"> | null | undefined): LeadStage {
  if (!lead.tenantId || !studio) return lead.stage;
  const stage = funnelStage(studio);
  if (stage === "paying" || studio.comped) return "won";
  if (stage === "churned") return "lost";
  return "trial";
}

/** Needs a person: new and never answered, or a next step that's due. */
export function leadNeedsYou(lead: Lead, stage: LeadStage, now: number): "new" | "due" | null {
  if (stage === "won" || stage === "lost") return null;
  if (stage === "new") return "new";
  // A day, not a time: due from the morning of that date.
  if (lead.nextStepAt && lead.nextStepAt.slice(0, 10) <= new Date(now).toISOString().slice(0, 10)) return "due";
  return null;
}

/** Leads per stage, and how many of the closed ones were won. */
export function pipelineSummary(stages: LeadStage[]): { counts: Record<LeadStage, number>; open: number; winRate: number | null } {
  const counts = Object.fromEntries(LEAD_STAGES.map((stage) => [stage, 0])) as Record<LeadStage, number>;
  for (const stage of stages) counts[stage] += 1;
  const closed = counts.won + counts.lost;
  return { counts, open: counts.new + counts.contacted + counts.demo_booked + counts.trial, winRate: closed ? counts.won / closed : null };
}

/** One spelling per address, so a signup finds its lead. */
export function normalizeEmail(value: string | null | undefined): string | null {
  const email = value?.trim().toLowerCase();
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}
