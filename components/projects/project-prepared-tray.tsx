"use client";

import { BrainCircuit, Check, ChevronRight, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  AiQueueCard,
  AutomationApprovalCard,
} from "@/components/ai/ai-approval-queue";
import { SheetDialog } from "@/components/ui/sheet-dialog";
import { useTenantDocuments } from "@/components/live/tenant-records";
import { useWorkspace } from "@/features/auth/workspace-context";

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

// A phone shows a short preview of the queue, not the whole thing expanded.
// 15 full approval cards stacked above the journey is the endless scroll the
// job page had; three compact rows and a count is not.
function useIsPhone() {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 760px)");
    const sync = () => setPhone(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  return phone;
}

const PHONE_PREVIEW = 3;

type TrayItem =
  | { kind: "ai"; record: RecordValue }
  | { kind: "automation"; record: RecordValue };

function CompactRow({
  item,
  onOpen,
}: {
  item: TrayItem;
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

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function ProjectPreparedTray({ projectId }: { projectId: string }) {
  const workspace = useWorkspace();
  const privileged = ["studio_owner", "studio_admin"].includes(
    workspace.role ?? "",
  );
  const isPhone = useIsPhone();
  const aiState = useTenantDocuments("aiActions");
  const automationState = useTenantDocuments("automationApprovals", {
    enabled: privileged,
  });
  const [decisions, setDecisions] = useState<Record<string, string>>({});
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const aiActions = useMemo(
    () =>
      (aiState.records ?? []).filter(
        (item) =>
          text(item.projectId) === projectId &&
          ["review_required", "queued", "running"].includes(
            decisions[item.id] ?? text(item.status),
          ),
      ),
    [aiState.records, decisions, projectId],
  );
  const approvals = useMemo(
    () =>
      (automationState.records ?? []).filter(
        (item) =>
          text(item.projectId) === projectId &&
          (decisions[item.id] ?? text(item.status)) === "pending",
      ),
    [automationState.records, decisions, projectId],
  );
  const onDecision = (id: string, status: string) => {
    setDecisions((current) => ({ ...current, [id]: status }));
    // Once a decision lands the card leaves the queue — close the sheet with it
    // rather than leaving a decided card open over the list.
    setReviewingId((current) => (current === id ? null : current));
  };
  const items = useMemo<TrayItem[]>(
    () => [
      ...aiActions.map((record) => ({
        kind: "ai" as const,
        record: record as RecordValue,
      })),
      ...approvals.map((record) => ({
        kind: "automation" as const,
        record: record as RecordValue,
      })),
    ],
    [aiActions, approvals],
  );
  const count = items.length;
  const reviewing = useMemo(
    () => items.find((item) => item.record.id === reviewingId) ?? null,
    [items, reviewingId],
  );

  const visible = isPhone && !showAll ? items.slice(0, PHONE_PREVIEW) : items;

  return (
    <section className="project-prepared-tray">
      <header>
        <span><Sparkles size={18} /></span>
        <div>
          <p className="eyebrow">Prepared for you</p>
          <h2>{count ? `${count} ${count === 1 ? "decision" : "decisions"} ready` : "Nothing needs approval"}</h2>
          <p>StudioCue prepares the work here. You retain every consequential decision.</p>
        </div>
      </header>
      {count ? (
        isPhone ? (
          // Phone: a compact, tappable queue. The full card — preview, "why",
          // and the Approve / Edit / Reject controls — opens in a bottom sheet
          // for the one you choose, in place, instead of 15 expanded cards.
          <div className="project-prepared-compact">
            {visible.map((item) => (
              <CompactRow
                key={item.record.id}
                item={item}
                onOpen={() => setReviewingId(item.record.id)}
              />
            ))}
            {items.length > PHONE_PREVIEW ? (
              <button
                type="button"
                className="prepared-compact-more"
                onClick={() => setShowAll((current) => !current)}
              >
                {showAll
                  ? "Show fewer"
                  : `Show ${items.length - PHONE_PREVIEW} more`}
              </button>
            ) : null}
          </div>
        ) : (
          <div className="project-prepared-list">
            {aiActions.map((action) => (
              <AiQueueCard action={action as RecordValue} key={action.id} onDecision={onDecision} />
            ))}
            {approvals.map((approval) => (
              <AutomationApprovalCard approval={approval as RecordValue} key={approval.id} onDecision={onDecision} />
            ))}
          </div>
        )
      ) : (
        <div className="project-prepared-empty">
          <Check size={17} />
          <span>
            <strong>You are caught up.</strong>
            <small>New drafts and workflow decisions for this project will appear here.</small>
          </span>
        </div>
      )}
      <SheetDialog
        label="Review prepared decision"
        onClose={() => setReviewingId(null)}
        open={reviewing != null}
      >
        {reviewing ? (
          reviewing.kind === "ai" ? (
            <AiQueueCard action={reviewing.record} onDecision={onDecision} />
          ) : (
            <AutomationApprovalCard
              approval={reviewing.record}
              onDecision={onDecision}
            />
          )
        ) : (
          <span />
        )}
      </SheetDialog>
    </section>
  );
}
