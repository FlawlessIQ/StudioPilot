"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarClock } from "lucide-react";
import { collection, doc, getDoc, getDocs, limit, query, where } from "firebase/firestore";
import { useWorkspace } from "@/features/auth/workspace-context";
import {
  compareTimelines,
  formatMinutes,
  parsePlannerTimeline,
  type TimelineAuthority,
  type TimelineDifference,
} from "@/features/schedules/timeline-authority";
import { friendlyError } from "@/lib/ai/friendly-error";
import { getFirebaseClient } from "@/lib/firebase/client";
import { sendPlanningCommand } from "@/lib/planning/command-client";
import { dataIsLive } from "@/lib/runtime-mode";

type ScheduleRow = { title: string; startAt: string; visibility?: string };
type Loaded = {
  projectId: string;
  authority: TimelineAuthority;
  plannerName: string;
  plannerText: string;
  plannerReceivedAt: string | null;
  schedule: { version: number; timezone: string; items: ScheduleRow[] } | null;
};

function describe(difference: TimelineDifference): { title: string; detail: string } {
  if (difference.kind === "moved") {
    const gap = difference.planner - difference.ours;
    const minutes = Math.abs(gap);
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    const amount = hours
      ? rest
        ? `${hours} hr ${rest} min`
        : `${hours} hr`
      : `${minutes} min`;
    return {
      title: difference.title,
      detail: `Planner has ${formatMinutes(difference.planner)}, yours says ${formatMinutes(difference.ours)} — ${amount} ${gap > 0 ? "later" : "earlier"} on theirs`,
    };
  }
  if (difference.kind === "only_planner")
    return { title: difference.title, detail: `${formatMinutes(difference.planner)} · only on the planner's timeline` };
  return { title: difference.title, detail: `${formatMinutes(difference.ours)} · only in your run of show` };
}

/**
 * Whose timeline is the real one for this wedding, and — when it's the
 * planner's — where the run of show has drifted from theirs.
 *
 * Mounted with a schedule (its detail page) or a project (the Timeline area).
 */
export function TimelineAuthorityPanel({ scheduleId, projectId }: { scheduleId?: string; projectId?: string }) {
  const workspace = useWorkspace();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [authority, setAuthority] = useState<TimelineAuthority>("studio");
  const [plannerName, setPlannerName] = useState("");
  const [plannerText, setPlannerText] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!dataIsLive || workspace.loading || !workspace.tenantId) return;
    if (!scheduleId && !projectId) return;
    let active = true;
    const { firestore } = getFirebaseClient();
    const tenantId = workspace.tenantId;
    void (async () => {
      let schedule: Record<string, unknown> | null = null;
      let targetProjectId = projectId ?? "";
      if (scheduleId) {
        const snapshot = await getDoc(doc(firestore, "schedules", scheduleId));
        if (!snapshot.exists() || snapshot.get("tenantId") !== tenantId) return;
        schedule = snapshot.data();
        targetProjectId = String(snapshot.get("projectId") ?? "");
      } else {
        const versions = await getDocs(
          query(
            collection(firestore, "schedules"),
            where("tenantId", "==", tenantId),
            where("projectId", "==", targetProjectId),
            limit(50),
          ),
        );
        schedule =
          versions.docs
            .map((item) => item.data())
            .sort((left, right) => Number(right.version ?? 0) - Number(left.version ?? 0))[0] ?? null;
      }
      if (!targetProjectId) return;
      const project = await getDoc(doc(firestore, "projects", targetProjectId));
      if (!active || !project.exists() || project.get("tenantId") !== tenantId) return;
      const planner = project.get("plannerTimeline") as { text?: unknown; receivedAt?: unknown } | null | undefined;
      const next: Loaded = {
        projectId: targetProjectId,
        authority: project.get("timelineAuthority") === "planner" ? "planner" : "studio",
        plannerName: String(project.get("plannerName") ?? ""),
        plannerText: typeof planner?.text === "string" ? planner.text : "",
        plannerReceivedAt: typeof planner?.receivedAt === "string" ? planner.receivedAt : null,
        schedule: schedule
          ? {
              version: Number(schedule.version ?? 0),
              timezone: String(schedule.timezone ?? "UTC"),
              items: Array.isArray(schedule.items) ? (schedule.items as ScheduleRow[]) : [],
            }
          : null,
      };
      setLoaded(next);
      setAuthority(next.authority);
      setPlannerName(next.plannerName);
      setPlannerText(next.plannerText);
    })().catch(() => {
      // The run of show below still works without this panel.
    });
    return () => {
      active = false;
    };
  }, [projectId, scheduleId, version, workspace.loading, workspace.tenantId]);

  const plannerItems = useMemo(() => parsePlannerTimeline(plannerText), [plannerText]);
  const differences = useMemo(() => {
    if (!loaded?.schedule || !plannerItems.length) return null;
    return compareTimelines({
      // Studio-only rows (arrival, gear, travel) are never on a planner's timeline.
      ours: loaded.schedule.items.filter((item) => item.visibility !== "studio"),
      timezone: loaded.schedule.timezone,
      planner: plannerItems,
    });
  }, [loaded, plannerItems]);

  if (!loaded) return null;
  const dirty =
    authority !== loaded.authority ||
    plannerName.trim() !== loaded.plannerName ||
    plannerText.trim() !== loaded.plannerText.trim();

  async function save() {
    if (!loaded) return;
    setBusy(true);
    setNotice(null);
    try {
      const outcome = await sendPlanningCommand("setTimelineAuthority", {
        projectId: loaded.projectId,
        authority,
        ...(authority === "planner" ? { plannerName: plannerName.trim(), plannerTimelineText: plannerText } : {}),
      });
      if (!outcome.persisted) {
        setNotice("Development preview — nothing was saved.");
        return;
      }
      setNotice(
        authority === "planner"
          ? "Saved. Vendors and crew are told the planner's timeline is the final word."
          : "Saved. Your run of show is the timeline for this wedding.",
      );
      setVersion((value) => value + 1);
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "That didn't save. Try again."));
    } finally {
      setBusy(false);
    }
  }

  const planner = plannerName.trim() || "the planner";
  return (
    <section className="panel timeline-authority-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">This wedding</p>
          <h2>Whose timeline is the real one?</h2>
          <p>When there&rsquo;s a planner, their timeline may be the one everyone follows.</p>
        </div>
        <CalendarClock aria-hidden="true" />
      </div>
      <fieldset className="timeline-authority-choice" disabled={busy}>
        <legend className="sr-only">Whose timeline is the real one</legend>
        <label>
          <input checked={authority === "studio"} name="timeline-authority" onChange={() => setAuthority("studio")} type="radio" />
          <span>
            <strong>Ours</strong>
            <small>Vendors and crew follow this run of show.</small>
          </span>
        </label>
        <label>
          <input checked={authority === "planner"} name="timeline-authority" onChange={() => setAuthority("planner")} type="radio" />
          <span>
            <strong>The planner&rsquo;s</strong>
            <small>This run of show is the photographers&rsquo; working copy of it.</small>
          </span>
        </label>
      </fieldset>
      {authority === "planner" ? (
        <div className="timeline-authority-planner">
          <label>
            Planner
            <input maxLength={120} onChange={(event) => setPlannerName(event.target.value)} placeholder="e.g. Maya at Lark Events" value={plannerName} />
          </label>
          <label>
            Their latest timeline
            <textarea
              onChange={(event) => setPlannerText(event.target.value)}
              placeholder={"Paste it as they sent it, one moment per line:\n3:30 PM Ceremony\n4:00 PM Family formals"}
              rows={8}
              value={plannerText}
            />
            <small>
              {plannerText.trim()
                ? plannerItems.length
                  ? `Found ${plannerItems.length} time${plannerItems.length === 1 ? "" : "s"}.`
                  : "No times found yet — put one moment per line, starting with its time."
                : loaded.plannerReceivedAt
                  ? null
                  : "Paste it whenever the planner sends a new version."}
              {loaded.plannerReceivedAt && !dirty
                ? ` Saved ${new Date(loaded.plannerReceivedAt).toLocaleDateString([], { month: "short", day: "numeric" })}.`
                : null}
            </small>
          </label>
          {differences === null ? (
            plannerItems.length && !loaded.schedule ? (
              <p className="timeline-authority-empty">Publish a run of show to compare it with {planner}&rsquo;s.</p>
            ) : null
          ) : differences.length ? (
            <div className="timeline-authority-differences">
              <p className="eyebrow">
                Where version {loaded.schedule?.version} differs from {planner}&rsquo;s
              </p>
              <ul>
                {differences.map((difference, index) => {
                  const text = describe(difference);
                  return (
                    <li data-kind={difference.kind} key={`${difference.kind}-${difference.title}-${index}`}>
                      <strong>{text.title}</strong>
                      <small>{text.detail}</small>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : (
            <p className="timeline-authority-match">Version {loaded.schedule?.version} matches {planner}&rsquo;s timeline.</p>
          )}
        </div>
      ) : null}
      <div className="timeline-authority-actions">
        <button
          className="button button-dark"
          disabled={busy || !dirty || (authority === "planner" && Boolean(plannerText.trim()) && !plannerItems.length)}
          onClick={() => void save()}
          type="button"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        {notice ? <p className="form-notice" role="status">{notice}</p> : null}
      </div>
    </section>
  );
}
