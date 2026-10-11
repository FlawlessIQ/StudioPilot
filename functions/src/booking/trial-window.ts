/**
 * When a client may book a makeup or hair trial from the studio's link.
 *
 * The trial page offered what a sales call offers: the next forty openings,
 * five working days. A hair trial is best once the veil is chosen, often
 * months later, and the invitation itself says "book once you have" (Priya
 * Shah, Jess Styles Bridal, 2026-10-10). So a trial opens every day from
 * tomorrow, the same lead time as a call, to the day before the event, shown
 * a week at a time; and its link stays open that long.
 *
 * Pure: the scheduler (public-scheduling.ts) gives it studio-local dates and
 * reads the window back. The openings inside a window still come from the
 * studio's hours, its busy calendar and what is already booked
 * (availability.ts), and a time the client picks is checked against them
 * again when they book.
 */

/** Days a trial window shows at once. */
export const TRIAL_WINDOW_DAYS = 7;
/** How far ahead a trial may be booked on a job with no date. */
export const TRIAL_HORIZON_DAYS = 365;
/** How long a sales call's link stays open, and the least a trial's does. */
export const BOOKING_LINK_DAYS = 14;

export type TrialWindow = {
  /** The first and last days shown, YYYY-MM-DD on the studio's clock. */
  start: string;
  end: string;
  /** The first and last days a trial may be booked at all. */
  earliest: string;
  latest: string;
  /** Where "Earlier" and "Later" go: null at either end. */
  previous: string | null;
  next: string | null;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

const dayOf = (value: unknown): string | null => {
  const day = typeof value === "string" ? value.slice(0, 10) : "";
  return DAY.test(day) && !Number.isNaN(Date.parse(`${day}T12:00:00Z`)) ? day : null;
};

/** A YYYY-MM-DD date moved by whole days. */
export function shiftDate(day: string, days: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Whole days from one YYYY-MM-DD date to another. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}

/** The calendar date of an instant on the studio's clock. */
export function studioDay(instant: Date, timeZone: string): string {
  const format = (zone: string | undefined) =>
    new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: zone }).format(instant);
  try {
    return format(timeZone || undefined);
  } catch {
    return format("America/New_York");
  }
}

/**
 * The week of days to show from `from` (the first bookable week without one),
 * kept between tomorrow and the day before the event. Null when no day is
 * left to book: the event is tomorrow, today or behind them.
 */
export function trialWindow(input: { today: string; eventDate: unknown; from?: string | null }): TrialWindow | null {
  const earliest = shiftDate(input.today, 1);
  const eventDay = dayOf(input.eventDate);
  const latest = eventDay ? shiftDate(eventDay, -1) : shiftDate(input.today, TRIAL_HORIZON_DAYS);
  if (latest < earliest) return null;
  const wanted = dayOf(input.from) ?? earliest;
  const start = wanted < earliest ? earliest : wanted > latest ? latest : wanted;
  const lastShown = shiftDate(start, TRIAL_WINDOW_DAYS - 1);
  const end = lastShown > latest ? latest : lastShown;
  const weekBefore = shiftDate(start, -TRIAL_WINDOW_DAYS);
  return {
    start,
    end,
    earliest,
    latest,
    previous: start > earliest ? (weekBefore < earliest ? earliest : weekBefore) : null,
    next: end < latest ? shiftDate(end, 1) : null,
  };
}

/**
 * How long a trial link stays open: to the day before the event, so a bride
 * who books once her veil is chosen still has a working link, and never less
 * than a call's fourteen days or more than a year.
 */
export function trialLinkDays(input: { today: string; eventDate: unknown }): number {
  const window = trialWindow({ today: input.today, eventDate: input.eventDate });
  if (!window) return BOOKING_LINK_DAYS;
  return Math.min(TRIAL_HORIZON_DAYS, Math.max(BOOKING_LINK_DAYS, daysBetween(input.today, window.latest) + 1));
}

/** What the slot generator is asked for, for one week of a trial (availability.ts generateConsultationSlots). */
export type TrialSlotPlan = {
  window: TrialWindow;
  /** The trial's own length: every start leaves room for all of it inside the studio's hours. */
  durationMinutes: number;
  /** Starts keep the studio's usual cadence: a call's length plus its buffer. */
  stepMinutes: number;
  /** From the studio's today to the window's first day, and how many days it shows. */
  startInDays: number;
  daysAhead: number;
  /** Room for every start in the week, however short the cadence. */
  maxSlots: number;
  /** What is already booked is read a day either side, so a booking that runs across midnight still counts. */
  busyFrom: string;
  busyTo: string;
};

/**
 * One week of a trial's openings, as the slot generator is asked for them.
 *
 * Pure, so what the server offers, and checks a pick against, is tested as
 * it runs (public-scheduling.ts `trialSlotsFor`). A pick (`at`) shows the
 * week it starts in: a time before tomorrow, after the day before the event,
 * or outside the studio's hours is never among the openings it is checked
 * against. Null when no day is left to book.
 */
export function trialSlotPlan(input: {
  now: Date;
  /** The studio's clock. */
  timezone: string;
  eventDate: unknown;
  /** The first day to show: "Earlier", "Later", or a date they jumped to. */
  from?: string | null;
  /** A time the client picked, to book it. */
  at?: string | null;
  /** The studio's call length and buffer (its consultation settings). */
  callMinutes: number;
  bufferMinutes: number;
  /** The trade's trial length (trades.ts `trialMinutes`); the call's when it has none. */
  trialMinutes?: number | null;
}): TrialSlotPlan | null {
  const today = studioDay(input.now, input.timezone);
  const picked = input.at && !Number.isNaN(Date.parse(input.at)) ? studioDay(new Date(input.at), input.timezone) : null;
  const window = trialWindow({ today, eventDate: input.eventDate, from: picked ?? input.from ?? null });
  if (!window) return null;
  const stepMinutes = Math.max(1, input.callMinutes + input.bufferMinutes);
  const daysAhead = daysBetween(window.start, window.end) + 1;
  return {
    window,
    durationMinutes: input.trialMinutes && input.trialMinutes > 0 ? input.trialMinutes : input.callMinutes,
    stepMinutes,
    startInDays: daysBetween(today, window.start),
    daysAhead,
    // Every start the week could hold. A fixed 200 ran out partway through a
    // week of 15-minute starts over long days, and the last days showed no
    // times with nothing saying why.
    maxSlots: daysAhead * Math.ceil((24 * 60) / stepMinutes),
    busyFrom: new Date(Math.max(input.now.valueOf(), Date.parse(`${shiftDate(window.start, -1)}T00:00:00Z`))).toISOString(),
    busyTo: new Date(Date.parse(`${shiftDate(window.end, 2)}T00:00:00Z`)).toISOString(),
  };
}
