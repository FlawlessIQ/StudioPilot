"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Smartphone, Users } from "lucide-react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { useTenantDocuments } from "@/components/live/tenant-records";
import { useWorkspace } from "@/features/auth/workspace-context";
import type { Participant } from "@/features/group-events/participants";
import {
  failedInvoiceLine,
  groupEventDay,
  groupEventShown,
  groupEventWhen,
  groupEventsForToday,
} from "@/features/group-events/today-summary";
import { getFirebaseClient } from "@/lib/firebase/client";
import { todayLocalIso } from "@/lib/format/event-date";
import { formatCentsExact } from "@/lib/format/money";
import { dataIsLive } from "@/lib/runtime-mode";

/**
 * Group events on Today (features/group-events/today-summary.ts): who has
 * signed up, what's been taken and what's still to take, for each roster
 * event today, in the next two weeks, or recently over with money owed.
 * On the day, Field mode is one tap away.
 *
 * Each event's roster is read live and on its own — the shared tenant read
 * stops at 100 records, and one cheer day can pass that.
 */
export function TodayGroupEvents() {
  const workspace = useWorkspace();
  const tenantId = workspace.tenantId;
  const { records: projects } = useTenantDocuments("projects");
  const today = todayLocalIso();
  const candidates = useMemo(() => groupEventsForToday(projects ?? [], today), [projects, today]);
  const key = candidates.map((candidate) => candidate.id).join(",");
  const [rosters, setRosters] = useState<Record<string, Participant[]>>({});

  useEffect(() => {
    if (!dataIsLive || !tenantId || !key) return;
    const { firestore } = getFirebaseClient();
    const stops = key.split(",").map((projectId) =>
      onSnapshot(
        // The rules check a coordinator's assignment from the job named here.
        query(collection(firestore, "eventParticipants"), where("tenantId", "==", tenantId), where("projectId", "==", projectId)),
        (snapshot) =>
          setRosters((current) => ({
            ...current,
            [projectId]: snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as Participant),
          })),
        () => setRosters((current) => ({ ...current, [projectId]: current[projectId] ?? [] })),
      ),
    );
    return () => stops.forEach((stop) => stop());
  }, [key, tenantId]);

  const now = new Date().toISOString();
  const rows = candidates
    .filter((candidate) => rosters[candidate.id] !== undefined || !dataIsLive)
    .map((candidate) => ({
      candidate,
      day: groupEventDay(rosters[candidate.id] ?? [], candidate.groupEvent, {
        now,
        isToday: (iso) => todayLocalIso(new Date(iso)) === today,
      }),
    }))
    .filter(({ candidate, day }) => groupEventShown(candidate, day))
    .slice(0, 4);

  if (!rows.length) return null;
  return (
    <section aria-label="Group events" className="today-lane today-group-events">
      <div className="today-lane-heading">
        <h2>Group events</h2>
        <span>{rows.length}</span>
      </div>
      <ul className="today-group-list">
        {rows.map(({ candidate, day }) => {
          const onTheDay = candidate.dayOffset === 0;
          const failed = failedInvoiceLine(day);
          const stats = day.signedUp
            ? [
                `${day.signedUp} signed up`,
                onTheDay && day.takenTodayCents ? `${formatCentsExact(day.takenTodayCents)} taken today` : null,
                !onTheDay && day.collectedCents ? `${formatCentsExact(day.collectedCents)} taken` : null,
                day.outstandingCents ? `${formatCentsExact(day.outstandingCents)} still to take` : day.paid ? "everyone has paid" : null,
              ]
            : [day.signup === "not_set_up" ? "Nobody on the roster yet. Set up sign-up to share a link or QR code." : "Nobody has signed up yet."];
          return (
            <li data-today={onTheDay ? "" : undefined} key={candidate.id}>
              <span className="today-group-icon" aria-hidden="true">
                <Users size={16} />
              </span>
              <span className="today-group-text">
                <strong>{candidate.name}</strong>
                <small>
                  {groupEventWhen(candidate)}
                  {day.signup === "open" ? " · sign-up open" : day.signup === "full" ? " · sign-up full" : ""}
                </small>
                <small>{stats.filter(Boolean).join(" · ")}</small>
                {failed ? <small className="today-group-failed">{failed} — send it again from the roster</small> : null}
              </span>
              <span className="today-group-actions">
                {onTheDay ? (
                  <Link className="button button-sm button-dark" href={`/studio/projects/${candidate.id}/field`}>
                    <Smartphone aria-hidden size={14} /> Field mode
                  </Link>
                ) : null}
                <Link className="button button-sm button-light" href={`/studio/projects/${candidate.id}`}>
                  Open <ArrowRight aria-hidden size={14} />
                </Link>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
