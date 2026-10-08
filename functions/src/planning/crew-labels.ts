/**
 * Short names for the people on a wedding: P1, P2 for photographers, V1, V2
 * for videographers — the way a studio writes them on a run of show.
 *
 * GR Productions' run of show (2026-10-06) tags each line with who covers it
 * ("P1 V1 Arrival & detail photos", "P2 V2 Groom getting ready") and says
 * when each team leaves ("P2 / V2 conclude", "V1 concludes 10:00"). Their
 * second team works a different window from the first, so a day has tracks,
 * not one list.
 *
 * Numbering: within a trade, a lead or main shooter comes first, a second or
 * assistant after, then the order they were booked. Pure, no imports.
 * Mirrored at functions/src/planning/crew-labels.ts; the test fails on drift.
 */

export type CrewTrade = "photographer" | "videographer" | "dj" | "makeup_artist" | "hair_stylist";

export type LabelledCrew = {
  id: string;
  /** The role they were booked as: "Lead photographer", "Second shooter", "Video". */
  role: string;
  /** Booking order, earliest first: an ISO time, or an index. */
  order?: string | number;
};

export type CrewLabel = { id: string; label: string; trade: CrewTrade; number: number };

/** Video in the role's name is video; anything else is photography (as staffing reads it). */
export function crewTrade(role: string): CrewTrade {
  // A DJ studio's crew: D1, D2 (trades.ts).
  if (/\bdj\b|disc jockey|\bmc\b/i.test(role)) return "dj";
  // A makeup or hair studio's: M1, M2 and H1, H2.
  if (/make.?up|\bmua\b|\bartist\b/i.test(role)) return "makeup_artist";
  if (/\bhair\b|stylist/i.test(role)) return "hair_stylist";
  return /video/i.test(role) ? "videographer" : "photographer";
}

const TRADE_LETTER: Record<CrewTrade, string> = { photographer: "P", videographer: "V", dj: "D", makeup_artist: "M", hair_stylist: "H" };

const rank = (role: string) => (/lead|main|primary|first|\b1\b/i.test(role) ? 0 : /second|assist|associate|\b2\b/i.test(role) ? 2 : 1);

export function crewLabels(members: readonly LabelledCrew[]): Map<string, CrewLabel> {
  const labels = new Map<string, CrewLabel>();
  for (const trade of ["photographer", "videographer", "dj", "makeup_artist", "hair_stylist"] as const) {
    const ofTrade = members
      .map((member, index) => ({ member, index }))
      .filter(({ member }) => crewTrade(member.role) === trade)
      .sort(
        (left, right) =>
          rank(left.member.role) - rank(right.member.role) ||
          String(left.member.order ?? left.index).localeCompare(String(right.member.order ?? right.index), undefined, { numeric: true }) ||
          left.index - right.index,
      );
    ofTrade.forEach(({ member }, index) => {
      if (labels.has(member.id)) return;
      labels.set(member.id, { id: member.id, label: `${TRADE_LETTER[trade]}${index + 1}`, trade, number: index + 1 });
    });
  }
  return labels;
}

/** P1, P2, V1, V2: photographers first, then by number. */
export function sortLabels(labels: readonly string[]): string[] {
  return [...new Set(labels)].sort((left, right) => left[0]!.localeCompare(right[0]!) || Number(left.slice(1)) - Number(right.slice(1)));
}

/** "Photo 1", "Video 2" for a label. */
export function labelName(label: string): string {
  const names: Record<string, string> = { V: "Video", D: "DJ", M: "Makeup", H: "Hair" };
  return `${names[label[0] ?? ""] ?? "Photo"} ${label.slice(1)}`;
}
