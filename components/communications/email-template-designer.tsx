"use client";

import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Clock3,
  Eye,
  LoaderCircle,
  MailCheck,
  Palette,
  Save,
  Send,
} from "lucide-react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { StatusBadge } from "@/components/ui/status-badge";
import { useWorkspace } from "@/features/auth/workspace-context";
import { sendCommunicationsCommand } from "@/lib/communications/command-client";
import { getFirebaseClient } from "@/lib/firebase/client";

const templateKeys = [
  "staff_invitation",
  "client_invitation",
  "crew_invitation",
  "email_verification",
  "password_reset",
  "inquiry_acknowledgement",
  "consultation_confirmation",
  "consultation_invitation",
  "consultation_reminder",
  "package_follow_up",
  "proposal_sent",
  "contract_sent",
  "retainer_invoice",
  "booking_confirmation",
  "questionnaire_request",
  "questionnaire_reminder",
  "coi_request",
  "coi_correction",
  "coi_venue_delivery",
  "crew_reminder",
  "final_invoice",
  "final_payment_reminder",
  "schedule_review",
  "final_schedule_published",
  "event_reminder",
  "thank_you",
  "delivery",
  "review_request",
  "manual_message",
] as const;

type TemplateKey = (typeof templateKeys)[number];
type TemplateRecord = {
  id: string;
  key: TemplateKey;
  name: string;
  subject: string;
  preheader: string;
  eyebrow: string;
  heading: string;
  paragraphs: string[];
  actionLabel: string | null;
  note: string | null;
  version: number;
  status: string;
  createdAt: string;
};

const label = (key: string) =>
  key
    .split("_")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");

const starter = (key: TemplateKey, studioName: string) => ({
  name: label(key),
  subject: `${label(key)} from {{studioName}}`,
  preheader: `An update from ${studioName}.`,
  eyebrow: label(key),
  heading: `A thoughtful next step from {{studioName}}`,
  paragraphs: [
    "Hi {{recipientName}},",
    "We have an update for {{projectName}}. Review the details below and use the secure button when you are ready.",
  ],
  actionLabel: "Open secure details",
  note: "Questions? Reply to this email and our studio team will help.",
});

function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? "Recently"
    : new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(date);
}

export function EmailTemplateDesigner() {
  const workspace = useWorkspace();
  const [key, setKey] = useState<TemplateKey>("client_invitation");
  const [templates, setTemplates] = useState<TemplateRecord[]>([]);
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [preheader, setPreheader] = useState("");
  const [eyebrow, setEyebrow] = useState("");
  const [heading, setHeading] = useState("");
  const [paragraphs, setParagraphs] = useState("");
  const [actionLabel, setActionLabel] = useState("");
  const [note, setNote] = useState("");
  const [testRecipient, setTestRecipient] = useState(workspace.userEmail);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!workspace.tenantId) return;
    const { firestore } = getFirebaseClient();
    const [versions, pointers] = await Promise.all([
      getDocs(
        query(
          collection(firestore, "messageTemplates"),
          where("tenantId", "==", workspace.tenantId),
        ),
      ),
      getDocs(
        query(
          collection(firestore, "messageTemplatePointers"),
          where("tenantId", "==", workspace.tenantId),
        ),
      ),
    ]);
    setTemplates(
      versions.docs
        .map((item) => ({ id: item.id, ...item.data() }) as TemplateRecord)
        .sort((left, right) => right.version - left.version),
    );
    const pointer = pointers.docs.find((item) => item.get("key") === key);
    setActiveTemplateId(
      typeof pointer?.get("activeTemplateId") === "string"
        ? pointer.get("activeTemplateId")
        : null,
    );
  }, [key, workspace.tenantId]);

  useEffect(() => {
    if (!workspace.loading && workspace.tenantId) {
      queueMicrotask(() => {
        void load().catch((error: unknown) =>
          setNotice(
            error instanceof Error
              ? error.message
              : "Template history could not be loaded.",
          ),
        );
      });
    }
  }, [load, workspace.loading, workspace.tenantId]);

  const keyTemplates = useMemo(
    () => templates.filter((template) => template.key === key),
    [key, templates],
  );

  useEffect(() => {
    const current =
      keyTemplates.find((template) => template.id === activeTemplateId) ??
      keyTemplates[0];
    const value = current ?? starter(key, workspace.tenantName);
    queueMicrotask(() => {
      setName(value.name);
      setSubject(value.subject);
      setPreheader(value.preheader);
      setEyebrow(value.eyebrow);
      setHeading(value.heading);
      setParagraphs(value.paragraphs.join("\n\n"));
      setActionLabel(value.actionLabel ?? "");
      setNote(value.note ?? "");
    });
  }, [activeTemplateId, key, keyTemplates, workspace.tenantName]);

  const content = {
    key,
    name,
    subject,
    preheader,
    eyebrow,
    heading,
    paragraphs: paragraphs
      .split(/\n\s*\n/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean),
    actionLabel: actionLabel.trim() || null,
    note: note.trim() || null,
  };

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("save");
    setNotice(null);
    try {
      const response = await sendCommunicationsCommand({
        type: "saveTemplateVersion",
        idempotencyKey: crypto.randomUUID(),
        input: content,
      });
      const result = response.payload as { templateId?: string };
      setNotice("A new draft version was saved. Activate it when approved.");
      await load();
      if (result.templateId) setBusy(null);
    } catch (error: unknown) {
      setNotice(
        error instanceof Error
          ? error.message.replaceAll("_", " ")
          : "The template could not be saved.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function activate(templateId: string) {
    setBusy(templateId);
    setNotice(null);
    try {
      await sendCommunicationsCommand({
        type: "activateTemplateVersion",
        idempotencyKey: crypto.randomUUID(),
        input: { templateId },
      });
      setNotice("This version is now used for future matching emails.");
      await load();
    } catch (error: unknown) {
      setNotice(
        error instanceof Error
          ? error.message.replaceAll("_", " ")
          : "The version could not be activated.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function sendTest() {
    const templateId = keyTemplates[0]?.id;
    if (!templateId) {
      setNotice("Save a draft version before sending a test.");
      return;
    }
    setBusy("test");
    setNotice(null);
    try {
      await sendCommunicationsCommand({
        type: "sendTemplateTest",
        idempotencyKey: crypto.randomUUID(),
        input: { templateId, recipient: testRecipient },
      });
      setNotice(`A branded test was queued for ${testRecipient}.`);
    } catch (error: unknown) {
      setNotice(
        error instanceof Error
          ? error.message.replaceAll("_", " ")
          : "The test email could not be queued.",
      );
    } finally {
      setBusy(null);
    }
  }

  if (!["studio_owner", "studio_admin"].includes(workspace.role ?? "")) {
    return null;
  }

  return (
    <section className="email-designer">
      <header className="email-designer-heading">
        <div>
          <p className="eyebrow">Email design system</p>
          <h2>Branded template studio</h2>
          <p>
            Refine transactional email, preview it in context, and publish an
            immutable version without changing messages already sent.
          </p>
        </div>
        <span className="email-designer-icon">
          <Palette aria-hidden="true" />
        </span>
      </header>

      <div className="email-designer-grid">
        <form className="panel email-designer-form" onSubmit={(event) => void save(event)}>
          <label>
            Email journey
            <select
              onChange={(event) => setKey(event.target.value as TemplateKey)}
              value={key}
            >
              {templateKeys.map((templateKey) => (
                <option key={templateKey} value={templateKey}>
                  {label(templateKey)}
                </option>
              ))}
            </select>
          </label>
          <div className="email-designer-fields">
            <label>
              Internal name
              <input onChange={(event) => setName(event.target.value)} required value={name} />
            </label>
            <label>
              Eyebrow
              <input onChange={(event) => setEyebrow(event.target.value)} required value={eyebrow} />
            </label>
          </div>
          <label>
            Subject line
            <input onChange={(event) => setSubject(event.target.value)} required value={subject} />
          </label>
          <label>
            Inbox preview
            <input onChange={(event) => setPreheader(event.target.value)} value={preheader} />
          </label>
          <label>
            Headline
            <input onChange={(event) => setHeading(event.target.value)} required value={heading} />
          </label>
          <label>
            Body paragraphs
            <textarea
              onChange={(event) => setParagraphs(event.target.value)}
              required
              rows={7}
              value={paragraphs}
            />
            <small>Separate paragraphs with a blank line.</small>
          </label>
          <div className="email-designer-fields">
            <label>
              Button label
              <input onChange={(event) => setActionLabel(event.target.value)} value={actionLabel} />
            </label>
            <label>
              Footer note
              <input onChange={(event) => setNote(event.target.value)} value={note} />
            </label>
          </div>
          <p className="email-designer-tokens">
            Available variables: {"{{studioName}}"}, {"{{recipientName}}"},{" "}
            {"{{projectName}}"}, and secure destination variables.
          </p>
          <button className="button" disabled={busy !== null} type="submit">
            {busy === "save" ? <LoaderCircle className="spin" /> : <Save />}
            Save new version
          </button>
        </form>

        <div className="email-designer-preview-column">
          <article className="email-designer-preview">
            <div className="email-preview-inbox">
              <span>
                <strong>{subject || "Your email subject"}</strong>
                <small>{preheader || "Inbox preview appears here."}</small>
              </span>
              <Eye aria-hidden="true" />
            </div>
            <div className="email-preview-canvas">
              <div className="email-preview-brand">
                <span>SC</span>
                <strong>{workspace.tenantName}</strong>
              </div>
              <div className="email-preview-content">
                <small>{eyebrow}</small>
                <h3>{heading}</h3>
                {content.paragraphs.map((paragraph, index) => (
                  <p key={`${paragraph}-${index}`}>{paragraph}</p>
                ))}
                {actionLabel ? <span className="email-preview-button">{actionLabel}</span> : null}
                {note ? <em>{note}</em> : null}
              </div>
            </div>
          </article>

          <section className="panel email-designer-test">
            <div>
              <MailCheck aria-hidden="true" />
              <span>
                <strong>Test before publishing</strong>
                <small>The latest saved version is sent with sample project data.</small>
              </span>
            </div>
            <div>
              <input
                onChange={(event) => setTestRecipient(event.target.value)}
                placeholder="you@studio.com"
                type="email"
                value={testRecipient}
              />
              <button
                className="button button-secondary"
                disabled={busy !== null || !testRecipient}
                onClick={() => void sendTest()}
                type="button"
              >
                {busy === "test" ? <LoaderCircle className="spin" /> : <Send />}
                Send test
              </button>
            </div>
          </section>
        </div>
      </div>

      <section className="panel email-version-history">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Immutable history</p>
            <h3>{label(key)} versions</h3>
          </div>
          <Clock3 aria-hidden="true" />
        </div>
        {keyTemplates.length ? (
          <div className="email-version-list">
            {keyTemplates.map((template) => {
              const active = template.id === activeTemplateId;
              return (
                <article key={template.id}>
                  <span>
                    <strong>Version {template.version}</strong>
                    <small>
                      {template.subject} · {dateLabel(template.createdAt)}
                    </small>
                  </span>
                  {active ? (
                    <StatusBadge tone="success">
                      <CheckCircle2 size={13} /> Active
                    </StatusBadge>
                  ) : (
                    <button
                      className="button button-small button-secondary"
                      disabled={busy !== null}
                      onClick={() => void activate(template.id)}
                      type="button"
                    >
                      {busy === template.id ? <LoaderCircle className="spin" /> : null}
                      Activate
                    </button>
                  )}
                </article>
              );
            })}
          </div>
        ) : (
          <p className="email-version-empty">
            No custom versions yet. StudioCue is using its secure default copy.
          </p>
        )}
      </section>
      {notice ? <p className="communications-notice" role="status">{notice}</p> : null}
    </section>
  );
}
