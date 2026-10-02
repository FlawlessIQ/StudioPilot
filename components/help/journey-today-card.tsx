"use client";

import { X } from "lucide-react";
import { useWorkspace } from "@/features/auth/workspace-context";
import { useStudioJobTypes } from "@/components/job-kinds/use-studio-job-types";
import { JourneyFilmTeaser, useDismissed } from "@/components/help/journey-film";

/**
 * Today's invitation to "A wedding, start to finish", for a studio that
 * hasn't booked a job yet — a trial studio wondering what the next year of a
 * wedding will look like. The caller shows it only until the first booking;
 * after that the studio is living it, not reading about it.
 *
 * The film plays right here, in a dialog; the written page is the second
 * link. Dismissed per person, in this browser (useDismissed): a convenience,
 * not a record. If storage is unavailable it simply shows again.
 */
const storageKey = (userId: string | null) => `studiocue.journeyCard.dismissed:${userId ?? "anon"}`;

export function JourneyTodayCard() {
  const { userId } = useWorkspace();
  const [dismissed, dismiss] = useDismissed(storageKey(userId));
  // A wedding's year, for a studio that shoots weddings: a family-only
  // studio would be reading about someone else's work.
  const shootsWeddings = useStudioJobTypes().some((type) => type.kind === "wedding");
  if (dismissed || !shootsWeddings) return null;
  return (
    <section className="today-clear today-getting-started is-compact journey-today-card">
      <JourneyFilmTeaser
        pageHref="/studio/help/journey"
        text="What StudioCue does by itself, what waits for you, and what your couple and crew see."
        title="See what a wedding looks like, inquiry to album"
      />
      <button aria-label="Hide this" className="journey-today-dismiss" onClick={dismiss} type="button">
        <X size={16} />
      </button>
    </section>
  );
}
