"use client";

import { useState } from "react";
import { CalendarCheck, LoaderCircle } from "lucide-react";
import { refreshTenantRecords, useTenantDocuments } from "@/components/live/tenant-records";
import { friendlyError } from "@/lib/ai/friendly-error";
import { sendPlanningCommand } from "@/lib/planning/command-client";

const text = (value: unknown) => (typeof value === "string" ? value : "");
const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const METHODS = [
  { value: "phone", label: "On the phone" },
  { value: "email", label: "By email" },
  { value: "text", label: "By text" },
  { value: "in_person", label: "In person" },
  { value: "other", label: "Another way" },
];

const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

/** The version the couple is being asked about, if one is waiting on them. */
export function timelineAwaitingCouple(schedules: readonly Record<string, unknown>[], projectId: string) {
  const newest = schedules
    .filter((schedule) => schedule.projectId === projectId)
    .sort((left, right) => Number(right.version ?? 0) - Number(left.version ?? 0))[0];
  if (!newest) return { newest: null, waiting: false };
  const status = text(newest.status);
  const state = text(newest.approvalState);
  const waiting =
    status === "client_review" ||
    status === "changes_requested" ||
    (status === "published" && (state === "client_pending" || state === "changes_requested"));
  return { newest, waiting };
}

/**
 * Record the couple's answer on the timeline when they gave it outside the portal.
 *
 * "Looks perfect!" arrives by text as often as through the portal, and the
 * studio had no way to say so: the version sat at "waiting for the couple"
 * and the readiness list with it. The answer is written with who gave it, how
 * and when, and only on the newest version — the server refuses a superseded
 * one (functions/src/planning/schedule-lifecycle.ts).
 */
export function RecordTimelineAnswer({ projectId, coupleName }: { projectId: string; coupleName?: string }) {
  const { records: schedules } = useTenantDocuments("schedules");
  const [decision, setDecision] = useState<"approved" | "changes_requested">("approved");
  const [givenBy, setGivenBy] = useState(coupleName ?? "");
  const [method, setMethod] = useState("phone");
  const [givenOn, setGivenOn] = useState(today);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const { newest, waiting } = timelineAwaitingCouple(schedules ?? [], projectId);
  if (!newest) return null;
  const version = Number(newest.version ?? 1);
  const recorded = record(newest.approvalRecordedByStudio);

  if (!waiting) {
    if (text(newest.approvalState) !== "client_approved") return notice ? <p className="form-notice">{notice}</p> : null;
    return (
      <section className="panel focused-tool-link" aria-label="The couple's answer">
        <div>
          <p className="eyebrow">Timeline version {version}</p>
          <h2>The couple approved it</h2>
          <p>
            {text(recorded.givenBy)
              ? `${text(recorded.givenBy)} approved it ${METHODS.find((item) => item.value === recorded.method)?.label.toLowerCase() ?? ""} on ${text(recorded.givenOn)}, recorded by the studio.`
              : "They approved it in their portal."}
          </p>
        </div>
      </section>
    );
  }

  async function save() {
    setBusy(true);
    setNotice(null);
    try {
      const response = await sendPlanningCommand("approveSchedule", {
        projectId,
        scheduleId: String(newest!.id),
        decision,
        notes: notes.trim(),
        recordedAnswer: { givenBy: givenBy.trim(), method, givenOn },
      });
      setNotice(
        response.persisted
          ? decision === "approved"
            ? `Recorded: the couple approved version ${version}.`
            : `Recorded: the couple asked for changes to version ${version}.`
          : "Preview: nothing was recorded.",
      );
      refreshTenantRecords("schedules", "checkpoints", "readinessAssessments");
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "Their answer could not be recorded."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="panel creation-disclosure">
      <summary>
        <CalendarCheck aria-hidden size={15} /> The couple answered another way? Record it for version {version}
      </summary>
      <div className="record-edit">
        <label>
          Their answer
          <select onChange={(event) => setDecision(event.target.value === "changes_requested" ? "changes_requested" : "approved")} value={decision}>
            <option value="approved">They approved it</option>
            <option value="changes_requested">They asked for changes</option>
          </select>
        </label>
        <label>
          Who said so
          <input maxLength={160} onChange={(event) => setGivenBy(event.target.value)} placeholder="e.g. Sarah" value={givenBy} />
        </label>
        <label>
          How
          <select onChange={(event) => setMethod(event.target.value)} value={method}>
            {METHODS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          When
          <input max={today()} onChange={(event) => setGivenOn(event.target.value)} type="date" value={givenOn} />
        </label>
        <label className="record-edit-span">
          {decision === "approved" ? "Anything they added (optional)" : "What they want changed"}
          <textarea maxLength={2000} onChange={(event) => setNotes(event.target.value)} rows={3} value={notes} />
        </label>
        <button
          className="button button-dark button-sm"
          disabled={busy || givenBy.trim().length < 2 || !givenOn || (decision === "changes_requested" && !notes.trim())}
          onClick={() => void save()}
          type="button"
        >
          {busy ? <LoaderCircle className="spin" size={14} /> : <CalendarCheck size={14} />}{" "}Record their answer
        </button>
        {notice ? (
          <p className="form-notice" role="status">
            {notice}
          </p>
        ) : null}
      </div>
    </details>
  );
}
