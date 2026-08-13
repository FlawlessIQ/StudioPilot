"use client";

import { Check, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import {
  AiQueueCard,
  AutomationApprovalCard,
} from "@/components/ai/ai-approval-queue";
import { useTenantDocuments } from "@/components/live/tenant-records";
import { useWorkspace } from "@/features/auth/workspace-context";

type RecordValue = Record<string, unknown> & { id: string };

const text = (value: unknown) => (typeof value === "string" ? value : "");

export function ProjectPreparedTray({ projectId }: { projectId: string }) {
  const workspace = useWorkspace();
  const privileged = ["studio_owner", "studio_admin"].includes(
    workspace.role ?? "",
  );
  const aiState = useTenantDocuments("aiActions");
  const automationState = useTenantDocuments("automationApprovals", {
    enabled: privileged,
  });
  const [decisions, setDecisions] = useState<Record<string, string>>({});
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
  const onDecision = (id: string, status: string) =>
    setDecisions((current) => ({ ...current, [id]: status }));
  const count = aiActions.length + approvals.length;

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
        <div className="project-prepared-list">
          {aiActions.map((action) => (
            <AiQueueCard action={action as RecordValue} key={action.id} onDecision={onDecision} />
          ))}
          {approvals.map((approval) => (
            <AutomationApprovalCard approval={approval as RecordValue} key={approval.id} onDecision={onDecision} />
          ))}
        </div>
      ) : (
        <div className="project-prepared-empty">
          <Check size={17} />
          <span>
            <strong>You are caught up.</strong>
            <small>New drafts and workflow decisions for this project will appear here.</small>
          </span>
        </div>
      )}
    </section>
  );
}
