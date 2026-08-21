"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Link2,
  LoaderCircle,
  MailCheck,
  RefreshCw,
  Send,
  ShieldX,
} from "lucide-react";
import { useWorkspace } from "@/features/auth/workspace-context";
import { runClientInvitation } from "@/lib/client/invitation-client";
import { runCrmCommand } from "@/lib/crm/command-client";
import { formatDueDate } from "@/lib/format/event-date";

export type ClientInviteProjectOption = {
  id: string;
  name: string;
  eventDate: string | null;
  state: string;
};

export type ClientInvitationStatus = {
  invitationId: string;
  projectId: string;
  status: string;
  expiresAt: string;
  lastSentAt: string | null;
  sendCount: number;
  deliveryStatus: string | null;
  emailJobStatus: string | null;
};

function invitationLabel(
  invitation: ClientInvitationStatus | null,
  currentTime: string | null,
) {
  if (!invitation) return "Portal access has not been sent";
  if (invitation.status === "accepted") return "Portal access is active";
  if (invitation.status === "revoked") return "Invitation revoked";
  if (currentTime && invitation.expiresAt <= currentTime)
    return "Invitation expired";
  if (invitation.deliveryStatus === "delivered")
    return "Invitation delivered";
  if (invitation.deliveryStatus === "open") return "Invitation opened";
  if (invitation.deliveryStatus === "click")
    return "Activation link opened";
  if (["bounce", "dropped"].includes(String(invitation.deliveryStatus)))
    return "Email delivery needs attention";
  if (invitation.emailJobStatus === "succeeded") return "Invitation sent";
  return "Invitation queued";
}

export function ClientPortalInvite({
  contactId,
  projectIds,
  projects,
  initialInvitations,
  loadingProjects = false,
  invitationStatusError = false,
  projectLoadError = false,
}: {
  contactId: string;
  projectIds: string[];
  projects: ClientInviteProjectOption[];
  initialInvitations: ClientInvitationStatus[];
  loadingProjects?: boolean;
  invitationStatusError?: boolean;
  projectLoadError?: boolean;
}) {
  const workspace = useWorkspace();
  const [newlyAssociatedProjectIds, setNewlyAssociatedProjectIds] = useState<
    string[]
  >([]);
  const [selectedProjectId, setSelectedProjectId] = useState(
    projectIds[0] ?? "",
  );
  const [invitationUpdates, setInvitationUpdates] = useState<
    Record<string, ClientInvitationStatus>
  >({});
  const [currentTime, setCurrentTime] = useState<string | null>(null);
  const [busy, setBusy] = useState<
    "associate" | "invite" | "revoke" | null
  >(null);
  const [notice, setNotice] = useState("");
  const permitted =
    Boolean(workspace.tenantId) &&
    ["studio_owner", "studio_admin", "studio_coordinator"].includes(
      workspace.role ?? "",
    );

  useEffect(() => {
    queueMicrotask(() => setCurrentTime(new Date().toISOString()));
  }, []);

  const effectiveProjectId = projects.some(
    (project) => project.id === selectedProjectId,
  )
    ? selectedProjectId
    : projectIds.find((projectId) =>
        projects.some((project) => project.id === projectId),
      ) ?? projects[0]?.id ?? "";
  const selectedProject = projects.find(
    (project) => project.id === effectiveProjectId,
  );
  const associated = [...projectIds, ...newlyAssociatedProjectIds].includes(
    effectiveProjectId,
  );
  const selectedInvitation =
    invitationUpdates[effectiveProjectId] ??
    initialInvitations.find(
      (invitation) => invitation.projectId === effectiveProjectId,
    ) ??
    null;
  const pendingInvitation =
    selectedInvitation?.status === "pending" &&
    (!currentTime || selectedInvitation.expiresAt > currentTime);
  const projectOptions = useMemo(
    () =>
      projects.map((project) => ({
        ...project,
        label: `${project.name}${project.eventDate ? ` · ${formatDueDate(project.eventDate)}` : ""}`,
      })),
    [projects],
  );

  if (!permitted) return null;

  async function associate() {
    if (!effectiveProjectId) return;
    setBusy("associate");
    setNotice("");
    try {
      const result = await runCrmCommand("associateClientProject", {
        contactId,
        projectId: effectiveProjectId,
      });
      if (result.persisted) {
        setNewlyAssociatedProjectIds((current) =>
          Array.from(new Set([...current, effectiveProjectId])),
        );
        setNotice(
          `${selectedProject?.name ?? "Project"} is now linked. You can send portal access.`,
        );
      } else {
        setNotice("Preview: the client and project would now be linked.");
      }
    } catch (caught: unknown) {
      setNotice(
        caught instanceof Error
          ? caught.message
          : "The project could not be linked.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function invite() {
    if (!workspace.tenantId || !effectiveProjectId) return;
    setBusy("invite");
    setNotice("");
    try {
      const result = await runClientInvitation({
        type: "invite",
        tenantId: workspace.tenantId,
        idempotencyKey: crypto.randomUUID(),
        input: { contactId, projectId: effectiveProjectId },
      });
      const next: ClientInvitationStatus = {
        invitationId: String(result.invitationId ?? ""),
        projectId: effectiveProjectId,
        status: String(result.status ?? "pending"),
        expiresAt: String(result.expiresAt ?? ""),
        lastSentAt: new Date().toISOString(),
        sendCount: Number(selectedInvitation?.sendCount ?? 0) + 1,
        deliveryStatus: null,
        emailJobStatus: "queued",
      };
      setInvitationUpdates((current) => ({
        ...current,
        [effectiveProjectId]: next,
      }));
      setNotice(
        result.resent === true
          ? "A fresh branded invitation was queued. The earlier link is no longer valid."
          : "The branded client invitation was queued for SendGrid delivery.",
      );
    } catch (caught: unknown) {
      setNotice(
        caught instanceof Error ? caught.message : "Invitation failed.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function revoke() {
    if (
      !workspace.tenantId ||
      !selectedInvitation?.invitationId
    ) {
      return;
    }
    setBusy("revoke");
    setNotice("");
    try {
      await runClientInvitation({
        type: "revoke",
        tenantId: workspace.tenantId,
        idempotencyKey: crypto.randomUUID(),
        input: { invitationId: selectedInvitation.invitationId },
      });
      setInvitationUpdates((current) => ({
        ...current,
        [effectiveProjectId]: { ...selectedInvitation, status: "revoked" },
      }));
      setNotice("Portal invitation revoked. Its secure link no longer works.");
    } catch (caught: unknown) {
      setNotice(
        caught instanceof Error
          ? caught.message
          : "The invitation could not be revoked.",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="client-access-card" aria-label="Client portal access">
      <div className="client-access-heading">
        <span className="client-access-icon">
          <MailCheck aria-hidden="true" size={18} />
        </span>
        <span>
          <strong>Client portal access</strong>
          <small>
            Access is granted per project through a branded secure email.
          </small>
        </span>
      </div>

      <label>
        Project to share
        <select
          aria-label="Project to share"
          disabled={loadingProjects || busy !== null}
          onChange={(event) => setSelectedProjectId(event.target.value)}
          value={effectiveProjectId}
        >
          <option value="">
            {loadingProjects ? "Loading projects…" : "Select a project"}
          </option>
          {projectOptions.map((project) => (
            <option key={project.id} value={project.id}>
              {project.label}
            </option>
          ))}
        </select>
      </label>

      {!loadingProjects && !projects.length ? (
        <p className="client-access-empty">
          Create a project before inviting this client.
        </p>
      ) : null}

      {projectLoadError ? (
        <p className="client-access-empty">
          Projects could not be loaded. Retry the page before sharing portal
          access.
        </p>
      ) : null}

      {invitationStatusError ? (
        <p className="client-access-empty">
          Invitation history is temporarily unavailable. You can still link a
          project or send a new invitation.
        </p>
      ) : null}

      {effectiveProjectId ? (
        <div
          className={`client-access-status ${
            associated ? "is-associated" : ""
          }`}
        >
          {associated ? (
            <CheckCircle2 aria-hidden="true" size={16} />
          ) : (
            <Link2 aria-hidden="true" size={16} />
          )}
          <span>
            <strong>
              {associated
                ? invitationLabel(selectedInvitation, currentTime)
                : "Link this client to the project first"}
            </strong>
            <small>
              {associated
                ? selectedInvitation?.lastSentAt
                  ? `Last sent ${new Date(selectedInvitation.lastSentAt).toLocaleString()}`
                  : "Only this project will appear in the client portal."
                : "Linking updates both the client and project records."}
            </small>
          </span>
        </div>
      ) : null}

      <div className="client-access-actions">
        {!associated && effectiveProjectId ? (
          <button
            className="button button-secondary"
            disabled={busy !== null}
            onClick={() => void associate()}
            type="button"
          >
            {busy === "associate" ? (
              <LoaderCircle className="spin" />
            ) : (
              <Link2 />
            )}
            Link project
          </button>
        ) : null}
        {associated ? (
          <button
            className="button button-dark"
            disabled={busy !== null}
            onClick={() => void invite()}
            type="button"
          >
            {busy === "invite" ? (
              <LoaderCircle className="spin" />
            ) : pendingInvitation ? (
              <RefreshCw />
            ) : (
              <Send />
            )}
            {pendingInvitation ? "Resend invitation" : "Send portal invite"}
          </button>
        ) : null}
        {pendingInvitation ? (
          <button
            className="button button-quiet"
            disabled={busy !== null}
            onClick={() => void revoke()}
            type="button"
          >
            {busy === "revoke" ? (
              <LoaderCircle className="spin" />
            ) : (
              <ShieldX />
            )}
            Revoke
          </button>
        ) : null}
      </div>

      {notice ? (
        <p className="client-access-notice" role="status">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
