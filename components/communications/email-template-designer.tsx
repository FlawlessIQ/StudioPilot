"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LoaderCircle, MailCheck, RotateCcw, Save, Send } from "lucide-react";
import { useWorkspace } from "@/features/auth/workspace-context";
import { sendCommunicationsCommand } from "@/lib/communications/command-client";
import { friendlyError } from "@/lib/ai/friendly-error";
import { EMAIL_GROUPS, editableEmailsFor, emailGroupLabel } from "@/features/communications/email-catalog";

/**
 * Settings → Email templates: change the words of the emails StudioCue sends.
 *
 * GR, 2026-10-08: "I see where but it doesn't let me adjust." The old editor
 * opened every email on the same placeholder copy, never the email itself;
 * saving made a draft that did nothing until a separate button further down
 * made it live; and a saved body replaced every
 * date, time and amount the email carried. Now the email shows as it arrives,
 * the studio's words go above StudioCue's unless they choose to replace them,
 * and one tap saves and starts using it.
 */

type Copy = {
  subject: string;
  preheader: string;
  eyebrow: string;
  heading: string;
  paragraphs: string[];
  actionLabel: string | null;
  note: string | null;
  mode?: "add" | "replace";
};

type Preview = {
  subject: string;
  html: string;
  defaults: Copy;
  active: { templateId: string; version: number; createdAt: string | null; content: Copy } | null;
};

type Fields = {
  subject: string;
  heading: string;
  words: string;
  mode: "add" | "replace";
  actionLabel: string;
  note: string;
};

const EMPTY: Fields = { subject: "", heading: "", words: "", mode: "add", actionLabel: "", note: "" };

const fieldsFrom = (copy: Copy | null | undefined): Fields =>
  copy
    ? {
        subject: copy.subject ?? "",
        heading: copy.heading ?? "",
        words: (copy.paragraphs ?? []).join("\n\n"),
        mode: copy.mode === "add" ? "add" : "replace",
        actionLabel: copy.actionLabel ?? "",
        note: copy.note ?? "",
      }
    : EMPTY;

const paragraphsOf = (words: string) =>
  words
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

function contentOf(key: string, label: string, fields: Fields) {
  return {
    key,
    name: label,
    subject: fields.subject.trim(),
    preheader: "",
    eyebrow: "",
    heading: fields.heading.trim(),
    paragraphs: paragraphsOf(fields.words).slice(0, 8),
    actionLabel: fields.actionLabel.trim() || null,
    note: fields.note.trim() || null,
    mode: fields.mode,
  };
}

const changed = (fields: Fields) =>
  Boolean(fields.subject.trim() || fields.heading.trim() || fields.words.trim() || fields.actionLabel.trim() || fields.note.trim());

function dateLabel(value: string | null) {
  const date = new Date(value ?? "");
  return Number.isNaN(date.valueOf())
    ? null
    : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

export function EmailTemplateDesigner() {
  const workspace = useWorkspace();
  // This studio's emails, in its trade's words: no delivery emails for a DJ.
  const emails = useMemo(() => editableEmailsFor(workspace.tenantTrade), [workspace.tenantTrade]);
  const mayEdit = ["studio_owner", "studio_admin"].includes(workspace.role ?? "");
  const [key, setKey] = useState(emails[0]!.key);
  const email = emails.find((entry) => entry.key === key) ?? emails[0]!;
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true);
  const [fields, setFields] = useState<Fields>(EMPTY);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<"save" | "reset" | "test" | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [testRecipient, setTestRecipient] = useState(workspace.userEmail ?? "");
  const requestId = useRef(0);

  const runPreview = useCallback(
    async (content: ReturnType<typeof contentOf> | null) => {
      const id = ++requestId.current;
      const response = await sendCommunicationsCommand({
        type: "previewTemplate",
        idempotencyKey: crypto.randomUUID(),
        input: { key, content },
      });
      // A slower answer for an earlier keystroke or email never overwrites a newer one.
      if (id !== requestId.current) return null;
      const payload = response.payload as Partial<Preview>;
      return typeof payload.html === "string" ? (payload as Preview) : null;
    },
    [key],
  );

  // Each email opens as it is now: theirs if they have one, else StudioCue's.
  useEffect(() => {
    if (!mayEdit || workspace.loading || !workspace.tenantId) return;
    let active = true;
    queueMicrotask(() => {
      setLoading(true);
      setNotice(null);
      setDirty(false);
    });
    void runPreview(null)
      .then((result) => {
        if (!active || !result) return;
        setPreview(result);
        setFields(fieldsFrom(result.active?.content));
      })
      .catch((caught: unknown) => {
        if (active) setNotice({ tone: "error", text: friendlyError(caught, "That email couldn't be loaded. Try again.") });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [mayEdit, runPreview, workspace.loading, workspace.tenantId]);

  // As they type, the preview follows — a moment after they pause.
  useEffect(() => {
    if (!dirty) return;
    const timer = window.setTimeout(() => {
      const content = changed(fields) ? contentOf(key, email.label, fields) : null;
      // Replacing with nothing yet: show StudioCue's until there are words.
      if (content && content.mode === "replace" && !content.paragraphs.length) return;
      void runPreview(content)
        .then((result) => {
          if (result) setPreview((current) => (current ? { ...current, subject: result.subject, html: result.html } : result));
        })
        .catch(() => undefined);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [dirty, email.label, fields, key, runPreview]);

  function set<K extends keyof Fields>(name: K, value: Fields[K]) {
    setFields((current) => ({ ...current, [name]: value }));
    setDirty(true);
    setNotice(null);
  }

  async function reload(message: string) {
    const result = await runPreview(null);
    if (result) {
      setPreview(result);
      setFields(fieldsFrom(result.active?.content));
    }
    setDirty(false);
    setNotice({ tone: "ok", text: message });
  }

  async function save() {
    if (fields.mode === "replace" && !paragraphsOf(fields.words).length) {
      setNotice({ tone: "error", text: "Write the message first — replacing StudioCue's wording with nothing would send an empty email." });
      return;
    }
    if (!changed(fields)) {
      setNotice({ tone: "error", text: "Nothing's changed yet. To use StudioCue's wording, there's nothing to save." });
      return;
    }
    setBusy("save");
    setNotice(null);
    try {
      await sendCommunicationsCommand({
        type: "saveTemplateVersion",
        idempotencyKey: crypto.randomUUID(),
        input: { ...contentOf(key, email.label, fields), activate: true },
      });
      await reload(`Saved. Every “${email.label}” email from now on uses your version.`);
    } catch (caught: unknown) {
      setNotice({ tone: "error", text: friendlyError(caught, "That couldn't be saved. Nothing was changed.") });
    } finally {
      setBusy(null);
    }
  }

  async function reset() {
    setBusy("reset");
    setNotice(null);
    try {
      await sendCommunicationsCommand({
        type: "resetTemplate",
        idempotencyKey: crypto.randomUUID(),
        input: { key },
      });
      await reload(`Back to StudioCue's wording for “${email.label}”.`);
    } catch (caught: unknown) {
      setNotice({ tone: "error", text: friendlyError(caught, "That couldn't be changed back. Try again.") });
    } finally {
      setBusy(null);
    }
  }

  async function sendTest() {
    const templateId = preview?.active?.templateId;
    if (!templateId) return;
    setBusy("test");
    setNotice(null);
    try {
      await sendCommunicationsCommand({
        type: "sendTemplateTest",
        idempotencyKey: crypto.randomUUID(),
        input: { templateId, recipient: testRecipient },
      });
      setNotice({ tone: "ok", text: `A test is on its way to ${testRecipient}.` });
    } catch (caught: unknown) {
      setNotice({ tone: "error", text: friendlyError(caught, "The test couldn't be sent.") });
    } finally {
      setBusy(null);
    }
  }

  const defaults = preview?.defaults;
  const grouped = useMemo(
    () => EMAIL_GROUPS.map((group) => ({ group, emails: emails.filter((entry) => entry.group === group) })),
    [emails],
  );

  if (!mayEdit)
    return <p className="form-notice">Only the studio owner or an admin can change email wording.</p>;

  const customSince = preview?.active ? dateLabel(preview.active.createdAt) : null;

  return (
    <section className="email-editor" aria-labelledby="email-editor-title">
      <header className="email-editor-head">
        <h2 id="email-editor-title">Email wording</h2>
        <p>
          Every email your clients and crew get, as it arrives. Add your own words, or replace ours — your logo,
          colors and sign-off come from Email branding.
        </p>
      </header>

      <label className="email-editor-pick">
        <span>Email</span>
        <select onChange={(event) => setKey(event.target.value)} value={key}>
          {grouped.map(({ group, emails }) => (
            <optgroup key={group} label={emailGroupLabel(group, workspace.tenantTrade)}>
              {emails.map((entry) => (
                <option key={entry.key} value={entry.key}>
                  {entry.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <small>
          {email.when}.{" "}
          {preview?.active
            ? `Using your version${customSince ? ` since ${customSince}` : ""}.`
            : "Using StudioCue's wording."}
        </small>
      </label>

      <div className="email-editor-body">
        <form
          className="email-editor-form"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <fieldset className="email-editor-mode">
            <legend>Your words</legend>
            <label>
              <input checked={fields.mode === "add"} name="email-mode" onChange={() => set("mode", "add")} type="radio" />
              <span>
                <strong>Add them above ours</strong>
                <small>Recommended. Dates, times, amounts and links stay in.</small>
              </span>
            </label>
            <label>
              <input checked={fields.mode === "replace"} name="email-mode" onChange={() => set("mode", "replace")} type="radio" />
              <span>
                <strong>Replace ours</strong>
                <small>Your words are the whole message. The details in ours below won&rsquo;t be included — the button still is.</small>
              </span>
            </label>
          </fieldset>
          <label>
            <span>{fields.mode === "add" ? "What you'd like to say" : "Your message"}</span>
            <textarea
              onChange={(event) => set("words", event.target.value)}
              placeholder={
                fields.mode === "add"
                  ? "Goes under the greeting, before our wording. Leave it empty to add nothing."
                  : "Write the whole message. Separate paragraphs with a blank line."
              }
              rows={6}
              value={fields.words}
            />
            <small>
              You can use {"{{recipientName}}"}, {"{{studioName}}"} and {"{{projectName}}"}. Separate paragraphs with a blank line.
            </small>
          </label>
          {fields.mode === "replace" && defaults?.paragraphs.length ? (
            <div className="email-editor-reference">
              <span>Our wording, for reference (shown with sample details)</span>
              {defaults.paragraphs.map((paragraph, index) => (
                <p key={`${index}-${paragraph.slice(0, 12)}`}>{paragraph}</p>
              ))}
            </div>
          ) : null}
          <label>
            <span>Subject line</span>
            <input onChange={(event) => set("subject", event.target.value)} placeholder={defaults?.subject ?? ""} value={fields.subject} />
          </label>
          <label>
            <span>Headline</span>
            <input onChange={(event) => set("heading", event.target.value)} placeholder={defaults?.heading ?? ""} value={fields.heading} />
          </label>
          <div className="email-editor-pair">
            <label>
              <span>Button</span>
              <input
                onChange={(event) => set("actionLabel", event.target.value)}
                placeholder={defaults?.actionLabel ?? "No button"}
                value={fields.actionLabel}
              />
            </label>
            <label>
              <span>Footer note</span>
              <input onChange={(event) => set("note", event.target.value)} placeholder={defaults?.note ?? "None"} value={fields.note} />
            </label>
          </div>
          <p className="email-editor-hint">Anything you leave empty keeps StudioCue&rsquo;s wording.</p>
          {notice ? (
            <p className={notice.tone === "error" ? "form-error" : "form-notice"} role="status">
              {notice.text}
            </p>
          ) : null}
          <div className="email-editor-actions">
            <button className="button button-dark" disabled={busy !== null || loading} type="submit">
              {busy === "save" ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}
              Save &amp; use
            </button>
            {preview?.active ? (
              <button className="button button-light" disabled={busy !== null} onClick={() => void reset()} type="button">
                {busy === "reset" ? <LoaderCircle className="spin" size={16} /> : <RotateCcw size={16} />}
                Back to StudioCue&rsquo;s wording
              </button>
            ) : null}
          </div>
        </form>

        <div className="email-editor-preview">
          <p className="email-editor-subject">
            <span>Subject</span>
            {preview?.subject ?? "…"}
          </p>
          {loading && !preview ? (
            <p className="email-editor-loading">
              <LoaderCircle className="spin" size={16} /> Loading the email…
            </p>
          ) : (
            <iframe
              className="email-editor-frame"
              sandbox=""
              srcDoc={preview?.html ?? ""}
              title={`${email.label} email preview`}
            />
          )}
          <p className="email-editor-hint">Shown with sample details. Real emails use the job&rsquo;s own.</p>
          {preview?.active ? (
            <div className="email-editor-test">
              <MailCheck aria-hidden="true" size={16} />
              <input
                aria-label="Send a test to"
                onChange={(event) => setTestRecipient(event.target.value)}
                type="email"
                value={testRecipient}
              />
              <button
                className="button button-light"
                disabled={busy !== null || !testRecipient.includes("@")}
                onClick={() => void sendTest()}
                type="button"
              >
                {busy === "test" ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}
                Send me a test
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
