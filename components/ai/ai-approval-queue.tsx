"use client";

import {
  AlertTriangle,
  BrainCircuit,
  Check,
  ChevronDown,
  CircleAlert,
  Clock3,
  FileClock,
  LoaderCircle,
  Pause,
  ReceiptText,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Send } from "lucide-react";
import { useTenantDocuments } from "@/components/live/tenant-records";
import { useWorkspace } from "@/features/auth/workspace-context";
import { runAiQueueCommand } from "@/lib/ai-actions/command-client";
import {
  approvalConsequenceSentence,
  dispatchesOnApproval,
} from "@/features/ai/approval-consequence";
import {
  StructuredContentFields,
  StructuredContentPreview,
} from "@/components/ai/structured-content-fields";
import { sendCommunicationsCommand } from "@/lib/communications/command-client";

type RecordValue = Record<string, unknown> & { id: string };

const text = (value: unknown): string =>
  typeof value === "string" ? value : "";
const object = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

function readable(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function relativeTime(value: unknown) {
  const timestamp = Date.parse(text(value));
  if (!Number.isFinite(timestamp)) return "Recently";
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function AiQueueCard({
  action,
  onDecision,
}: {
  action: RecordValue;
  onDecision: (id: string, status: string) => void;
}) {
  const output = object(action.structuredOutput);
  // Message drafts (subject + body) get a friendly editor and preview instead
  // of raw JSON — the DraftCard pattern.
  const isMessageDraft =
    typeof output.subject === "string" && typeof output.body === "string";
  const [editing, setEditing] = useState(false);
  const [editor, setEditor] = useState(object(action.structuredOutput));
  const [subjectDraft, setSubjectDraft] = useState(text(output.subject));
  const [bodyDraft, setBodyDraft] = useState(text(output.body));
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [approvedReplyDraftId, setApprovedReplyDraftId] = useState<
    string | null
  >(null);
  const [dispatched, setDispatched] = useState(false);
  const confidence = object(action.confidence);
  const validation = object(action.validation);
  const issues = list(validation.issues).map(object);
  const blocking = issues.some((issue) => issue.severity === "blocking");
  const sources = list(action.sourceReferences).map(object);
  const downstream = object(action.downstreamCommand);
  // A draft may cite no source at all (a free-form reply, an imported record).
  // That is not a reason to take the whole job page down.
  const affected = sources[0] ?? {};
  // What approving will actually do. The edited subject and body are what
  // would be sent when the editor is open, so the sentence follows the edit.
  const consequenceInput = {
    downstreamCommandType: text(downstream.commandType) || null,
    recipient: text(output.recipientEmail) || null,
    subject: (editing && isMessageDraft ? subjectDraft : text(output.subject)) || null,
    body: (editing && isMessageDraft ? bodyDraft : text(output.body)) || null,
  };
  const approvingSends = dispatchesOnApproval(consequenceInput);

  async function decide(
    decision: "approved" | "rejected" | "dismissed",
  ) {
    setBusy(decision);
    setNotice(null);
    try {
      let editDelta: Record<string, unknown> | undefined;
      if (editing && isMessageDraft) {
        if (!subjectDraft.trim() || !bodyDraft.trim())
          throw new Error("Subject and message body are both required.");
        editDelta = { subject: subjectDraft, body: bodyDraft };
      } else if (editing) {
        editDelta = editor;
      }
      const result = await runAiQueueCommand({
        type: "decideAiAction",
        input: {
          actionId: action.id,
          decision,
          editDelta,
        },
      });
      setNotice(text(result.downstreamConsequence));
      if (
        decision === "approved" &&
        text(action.capability) === "inquiry_reply_draft" &&
        typeof output.recipientEmail === "string" &&
        output.recipientEmail
      ) {
        // Keep the card visible so the reply can be re-sent if needed. When
        // the draft was complete the server has already dispatched it as part
        // of the approval, so the button must not still offer to send it —
        // that is what made the card contradict itself.
        setApprovedReplyDraftId(`ai_reply_${action.id}`);
        if (approvingSends) setDispatched(true);
      } else {
        onDecision(action.id, decision);
      }
    } catch (caught: unknown) {
      setNotice(
        caught instanceof Error
          ? caught.message.replaceAll("_", " ")
          : "The decision could not be saved.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function dispatchReply() {
    if (!approvedReplyDraftId) return;
    setBusy("dispatch");
    setNotice(null);
    try {
      const result = await sendCommunicationsCommand({
        type: "sendApprovedDraft",
        idempotencyKey: `dispatch_${approvedReplyDraftId}`,
        input: { draftId: approvedReplyDraftId },
      });
      if (result.mode === "preview") {
        setNotice("Preview: the approved reply would be sent to the client.");
      } else {
        setNotice("Reply queued for delivery.");
      }
      setDispatched(true);
    } catch (caught: unknown) {
      setNotice(
        caught instanceof Error
          ? caught.message.replaceAll("_", " ")
          : "The reply could not be sent.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function snooze() {
    setBusy("snooze");
    setNotice(null);
    try {
      const snoozedUntil = new Date(
        Date.now() + 24 * 60 * 60 * 1000,
      ).toISOString();
      await runAiQueueCommand({
        type: "snoozeAiAction",
        input: { actionId: action.id, snoozedUntil },
      });
      setNotice("Snoozed for 24 hours.");
      onDecision(action.id, "snoozed");
    } catch (caught: unknown) {
      setNotice(
        caught instanceof Error
          ? caught.message.replaceAll("_", " ")
          : "The action could not be snoozed.",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <article className="ai-queue-card">
      <header>
        <span className="ai-queue-capability-icon">
          <BrainCircuit size={18} />
        </span>
        <span>
          <small>{readable(text(action.capability) || "AI prepared work")}</small>
          <strong>
            {text(action.title) ||
              `Review ${readable(text(action.capability) || "AI suggestion")}`}
          </strong>
          <em>
            {text(affected.label) || "Studio record"} ·{" "}
            {relativeTime(action.updatedAt ?? action.createdAt)}
          </em>
        </span>
        <span className={`ai-confidence is-${text(confidence.label) || "medium"}`}>
          {Math.round(Number(confidence.overall ?? 0) * 100)}% confidence
        </span>
      </header>

      {/* What approving actually does, in one sentence. The entity type,
          downstream command and authority boundary are audit metadata, not
          the question being asked of a photographer — they stay available
          under "Why StudioCue prepared this". */}
      {/* Derived from the same condition the server uses, because this card
          used to promise "nothing goes to the client until you send it" and
          then send it one second later. See features/ai/approval-consequence.ts. */}
      <p className="ai-queue-consequence">
        {approvalConsequenceSentence(consequenceInput, readable)}
      </p>

      {issues.length ? (
        <div className="ai-queue-issues">
          {issues.map((issue, index) => (
            <p className={`is-${text(issue.severity)}`} key={`${issue.code}-${index}`}>
              {issue.severity === "blocking" ? (
                <CircleAlert size={14} />
              ) : (
                <AlertTriangle size={14} />
              )}
              {text(issue.message)}
            </p>
          ))}
        </div>
      ) : null}

      <details className="ai-queue-explanation">
        <summary>
          <Sparkles size={14} />
          Why StudioCue prepared this
          <ChevronDown size={14} />
        </summary>
        <div>
          <p>
            {sources.length
              ? `Written from ${sources.length} record${sources.length === 1 ? "" : "s"} in this job.`
              : "Written from what is already in this job."}{" "}
            StudioCue can never take a payment, sign anything, or mark a job
            ready on its own.
            {text(affected.entityType)
              ? ` Affects the ${readable(text(affected.entityType)).toLowerCase()}.`
              : ""}
          </p>
          {sources.map((source, index) => (
            <span key={`${source.entityId}-${index}`}>
              <ShieldCheck size={13} />
              <strong>{text(source.label)}</strong>
              <small>
                {readable(text(source.entityType))}
                {text(source.locator) ? ` · ${text(source.locator)}` : ""}
              </small>
            </span>
          ))}
        </div>
      </details>

      {isMessageDraft && !editing ? (
        <div className="ai-message-preview">
          <small>
            To {text(output.recipientName) || text(output.recipientEmail) || "client"}
            {text(output.recipientEmail) ? ` · ${text(output.recipientEmail)}` : ""}
          </small>
          <strong>{text(output.subject)}</strong>
          <p>{text(output.body)}</p>
        </div>
      ) : null}

      {editing && isMessageDraft ? (
        <div className="ai-queue-editor ai-message-editor">
          <label>
            <span>Subject</span>
            <input
              aria-label="Edited subject"
              onChange={(event) => setSubjectDraft(event.target.value)}
              value={subjectDraft}
            />
          </label>
          <label>
            <span>Message</span>
            <textarea
              aria-label="Edited message body"
              onChange={(event) => setBodyDraft(event.target.value)}
              value={bodyDraft}
            />
          </label>
        </div>
      ) : editing ? (
        <div className="ai-queue-editor">
          <span>Review and edit the prepared details</span>
          <StructuredContentFields onChange={setEditor} value={editor} />
        </div>
      ) : !isMessageDraft ? (
        <StructuredContentPreview value={object(action.structuredOutput)} />
      ) : null}

      {approvedReplyDraftId ? (
        <footer>
          <button
            className="is-primary"
            disabled={Boolean(busy) || dispatched}
            onClick={() => void dispatchReply()}
            type="button"
          >
            {busy === "dispatch" ? <LoaderCircle className="spin" /> : <Send />}
            {dispatched ? "Reply sent" : "Send reply now"}
          </button>
          <button
            disabled={Boolean(busy)}
            onClick={() => onDecision(action.id, "approved")}
            type="button"
          >
            <Check /> Done
          </button>
        </footer>
      ) : (
      <footer>
        <button
          className="is-primary"
          disabled={Boolean(busy) || blocking}
          onClick={() => void decide("approved")}
          type="button"
        >
          {busy === "approved" ? <LoaderCircle className="spin" /> : <Check />}
          Approve
        </button>
        <button
          disabled={Boolean(busy)}
          onClick={() => setEditing((current) => !current)}
          type="button"
        >
          <Sparkles /> {editing ? "Use original" : "Edit first"}
        </button>
        <button
          disabled={Boolean(busy)}
          onClick={() => void decide("rejected")}
          type="button"
        >
          <X /> Reject
        </button>
        <button
          disabled={Boolean(busy)}
          onClick={() => void snooze()}
          type="button"
        >
          <Pause /> Snooze
        </button>
        <button
          disabled={Boolean(busy)}
          onClick={() => void decide("dismissed")}
          type="button"
        >
          Dismiss
        </button>
      </footer>
      )}
      {notice ? <p className="ai-queue-notice" role="status">{notice}</p> : null}
    </article>
  );
}

export function AutomationApprovalCard({
  approval,
  onDecision,
}: {
  approval: RecordValue;
  onDecision: (id: string, status: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  async function decide(decision: "approved" | "rejected") {
    setBusy(decision);
    try {
      const result = await runAiQueueCommand({
        type: "decideAutomationApproval",
        input: { approvalId: approval.id, decision },
      });
      setNotice(text(result.downstreamConsequence));
      onDecision(approval.id, decision);
    } catch (caught: unknown) {
      setNotice(
        caught instanceof Error
          ? caught.message.replaceAll("_", " ")
          : "The workflow decision could not be saved.",
      );
    } finally {
      setBusy(null);
    }
  }
  return (
    <article className="ai-queue-card automation-queue-card">
      <header>
        <span className="ai-queue-capability-icon"><FileClock size={18} /></span>
        <span>
          <small>Workflow step awaiting your yes</small>
          <strong>{readable(text(approval.actionType))}</strong>
          <em>Requested {relativeTime(approval.requestedAt)}</em>
        </span>
        <span className="ai-confidence is-high">Rules verified</span>
      </header>
      <div className="ai-queue-impact">
        <span><small>Configuration</small><strong>Review exact values below</strong></span>
        <span><small>Automation run</small><strong>{text(approval.automationRunId)}</strong></span>
        <span><small>Downstream</small><strong>{readable(text(approval.actionType))}</strong></span>
      </div>
      <StructuredContentPreview value={object(approval.configuration)} />
      <footer>
        <button className="is-primary" disabled={Boolean(busy)} onClick={() => void decide("approved")} type="button">
          {busy === "approved" ? <LoaderCircle className="spin" /> : <Check />} Approve
        </button>
        <button disabled={Boolean(busy)} onClick={() => void decide("rejected")} type="button">
          <X /> Reject
        </button>
      </footer>
      {notice ? <p className="ai-queue-notice" role="status">{notice}</p> : null}
    </article>
  );
}

function ReceiptCard({ receipt }: { receipt: RecordValue }) {
  const [status, setStatus] = useState(text(receipt.status));
  const [busy, setBusy] = useState(false);
  async function update(type: "cancelReceipt" | "retryReceipt") {
    setBusy(true);
    try {
      const result = await runAiQueueCommand({
        type,
        input: { receiptId: receipt.id },
      });
      setStatus(text(result.status));
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="ai-receipt">
      <span><ReceiptText size={16} /></span>
      <span>
        <small>{relativeTime(receipt.createdAt)}</small>
        <strong>{text(receipt.title)}</strong>
        <p>{text(receipt.summary)}</p>
        {receipt.providerEvidence ? (
          <em><ShieldCheck size={12} /> Provider evidence recorded</em>
        ) : null}
      </span>
      <span className={`receipt-status is-${status}`}>{readable(status)}</span>
      {receipt.canCancel === true && ["queued", "retry_scheduled"].includes(status) ? (
        <button disabled={busy} onClick={() => void update("cancelReceipt")} type="button">Cancel</button>
      ) : null}
      {receipt.canRetry === true && ["failed", "cancelled"].includes(status) ? (
        <button disabled={busy} onClick={() => void update("retryReceipt")} type="button"><RotateCcw /> Retry</button>
      ) : null}
    </article>
  );
}

export function AiApprovalQueue() {
  const workspace = useWorkspace();
  const privileged = ["studio_owner", "studio_admin"].includes(
    workspace.role ?? "",
  );
  const aiState = useTenantDocuments("aiActions");
  const approvalState = useTenantDocuments("automationApprovals", {
    enabled: privileged,
  });
  const receiptState = useTenantDocuments("actionReceipts");
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<"review" | "receipts">("review");
  const [now, setNow] = useState(0);
  useEffect(() => {
    const timer = window.setTimeout(() => setNow(Date.now()), 0);
    return () => window.clearTimeout(timer);
  }, []);
  const aiActions = useMemo(
    () =>
      (aiState.records ?? []).filter((action) => {
        const status = overrides[action.id] ?? text(action.status);
        const snoozed = text(action.snoozedUntil);
        return (
          ["review_required", "queued", "running"].includes(status) &&
          (!snoozed || Date.parse(snoozed) <= now) &&
          status !== "snoozed"
        );
      }),
    [aiState.records, now, overrides],
  );
  const approvals = (approvalState.records ?? []).filter(
    (approval) =>
      (overrides[approval.id] ?? text(approval.status)) === "pending",
  );
  const receipts = [...(receiptState.records ?? [])]
    .sort((left, right) =>
      text(right.createdAt).localeCompare(text(left.createdAt)),
    )
    .slice(0, 30);
  const loading =
    aiState.loading || approvalState.loading || receiptState.loading;
  const error =
    aiState.error ?? approvalState.error ?? receiptState.error ?? null;
  const onDecision = (id: string, status: string) =>
    setOverrides((current) => ({ ...current, [id]: status }));

  return (
    <div className="ai-queue-page">
      <header className="ai-queue-hero">
        <div>
          <p className="eyebrow"><Sparkles size={14} /> AI review</p>
          <h1>Prepared for you.<br />Never decided for you.</h1>
          <p>
            Review drafts and workflow actions with their source facts,
            confidence, affected record, and exactly what happens after
            approval.
          </p>
        </div>
        <aside>
          <span><strong>{aiActions.length + approvals.length}</strong><small>waiting for review</small></span>
          <span><strong>{receipts.length}</strong><small>recent receipts</small></span>
          <span><ShieldCheck /><small>human authority retained</small></span>
        </aside>
      </header>

      <nav className="ai-queue-tabs" aria-label="AI review views">
        <button className={filter === "review" ? "is-active" : ""} onClick={() => setFilter("review")} type="button">
          <BrainCircuit /> Review queue <span>{aiActions.length + approvals.length}</span>
        </button>
        <button className={filter === "receipts" ? "is-active" : ""} onClick={() => setFilter("receipts")} type="button">
          <ReceiptText /> Action receipts <span>{receipts.length}</span>
        </button>
      </nav>

      {error ? (
        <p className="ai-queue-page-error" role="alert"><CircleAlert /> {error}</p>
      ) : null}
      {loading ? (
        <div className="ai-queue-empty"><LoaderCircle className="spin" /><strong>Loading review work…</strong></div>
      ) : filter === "review" ? (
        <section className="ai-queue-list">
          {aiActions.map((action) => (
            <AiQueueCard action={action} key={action.id} onDecision={onDecision} />
          ))}
          {approvals.map((approval) => (
            <AutomationApprovalCard approval={approval} key={approval.id} onDecision={onDecision} />
          ))}
          {!aiActions.length && !approvals.length ? (
            <div className="ai-queue-empty">
              <Check size={22} />
              <strong>Nothing is waiting for approval.</strong>
              <small>New cited AI drafts and workflow decisions will appear here.</small>
            </div>
          ) : null}
        </section>
      ) : (
        <section className="ai-receipt-list">
          {receipts.map((receipt) => <ReceiptCard key={receipt.id} receipt={receipt} />)}
          {!receipts.length ? (
            <div className="ai-queue-empty">
              <Clock3 size={22} />
              <strong>No action receipts yet.</strong>
              <small>Every approved, rejected, retried, or cancelled action will leave a plain-language receipt.</small>
            </div>
          ) : null}
        </section>
      )}
    </div>
  );
}
