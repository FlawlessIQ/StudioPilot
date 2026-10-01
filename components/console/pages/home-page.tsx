"use client";

import { useMemo } from "react";
import Link from "next/link";
import { collection, limit, limitToLast, orderBy, query, where } from "firebase/firestore";
import { triageOf } from "@/features/console/inbox";
import { LIFECYCLE_LABELS, type Tone } from "@/features/console/model";
import { daysUntil, money, relative, shortDate } from "@/lib/console/format";
import { useLiveDoc, useLiveQuery } from "@/lib/console/live";
import { useJobs } from "@/lib/console/jobs";
import { planLabel, studioHref } from "@/lib/console/studio-display";
import { useNow } from "@/lib/console/use-now";
import { BarChart } from "../charts";
import { useConsole } from "../console-context";
import { Topbar } from "../console-frame";
import { Empty, PageHead, Panel, Pill, Stat, StatStrip } from "../ui";
import { dueState, type ConsoleTask } from "../tasks";
import { type Feedback, KindIcon } from "./inbox-page";

/**
 * Home (docs/console.md): the morning check on one screen. The numbers that
 * matter, then "Needs you" — every item that wants a person today, each with
 * the place to act on it.
 */
type Need = { key: string; tone: Tone; tag: string; title: string; detail: string; href: string; action: string; order: number };

export function HomePage() {
  const { studios, user } = useConsole();
  const feedback = useLiveQuery<Feedback>("home:feedback", (firestore) => query(collection(firestore, "feedback"), orderBy("createdAt", "desc"), limit(60)));
  const tasks = useLiveQuery<ConsoleTask>("home:tasks", (firestore) => query(collection(firestore, "consoleTasks"), where("status", "==", "open"), limit(300)));
  const deletions = useLiveQuery<{ id: string; tenantId: string }>("nav:deletions", (firestore) => query(collection(firestore, "deletionRequests"), where("status", "==", "cooling_off"), limit(100)));
  const metrics = useLiveQuery<{ id: string; day: string; mrrCents: number }>("home:metrics", (firestore) => query(collection(firestore, "consoleMetrics"), orderBy("day"), limitToLast(31)));
  const rollup = useLiveDoc<{ lastRunAt?: string }>("consoleSettings/rollup");
  const jobs = useJobs("failed");
  const all = studios.rows ?? [];
  const now = useNow();

  const mrr = all.reduce((sum, studio) => sum + studio.mrrCents, 0);
  const monthAgo = metrics.rows?.[0];
  const netNew = monthAgo && metrics.rows && metrics.rows.length > 1 ? mrr - monthAgo.mrrCents : null;
  const trialsEnding = all.filter((studio) => studio.subscriptionStatus === "trialing" && !studio.comped && (daysUntil(studio.trialEndsAt, now) ?? 99) <= 7 && (daysUntil(studio.trialEndsAt, now) ?? -1) >= 0);
  const pastDue = all.filter((studio) => studio.subscriptionStatus === "past_due" || studio.subscriptionStatus === "paused");
  const newFeedback = (feedback.rows ?? []).filter((item) => triageOf(item) === "new");
  const deadJobs = (jobs.rows ?? []).filter((job) => !job.dismissedAt);

  const needs = useMemo<Need[]>(() => {
    const list: Need[] = [];
    for (const studio of pastDue)
      list.push({ key: `pd:${studio.tenantId}`, tone: "bad", tag: "Past due", title: `${studio.name}'s payment failed`, detail: `${planLabel(studio.plan, studio.cadence)} · ${studio.lastPaymentFailedAt ? `failed ${relative(studio.lastPaymentFailedAt, now)}` : "Stripe is retrying"}`, href: studioHref(studio.tenantId, "billing"), action: "Open billing", order: 0 });
    for (const studio of trialsEnding) {
      const days = daysUntil(studio.trialEndsAt, now) ?? 0;
      const ready = studio.setupDone >= 4;
      list.push({
        key: `trial:${studio.tenantId}`,
        tone: ready ? "info" : "warn",
        tag: "Trial ending",
        title: `${studio.name}'s trial ends ${days <= 0 ? "today" : `in ${days} day${days === 1 ? "" : "s"}`}`,
        detail: `Setup ${studio.setupDone} of 6 · ${studio.jobs.total} jobs · active ${relative(studio.lastActiveAt ?? studio.lastSignInAt, now)}`,
        href: studioHref(studio.tenantId),
        action: ready ? "Open" : "Help them finish",
        order: ready ? 3 : 1,
      });
    }
    const old = newFeedback.filter((item) => now - Date.parse(item.createdAt) > 2 * 86_400_000);
    if (newFeedback.length)
      list.push({ key: "feedback", tone: old.length ? "warn" : "info", tag: "Inbox", title: `${newFeedback.length} new piece${newFeedback.length === 1 ? "" : "s"} of feedback`, detail: old.length ? `${old.length} waiting more than 2 days` : "All from the last 2 days", href: "/platform-admin/inbox", action: "Open inbox", order: old.length ? 1 : 4 });
    if (deadJobs.length) {
      const causes = new Set(deadJobs.map((job) => job.errorCode)).size;
      list.push({ key: "jobs", tone: "bad", tag: "Jobs", title: `${deadJobs.length} failed job${deadJobs.length === 1 ? "" : "s"}`, detail: `${causes} cause${causes === 1 ? "" : "s"}`, href: "/platform-admin/jobs", action: "Open jobs", order: 2 });
    }
    const mine = (tasks.rows ?? []).filter((task) => task.assigneeUid === user?.uid && ["overdue", "today"].includes(dueState(task, now)));
    if (mine.length)
      list.push({ key: "tasks", tone: mine.some((task) => dueState(task, now) === "overdue") ? "bad" : "warn", tag: "Tasks", title: `${mine.length} task${mine.length === 1 ? "" : "s"} due`, detail: mine.slice(0, 2).map((task) => task.title).join(" · "), href: "/platform-admin/tasks", action: "Open tasks", order: 1 });
    for (const studio of all.filter((item) => item.lifecycle === "stalled" || (item.lifecycle === "signed_up" && item.createdAt && now - Date.parse(item.createdAt) > 3 * 86_400_000)).slice(0, 5))
      list.push({ key: `stalled:${studio.tenantId}`, tone: "warn", tag: LIFECYCLE_LABELS[studio.lifecycle], title: `${studio.name} ${studio.lifecycle === "signed_up" ? "never added a card" : "has gone quiet"}`, detail: `Signed up ${shortDate(studio.createdAt, now)} · setup ${studio.setupDone} of 6 · active ${relative(studio.lastActiveAt ?? studio.lastSignInAt, now)}`, href: studioHref(studio.tenantId), action: "Reach out", order: 3 });
    if (deletions.rows?.length)
      list.push({ key: "deletions", tone: "info", tag: "Data", title: `${deletions.rows.length} deletion request${deletions.rows.length === 1 ? "" : "s"} cooling off`, detail: "Approve once the export is complete", href: "/platform-admin/data-requests", action: "Review", order: 5 });
    const rollupAge = rollup.data?.lastRunAt ? now - Date.parse(rollup.data.lastRunAt) : null;
    if (rollupAge !== null && rollupAge > 45 * 60_000)
      list.push({ key: "rollup", tone: "warn", tag: "Console", title: "Studio rows are stale", detail: `Last rebuilt ${relative(rollup.data?.lastRunAt, now)}`, href: "/platform-admin/health", action: "Check", order: 2 });
    return list.sort((a, b) => a.order - b.order);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, feedback.rows, tasks.rows, deletions.rows, jobs.rows, rollup.data, user?.uid]);

  const signups = useMemo(() => {
    const days: Array<{ label: string; value: number }> = [];
    for (let offset = 13; offset >= 0; offset -= 1) {
      const day = new Date(now - offset * 86_400_000).toISOString().slice(0, 10);
      days.push({ label: new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric" }), value: all.filter((studio) => studio.createdAt?.startsWith(day)).length });
    }
    return days;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all]);
  const recent = [...all].filter((studio) => studio.createdAt).sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "")).slice(0, 6);

  return (
    <>
      <Topbar crumbs={[{ label: "Home" }]} />
      <div className="cx-content">
        <PageHead title={greeting(user?.name)}>
          <StatStrip>
            <Stat label="MRR" value={money(mrr)} />
            <Stat label="Net new, 30d" tone={netNew === null ? undefined : netNew < 0 ? "bad" : netNew > 0 ? "ok" : undefined} value={netNew === null ? "—" : `${netNew >= 0 ? "+" : "−"}${money(Math.abs(netNew))}`} />
            <Stat label="Trials ending ≤7d" tone={trialsEnding.length ? "warn" : undefined} value={trialsEnding.length} />
            <Stat label="Past due" tone={pastDue.length ? "bad" : undefined} value={pastDue.length} />
            <Stat label="New feedback" value={newFeedback.length} />
            <Stat label="Failed jobs" tone={deadJobs.length ? "bad" : undefined} value={jobs.rows ? deadJobs.length : "…"} />
          </StatStrip>
        </PageHead>
        <div className="cx-record-body" style={{ padding: 0 }}>
          <Panel flush title={`Needs you · ${needs.length}`}>
            {studios.rows === null ? (
              <Empty title="Loading…" />
            ) : needs.length ? (
              <div className="cx-timeline">
                {needs.map((need) => (
                  <Link className="cx-tl-row" href={need.href} key={need.key} style={{ gridTemplateColumns: "110px minmax(0,1fr) auto", alignItems: "center" }}>
                    <span><Pill tone={need.tone}>{need.tag}</Pill></span>
                    <span className="cx-tl-body">
                      <b>{need.title}</b>
                      <small>{need.detail}</small>
                    </span>
                    <span className="cx-btn" data-size="sm">{need.action}</span>
                  </Link>
                ))}
              </div>
            ) : (
              <Empty title="Nothing needs you right now">No failed payments, no trials about to lapse unready, an empty inbox and no stuck jobs.</Empty>
            )}
          </Panel>
          <aside className="cx-stack">
            <Panel title="Signups, last 14 days">
              <BarChart format={(value) => String(Math.round(value))} height={150} label="Studio signups by day" points={signups} />
            </Panel>
            <Panel flush title="Newest studios">
              {recent.length ? (
                <div className="cx-timeline">
                  {recent.map((studio) => (
                    <Link className="cx-item" href={studioHref(studio.tenantId)} key={studio.tenantId}>
                      <span className="cx-item-title">{studio.name}</span>
                      <span className="cx-item-time">{relative(studio.createdAt, now)}</span>
                      <span className="cx-item-snippet">{LIFECYCLE_LABELS[studio.lifecycle]} · setup {studio.setupDone}/6</span>
                    </Link>
                  ))}
                </div>
              ) : (
                <Empty title="No studios yet" />
              )}
            </Panel>
            <Panel flush title="Latest feedback">
              {(feedback.rows ?? []).slice(0, 5).map((item) => (
                <Link className="cx-item" href={`/platform-admin/inbox?id=${item.id}`} key={item.id}>
                  <span className="cx-item-lead"><KindIcon kind={item.kind} /></span>
                  <span className="cx-item-title">{item.studioName}</span>
                  <span className="cx-item-time">{relative(item.createdAt, now)}</span>
                  <span className="cx-item-snippet">{item.message}</span>
                </Link>
              ))}
              {feedback.rows?.length === 0 ? <Empty title="No feedback yet" /> : null}
            </Panel>
          </aside>
        </div>
      </div>
    </>
  );
}

function greeting(name: string | null | undefined): string {
  const hour = new Date().getHours();
  const part = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const first = name?.split(" ")[0];
  return first ? `${part}, ${first}` : part;
}
