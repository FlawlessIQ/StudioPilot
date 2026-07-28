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
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  where,
} from "firebase/firestore";
import { useWorkspace } from "@/features/auth/workspace-context";
import { runClientInvitation } from "@/lib/client/invitation-client";
import { runCrmCommand } from "@/lib/crm/command-client";
import { getFirebaseClient } from "@/lib/firebase/client";
import { dataIsLive } from "@/lib/runtime-mode";

type ProjectOption = {
  id: string;
  name: string;
  eventDate: string | null;
  state: string;
};

type InvitationStatus = {
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
  invitation: InvitationStatus | null,
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
}: {
  contactId: string;
  projectIds: string[];
}) {
  const workspace = useWorkspace();
  const [associatedProjectIds, setAssociatedProjectIds] = useState(projectIds);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState(
    projectIds[0] ?? "",
  );
  const [invitations, setInvitations] = useState<InvitationStatus[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(dataIsLive);
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

  useEffect(() => {
    if (!dataIsLive || workspace.loading || !workspace.tenantId || !permitted) {
      if (!dataIsLive) {
        queueMicrotask(() => {
          setProjects([
            {
              id: "demo-project",
              name: "Rivera wedding",
              eventDate: "2027-06-12",
              state: "PLANNING",
            },
          ]);
          setLoadingProjects(false);
        });
      }
      return;
    }
    let active = true;
    const { firestore } = getFirebaseClient();
    const load =
      workspace.role === "studio_coordinator"
        ? Promise.all(
            workspace.projectIds.slice(0, 100).map((projectId) =>
              getDoc(doc(firestore, "projects", projectId)),
            ),
          ).then((documents) =>
            documents.filter((document) => document.exists()),
          )
        : getDocs(
            query(
              collection(firestore, "projects"),
              where("tenantId", "==", workspace.tenantId),
              limit(100),
            ),
          ).then((snapshot) => snapshot.docs);
    void load
      .then((documents) => {
        if (!active) return;
        const options = documents
          .map((document) => ({
            id: document.id,
            name: String(document.get("name") ?? "Untitled project"),
            eventDate:
              typeof document.get("eventDate") === "string"
                ? String(document.get("eventDate"))
                : null,
            state: String(document.get("state") ?? ""),
          }))
          .filter((project) => project.state !== "ARCHIVED")
          .sort((left, right) =>
            String(left.eventDate ?? "").localeCompare(
              String(right.eventDate ?? ""),
            ),
          );
        setProjects(options);
        setSelectedProjectId((current) =>
          options.some((project) => project.id === current)
            ? current
            : options[0]?.id ?? "",
        );
      })
      .catch(() => {
        if (active) setNotice("Projects could not be loaded.");
      })
      .finally(() => {
        if (active) setLoadingProjects(false);
      });
    return () => {
      active = false;
    };
  }, [
    permitted,
    workspace.loading,
    workspace.projectIds,
    workspace.role,
    workspace.tenantId,
  ]);

  useEffect(() => {
    if (
      !dataIsLive ||
      workspace.loading ||
      !workspace.tenantId ||
      !permitted
    ) {
      return;
    }
    let active = true;
    void runClientInvitation({
      type: "status",
      tenantId: workspace.tenantId,
      idempotencyKey: crypto.randomUUID(),
      input: { contactId },
    })
      .then((result) => {
        if (!active) return;
        const values = Array.isArray(result.invitations)
          ? result.invitations
              .filter(
                (value): value is Record<string, unknown> =>
                  typeof value === "object" && value !== null,
              )
              .map((value) => ({
                invitationId: String(value.invitationId ?? ""),
                projectId: String(value.projectId ?? ""),
                status: String(value.status ?? ""),
                expiresAt: String(value.expiresAt ?? ""),
                lastSentAt:
                  typeof value.lastSentAt === "string"
                    ? value.lastSentAt
                    : null,
                sendCount: Number(value.sendCount ?? 0),
                deliveryStatus:
                  typeof value.deliveryStatus === "string"
                    ? value.deliveryStatus
                    : null,
                emailJobStatus:
                  typeof value.emailJobStatus === "string"
                    ? value.emailJobStatus
                    : null,
              }))
          : [];
        setInvitations(values);
      })
      .catch(() => {
        // Invitation status is supplemental; the invite action remains usable.
      });
    return () => {
      active = false;
    };
  }, [
    contactId,
    permitted,
    workspace.loading,
    workspace.tenantId,
  ]);

  const selectedProject = projects.find(
    (project) => project.id === selectedProjectId,
  );
  const associated = associatedProjectIds.includes(selectedProjectId);
  const selectedInvitation =
    invitations.find(
      (invitation) => invitation.projectId === selectedProjectId,
    ) ?? null;
  const pendingInvitation =
    selectedInvitation?.status === "pending" &&
    (!currentTime || selectedInvitation.expiresAt > currentTime);
  const projectOptions = useMemo(
    () =>
      projects.map((project) => ({
        ...project,
        label: `${project.name}${project.eventDate ? ` · ${new Date(`${project.eventDate}T12:00:00`).toLocaleDateString()}` : ""}`,
      })),
    [projects],
  );

  if (!permitted) return null;

  async function associate() {
    if (!selectedProjectId) return;
    setBusy("associate");
    setNotice("");
    try {
      const result = await runCrmCommand("associateClientProject", {
        contactId,
        projectId: selectedProjectId,
      });
      if (result.persisted) {
        setAssociatedProjectIds((current) =>
          Array.from(new Set([...current, selectedProjectId])),
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
    if (!workspace.tenantId || !selectedProjectId) return;
    setBusy("invite");
    setNotice("");
    try {
      const result = await runClientInvitation({
        type: "invite",
        tenantId: workspace.tenantId,
        idempotencyKey: crypto.randomUUID(),
        input: { contactId, projectId: selectedProjectId },
      });
      const next: InvitationStatus = {
        invitationId: String(result.invitationId ?? ""),
        projectId: selectedProjectId,
        status: String(result.status ?? "pending"),
        expiresAt: String(result.expiresAt ?? ""),
        lastSentAt: new Date().toISOString(),
        sendCount: Number(selectedInvitation?.sendCount ?? 0) + 1,
        deliveryStatus: null,
        emailJobStatus: "queued",
      };
      setInvitations((current) => [
        ...current.filter(
          (invitation) => invitation.projectId !== selectedProjectId,
        ),
        next,
      ]);
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
      setInvitations((current) =>
        current.map((invitation) =>
          invitation.invitationId === selectedInvitation.invitationId
            ? { ...invitation, status: "revoked" }
            : invitation,
        ),
      );
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
          value={selectedProjectId}
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

      {selectedProjectId ? (
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
        {!associated && selectedProjectId ? (
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
