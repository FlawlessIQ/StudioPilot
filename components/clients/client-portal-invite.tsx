"use client";

import { useState } from "react";
import { Copy, LoaderCircle, Send } from "lucide-react";
import { useWorkspace } from "@/features/auth/workspace-context";
import { runClientInvitation } from "@/lib/client/invitation-client";

export function ClientPortalInvite({
  contactId,
  projectIds,
}: {
  contactId: string;
  projectIds: string[];
}) {
  const workspace = useWorkspace();
  const [projectId, setProjectId] = useState(projectIds[0] ?? "");
  const [busy, setBusy] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  if (
    !workspace.tenantId ||
    !["studio_owner", "studio_admin", "studio_coordinator"].includes(
      workspace.role ?? "",
    )
  )
    return null;

  async function invite() {
    if (!workspace.tenantId || !projectId) return;
    setBusy(true);
    setNotice("");
    try {
      const result = await runClientInvitation({
        type: "invite",
        tenantId: workspace.tenantId,
        idempotencyKey: crypto.randomUUID(),
        input: { contactId, projectId },
      });
      setInviteUrl(
        typeof result.inviteUrl === "string" ? result.inviteUrl : null,
      );
      setNotice("Secure invitation created.");
    } catch (caught: unknown) {
      setNotice(
        caught instanceof Error ? caught.message : "Invitation failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!projectIds.length)
    return <small>Associate this client with a project before inviting them.</small>;
  return (
    <div className="client-portal-invite">
      {projectIds.length > 1 ? (
        <select
          aria-label="Project to share"
          onChange={(event) => setProjectId(event.target.value)}
          value={projectId}
        >
          {projectIds.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
      ) : null}
      <button disabled={busy} onClick={() => void invite()} type="button">
        {busy ? <LoaderCircle className="spin" /> : <Send />} Invite to portal
      </button>
      {inviteUrl ? (
        <button
          onClick={() => void navigator.clipboard.writeText(inviteUrl)}
          type="button"
        >
          <Copy /> Copy secure link
        </button>
      ) : null}
      {notice ? <small role="status">{notice}</small> : null}
    </div>
  );
}
