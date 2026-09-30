"use client";

import { useState } from "react";
import { Check, ShieldCheck, X } from "lucide-react";
import { refreshTenantRecords, useTenantDocuments } from "@/components/live/tenant-records";
import { useWorkspace } from "@/features/auth/workspace-context";
import { sendCommunicationsCommand } from "@/lib/communications/command-client";
import { friendlyError } from "@/lib/ai/friendly-error";
import { InfoHint } from "@/components/ui/info-hint";

const str = (value: unknown): string => (typeof value === "string" ? value : "");

const CATEGORY_LABEL: Record<string, string> = {
  financial: "Money",
  contract: "The contract",
  insurance: "Insurance",
};

/**
 * Messages waiting on the owner.
 *
 * A coordinator's message about money, the contract or insurance is held for
 * an owner or admin to approve (communications/commands.ts, sendMessage). Today
 * listed them as "Approve: …" and linked here, and nothing here could approve
 * one — `approveMessage` had no caller anywhere (found 2026-09-29). This is
 * that control, and its "not this one".
 */
export function MessageApprovals({ projectId = null }: { projectId?: string | null }) {
  const workspace = useWorkspace();
  const canApprove = ["studio_owner", "studio_admin"].includes(String(workspace.role ?? ""));
  const { records } = useTenantDocuments("communicationDrafts", { enabled: canApprove });
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  if (!canApprove) return null;
  const waiting = (records ?? []).filter(
    (draft) => draft.status === "needs_approval" && (!projectId || draft.projectId === projectId),
  );
  if (!waiting.length && !notice) return null;

  async function decide(draftId: string, approve: boolean) {
    setBusy(draftId);
    setNotice(null);
    try {
      await sendCommunicationsCommand({
        type: approve ? "approveMessage" : "declineMessage",
        idempotencyKey: `${approve ? "approve" : "decline"}_${draftId}`,
        input: approve ? { draftId } : { draftId, reason: null },
      });
      setNotice(approve ? "Approved. It's on its way." : "Declined. It won't be sent.");
      refreshTenantRecords("communicationDrafts", "conversations");
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "That couldn't be done. Nothing was sent."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-label="Messages waiting for your approval" className="msg-approvals">
      <p className="msg-approvals-head">
        <ShieldCheck aria-hidden size={14} />
        Waiting for your approval
        <InfoHint label="Waiting for your approval">
          A coordinator wrote these about money, the contract or insurance. Approve to send them to the client, or
          decline and nothing is sent.
        </InfoHint>
      </p>
      {waiting.map((draft) => (
        <article className="msg-approval" key={draft.id}>
          <p className="msg-approval-meta">
            {[CATEGORY_LABEL[str(draft.category)], str(draft.projectName), `to ${str(draft.recipientName) || str(draft.recipient)}`]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <strong>{str(draft.subject)}</strong>
          <p className="msg-approval-body">{str(draft.body)}</p>
          <div className="msg-approval-actions">
            <button
              className="ds-btn ds-btn-primary ds-btn-sm"
              disabled={busy !== null}
              onClick={() => void decide(draft.id, true)}
              type="button"
            >
              <Check aria-hidden size={14} />
              {busy === draft.id ? "Sending…" : "Approve and send"}
            </button>
            <button
              className="ds-btn ds-btn-ghost ds-btn-sm"
              disabled={busy !== null}
              onClick={() => void decide(draft.id, false)}
              type="button"
            >
              <X aria-hidden size={14} />
              Decline
            </button>
          </div>
        </article>
      ))}
      {notice ? (
        <p className="msg-approval-meta" role="status">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
