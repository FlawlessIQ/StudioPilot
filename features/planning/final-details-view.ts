/** The couple's final details as their portal shows them (server/planning/final-details.ts). */
export type FinalDetailsView = {
  status: "awaiting_couple" | "confirmed";
  lockOn: string | null;
  rows: Array<{ label: string; value: string }>;
  timeline: Array<{ time: string; title: string; location: string | null }>;
  changes: Array<{ at: string; label: string; from: string; to: string }>;
  /** What they confirm must be what they were shown. */
  snapshotHash: string;
  confirmedAt: string | null;
  /**
   * "headcount" for a client priced per person (makeup, hair): one question,
   * still this many getting ready, confirmed in one tap with no typed name
   * (functions/src/planning/final-details.ts). Absent: the full sign-off.
   */
  kind?: "details" | "headcount";
  /** Who's on their party list now, counting toward the headcount (headcount only). */
  people?: string[];
  /** The headcount when the details locked: it can go up from here, not down. */
  lockedHeadcount?: number | null;
  /** The headcount they confirmed. */
  confirmedHeadcount?: number | null;
};
