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
};
