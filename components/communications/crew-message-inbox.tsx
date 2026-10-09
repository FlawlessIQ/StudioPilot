"use client";

import { Fragment, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowUpRight, ChevronLeft, HardHat, Loader2, MessageSquare, Send } from "lucide-react";
import { LiveRecordsState, refreshTenantRecords, useTenantDocuments } from "@/components/live/tenant-records";
import { crewThreads } from "@/features/crew/crew-threads";
import { sendCrewCommand } from "@/lib/crew/command-client";
import { friendlyError } from "@/lib/ai/friendly-error";

/**
 * Crew messages on Messages (GR, 2026-10-09): a crew member's "Message the
 * studio" landed on their assignment page and nowhere a studio looks. Same
 * look as client conversations (message-inbox.tsx); a reply goes through
 * crewCommand contactStudio, which also emails it to them.
 */

const whenLabel = (iso: string) => {
  const date = new Date(iso);
  if (Number.isNaN(date.valueOf())) return "";
  const today = new Date().toDateString() === date.toDateString();
  return new Intl.DateTimeFormat("en-US", today ? { hour: "numeric", minute: "2-digit" } : { month: "short", day: "numeric" }).format(date);
};
const clockLabel = (iso: string) =>
  new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(iso));
const dayLabel = (iso: string) =>
  new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric" }).format(new Date(iso));

export function CrewMessageInbox({ initialAssignmentId }: { initialAssignmentId?: string }) {
  const crewMessages = useTenantDocuments("crewMessages");
  const crewAssignments = useTenantDocuments("crewAssignments");
  const crewProfiles = useTenantDocuments("crewProfiles");
  const projects = useTenantDocuments("projects");
  const [activeId, setActiveId] = useState<string | null>(initialAssignmentId ?? null);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const threads = useMemo(
    () =>
      crewThreads({
        crewMessages: crewMessages.records,
        crewAssignments: crewAssignments.records,
        crewProfiles: crewProfiles.records,
        projects: projects.records,
      }),
    [crewMessages.records, crewAssignments.records, crewProfiles.records, projects.records],
  );
  const active = threads.find((thread) => thread.assignmentId === activeId) ?? null;
  const waiting = threads.filter((thread) => thread.awaitingStudio).length;

  if (crewMessages.loading) {
    return <LiveRecordsState kind="loading" state="Loading crew messages…" detail="Gathering what your crew sent." />;
  }
  if (crewMessages.error) {
    return <LiveRecordsState kind="error" state="Crew messages could not be loaded" detail={crewMessages.error} />;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!active || !reply.trim() || sending) return;
    setSending(true);
    setNotice(null);
    try {
      const outcome = await sendCrewCommand("contactStudio", {
        projectId: active.projectId,
        assignmentId: active.assignmentId,
        subject: `Re: ${active.last.subject || active.projectName}`.slice(0, 160),
        message: reply.trim(),
        urgency: "normal",
      });
      if (!outcome.persisted) {
        setNotice("Development preview only. Nothing was sent.");
        return;
      }
      setReply("");
      setNotice(`Sent. ${active.crewName} gets it by email and on their job.`);
      refreshTenantRecords("crewMessages");
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "Your reply couldn't be sent."));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="msg-inbox" data-detail={active ? "open" : undefined}>
      <aside className="msg-threads">
        <div className="msg-threads-head">
          <div className="msg-threads-meta">
            <p className="msg-threads-count">
              {`${threads.length} crew conversation${threads.length === 1 ? "" : "s"}`}
              {waiting > 0 ? ` · ${waiting} waiting on you` : ""}
            </p>
          </div>
        </div>
        {threads.length === 0 ? (
          <div className="msg-empty">
            <p>No crew messages yet. When someone on your crew messages you from their job, it appears here.</p>
          </div>
        ) : (
          <ul className="msg-thread-list">
            {threads.map((thread) => (
              <li key={thread.assignmentId}>
                <button
                  aria-current={thread.assignmentId === active?.assignmentId}
                  className={`msg-thread${thread.assignmentId === active?.assignmentId ? " is-active" : ""}${thread.awaitingStudio ? " is-unread" : ""}`}
                  onClick={() => {
                    setActiveId(thread.assignmentId);
                    setNotice(null);
                  }}
                  type="button"
                >
                  <span className="msg-thread-top">
                    <span className="msg-thread-who">{thread.crewName}</span>
                    <span className="msg-thread-when">
                      {whenLabel(thread.last.createdAt)}
                      {thread.awaitingStudio ? <span className="msg-thread-badge">{thread.urgent ? "!" : "1"}</span> : null}
                    </span>
                  </span>
                  <span className="msg-thread-subject">
                    <HardHat aria-hidden size={13} />
                    {[thread.role, thread.projectName].filter(Boolean).join(" · ")}
                  </span>
                  <span className="msg-thread-preview">
                    {thread.last.fromCrew ? (thread.urgent ? "Event day: " : "") : "You: "}
                    {thread.last.message}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <section className="msg-thread-view">
        {!active ? (
          <div className="msg-empty">
            <MessageSquare aria-hidden size={18} />
            <p>Choose a conversation to read it.</p>
          </div>
        ) : (
          <>
            <header className="msg-thread-header">
              <button aria-label="Back to conversations" className="msg-back" onClick={() => setActiveId(null)} type="button">
                <ChevronLeft aria-hidden size={18} />
              </button>
              <div>
                <h2>{active.crewName}</h2>
                <p>{[active.role, active.projectName].filter(Boolean).join(" · ")}</p>
              </div>
              <Link className="msg-thread-job" href={`/studio/crew/${active.assignmentId}`}>
                Open assignment <ArrowUpRight aria-hidden size={14} />
              </Link>
            </header>
            <div className="msg-stream">
              {active.messages.map((message, index) => {
                const previous = active.messages[index - 1];
                const newDay =
                  !previous || new Date(previous.createdAt).toDateString() !== new Date(message.createdAt).toDateString();
                const showWho = message.fromCrew && (newDay || !previous?.fromCrew);
                return (
                  <Fragment key={message.id}>
                    {newDay ? (
                      <div className="msg-day">
                        <span>{dayLabel(message.createdAt)}</span>
                      </div>
                    ) : null}
                    {showWho ? <strong className="msg-bubble-who">{active.crewName}</strong> : null}
                    <article className={`msg-bubble is-${message.fromCrew ? "inbound" : "outbound"}`}>
                      <p>{message.message}</p>
                      <span className="msg-bubble-meta">
                        <time dateTime={message.createdAt}>{clockLabel(message.createdAt)}</time>
                        {message.fromCrew && message.urgent ? <em>· marked event day</em> : null}
                      </span>
                    </article>
                  </Fragment>
                );
              })}
            </div>
            <form className="msg-reply" onSubmit={(event) => void submit(event)}>
              <label className="sr-only" htmlFor="crew-reply-body">
                Your reply
              </label>
              <textarea
                id="crew-reply-body"
                maxLength={4000}
                onChange={(event) => setReply(event.target.value)}
                placeholder={`Reply to ${active.crewName}…`}
                rows={3}
                value={reply}
              />
              <div className="msg-reply-actions">
                {notice ? <p className="msg-notice">{notice}</p> : <span />}
                <button className="ds-btn ds-btn-primary ds-btn-sm" disabled={!reply.trim() || sending} type="submit">
                  {sending ? <Loader2 aria-hidden className="spin" size={14} /> : <Send aria-hidden size={14} />}
                  Send reply
                </button>
              </div>
            </form>
          </>
        )}
      </section>
    </div>
  );
}
