/**
 * Hours on a crew closeout, from two clock times (M6 of
 * docs/mobile-first-client-crew-plan-2026-09-28.md). The date is the job's;
 * a finish earlier than the start is after midnight, which a wedding
 * reception often is. Pure.
 */
export function workWindow(dayIso: string, start: string, end: string): { startsAt: Date; endsAt: Date } | null {
  const day = new Date(dayIso);
  if (Number.isNaN(day.valueOf()) || !/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) return null;
  const at = (value: string, addDay: boolean) => {
    const [hours, minutes] = value.split(":").map(Number) as [number, number];
    const date = new Date(day);
    date.setHours(hours, minutes, 0, 0);
    if (addDay) date.setDate(date.getDate() + 1);
    return date;
  };
  const startsAt = at(start, false);
  const endsAt = at(end, end <= start);
  return { startsAt, endsAt };
}

