import { clockMinutes, minutesClock } from "./day-clock";
import type { BeautyService, PartyMember, PartyRole } from "./party-list";

/**
 * A makeup or hair morning: who sits in whose chair, and when
 * (docs/vendor-journeys-plan.md, 3.4; docs/vendor-journeys.md).
 *
 * Worked back from the time everyone must be ready, in the window from the
 * earliest the artists can start. How long each person takes is by role
 * (the bride longest, a child shortest); the people are shared across the
 * artists so the morning ends together; and the bride sits in the middle of
 * her artist's chair, never last, so a running-late morning never rushes
 * her (the research's one rule everyone repeats). When the window is too
 * short for the artists booked, it says how many it needs.
 *
 * Pure: no clock, no randomness, the same plan for the same answers.
 */

/** Minutes per person, by role and service (the research's usual times). */
export const CHAIR_MINUTES: Record<BeautyService, Record<PartyRole, number>> = {
  makeup: { bride: 75, party: 45, mother: 45, child: 15 },
  hair: { bride: 75, party: 45, mother: 40, child: 20 },
};

export type ChairSlot = {
  name: string;
  role: PartyRole;
  /** 1-based: whose chair. */
  artist: number;
  /** "HH:MM" on the day. */
  start: string;
  end: string;
  notes: string | null;
};

export type ChairPlan = {
  slots: ChairSlot[];
  /** The artists this morning needs to be done by the ready-by time. */
  artistsNeeded: number;
  /** The artists the plan was laid out for (what was booked, or what it needs). */
  artists: number;
  /** "HH:MM" the first chair starts. */
  start: string | null;
  /** Fits between the earliest start and the ready-by time. */
  fits: boolean;
  notes: string[];
};

type Job = { person: PartyMember; minutes: number };

/** Share the people across `artists` chairs, longest first, the bride on chair 1. */
function share(jobs: readonly Job[], artists: number): Job[][] {
  const chairs: Job[][] = Array.from({ length: artists }, () => []);
  const load = new Array<number>(artists).fill(0);
  const bride = jobs.find((job) => job.person.role === "bride");
  if (bride) {
    chairs[0]!.push(bride);
    load[0] = bride.minutes;
  }
  const rest = jobs.filter((job) => job !== bride).sort((left, right) => right.minutes - left.minutes);
  for (const job of rest) {
    const least = load.indexOf(Math.min(...load));
    chairs[least]!.push(job);
    load[least] = load[least]! + job.minutes;
  }
  return chairs;
}

/** The order in a chair: the bride in the middle, everyone else around her. */
function order(chair: readonly Job[]): Job[] {
  const bride = chair.find((job) => job.person.role === "bride");
  if (!bride) return [...chair];
  const others = chair.filter((job) => job !== bride);
  const before = Math.ceil(others.length / 2);
  return [...others.slice(0, before), bride, ...others.slice(before)];
}

const longest = (chairs: readonly Job[][]) => Math.max(0, ...chairs.map((chair) => chair.reduce((sum, job) => sum + job.minutes, 0)));

export function planChairs(input: {
  people: readonly PartyMember[];
  service: BeautyService;
  /** "HH:MM": when everyone must be ready. */
  readyBy: string | null;
  /** "HH:MM": the earliest the artists can start; null for no limit. */
  earliestStart?: string | null;
  /** Artists booked; null lays it out for as many as it needs. */
  artists?: number | null;
}): ChairPlan {
  const notes: string[] = [];
  const jobs: Job[] = input.people
    .filter((person) => person.services.includes(input.service))
    .map((person) => ({ person, minutes: CHAIR_MINUTES[input.service][person.role] }));
  if (!input.readyBy || !jobs.length) {
    return {
      slots: [],
      artistsNeeded: 0,
      artists: 0,
      start: null,
      fits: false,
      notes: [!input.readyBy ? "Add the time everyone needs to be ready, then lay out the morning." : "Nobody on the party list has asked for this yet."],
    };
  }
  const readyBy = clockMinutes(input.readyBy);
  const window = input.earliestStart ? readyBy - clockMinutes(input.earliestStart) : null;
  // The fewest chairs that finish inside the window.
  let artistsNeeded = 1;
  while (window !== null && artistsNeeded < jobs.length && longest(share(jobs, artistsNeeded)) > window) artistsNeeded += 1;
  const artists = Math.max(1, Math.min(input.artists ?? artistsNeeded, jobs.length));
  const chairs = share(jobs, artists).map(order);
  const slots: ChairSlot[] = [];
  chairs.forEach((chair, index) => {
    // Each chair ends at the ready-by time, so the morning finishes together.
    let at = readyBy - chair.reduce((sum, job) => sum + job.minutes, 0);
    for (const job of chair) {
      const start = minutesClock(at);
      const end = minutesClock(at + job.minutes);
      if (start && end) slots.push({ name: job.person.name, role: job.person.role, artist: index + 1, start, end, notes: job.person.notes });
      at += job.minutes;
    }
  });
  slots.sort((left, right) => left.start.localeCompare(right.start) || left.artist - right.artist);
  const first = slots[0]?.start ?? null;
  const fits = window === null || longest(chairs) <= window;
  if (!fits) {
    notes.push(
      `With ${artists} ${artists === 1 ? "artist" : "artists"} the first chair starts at ${first} — before the earliest start. It needs ${artistsNeeded} to finish by ${input.readyBy}.`,
    );
  } else if (input.artists && artistsNeeded < input.artists) {
    notes.push(`${artistsNeeded} ${artistsNeeded === 1 ? "artist" : "artists"} would be enough for this party.`);
  }
  return { slots, artistsNeeded, artists, start: first, fits, notes };
}

/**
 * The chair plan as a day plan the run-of-show editor lays out
 * (day-plan.ts `planItems`): one line per chair, with its own end, at the
 * getting-ready place, said whose chair it is.
 */
export function chairDayPlan(plan: ChairPlan, input: { service: BeautyService; place: string | null; readyBy: string | null }) {
  const word = input.service === "makeup" ? "makeup" : "hair";
  const roleWord: Record<PartyRole, string> = { bride: " (bride)", party: "", mother: " (mother)", child: " (child)" };
  const summary =
    plan.slots.length && plan.start
      ? `${plan.slots.length} ${plan.slots.length === 1 ? "chair" : "chairs"} across ${plan.artists} ${plan.artists === 1 ? "artist" : "artists"}, from ${plan.start}, everyone ready by ${input.readyBy}.`
      : null;
  return {
    churchDay: false,
    firstLook: false,
    rows: plan.slots.map((slot, index) => ({
      key: `rule:chair-${index}` as const,
      title: `${slot.name}${roleWord[slot.role]} — ${word}`,
      time: slot.start,
      end: slot.end,
      where: input.place,
      source: "form" as const,
      sourceLabel: `Chair ${slot.artist}`,
      tbd: false,
      travelMinutes: 0,
      team: "all" as const,
    })),
    coverageStart: plan.start,
    coverageEnd: input.readyBy,
    notes: [...(summary ? [summary] : []), ...plan.notes],
    withheld: 0,
  };
}
