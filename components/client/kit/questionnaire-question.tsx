"use client";

import type { ReactNode } from "react";
import { Paperclip } from "lucide-react";
import { Choices, Field, TextArea } from "@/components/kit/kit";
import { attachmentRef, type FileRef } from "@/features/documents/file-ref";
import type { QuestionnaireField } from "@/features/questionnaires/client-form";

/**
 * One questionnaire question, as the couple answers it.
 *
 * Shared by the client portal's questionnaire (client-questionnaire.tsx) and
 * the event form on the couple's inquiry page (components/inquiries/
 * couple-inquiry-page.tsx), so a question looks and saves the same in both.
 * Kept free of Firebase and of the portal session: the inquiry page is public
 * and loads Firebase only when it calls the server.
 */

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

function longDate(value: string): string {
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
  return Number.isNaN(parsed.valueOf())
    ? value
    : parsed.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}

/** An answer as the couple would say it back. */
export function spoken(value: unknown, type = "text"): string {
  if (type === "time" && typeof value === "string" && /^\d{2}:\d{2}/.test(value)) {
    const [hours, minutes] = value.split(":").map(Number) as [number, number];
    return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${hours < 12 ? "AM" : "PM"}`;
  }
  if (type === "date" && typeof value === "string" && value) return longDate(value);
  if (Array.isArray(value)) return value.map(String).join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  const named = record(value).name;
  if (typeof named === "string") return named;
  return String(value ?? "").trim();
}

export function Question({
  field,
  answer,
  source,
  uploading,
  onChange,
  onFile,
  renderUpload,
}: {
  field: QuestionnaireField;
  answer: unknown;
  source: string;
  uploading: boolean;
  onChange: (value: unknown) => void;
  onFile: (file: File | null) => void;
  /** Opens a file the couple uploaded; only the signed-in portal can. */
  renderUpload?: (file: FileRef) => ReactNode;
}) {
  const label = (
    <>
      {field.label}
      {field.required ? <span className="required-mark">Required</span> : null}
    </>
  );
  const hint = source ? `Filled in from ${source}. You can change it.` : undefined;
  const value = typeof answer === "string" ? answer : answer == null ? "" : spoken(answer);

  if (field.type === "information")
    return (
      <div className="kit-stack-tight">
        <p className="kit-subsection">{field.label}</p>
        {value ? <p className="kit-body">{value}</p> : null}
      </div>
    );

  // The studio set this one; the couple can see it, not change it.
  if (field.locked)
    return <Field hint="Set by your studio." label={field.label} readOnly value={value} />;

  if (field.type === "file")
    return (
      <div className="kit-field">
        <span className="kit-field-label">{label}</span>
        <label className="kit-button" data-variant="secondary">
          <Paperclip aria-hidden size={20} />
          {uploading ? "Uploading…" : value ? "Replace file" : "Choose a file or photo"}
          <input
            accept=".pdf,.docx,.jpg,.jpeg,.png"
            className="kit-sr"
            disabled={uploading}
            onChange={(event) => onFile(event.target.files?.[0] ?? null)}
            type="file"
          />
        </label>
        <span className="kit-hint">
          {value ? `${value} · uploaded securely` : "PDF, Word, JPG or PNG, up to 12 MB."}
        </span>
        {/* Their own upload, openable once it has been checked
            (docs/document-access-plan-2026-09-28.md, E). */}
        {attachmentRef(answer) && renderUpload ? renderUpload(attachmentRef(answer)!) : null}
      </div>
    );

  if (["long_text", "address", "repeating_group"].includes(field.type))
    return (
      <TextArea
        hint={hint}
        label={label}
        name={field.id}
        onChange={(event) => onChange(event.target.value)}
        rows={field.type === "address" ? 3 : 5}
        value={value}
      />
    );

  // Several answers: chips again, any number on. It fell through to a text
  // box, which showed the stored list as "Sage, Gold" and saved it back as
  // one string (found by the local UAT run, 2026-09-29).
  if (field.type === "multi_select" && field.options.length)
    return (
      <Choices
        legend={label}
        multiple
        onChange={(next) => onChange(next)}
        options={field.options.map((option) => ({ value: option, label: option }))}
        value={Array.isArray(answer) ? answer.map(String) : []}
      />
    );

  if (["dropdown", "radio"].includes(field.type) && field.options.length)
    return (
      <div className="kit-stack-tight">
        <Choices
          legend={label}
          onChange={(next) => onChange(next)}
          options={field.options.map((option) => ({ value: option, label: option }))}
          value={value || null}
        />
        {hint && value ? <span className="kit-hint">{hint}</span> : null}
      </div>
    );

  if (["checkbox", "acknowledgement"].includes(field.type))
    return (
      <label className="kit-check">
        <input
          checked={answer === true}
          name={field.id}
          onChange={(event) => onChange(event.target.checked)}
          type="checkbox"
        />
        <span>{label}</span>
      </label>
    );

  const inputType =
    field.type === "phone" ? "tel" : ["email", "date", "time"].includes(field.type) ? field.type : "text";
  return (
    <Field
      autoComplete={field.type === "email" ? "email" : field.type === "phone" ? "tel" : "off"}
      hint={hint}
      inputMode={field.type === "phone" ? "tel" : field.type === "email" ? "email" : undefined}
      label={label}
      name={field.id}
      onChange={(event) => onChange(event.target.value)}
      type={inputType}
      value={value}
    />
  );
}
