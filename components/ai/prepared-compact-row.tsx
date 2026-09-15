"use client";

import { BrainCircuit, ChevronRight, Sparkles } from "lucide-react";

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
}: {
  item: PreparedItem;
  onOpen: () => void;
}) {
  const record = item.record;
  if (item.kind === "ai") {
    const confidence = object(record.confidence);
    const capability = text(record.capability);
    const affected = object(list(record.sourceReferences)[0]);
    return (
      <button type="button" className="prepared-compact-row" onClick={onOpen}>
        <span className="prepared-compact-icon">
          <BrainCircuit size={16} />
        </span>
        <span className="prepared-compact-body">
          <small>{readable(capability) || "AI prepared work"}</small>
          <strong>
            {text(record.title) || `Review ${readable(capability) || "AI suggestion"}`}
          </strong>
          <em>
            {text(affected.label) || "Studio record"}
            {" · "}
            {relativeTime(record.updatedAt ?? record.createdAt)}
          </em>
        </span>
        <span
          className={`ai-confidence is-${text(confidence.label) || "medium"}`}
        >
          {Math.round(Number(confidence.overall ?? 0) * 100)}%
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
      </span>
      <ChevronRight size={18} className="prepared-compact-chevron" />
    </button>
  );
}

export function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

