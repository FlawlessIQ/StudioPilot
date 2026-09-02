"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { todayLocalIso } from "@/lib/format/event-date";
import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  History,
  LoaderCircle,
  MessageSquareText,
  PauseCircle,
  Send,
  ShieldCheck,
  Sparkles,
  UserRound,
} from "lucide-react";
import type { JourneyStep } from "@/features/journey/steps";
import { groupJourneyByPhase } from "@/features/journey/phases";
import { KindGlyph } from "@/components/library/kind-glyph";
import type { LibraryKind } from "@/features/library/kinds";
import {
  filterThreadHistory,
  groupThreadByDay,
  threadHistoryFacets,
  threadHistorySummary,
  type ThreadActor,
  type ThreadEntry,
  type ThreadHistoryFacet,
} from "@/features/journey/thread";
import { SheetDialog } from "@/components/ui/sheet-dialog";
import { refreshTenantRecords } from "@/components/live/tenant-records";
import { useWorkspace } from "@/features/auth/workspace-context";
import { askCopilot } from "@/lib/ai/copilot-client";
import { friendlyError } from "@/lib/ai/friendly-error";
import { sendBookingCommand } from "@/lib/booking/command-client";
import { runCrmCommand } from "@/lib/crm/command-client";
import { sendPlanningCommand } from "@/lib/planning/command-client";
import { runWorkflowCommand } from "@/lib/workflows/command-client";

const DAY = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
});

/** For the history row, where the weekday is a word too many. */
const SHORT_DAY = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});

function shortDayLabel(at: string): string {
  const parsed = new Date(at);
  if (Number.isNaN(parsed.valueOf())) return "";
  return SHORT_DAY.format(parsed);
}

function dayLabel(day: string): string {
  const parsed = new Date(`${day}T12:00:00`);
  if (Number.isNaN(parsed.valueOf())) return day;
  const today = todayLocalIso();
  if (day === today) return "Today";
  // A wedding books a year out, so a thread routinely spans years. "Fri,
  // Dec 5" on a job whose event is next week reads as next month unless the
  // year that is not this one is stated.
  return parsed.getFullYear() === new Date().getFullYear()
    ? DAY.format(parsed)
    : `${DAY.format(parsed)}, ${parsed.getFullYear()}`;
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
  interruption,
  stateVersion,
  consultationId,
  onChanged,
}: {
  projectId: string;
  entries: ThreadEntry[];
  current: JourneyStep | null;
  /**
   * Set when the job is on hold or cancelled, with the reason the studio gave.
   * A cancelled job has no next move, and "waiting on someone else" is the
   * wrong thing to say about it.
   */
  interruption: { state: string; reason: string | null } | null;
  stateVersion: number;
  /** An open consultation, when one exists — enables logging notes here. */
  consultationId: string | null;
  onChanged: (state?: string, version?: number) => void;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const summary = useMemo(() => threadHistorySummary(entries), [entries]);

  return (
    <section className="job-thread" aria-label="This job">
      <ThreadNextMove
        current={current}
        interruption={interruption}
        onChanged={onChanged}
        projectId={projectId}
        stateVersion={stateVersion}
      />
      {summary.latest ? (
        <>
          <button
            aria-expanded={historyOpen}
            aria-haspopup="dialog"
            className="job-history-strip"
            onClick={() => setHistoryOpen(true)}
            type="button"
          >
            <span className="job-history-icon">
              <History aria-hidden="true" size={16} />
            </span>
            <span className="job-history-label">
              <strong>Job history</strong>
              <small>
                {summary.count} {summary.count === 1 ? "entry" : "entries"}
              </small>
            </span>
            <span className="job-history-latest">
              <em>Latest</em>
              {summary.latest.title} · {shortDayLabel(summary.latest.at)}
            </span>
            <span className="job-history-open">
              Open <ArrowUpRight aria-hidden="true" size={14} />
            </span>
          </button>
          <SheetDialog
            label="Job history"
            onClose={() => setHistoryOpen(false)}
            open={historyOpen}
            width="wide"
          >
            <ThreadHistory count={summary.count} entries={entries} />
          </SheetDialog>
        </>
      ) : (
        <div className="job-thread-empty">
          <MessageSquareText size={18} />
          <strong>This is where the whole job lives.</strong>
          <p>
            Every message, consultation, proposal, payment and delivery will
            appear here in order — so you can see the story at a glance.
          </p>
        </div>
      )}
      <ThreadComposer
        consultationId={consultationId}
        onChanged={onChanged}
        projectId={projectId}
      />
    </section>
  );
}

/**
 * The history itself, in the dialog the strip opens.
 *
 * This used to render inline, between the next move and the three sections
 * that follow the thread — the outstanding list, the prepared decisions, the
 * planning copilot. A job with a few months on it put eight screens of
 * scroll in front of all three. The flow is unchanged: same day dividers,
 * same entry cards, same order.
 */
function ThreadHistory({
  count,
  entries,
}: {
  count: number;
  entries: ThreadEntry[];
}) {
  const [facet, setFacet] = useState<ThreadHistoryFacet>("all");
  const scroller = useRef<HTMLDivElement>(null);
  const facets = threadHistoryFacets(entries);
  const shown = filterThreadHistory(entries, facet);
  const days = groupThreadByDay(shown);

  // Opens at the newest entry, the way a conversation does. Reading order
  // stays oldest-first — the thread is a story — but "what happened last"
  // is the question that made someone open this.
  useEffect(() => {
    const node = scroller.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [facet]);

  return (
    <div className="panel job-history-sheet">
      <header>
        <p className="eyebrow">Job history</p>
        <h2>Everything that has happened here</h2>
        <p>
          {count} {count === 1 ? "entry" : "entries"} — oldest first, newest at
          the end.
        </p>
        {/* Only rendered when the job has more than one kind of entry to
            separate; a lone "Everything" chip is a control that does
            nothing. */}
        {facets.length > 2 ? (
          <div className="job-history-facets" role="group" aria-label="Show">
            {facets.map((option) => (
              <button
                aria-pressed={facet === option.facet}
                className={facet === option.facet ? "is-active" : ""}
                key={option.facet}
                onClick={() => setFacet(option.facet)}
                type="button"
              >
                {option.label} <em>{option.count}</em>
              </button>
            ))}
          </div>
        ) : null}
      </header>
      <div className="job-history-scroll" ref={scroller}>
        {days.map((bucket) => (
          <div className="job-thread-day" key={bucket.day}>
            <span className="job-thread-daylabel">{dayLabel(bucket.day)}</span>
            {bucket.entries.map((entry) => (
              <ThreadEntryCard entry={entry} key={entry.id} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * What sort of record this entry is about, in the app's shared vocabulary.
 *
 * The thread is the one genuinely mixed feed in the product — a proposal,
 * a phone note, an invoice and a schedule version, in date order — and
 * every row rendered identically. A glyph makes the feed scannable without
 * adding a word to it.
 */
function entryKind(entry: ThreadEntry): LibraryKind | null {
  if (entry.artifact) return threadArtifactKinds[entry.artifact.type];
  if (entry.kind === "message") return "message";
  // System narration is the engines talking about themselves. It has no
  // subject of its own, and inventing one would be a lie in colour.
  return null;
}

const threadArtifactKinds: Record<
  NonNullable<ThreadEntry["artifact"]>["type"],
  LibraryKind
> = {
  proposal: "proposal",
  contract: "contract",
  invoice: "invoice",
  schedule: "schedule",
  questionnaire: "questionnaire",
  delivery: "delivery",
  consultation: "calendar",
};

function ThreadEntryCard({ entry }: { entry: ThreadEntry }) {
  const kind = entryKind(entry);
  return (
    <article
      className={`thread-entry is-${entry.kind} from-${entry.actor}${kind ? " has-glyph" : ""}`}
      data-actor={entry.actor}
    >
      {kind ? <KindGlyph kind={kind} size={26} /> : null}
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
 * A blank box is the worst copilot interface: people do not know what it
 * can answer. These are questions the thread's own records can actually
 * settle, offered as one tap.
 */
const ASK_SUGGESTIONS = [
  "What's outstanding on this job?",
  "What has the client not replied to?",
  "What do I owe them next?",
] as const;

const NOTE_SUGGESTIONS = [
  "Just got off the phone with them —",
  "They want to add",
  "They asked about",
] as const;

/**
 * The composer: say what happened, ask a question, or capture a task —
 * without deciding which page to visit first. Modes are explicit rather
 * than guessed from prose: a misread that files a consultation as a task
 * would be worse than one extra tap.
 */
/**
 * What to do next, above the history rather than after it.
 *
 * This used to sit at the bottom of the thread, inside the composer. A
 * thread is chronological and grows for the life of the job, so the single
 * most consequential thing on the page ended up below months of activity —
 * a studio with an accepted proposal had to scroll past every consultation
 * and email to find "Send contract". The compose box still belongs at the
 * end, where a reply box goes; the instruction does not.
 */
function ThreadNextMove({
  current,
  interruption,
  onChanged,
  projectId,
  stateVersion,
}: {
  current: JourneyStep | null;
  interruption: { state: string; reason: string | null } | null;
  onChanged: (state?: string, version?: number) => void;
  projectId: string;
  stateVersion: number;
}) {
  if (interruption) {
    /**
     * On hold or called off, and it says which and why.
     *
     * A cancelled sports shoot used to read "YOUR NEXT MOVE — Schedule
     * consultation · Find a time that works", because the journey read records
     * that had not changed. The reason the studio typed was recorded and then
     * shown nowhere.
     */
    const held = interruption.state === "POSTPONED";
    return (
      <div className="thread-next-slot">
        <div className="thread-next is-interrupted">
          <div className="thread-next-copy">
            <p className="thread-next-eyebrow">
              <PauseCircle size={12} /> {held ? "On hold" : "Cancelled"}
            </p>
            <strong>
              {held
                ? "This job is on hold, so nothing is being chased."
                : "This job was cancelled. Everything on it is still on file."}
            </strong>
            <small>
              {interruption.reason
                ? `Your reason: ${interruption.reason}`
                : held
                  ? "Bring it back from the job rail when the new date is settled."
                  : "Nothing was deleted."}
            </small>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="thread-next-slot">
      {current ? (
        <div className="thread-next">
          <span className="thread-next-glow" aria-hidden="true" />
          <div className="thread-next-copy">
            <p className="thread-next-eyebrow">
              <Sparkles size={12} /> Your next move
            </p>
            {/* Step titles are milestone names written in the past ("Crew
              confirmed"), which read as an announcement that the thing is
              done. The outstanding action is what this card is for. */}
            <strong>
              {current.action?.kind === "link"
                ? current.action.label
                : current.title}
            </strong>
            <small>{current.detail}</small>
          </div>
          <div className="thread-next-actions">
            {current.action?.kind === "link" ? (
              <Link className="thread-next-go" href={current.action.href}>
                {current.action.label} <ArrowRight size={15} />
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
            {/* The nag appears here, so the answer to it belongs here. A
                venue that never asks for a certificate left this card
                reading "Request COI" for the life of the job, and the only
                way to say otherwise was to find the insurance page. */}
            {current.key === "coi" ? (
              <CoiNotRequiredButton projectId={projectId} />
            ) : null}
          </div>
        </div>
      ) : (
        // One voice means it also speaks when the answer is "nothing". The
        // thread used to simply end, which reads as a page that has not
        // finished loading rather than a job that is genuinely waiting.
        <div className="thread-next is-clear">
          <div className="thread-next-copy">
            <p className="thread-next-eyebrow">
              <Check size={12} /> Nothing for you right now
            </p>
            <strong>This job is waiting on someone else.</strong>
            <small>
              It comes back here the moment it needs a decision from you.
            </small>
          </div>
        </div>
      )}
    </div>
  );
}

function ThreadComposer({
  projectId,
  consultationId,
  onChanged,
}: {
  projectId: string;
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

  const suggestions =
    mode === "ask" ? ASK_SUGGESTIONS : mode === "note" ? NOTE_SUGGESTIONS : [];

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
    <div className={mode === "ask" ? "thread-composer is-ask" : "thread-composer"}>
      <div
        className="thread-composer-modes"
        role="tablist"
        aria-label="What are you adding?"
      >
        {consultationId ? (
          <button
            aria-selected={mode === "note"}
            className={mode === "note" ? "mode-note is-active" : "mode-note"}
            onClick={() => setMode("note")}
            role="tab"
            type="button"
          >
            <MessageSquareText size={13} /> Log a call
          </button>
        ) : null}
        <button
          aria-selected={mode === "ask"}
          className={mode === "ask" ? "mode-ask is-active" : "mode-ask"}
          onClick={() => setMode("ask")}
          role="tab"
          type="button"
        >
          <Sparkles size={13} /> Ask StudioCue
        </button>
        <button
          aria-selected={mode === "task"}
          className={mode === "task" ? "mode-task is-active" : "mode-task"}
          onClick={() => setMode("task")}
          role="tab"
          type="button"
        >
          <Check size={13} /> Add a task
        </button>
      </div>

      <div className="thread-composer-input">
        {mode === "ask" ? (
          <>
            {/* Outside the box on purpose, so `clip` and not `hidden` — the
                same hazard that clipped the next-move card's heading. */}
            <span className="thread-ask-glow" aria-hidden="true" />
            <p className="thread-ask-identity">
              <span className="thread-ask-mark">
                <Sparkles aria-hidden="true" size={12} />
              </span>
              Ask StudioCue
              <em>
                <ShieldCheck aria-hidden="true" size={11} /> Reads this
                job&rsquo;s records · changes nothing
              </em>
            </p>
          </>
        ) : null}
        <textarea
          onChange={(event) => setValue(event.target.value)}
          placeholder={placeholder}
          rows={3}
          value={value}
        />
        <div className="thread-composer-foot">
          {suggestions.length && !value.trim() ? (
            <div className="thread-suggestions">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => setValue(suggestion)}
                  type="button"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          ) : (
            <small className="thread-composer-hint">
              {mode === "note"
                ? "Saved to this job, and StudioCue drafts what follows."
                : mode === "task"
                  ? "Added to your tasks for this job."
                  : // Ask mode says this above the box already, where it is
                    // read before the question rather than after it.
                    ""}
            </small>
          )}
          <button
            className="thread-send"
            disabled={busy || !value.trim()}
            onClick={() => void submit()}
            type="button"
          >
            {busy ? (
              <LoaderCircle className="spin" size={14} />
            ) : (
              <Send size={14} />
            )}
            {busy
              ? "Working…"
              : mode === "ask"
                ? "Ask"
                : mode === "note"
                  ? "Save the note"
                  : "Add task"}
          </button>
        </div>
      </div>

      {answer ? (
        <div className="thread-answer" role="status">
          <span>
            <Sparkles aria-hidden="true" size={12} /> StudioCue
          </span>
          <p>{answer}</p>
          <footer>
            <small>
              <ShieldCheck aria-hidden="true" size={11} /> Answered from this
              job&rsquo;s records — nothing was changed.
            </small>
            <button onClick={() => setAnswer(null)} type="button">
              Ask something else
            </button>
          </footer>
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

/**
 * "This venue does not need one", said where the asking happens.
 *
 * `setInsuranceRequirement` is the same command the insurance page calls;
 * this is the second place it is reachable from, because the next-move card
 * is where a studio actually meets the question.
 */
function CoiNotRequiredButton({ projectId }: { projectId: string }) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setNotice(null);
    try {
      const response = await sendPlanningCommand("setInsuranceRequirement", {
        projectId,
        insuranceRequired: "not_required",
      });
      if (response.persisted) {
        // No state transition here, so `onChanged` has nothing to report —
        // the parent ignores it unless both a state and a version are given.
        // The journey is computed from the cached `projects` records, and the
        // store is a cache rather than a live subscription, so evicting it is
        // what actually moves this card on.
        refreshTenantRecords("projects");
      } else {
        setNotice("Preview: this job would be marked as needing no certificate.");
      }
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "That could not be saved."));
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
        Not required
      </button>
      {notice ? <small role="status">{notice}</small> : null}
    </>
  );
}

/** The compact rail: where this job sits, and how far it has come. */
export function ThreadMinimap({ steps }: { steps: JourneyStep[] }) {
  const complete = steps.filter((step) => step.status === "complete").length;
  // Steps the event overtook. In the denominator only, they made an already
  // shot wedding read "8/14" — six things looking open that nobody can do.
  const missed = steps.filter((step) => step.status === "passed").length;
  // Fifteen identical ticks is an accurate index and a poor map. The arcs
  // are what a photographer thinks in: am I still selling this, or am I
  // shooting it in a fortnight?
  const groups = groupJourneyByPhase(steps);
  return (
    <aside className="thread-minimap" aria-label="Journey">
      <div className="thread-minimap-head">
        <p className="eyebrow">The journey</p>
        <span>
          {complete}/{steps.length}
          {missed ? (
            <em className="thread-phase-missed"> · {missed} missed</em>
          ) : null}
        </span>
      </div>
      {groups.map((group) => (
        <section
          className={`thread-phase${group.active ? " is-active" : ""}`}
          key={group.phase}
        >
          <p className="thread-phase-label">
            {group.label}
            <em>
              {group.complete}/{group.steps.length}
              {group.missed ? (
                // "2/4" alone reads as two still to do. Two of them are behind
                // the event and undoable; the phase heading has to say so.
                <span className="thread-phase-missed">
                  {" "}
                  · {group.missed} missed
                </span>
              ) : null}
            </em>
          </p>
          <ol>
            {group.steps.map((step) => (
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
        </section>
      ))}
      {/* The rail used to restate the current step as "Now: X" while the
          next-move card gave the same step as an instruction. The highlighted
          row already says where the job is; one voice is enough. */}
    </aside>
  );
}
