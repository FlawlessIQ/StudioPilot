"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, Compass, X } from "lucide-react";
import { useWorkspace } from "@/features/auth/workspace-context";
import { useStudioJobTypes } from "@/components/job-kinds/use-studio-job-types";

/**
 * Today's invitation to "A wedding, start to finish", for a studio that
 * hasn't booked a job yet — a trial studio wondering what the next year of a
 * wedding will look like. The caller shows it only until the first booking;
 * after that the studio is living it, not reading about it.
 *
 * Dismissed per person, in this browser (localStorage): a convenience, not a
 * record. If storage is unavailable it simply shows again.
 */
const storageKey = (userId: string | null) => `studiocue.journeyCard.dismissed:${userId ?? "anon"}`;

function readDismissed(userId: string | null): boolean {
  try {
    return window.localStorage.getItem(storageKey(userId)) === "1";
  } catch {
    return false;
  }
}

export function JourneyTodayCard() {
  const { userId } = useWorkspace();
  // Read on first render: Today mounts this only once its records have
  // loaded in the browser, never in the server render, so there is no
  // hydration to disagree with and a dismissed card never flashes.
  const [dismissed, setDismissed] = useState(() => readDismissed(userId));
  // A wedding's year, for a studio that shoots weddings: a family-only
  // studio would be reading about someone else's work.
  const shootsWeddings = useStudioJobTypes().some((type) => type.kind === "wedding");
  if (dismissed || !shootsWeddings) return null;
  return (
    <section className="today-clear today-getting-started is-compact journey-today-card">
      <span className="today-clear-icon">
        <Compass size={18} />
      </span>
      <div>
        <strong>See what a wedding looks like, inquiry to album</strong>
        <small>What StudioCue does by itself, what waits for you, and what your couple and crew see.</small>
      </div>
      <Link className="button button-light" href="/studio/help/journey">
        Take a look <ArrowRight size={15} />
      </Link>
      <button
        aria-label="Hide this"
        className="journey-today-dismiss"
        onClick={() => {
          setDismissed(true);
          try {
            window.localStorage.setItem(storageKey(userId), "1");
          } catch {
            // Hidden for this visit only.
          }
        }}
        type="button"
      >
        <X size={16} />
      </button>
    </section>
  );
}
