"use client";

import { useState } from "react";
import { Button, ButtonRow, Pill, Row } from "@/components/kit/kit";
import type { QuestionnaireField } from "@/features/questionnaires/client-form";
import { Question, spoken } from "@/components/client/kit/questionnaire-question";

/**
 * One answer on a form the couple already sent — still theirs to keep current.
 *
 * GR Productions (2026-10-02): couples can update little things; locations
 * and times lock four weeks before. So each answer offers "Change", which
 * saves at once — or, for a location or time once the final details have
 * locked, "Request a change", which goes to the studio to agree. A request
 * already waiting says so instead.
 */
export function SubmittedAnswer({
  field,
  answer,
  required,
  locked,
  pending,
  studioName,
  onSave,
  onRequest,
}: {
  field: QuestionnaireField;
  answer: unknown;
  required: boolean;
  /** A location or time, after the final details locked. */
  locked: boolean;
  /** The change already asked for, waiting for the studio. */
  pending: unknown;
  studioName: string;
  onSave: (value: unknown) => Promise<void>;
  onRequest: (value: unknown, note: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<unknown>(answer);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shown = spoken(answer, field.type) || "Not answered";
  const changeable = !["file", "information"].includes(field.type);

  if (!editing)
    return (
      <Row
        subtitle={pending !== undefined ? `${shown} — you asked for: ${spoken(pending, field.type) || "(blank)"}` : shown}
        title={field.label}
        trailing={
          pending !== undefined ? (
            <Pill>{`Waiting for ${studioName}`}</Pill>
          ) : required && (answer === undefined || answer === null || answer === "") ? (
            <Pill tone="danger">Still needed</Pill>
          ) : changeable ? (
            <button
              className="kit-link-button"
              onClick={() => {
                setValue(answer);
                setNote("");
                setError(null);
                setEditing(true);
              }}
              type="button"
            >
              {locked ? "Request a change" : "Change"}
            </button>
          ) : undefined
        }
      />
    );

  async function go() {
    setBusy(true);
    setError(null);
    try {
      if (locked) await onRequest(value, note);
      else await onSave(value);
      setEditing(false);
    } catch (caught) {
      const code = caught instanceof Error ? caught.message : "";
      setError(
        code === "DETAILS_LOCKED"
          ? `Your final details have locked, so this goes to ${studioName} as a request. Press it again to send it.`
          : code === "DETAIL_CHANGE_UNCHANGED"
            ? "That's the same as what they have."
            : "That didn't go through. Check your connection and try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="kit-stack-tight">
      <Question answer={value} field={field} onChange={setValue} onFile={() => undefined} source="" uploading={false} />
      {locked ? (
        <label className="kit-field">
          <span className="kit-field-label">{`A note for ${studioName} (optional)`}</span>
          <textarea className="kit-input" maxLength={1000} onChange={(event) => setNote(event.target.value)} rows={2} value={note} />
        </label>
      ) : null}
      {locked ? (
        <p className="kit-caption">{`Your final details are locked, so ${studioName} agrees changes to locations and times. There's no charge.`}</p>
      ) : null}
      {error ? (
        <p className="kit-error" role="alert">
          {error}
        </p>
      ) : null}
      <ButtonRow>
        <Button disabled={busy} onClick={() => void go()}>
          {busy ? "Sending…" : locked ? `Ask ${studioName}` : "Save"}
        </Button>
        <Button disabled={busy} onClick={() => setEditing(false)} variant="secondary">
          Cancel
        </Button>
      </ButtonRow>
    </div>
  );
}
