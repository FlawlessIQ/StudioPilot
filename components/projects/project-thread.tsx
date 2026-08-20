"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  LoaderCircle,
  MessageSquareText,
  Send,
  ShieldCheck,
  Sparkles,
  UserRound,
} from "lucide-react";
import type { JourneyStep } from "@/features/journey/steps";
import {
  groupThreadByDay,
  type ThreadActor,
  type ThreadEntry,
} from "@/features/journey/thread";
import { refreshTenantRecords } from "@/components/live/tenant-records";
import { useWorkspace } from "@/features/auth/workspace-context";
import { askCopilot } from "@/lib/ai/copilot-client";
import { friendlyError } from "@/lib/ai/friendly-error";
import { sendBookingCommand } from "@/lib/booking/command-client";
import { runCrmCommand } from "@/lib/crm/command-client";
import { runWorkflowCommand } from "@/lib/workflows/command-client";

const DAY = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
});

function dayLabel(day: string): string {
  const parsed = new Date(`${day}T12:00:00`);
  if (Number.isNaN(parsed.valueOf())) return day;
  const today = new Date().toISOString().slice(0, 10);
  if (day === today) return "Today";
  return DAY.format(parsed);
}

const ACTOR_LABEL: Record<ThreadActor, string> = {
  client: "Client",
  studio: "You",
  studiocue: "StudioCue",
  provider: "Verified",
};

/**
 * The job thread — one wedding as one conversation.
 *
 * Phase 2 of "Today & Jobs": every message, consult, proposal, contract,
 * payment, schedule and delivery in one chronological column, with the next
 * step composing at the bottom. Artifact entries are live cards, so the
 * proposal can be opened and the run of show reviewed without leaving.
 */
export function ProjectThread({
  projectId,
  entries,
  current,
  stateVersion,
  consultationId,
  onChanged,
}: {
  projectId: string;
  entries: ThreadEntry[];
  current: JourneyStep | null;
  stateVersion: number;
  /** An open consultation, when one exists — enables logging notes here. */
  consultationId: string | null;
  onChanged: (state?: string, version?: number) => void;
}) {
  const days = groupThreadByDay(entries);

  return (
    <section className="job-thread" aria-label="Job history">
      {days.length === 0 ? (
        <p className="job-thread-empty">
          Nothing has happened yet. Everything you and your client do will
          appear here.
        </p>
      ) : null}
      {days.map((bucket) => (
        <div className="job-thread-day" key={bucket.day}>
          <span className="job-thread-daylabel">{dayLabel(bucket.day)}</span>
          {bucket.entries.map((entry) => (
            <ThreadEntryCard entry={entry} key={entry.id} />
          ))}
        </div>
      ))}
      <ThreadComposer
        consultationId={consultationId}
        current={current}
        onChanged={onChanged}
        projectId={projectId}
        stateVersion={stateVersion}
      />
    </section>
  );
}

function ThreadEntryCard({ entry }: { entry: ThreadEntry }) {
  return (
    <article
      className={`thread-entry is-${entry.kind} from-${entry.actor}`}
      data-actor={entry.actor}
    >
      <div className="thread-entry-head">
        <strong>{entry.title}</strong>
        <em>{ACTOR_LABEL[entry.actor]}</em>
      </div>
      {entry.detail ? <p>{entry.detail}</p> : null}
      {entry.artifact ? (
        <div className="thread-entry-artifact">
          <div className="thread-entry-chips">
            {entry.artifact.facts.map((fact) => (
              <span key={fact}>{fact}</span>
            ))}
          </div>
          {entry.artifact.href ? (
            <Link href={entry.artifact.href}>
              Open <ArrowUpRight size={12} />
            </Link>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

type ComposerMode = "note" | "ask" | "task";

/**
 * The composer: say what happened, ask a question, or capture a task —
 * without deciding which page to visit first. Modes are explicit rather
 * than guessed from prose: a misread that files a consultation as a task
 * would be worse than one extra tap.
 */
function ThreadComposer({
  projectId,
  current,
  stateVersion,
  consultationId,
  onChanged,
}: {
  projectId: string;
  current: JourneyStep | null;
  stateVersion: number;
  consultationId: string | null;
  onChanged: (state?: string, version?: number) => void;
}) {
  const workspace = useWorkspace();
  const [mode, setMode] = useState<ComposerMode>(
    consultationId ? "note" : "ask",
  );
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const placeholder =
    mode === "note"
      ? "Just got off the phone with them — what did they say?"
      : mode === "ask"
        ? "Ask anything about this job…"
        : "What needs doing, and by when?";

  async function submit() {
    const body = value.trim();
    if (!body || busy) return;
    setBusy(true);
    setNotice(null);
    setAnswer(null);
    try {
      if (mode === "note") {
        if (!consultationId) throw new Error("NO_OPEN_CONSULTATION");
        await sendBookingCommand({
          type: "completeConsultation",
          idempotencyKey: crypto.randomUUID(),
          input: { projectId, consultationId, notes: body },
        });
        setValue("");
        setNotice(
          "Logged. StudioCue is preparing the brief, package fit, and a proposal draft.",
        );
        refreshTenantRecords("consultations", "aiActions");
        onChanged();
      } else if (mode === "ask") {
        if (!workspace.tenantId) throw new Error("FORBIDDEN");
        const result = await askCopilot({
          tenantId: workspace.tenantId,
          projectId,
          question: body,
        });
        setAnswer(result.answer);
      } else {
        await runWorkflowCommand("createTask", {
          projectId,
          workflowRunId: null,
          checkpointId: null,
          title: body.slice(0, 200),
          description: "",
          assignedUserId: null,
          assignedRole: "studio_coordinator",
          dueDate: null,
          priority: "normal",
          blocking: false,
        });
        setValue("");
        setNotice("Added to your tasks.");
        refreshTenantRecords("tasks");
        onChanged();
      }
    } catch (caught: unknown) {
      setNotice(
        friendlyError(
          caught,
          mode === "note"
            ? "Those notes couldn't be saved. Try again."
            : mode === "ask"
              ? "StudioCue couldn't answer that. Try again."
              : "That task couldn't be added. Try again.",
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="thread-composer">
      {current ? (
        <div className="thread-next">
          <span>
            <Sparkles size={13} /> Next: {current.title.toLowerCase()}
          </span>
          <div>
            {current.action?.kind === "link" ? (
              <Link className="button button-dark" href={current.action.href}>
                {current.action.label} <ArrowRight size={14} />
              </Link>
            ) : null}
            {current.advance ? (
              <MarkDoneButton
                advance={current.advance}
                onChanged={onChanged}
                projectId={projectId}
                stateVersion={stateVersion}
              />
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="thread-composer-modes" role="tablist" aria-label="What are you adding?">
        {consultationId ? (
          <button
            aria-selected={mode === "note"}
            className={mode === "note" ? "is-active" : ""}
            onClick={() => setMode("note")}
            role="tab"
            type="button"
          >
            <MessageSquareText size={13} /> Log a call
          </button>
        ) : null}
        <button
          aria-selected={mode === "ask"}
          className={mode === "ask" ? "is-active" : ""}
          onClick={() => setMode("ask")}
          role="tab"
          type="button"
        >
          <Sparkles size={13} /> Ask StudioCue
        </button>
        <button
          aria-selected={mode === "task"}
          className={mode === "task" ? "is-active" : ""}
          onClick={() => setMode("task")}
          role="tab"
          type="button"
        >
          <Check size={13} /> Add a task
        </button>
      </div>

      <div className="thread-composer-input">
        <textarea
          onChange={(event) => setValue(event.target.value)}
          placeholder={placeholder}
          rows={2}
          value={value}
        />
        <button
          aria-label="Submit"
          disabled={busy || !value.trim()}
          onClick={() => void submit()}
          type="button"
        >
          {busy ? <LoaderCircle className="spin" size={15} /> : <Send size={15} />}
        </button>
      </div>

      {answer ? (
        <div className="thread-answer" role="status">
          <span>
            <Sparkles size={12} /> StudioCue
          </span>
          <p>{answer}</p>
          <small>
            <ShieldCheck size={11} /> Answered from this job&rsquo;s records —
            nothing was changed.
          </small>
        </div>
      ) : null}
      {notice ? (
        <p className="thread-composer-notice" role="status">
          {notice}
        </p>
      ) : null}
    </div>
  );
}

function MarkDoneButton({
  advance,
  projectId,
  stateVersion,
  onChanged,
}: {
  advance: NonNullable<JourneyStep["advance"]>;
  projectId: string;
  stateVersion: number;
  onChanged: (state?: string, version?: number) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setNotice(null);
    try {
      const response = await runCrmCommand("transitionProject", {
        projectId,
        expectedVersion: stateVersion,
        targetState: advance.targetState,
      });
      if (response.persisted) {
        onChanged(
          advance.targetState,
          Number(response.result.stateVersion ?? stateVersion + 1),
        );
      } else {
        setNotice("Preview: this step would be marked done.");
      }
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "This step could not be marked done."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        className="button button-light thread-mark-done"
        disabled={busy}
        onClick={() => void run()}
        type="button"
      >
        {busy ? <LoaderCircle className="spin" size={13} /> : null}
        {advance.label}
      </button>
      {notice ? <small role="status">{notice}</small> : null}
    </>
  );
}

/** The compact rail: where this job sits, and how far it has come. */
export function ThreadMinimap({
  steps,
  current,
}: {
  steps: JourneyStep[];
  current: JourneyStep | null;
}) {
  const complete = steps.filter((step) => step.status === "complete").length;
  return (
    <aside className="thread-minimap" aria-label="Journey">
      <div className="thread-minimap-head">
        <p className="eyebrow">The journey</p>
        <span>
          {complete}/{steps.length}
        </span>
      </div>
      <ol>
        {steps.map((step) => (
          <li className={`is-${step.status}`} key={step.key}>
            <span aria-hidden="true">
              {step.status === "complete" ? (
                <Check size={11} />
              ) : step.status === "waiting_client" ? (
                <UserRound size={10} />
              ) : null}
            </span>
            {step.record && step.status !== "upcoming" ? (
              <Link href={step.record.href}>{step.title}</Link>
            ) : (
              <em>{step.title}</em>
            )}
          </li>
        ))}
      </ol>
      {current ? (
        <p className="thread-minimap-now">
          Now: <strong>{current.title}</strong>
        </p>
      ) : null}
    </aside>
  );
}
