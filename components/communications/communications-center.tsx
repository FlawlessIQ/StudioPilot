"use client";

import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  Clock3,
  LoaderCircle,
  Mail,
  Send,
  ShieldCheck,
} from "lucide-react";
import {
  collection,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import { StatusBadge } from "@/components/ui/status-badge";
import { useWorkspace } from "@/features/auth/workspace-context";
import { sendCommunicationsCommand } from "@/lib/communications/command-client";
import { getFirebaseClient } from "@/lib/firebase/client";

type Value = Record<string, unknown> & { id: string };

function stamp(value: unknown) {
  const date = new Date(String(value ?? ""));
  return Number.isNaN(date.valueOf())
    ? "Pending"
    : new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(date);
}

export function CommunicationsCenter({
  initialProjectId,
}: {
  initialProjectId?: string;
}) {
  const workspace = useWorkspace();
  const [projects, setProjects] = useState<Value[]>([]);
  const [contacts, setContacts] = useState<Value[]>([]);
  const [messages, setMessages] = useState<Value[]>([]);
  const [drafts, setDrafts] = useState<Value[]>([]);
  const [projectId, setProjectId] = useState(initialProjectId ?? "");
  const [contactId, setContactId] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState("general");
  const [actionLabel, setActionLabel] = useState("");
  const [actionUrl, setActionUrl] = useState("");
  const [scheduledFor, setScheduledFor] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!workspace.tenantId) return;
    setLoading(true);
    try {
      const { firestore } = getFirebaseClient();
      const [projectSnapshot, contactSnapshot, messageSnapshot, draftSnapshot] =
        await Promise.all([
          getDocs(
            query(
              collection(firestore, "projects"),
              where("tenantId", "==", workspace.tenantId),
            ),
          ),
          getDocs(
            query(
              collection(firestore, "contacts"),
              where("tenantId", "==", workspace.tenantId),
            ),
          ),
          getDocs(
            query(
              collection(firestore, "messages"),
              where("tenantId", "==", workspace.tenantId),
            ),
          ),
          getDocs(
            query(
              collection(firestore, "communicationDrafts"),
              where("tenantId", "==", workspace.tenantId),
            ),
          ),
        ]);
      setProjects(
        projectSnapshot.docs
          .map((item): Value => ({ id: item.id, ...item.data() }))
          .sort((left, right) =>
            String(left.eventDate ?? "").localeCompare(
              String(right.eventDate ?? ""),
            ),
          ),
      );
      setContacts(
        contactSnapshot.docs.map(
          (item): Value => ({ id: item.id, ...item.data() }),
        ),
      );
      setMessages(
        messageSnapshot.docs
          .map((item): Value => ({ id: item.id, ...item.data() }))
          .sort((left, right) =>
            String(right.sentAt ?? "").localeCompare(String(left.sentAt ?? "")),
          )
          .slice(0, 50),
      );
      setDrafts(
        draftSnapshot.docs
          .map((item): Value => ({ id: item.id, ...item.data() }))
          .filter((item) => item.status === "needs_approval")
          .sort((left, right) =>
            String(right.createdAt ?? "").localeCompare(
              String(left.createdAt ?? ""),
            ),
          ),
      );
    } catch (error: unknown) {
      setNotice(error instanceof Error ? error.message : "Messages could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [workspace.tenantId]);

  useEffect(() => {
    if (!workspace.loading && workspace.tenantId) {
      void Promise.resolve().then(load);
    }
  }, [load, workspace.loading, workspace.tenantId]);

  const selectedProject = projects.find((item) => item.id === projectId);
  const availableContacts = useMemo(() => {
    const ids = Array.isArray(selectedProject?.clientContactIds)
      ? selectedProject.clientContactIds
      : [];
    return contacts.filter((contact) => ids.includes(contact.id));
  }, [contacts, selectedProject]);

  const selectedContactId = availableContacts.some(
    (contact) => contact.id === contactId,
  )
    ? contactId
    : (availableContacts[0]?.id ?? "");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("send");
    setNotice(null);
    try {
      const response = await sendCommunicationsCommand({
        type: "sendMessage",
        idempotencyKey: crypto.randomUUID(),
        input: {
          projectId,
          contactId: selectedContactId,
          subject,
          body,
          category,
          actionLabel: actionLabel.trim() || null,
          actionUrl: actionUrl.trim() || null,
          scheduledFor: scheduledFor
            ? new Date(scheduledFor).toISOString()
            : null,
        },
      });
      const payload =
        response.payload && typeof response.payload === "object"
          ? (response.payload as Record<string, unknown>)
          : {};
      setNotice(
        payload.requiresApproval
          ? "Saved for owner or administrator approval."
          : scheduledFor
            ? "Branded email scheduled."
            : "Branded email queued for delivery.",
      );
      setSubject("");
      setBody("");
      setActionLabel("");
      setActionUrl("");
      setScheduledFor("");
      await load();
    } catch (error: unknown) {
      setNotice(
        error instanceof Error
          ? error.message.replaceAll("_", " ")
          : "The message could not be queued.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function approve(draftId: string) {
    setBusy(draftId);
    setNotice(null);
    try {
      await sendCommunicationsCommand({
        type: "approveMessage",
        idempotencyKey: crypto.randomUUID(),
        input: { draftId },
      });
      setNotice("Message approved and queued.");
      await load();
    } catch (error: unknown) {
      setNotice(
        error instanceof Error
          ? error.message.replaceAll("_", " ")
          : "The message could not be approved.",
      );
    } finally {
      setBusy(null);
    }
  }

  const canApprove = ["studio_owner", "studio_admin"].includes(
    workspace.role ?? "",
  );

  return (
    <div className="communications-layout">
      <section className="panel communications-compose">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Branded email</p>
            <h2>Write to a client</h2>
            <p>Every message uses the studio’s approved email branding and is kept in project history.</p>
          </div>
          <Mail aria-hidden="true" />
        </div>
        <form onSubmit={(event) => void submit(event)}>
          <div className="communications-form-grid">
            <label>
              Project
              <select
                onChange={(event) => setProjectId(event.target.value)}
                required
                value={projectId}
              >
                <option value="">Select a project</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {String(project.name)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Client
              <select
                disabled={!projectId}
                onChange={(event) => setContactId(event.target.value)}
                required
                value={selectedContactId}
              >
                <option value="">Select a client</option>
                {availableContacts.map((contact) => (
                  <option key={contact.id} value={contact.id}>
                    {String(contact.displayName ?? contact.email)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Message type
              <select
                onChange={(event) => setCategory(event.target.value)}
                value={category}
              >
                <option value="general">General project update</option>
                <option value="financial">Financial</option>
                <option value="contract">Contractual</option>
                <option value="insurance">Insurance</option>
              </select>
            </label>
            <label>
              Send later (optional)
              <input
                min={new Date().toISOString().slice(0, 16)}
                onChange={(event) => setScheduledFor(event.target.value)}
                type="datetime-local"
                value={scheduledFor}
              />
            </label>
          </div>
          <label>
            Subject
            <input
              maxLength={180}
              onChange={(event) => setSubject(event.target.value)}
              placeholder="A clear description of the update"
              required
              value={subject}
            />
          </label>
          <label>
            Message
            <textarea
              maxLength={8000}
              onChange={(event) => setBody(event.target.value)}
              placeholder="Write the client-facing message. StudioCue will place it inside the studio’s branded email."
              required
              rows={7}
              value={body}
            />
          </label>
          <details className="communications-action-options">
            <summary>Add an action button</summary>
            <div className="communications-form-grid">
              <label>
                Button label
                <input
                  onChange={(event) => setActionLabel(event.target.value)}
                  placeholder="Open project portal"
                  value={actionLabel}
                />
              </label>
              <label>
                Secure destination
                <input
                  onChange={(event) => setActionUrl(event.target.value)}
                  placeholder="https://"
                  type="url"
                  value={actionUrl}
                />
              </label>
            </div>
          </details>
          {category !== "general" ? (
            <p className="communications-approval-note">
              <ShieldCheck size={15} />
              Financial, contractual, and insurance messages require owner or administrator approval when drafted by a coordinator.
            </p>
          ) : null}
          <button
            className="button"
            disabled={busy !== null || !projectId || !selectedContactId}
            type="submit"
          >
            {busy === "send"
              ? "Preparing…"
              : scheduledFor
                ? "Schedule branded email"
                : "Send branded email"}
            <Send size={15} />
          </button>
        </form>
        {notice ? <p className="communications-notice" role="status">{notice}</p> : null}
      </section>

      <aside className="communications-history">
        {drafts.length ? (
          <section className="panel communications-approval-queue">
            <div className="panel-heading">
              <div><p className="eyebrow">Control point</p><h2>Awaiting approval</h2></div>
              <StatusBadge tone="warning">{drafts.length}</StatusBadge>
            </div>
            {drafts.map((draft) => (
              <article key={draft.id}>
                <span><strong>{String(draft.subject)}</strong><small>{String(draft.projectName)} · {String(draft.category)}</small></span>
                {canApprove ? (
                  <button
                    className="button button-small"
                    disabled={busy !== null}
                    onClick={() => void approve(draft.id)}
                    type="button"
                  >
                    {busy === draft.id ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />}
                    Approve
                  </button>
                ) : (
                  <StatusBadge tone="warning">Owner review</StatusBadge>
                )}
              </article>
            ))}
          </section>
        ) : null}
        <section className="panel communications-timeline">
          <div className="panel-heading">
            <div><p className="eyebrow">Delivery history</p><h2>Recent messages</h2></div>
            <Clock3 aria-hidden="true" />
          </div>
          {loading ? (
            <div className="communications-empty"><LoaderCircle className="spin" /><span>Loading messages…</span></div>
          ) : messages.length ? (
            messages.map((message) => (
              <article key={message.id}>
                <span className="communications-message-icon"><Mail size={15} /></span>
                <span>
                  <strong>{String(message.subject)}</strong>
                  <small>To {String(message.recipient)} · {stamp(message.sentAt)}</small>
                  {message.bodyPreview ? <p>{String(message.bodyPreview)}</p> : null}
                </span>
                <StatusBadge
                  tone={
                    ["delivered", "opened", "clicked"].includes(
                      String(message.deliveryStatus),
                    )
                      ? "success"
                      : "info"
                  }
                >
                  {String(message.deliveryStatus ?? "sent")}
                </StatusBadge>
              </article>
            ))
          ) : (
            <div className="communications-empty">
              <Mail />
              <span><strong>No messages yet</strong><small>Your branded delivery history will appear here.</small></span>
            </div>
          )}
        </section>
      </aside>
    </div>
  );
}
