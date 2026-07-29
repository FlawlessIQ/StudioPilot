"use client";

import { useEffect, useState } from "react";
import { ArrowRight, BellRing, CalendarClock, MapPin, Users } from "lucide-react";
import { doc, getDoc } from "firebase/firestore";
import { useWorkspace } from "@/features/auth/workspace-context";
import { getFirebaseClient } from "@/lib/firebase/client";
import { dataIsLive } from "@/lib/runtime-mode";

type Impact = {
  addedItemIds: string[];
  removedItemIds: string[];
  changedItems: Array<{ itemId: string; title: string; changedFields: string[] }>;
  changedItemCount: number;
  requiresRenewedCrewAcknowledgement: boolean;
};

export function ScheduleImpactSummary({ scheduleId }: { scheduleId: string }) {
  const workspace = useWorkspace();
  const [impact, setImpact] = useState<Impact | null>(null);
  const [version, setVersion] = useState<number | null>(null);

  useEffect(() => {
    if (!dataIsLive || workspace.loading || !workspace.tenantId) return;
    const { firestore } = getFirebaseClient();
    void getDoc(doc(firestore, "schedules", scheduleId))
      .then((snapshot) => {
        if (
          !snapshot.exists() ||
          snapshot.get("tenantId") !== workspace.tenantId
        ) return;
        setVersion(Number(snapshot.get("version") ?? 0));
        const value = snapshot.get("changeImpact");
        if (value && typeof value === "object" && !Array.isArray(value)) {
          setImpact(value as Impact);
        }
      })
      .catch(() => {
        // The immutable schedule remains available below through the standard
        // record view even when this optional comparison cannot be loaded.
      });
  }, [scheduleId, workspace.loading, workspace.tenantId]);

  if (!impact || version === null) return null;
  return (
    <section className="panel schedule-impact-card">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Version {version} impact</p>
          <h2>What changed</h2>
          <p>Calculated from immutable schedule versions before notifications were sent.</p>
        </div>
        <CalendarClock aria-hidden="true" />
      </div>
      <div className="schedule-impact-facts">
        <span><strong>{impact.addedItemIds.length}</strong><small>Added items</small></span>
        <span><strong>{impact.removedItemIds.length}</strong><small>Removed items</small></span>
        <span><strong>{impact.changedItems.length}</strong><small>Changed items</small></span>
        <span className={impact.requiresRenewedCrewAcknowledgement ? "requires-action" : ""}>
          <BellRing size={16} />
          <strong>{impact.requiresRenewedCrewAcknowledgement ? "Required" : "Not required"}</strong>
          <small>Renewed crew acknowledgement</small>
        </span>
      </div>
      {impact.changedItems.length ? (
        <div className="schedule-change-list">
          {impact.changedItems.map((item) => (
            <article key={item.itemId}>
              <span>
                {item.changedFields.includes("location") ? <MapPin size={15} /> : item.changedFields.includes("photographers") ? <Users size={15} /> : <ArrowRight size={15} />}
              </span>
              <strong>{item.title}</strong>
              <small>{item.changedFields.join(" · ")}</small>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
