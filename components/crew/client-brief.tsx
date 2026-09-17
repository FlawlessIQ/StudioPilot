"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, ClipboardList } from "lucide-react";
import { collection, getDocs, limit, query, where } from "firebase/firestore";
import { useWorkspace } from "@/features/auth/workspace-context";
import { getFirebaseClient } from "@/lib/firebase/client";
import { dataIsLive } from "@/lib/runtime-mode";

type BriefItem = { fieldId: string; label: string; text: string };
type Brief = {
  id: string;
  questionnaireName: string;
  beforeYouShoot: BriefItem[];
  onTheDay: BriefItem[];
};

const items = (value: unknown): BriefItem[] =>
  Array.isArray(value)
    ? value.filter(
        (item): item is BriefItem =>
          typeof item?.label === "string" && typeof item?.text === "string",
      )
    : [];

/**
 * What the client told the studio that the crew need on the day.
 *
 * Crew can't read a questionnaire. When one is submitted, a trigger writes the
 * crew's part of it — the do-not-photograph list first — to `crewBriefs`,
 * which rules let only the people on that job read.
 *
 * It is also saved on the crew member's own phone, because the do-not-photograph
 * list matters most at a venue with no signal — exactly where the event-day
 * brief already falls back to its saved copy. The key carries the `studiocue:`
 * prefix, so signing out forgets it.
 */
export function CrewClientBrief({
  projectId,
  compact = false,
  offline = false,
}: {
  projectId: string;
  /** Only the before-you-shoot answers, for the event-day brief. */
  compact?: boolean;
  /** Render only the saved copy; don't try the network. */
  offline?: boolean;
}) {
  const workspace = useWorkspace();
  const [briefs, setBriefs] = useState<Brief[]>([]);
  const userId = workspace.userId;
  useEffect(() => {
    if (!userId || !projectId) return;
    // The saved copy first: offline, the query below can hang rather than fail.
    const timer = window.setTimeout(() => {
      try {
        const saved = window.localStorage.getItem(`studiocue:crew-client-brief:${userId}:${projectId}`);
        if (saved) setBriefs((current) => (current.length ? current : (JSON.parse(saved) as Brief[])));
      } catch {
        // A blocked or malformed copy never replaces the live brief.
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [projectId, userId]);
  useEffect(() => {
    if (offline || !dataIsLive || !workspace.tenantId || !userId || !projectId) return;
    let active = true;
    void getDocs(
      query(
        collection(getFirebaseClient().firestore, "crewBriefs"),
        where("tenantId", "==", workspace.tenantId),
        where("projectId", "==", projectId),
        limit(10),
      ),
    )
      .then((snapshot) => {
        if (!active) return;
        const live = snapshot.docs.map((document) => {
            const data = document.data();
            return {
              id: document.id,
              questionnaireName: String(data.questionnaireName ?? "Client brief"),
              beforeYouShoot: items(data.beforeYouShoot),
              onTheDay: items(data.onTheDay),
            };
          });
        setBriefs(live);
        try {
          if (live.length)
            window.localStorage.setItem(`studiocue:crew-client-brief:${userId}:${projectId}`, JSON.stringify(live));
          // A brief the studio withdrew shouldn't live on in the saved copy.
          else window.localStorage.removeItem(`studiocue:crew-client-brief:${userId}:${projectId}`);
        } catch {
          // Storage full or blocked: the live brief still shows.
        }
      })
      // No brief is the ordinary case, and a failed read keeps the saved copy.
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [offline, projectId, userId, workspace.tenantId]);

  const beforeYouShoot = briefs.flatMap((brief) => brief.beforeYouShoot);
  const onTheDay = compact ? [] : briefs.flatMap((brief) => brief.onTheDay);
  if (!beforeYouShoot.length && !onTheDay.length) return null;

  return (
    <section className="panel crew-client-brief" aria-label="From the client's brief">
      {beforeYouShoot.length ? (
        <div className="crew-client-brief-critical">
          <p className="eyebrow">
            <AlertTriangle size={14} /> Read before you shoot
          </p>
          <dl>
            {beforeYouShoot.map((item) => (
              <div key={`${item.fieldId}-${item.text}`} data-field={item.fieldId}>
                <dt>{item.label}</dt>
                <dd>{item.text}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
      {onTheDay.length ? (
        <div className="crew-client-brief-day">
          <p className="eyebrow">
            <ClipboardList size={14} /> From the client&rsquo;s brief
          </p>
          <dl>
            {onTheDay.map((item) => (
              <div key={`${item.fieldId}-${item.text}`}>
                <dt>{item.label}</dt>
                <dd>{item.text}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
    </section>
  );
}
