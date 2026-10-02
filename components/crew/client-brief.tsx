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
  // Offline the workspace can't load, so it has no user; the phone's signed-in
  // user still names the saved copy (found by the local UAT run, 2026-09-29).
  const userId = workspace.userId ?? (dataIsLive ? getFirebaseClient().auth.currentUser?.uid ?? null : null);
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

  const shown = briefs.length ? briefs : dataIsLive ? [] : MOCK_BRIEF;
  const beforeYouShoot = shown.flatMap((brief) => brief.beforeYouShoot);
  const onTheDay = compact ? [] : shown.flatMap((brief) => brief.onTheDay);
  if (!beforeYouShoot.length && !onTheDay.length) return null;

  return (
    <section aria-label="From the client's brief" className="kit-stack-tight">
      {beforeYouShoot.length ? (
        <div className="kit-card kit-brief" data-tone="critical">
          <p className="kit-eyebrow">
            <AlertTriangle aria-hidden size={14} /> Read before you shoot
          </p>
          <dl className="kit-brief-list">
            {beforeYouShoot.map((item) => (
              <div data-field={item.fieldId} key={`${item.fieldId}-${item.text}`}>
                <dt>{item.label}</dt>
                <dd>{item.text}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
      {onTheDay.length ? (
        <div className="kit-card kit-brief">
          <p className="kit-eyebrow">
            <ClipboardList aria-hidden size={14} /> From the client&rsquo;s brief
          </p>
          <dl className="kit-brief-list">
            {onTheDay.map((item) => (
              <div data-field={item.fieldId} key={`${item.fieldId}-${item.text}`}>
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

/** Mock mode's brief, so the day sheet shows the lists that matter most. */
const MOCK_BRIEF: Brief[] = [
  {
    id: "demo-brief",
    questionnaireName: "Wedding day planning",
    beforeYouShoot: [
      { fieldId: "no-photo-list", label: "Please don't photograph", text: "The bride's uncle Mark (grey suit). Family reasons." },
      { fieldId: "sensitivities", label: "Handle with care", text: "Groom's grandmother uses a wheelchair; keep her in the front row of formals." },
    ],
    onTheDay: [
      { fieldId: "must-have-groups", label: "Family formals", text: "Couple with both sets of parents\nCouple with grandparents\nBride with her sisters\nGroom with his college friends" },
      { fieldId: "first-look", label: "First look", text: "Yes, in the rose garden at 3 PM." },
      { fieldId: "day-of-contact", label: "Day-of contact", text: "Jess (planner) · 617 555 0177" },
    ],
  },
];
