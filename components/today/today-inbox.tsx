"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  CircleAlert,
  LoaderCircle,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { useTodayInbox } from "@/components/today/use-today-inbox";
import { useWorkspace } from "@/features/auth/workspace-context";
import { greetingFor } from "@/features/dashboard/home-metrics";
import { todaySummary, type TodayItem } from "@/features/today/inbox";
import { friendlyError } from "@/lib/ai/friendly-error";
import { runAiQueueCommand } from "@/lib/ai-actions/command-client";

function firstName(value: string) {
  return value.trim().split(/\s+/)[0] || "there";
}

/**
 * Today — the studio's inbox of moments.
 *
 * Phase 1 of the "Today & Jobs" design: the home screen is the queue, not a
 * dashboard of collections. Three lanes, one action per card, and approvals
 * that complete without leaving the screen. Designed thumb-first — this is
 * the surface a photographer triages from a phone in the evening.
 */
export function TodayInbox() {
  const workspace = useWorkspace();
  const { inbox, loading } = useTodayInbox();
  /** Items decided in place this session, hidden optimistically. */
  const [cleared, setCleared] = useState<Set<string>>(new Set());
  const [showHandled, setShowHandled] = useState(false);

  const visible = (items: TodayItem[]) =>
    items.filter((item) => !cleared.has(item.id));
  const act = visible(inbox.act);
  const approve = visible(inbox.approve);
  const waiting = act.length + approve.length;
  // Recomputed from what is on screen: approving a card in place must move
  // this line too, or the summary describes a queue that no longer exists.
  const summary = todaySummary({
    act: act.length,
    approve: approve.length,
    inMotion: inbox.inMotion,
  });

  return (
    <AppShell active="Today">
      <div className="today-page">
        <header className="today-header">
          <p className="eyebrow">
            {greetingFor(new Date())}, {firstName(workspace.userName ?? "there")}
          </p>
          <h1>
            {loading
              ? "Catching up…"
              : waiting === 0
                ? "You're clear."
                : `${waiting} ${waiting === 1 ? "thing needs" : "things need"} you.`}
          </h1>
          <p className="today-summary">
            {loading ? "Reading your studio…" : summary}
          </p>
        </header>

        {!loading && waiting === 0 ? (
          <section className="today-clear">
            <span className="today-clear-icon">
              <Check size={20} />
            </span>
            <div>
              <strong>Nothing is waiting on you.</strong>
              <small>
                {inbox.inMotion > 0
                  ? "Everything in flight is with a client, a provider, or not due yet. StudioCue will bring it back when it needs a decision."
                  : "When an inquiry arrives or a job needs a decision, it appears here."}
              </small>
            </div>
            <Link className="button button-light" href="/studio/projects">
              See all jobs <ArrowRight size={15} />
            </Link>
          </section>
        ) : null}

        {act.length ? (
          <section className="today-lane" aria-label="Needs you">
            <div className="today-lane-heading">
              <h2>Only you can do this</h2>
              <span>{act.length}</span>
            </div>
            {act.map((item) => (
              <TodayCard key={item.id} item={item} tone="act" />
            ))}
          </section>
        ) : null}

        {approve.length ? (
          <section className="today-lane" aria-label="Ready for your approval">
            <div className="today-lane-heading">
              <h2>Prepared for you — one tap</h2>
              <span>{approve.length}</span>
            </div>
            {approve.map((item) => (
              <TodayCard
                key={item.id}
                item={item}
                onCleared={() =>
                  setCleared((current) => new Set(current).add(item.id))
                }
                tone="approve"
              />
            ))}
          </section>
        ) : null}

        {inbox.fyi.length ? (
          <section className="today-handled" aria-label="Handled for you">
            <button
              aria-expanded={showHandled}
              onClick={() => setShowHandled((value) => !value)}
              type="button"
            >
              <ShieldCheck size={15} />
              {inbox.fyi.length} handled for you
              <em>{showHandled ? "Hide" : "Show"}</em>
            </button>
            {showHandled ? (
              <div className="today-handled-list">
                {inbox.fyi.map((item) => (
                  <TodayCard key={item.id} item={item} tone="fyi" />
                ))}
              </div>
            ) : null}
          </section>
        ) : null}
      </div>
    </AppShell>
  );
}

function TodayCard({
  item,
  tone,
  onCleared,
}: {
  item: TodayItem;
  tone: "act" | "approve" | "fyi";
  onCleared?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function approveInPlace() {
    if (item.action.kind !== "approve") return;
    setBusy(true);
    setNotice(null);
    try {
      await runAiQueueCommand({
        type: "decideAiAction",
        input: { actionId: item.action.actionId, decision: "approved" },
      });
      onCleared?.();
    } catch (caught: unknown) {
      setNotice(
        friendlyError(caught, "That couldn't be approved. Open it to review."),
      );
      setBusy(false);
    }
  }

  return (
    <article className={`today-card is-${tone}`}>
      <span className="today-card-dot" aria-hidden="true" />
      <div className="today-card-body">
        <strong>{item.title}</strong>
        {item.detail ? <small>{item.detail}</small> : null}
        {item.evidence ? (
          <span className="today-card-evidence">
            {tone === "approve" ? (
              <Sparkles size={11} />
            ) : tone === "fyi" ? (
              <ShieldCheck size={11} />
            ) : (
              <CircleAlert size={11} />
            )}
            {item.evidence}
          </span>
        ) : null}
        {notice ? (
          <span className="today-card-notice" role="status">
            {notice}
          </span>
        ) : null}
      </div>
      <div className="today-card-actions">
        {item.action.kind === "approve" ? (
          <>
            <button
              className="today-card-primary"
              disabled={busy}
              onClick={() => void approveInPlace()}
              type="button"
            >
              {busy ? (
                <LoaderCircle className="spin" size={14} />
              ) : (
                <Check size={14} />
              )}
              {busy ? "Approving…" : item.action.label}
            </button>
            <Link className="today-card-secondary" href={item.action.href}>
              Review first
            </Link>
          </>
        ) : item.action.kind === "link" ? (
          <>
            <Link className="today-card-primary" href={item.action.href}>
              {item.action.label} <ArrowRight size={14} />
            </Link>
            {item.jobHref && item.jobHref !== item.action.href ? (
              <Link className="today-card-secondary" href={item.jobHref}>
                Open the job
              </Link>
            ) : null}
          </>
        ) : (
          <>
            <span className="today-card-done">{item.action.label}</span>
            {item.jobHref ? (
              <Link className="today-card-secondary" href={item.jobHref}>
                Open the job
              </Link>
            ) : null}
          </>
        )}
      </div>
    </article>
  );
}
