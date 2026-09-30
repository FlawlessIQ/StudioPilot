"use client";

import { useState } from "react";
import { LoaderCircle, Mail, PencilLine, RotateCcw, Undo2 } from "lucide-react";
import { refreshTenantRecords } from "@/components/live/tenant-records";
import { useWorkspace } from "@/features/auth/workspace-context";
import type { QuestionnaireSection } from "@/features/questionnaires/client-form";
import {
  changedAnswers,
  studioEditableFields,
  studioQuestionnaireActions,
  studioSaveSubmits,
} from "@/features/questionnaires/studio-edit";
import { statusLabel } from "@/features/format/status-label";
import { friendlyError } from "@/lib/ai/friendly-error";
import { sendPlanningCommand } from "@/lib/planning/command-client";

type ResponseRow = Record<string, unknown> & { id: string };

const OWNER_ADMIN = ["studio_owner", "studio_admin"];

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

/**
 * What the studio can do with one couple's questionnaire.
 *
 * Once the couple sent it back, nothing could be done with it: they were
 * refused changes, the studio's save existed server-side with no screen, and
 * "send it again" made a second copy. Now: correct an answer they emailed in,
 * reopen it for them, remind them, or take back one they have not sent.
 * Mounted on the response page and inside Cue's cards, so both run the same
 * commands. What applies is decided by studio-edit.ts; the server refuses
 * anything that does not.
 */
export function QuestionnaireResponseActions({
  response,
  sections,
  onChanged,
  only,
}: {
  response: ResponseRow;
  sections: QuestionnaireSection[];
  onChanged: () => void;
  /** Cue opens one action rather than the whole set. */
  only?: "edit" | "reopen" | "resend" | "withdraw";
}) {
  const workspace = useWorkspace();
  const ownerOrAdmin = OWNER_ADMIN.includes(String(workspace.role));
  const status = String(response.status ?? "");
  const projectId = String(response.projectId ?? "");
  const available = studioQuestionnaireActions(status, ownerOrAdmin).filter((action) => !only || action === only);
  const [open, setOpen] = useState<"edit" | "reopen" | "withdraw" | null>(only && only !== "resend" ? only : null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function run(type: string, input: Record<string, unknown>, done: string) {
    setBusy(true);
    setNotice(null);
    try {
      const result = await sendPlanningCommand(type, { projectId, responseId: response.id, ...input });
      setNotice(result.persisted ? done : "Preview: nothing was changed.");
      setOpen(null);
      refreshTenantRecords("questionnaireResponses", "checkpoints");
      onChanged();
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "That could not be done. Nothing was changed."));
    } finally {
      setBusy(false);
    }
  }

  if (!available.length) {
    if (only === "reopen" && !ownerOrAdmin && status !== "withdrawn")
      return <p className="form-notice">Only the studio&rsquo;s owners and admins can reopen a questionnaire.</p>;
    return only ? <p className="form-notice">That doesn&rsquo;t apply to this questionnaire as it stands ({status ? statusLabel(status).toLowerCase() : "unknown"}).</p> : null;
  }

  return (
    <section className="panel questionnaire-response-section" aria-label="Questionnaire actions">
      {status === "reopened" ? (
        <p className="form-notice">
          Reopened for the couple. Your crew keep the answers they last sent until they send it back.
        </p>
      ) : null}
      <div className="live-detail-header-actions">
        {available.includes("edit") ? (
          <button className="button button-light button-sm" disabled={busy} onClick={() => setOpen(open === "edit" ? null : "edit")} type="button">
            <PencilLine size={14} /> Edit their answers
          </button>
        ) : null}
        {available.includes("reopen") ? (
          <button className="button button-light button-sm" disabled={busy} onClick={() => setOpen(open === "reopen" ? null : "reopen")} type="button">
            <RotateCcw size={14} /> Reopen for the couple
          </button>
        ) : null}
        {available.includes("resend") ? (
          <button
            className="button button-light button-sm"
            disabled={busy}
            onClick={() => void run("resendQuestionnaire", {}, "Reminder sent. It links them to the same form, with their answers so far.")}
            type="button"
          >
            {busy ? <LoaderCircle className="spin" size={14} /> : <Mail size={14} />}{" "}Email them a reminder
          </button>
        ) : null}
        {available.includes("withdraw") ? (
          <button className="button button-light button-sm" disabled={busy} onClick={() => setOpen(open === "withdraw" ? null : "withdraw")} type="button">
            <Undo2 size={14} /> Withdraw
          </button>
        ) : null}
      </div>

      {open === "edit" ? (
        <AnswerEditor
          busy={busy}
          onSave={(answers) =>
            void run(
              "saveQuestionnaire",
              { answers, submit: studioSaveSubmits(status) },
              studioSaveSubmits(status)
                ? "Saved. It stays sent back; the crew brief and the planning notes are rebuilt from the corrected answers."
                : "Saved. The couple sees your change when they open the form.",
            )
          }
          response={response}
          sections={sections}
        />
      ) : null}

      {open === "reopen" ? (
        <div className="record-edit">
          <p>
            They can change their answers again and send it back. They get an email saying so. Your crew keep the
            answers they last sent until then.
          </p>
          <label className="record-edit-span">
            A note to them (optional)
            <textarea maxLength={2000} onChange={(event) => setNote(event.target.value)} rows={3} value={note} />
          </label>
          <button
            className="button button-dark button-sm"
            disabled={busy}
            onClick={() => void run("reopenQuestionnaire", { note }, "Reopened, and they've been emailed.")}
            type="button"
          >
            {busy ? <LoaderCircle className="spin" size={14} /> : <RotateCcw size={14} />}{" "}Reopen and email them
          </button>
        </div>
      ) : null}

      {open === "withdraw" ? (
        <div className="record-edit">
          <p>The couple stops seeing this form. Any answers so far are kept on record. You can send a form again later.</p>
          <button
            className="button button-dark button-sm"
            disabled={busy}
            onClick={() => void run("withdrawQuestionnaire", {}, "Withdrawn. The couple no longer sees it.")}
            type="button"
          >
            {busy ? <LoaderCircle className="spin" size={14} /> : <Undo2 size={14} />}{" "}Withdraw it
          </button>
        </div>
      ) : null}

      {notice ? (
        <p className="form-notice" role="status">
          {notice}
        </p>
      ) : null}
    </section>
  );
}

/** One input per answer the studio can correct; files and people are left alone. */
function AnswerEditor({
  response,
  sections,
  busy,
  onSave,
}: {
  response: ResponseRow;
  sections: QuestionnaireSection[];
  busy: boolean;
  onSave: (answers: Record<string, unknown>) => void;
}) {
  const prior = record(response.answers);
  const fields = studioEditableFields(sections);
  const [edited, setEdited] = useState<Record<string, unknown>>(() =>
    Object.fromEntries(fields.map((field) => [field.id, prior[field.id] ?? null])),
  );
  const changed = changedAnswers(prior, edited);
  const set = (id: string, value: unknown) => setEdited((current) => ({ ...current, [id]: value }));
  if (!fields.length) return <p className="form-notice">None of this form&rsquo;s answers can be edited here.</p>;
  return (
    <div className="record-edit">
      <p>Change what they told you another way. Each change is recorded as yours, with what it replaced.</p>
      {fields.map((field) => {
        const value = edited[field.id];
        const label = `${field.label}${field.internalOnly ? " (studio only)" : ""}`;
        if (field.type === "checkbox" || field.type === "acknowledgement")
          return (
            <label className="record-edit-span" key={field.id}>
              <input checked={value === true} onChange={(event) => set(field.id, event.target.checked)} type="checkbox" /> {label}
            </label>
          );
        if ((field.type === "dropdown" || field.type === "radio") && field.options.length)
          return (
            <label key={field.id}>
              {label}
              <select onChange={(event) => set(field.id, event.target.value || null)} value={typeof value === "string" ? value : ""}>
                <option value="">No answer</option>
                {field.options.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          );
        if (field.type === "multi_select")
          return (
            <label className="record-edit-span" key={field.id}>
              {label} <small>(separate with commas)</small>
              <input
                onChange={(event) =>
                  set(
                    field.id,
                    event.target.value
                      .split(",")
                      .map((item) => item.trim())
                      .filter(Boolean),
                  )
                }
                value={Array.isArray(value) ? value.map(String).join(", ") : ""}
              />
            </label>
          );
        if (field.type === "long_text" || field.type === "address")
          return (
            <label className="record-edit-span" key={field.id}>
              {label}
              <textarea onChange={(event) => set(field.id, event.target.value)} rows={3} value={typeof value === "string" ? value : ""} />
            </label>
          );
        return (
          <label key={field.id}>
            {label}
            <input
              onChange={(event) => set(field.id, event.target.value)}
              type={field.type === "date" ? "date" : field.type === "time" ? "time" : field.type === "email" ? "email" : field.type === "phone" ? "tel" : "text"}
              value={typeof value === "string" ? value : ""}
            />
          </label>
        );
      })}
      <button
        className="button button-dark button-sm"
        disabled={busy || !Object.keys(changed).length}
        onClick={() => onSave(changed)}
        type="button"
      >
        {busy ? <LoaderCircle className="spin" size={14} /> : <PencilLine size={14} />}
        {Object.keys(changed).length ? ` Save ${Object.keys(changed).length} change${Object.keys(changed).length === 1 ? "" : "s"}` : " No changes yet"}
      </button>
    </div>
  );
}
