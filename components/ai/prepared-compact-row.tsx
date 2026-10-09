"use client";

import { BrainCircuit, ChevronRight, Sparkles } from "lucide-react";
import { useWorkspace } from "@/features/auth/workspace-context";
import { tradeVocab } from "@/features/trades/trades";

type RecordValue = Record<string, unknown> & { id: string };

const text = (value: unknown) => (typeof value === "string" ? value : "");
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

// Match the queue card's own label styling: "inquiry_reply_draft" → "Inquiry
// reply draft". Kept local so the tray needs no export from the queue module.
function readable(value: string) {
  const spaced = value.replaceAll("_", " ").trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : value;
}

/**
 * The kind of draft, in the studio's words. The capability name leaked its
 * workflow phase: a pre-wedding invoice notice was labelled "Delivery message
 * draft" (UI audit, 2026-10-02).
 */
function draftLabel(capability: string, trade?: unknown): string {
  if (/reply/.test(capability)) return "Reply draft";
  if (/message|email|notice/.test(capability)) return "Message draft";
  // A makeup or hair studio's offer is a quote (trades.ts).
  if (/proposal/.test(capability)) return `${tradeVocab(trade).proposal} draft`;
  if (/schedule|run_of_show/.test(capability)) return "Schedule draft";
  return readable(capability) || "Prepared for you";
}

function relativeTime(value: unknown) {
  const raw = typeof value === "number" ? value : Date.parse(text(value));
  if (!Number.isFinite(raw)) return "";
  const diff = Date.now() - raw;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

/**
 * One prepared decision as a tappable row.
 *
 * Shared by the job page's tray and the review queue page. On a phone both
 * show these instead of full cards; the full card opens in a sheet.
 */
export type PreparedItem =
  | { kind: "ai"; record: RecordValue }
  | { kind: "automation"; record: RecordValue };

export function PreparedCompactRow({
  item,
  onOpen,
  versions = 1,
  stale = null,
}: {
  item: PreparedItem;
  onOpen: () => void;
  /** How many versions of this decision are pending, this one included. */
  versions?: number;
  /** Why it is out of date for the job, when it is. */
  stale?: string | null;
}) {
  const trade = useWorkspace().tenantTrade;
  const record = item.record;
  const flags =
    versions > 1 || stale ? (
      <span className="prepared-compact-flags">
        {stale ? <span className="is-stale">Out of date</span> : null}
        {versions > 1 ? (
          <span>
            {versions - 1} older {versions - 1 === 1 ? "version" : "versions"}
          </span>
        ) : null}
      </span>
    ) : null;
  if (item.kind === "ai") {
    const confidence = object(record.confidence);
    const capability = text(record.capability);
    const affected = object(list(record.sourceReferences)[0]);
    return (
      <button
        type="button"
        className={stale ? "prepared-compact-row is-stale" : "prepared-compact-row"}
        onClick={onOpen}
      >
        <span className="prepared-compact-icon">
          <BrainCircuit size={16} />
        </span>
        <span className="prepared-compact-body">
          <small>{draftLabel(capability, trade)}</small>
          <strong>
            {text(record.title) || `Review ${readable(capability) || "AI suggestion"}`}
          </strong>
          <em>
            {text(affected.label) || "Studio record"}
            {" · "}
            {relativeTime(record.updatedAt ?? record.createdAt)}
          </em>
          {flags}
        </span>
        {/* A bare "95%" said nothing; it is how sure the draft is. */}
        <span
          className={`ai-confidence is-${text(confidence.label) || "medium"}`}
          title="How sure StudioCue is that this draft is right"
        >
          {Math.round(Number(confidence.overall ?? 0) * 100)}% sure
        </span>
        <ChevronRight size={18} className="prepared-compact-chevron" />
      </button>
    );
  }
  const proposal = object(record.proposedChange);
  return (
    <button type="button" className="prepared-compact-row" onClick={onOpen}>
      <span className="prepared-compact-icon is-automation">
        <Sparkles size={16} />
      </span>
      <span className="prepared-compact-body">
        <small>Workflow approval</small>
        <strong>
          {text(record.title) || text(proposal.summary) || "Approve automation step"}
        </strong>
        <em>{relativeTime(record.updatedAt ?? record.createdAt)}</em>
        {flags}
      </span>
      <ChevronRight size={18} className="prepared-compact-chevron" />
    </button>
  );
}

export function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

