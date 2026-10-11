import { addCalendarDays, REMINDER_SEND_HOUR, zonedCalendarDate, zonedHour } from "../communications/event-reminders-core.js";
import { clientOutreachStop } from "../post-event/client-outreach.js";
import {
  EVENT_PAYMENT_METHODS,
  eventPrice,
  howToPay,
  normaliseEventSignup,
  slotLabel,
  venmoPayUrl,
  type EventPaymentMethod,
} from "./signup.js";

/**
 * The day-before note to each parent or family at a group event — the pure
 * rules (participant-reminders.ts does the Firestore half, inside the hourly
 * event-reminder sweep).
 *
 * Everyone with a place and an email hears the day before, from 9 AM in the
 * event's own zone: their time on a mini-session day, where, their
 * confirmation number, and what they still owe with a way to pay — or that
 * they're all paid. Only once the studio has set up sign-up (a roster kept
 * by hand isn't parent-facing until then), and the studio can turn it off
 * per event.
 *
 * Read again as it sends: a cancelled place, a job put away or quieted, or a
 * moved date holds it, and a moved time is said as it is now.
 */

export const GROUP_REMINDER_EMAIL = "group_event_reminder";

type Row = Record<string, unknown>;
const record = (value: unknown): Row =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Row) : {};
const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const dateOnly = (value: unknown): string | null => (/^\d{4}-\d{2}-\d{2}/.test(text(value)) ? text(value).slice(0, 10) : null);

/** One reminder per person per event date: a moved date is a new reminder. */
export const groupReminderJobId = (participantId: string, eventDate: string) => `group_reminder_${participantId}_${eventDate}`;

/** Whether an event's reminders go at all. */
export function eventRemindersOn(project: Row): { on: true } | { on: false; reason: string } {
  const groupEvent = record(project.groupEvent);
  if (groupEvent.enabled !== true) return { on: false, reason: "no_roster" };
  const config = normaliseEventSignup(groupEvent);
  if (!config.token) return { on: false, reason: "no_signup" };
  if (!config.reminders) return { on: false, reason: "turned_off" };
  const stop = clientOutreachStop(project);
  if (stop) return { on: false, reason: stop };
  return { on: true };
}

/** The calendar day the reminder is for: the day before the event, in its zone. */
export function reminderDay(project: Row): string | null {
  const eventDate = dateOnly(project.eventDate);
  return eventDate ? addCalendarDays(eventDate, -1) : null;
}

/** Whether `now` is on the reminder day, from 9 AM, in the event's zone. */
export function reminderDue(project: Row, now: Date, zone: string): "due" | "not_yet" | "too_late" | "no_date" {
  const day = reminderDay(project);
  if (!day) return "no_date";
  const today = zonedCalendarDate(now, zone);
  if (today < day) return "not_yet";
  if (today > day) return "too_late";
  return zonedHour(now, zone) >= REMINDER_SEND_HOUR ? "due" : "not_yet";
}

export type ParticipantReminderDecision = { send: true; id: string; eventDate: string } | { send: false; reason: string };

export function participantReminderDecision(input: {
  project: Row;
  participantId: string;
  participant: Row;
  now: Date;
  zone: string;
}): ParticipantReminderDecision {
  const on = eventRemindersOn(input.project);
  if (!on.on) return { send: false, reason: on.reason };
  const due = reminderDue(input.project, input.now, input.zone);
  if (due !== "due") return { send: false, reason: due };
  if (text(input.participant.status) === "cancelled") return { send: false, reason: "cancelled" };
  if (!text(input.participant.email).includes("@")) return { send: false, reason: "no_email" };
  const eventDate = dateOnly(input.project.eventDate)!;
  return { send: true, id: groupReminderJobId(input.participantId, eventDate), eventDate };
}

/** Where to be: the venue, and its town when there is one. */
export function eventWhere(project: Row): string | null {
  const venue = text(record(project.venue).name) || text(project.venueName);
  const city = text(project.city);
  return [venue, city].filter(Boolean).join(", ") || null;
}

/**
 * What they still owe and how to pay it, as the participant and the event
 * stand now. A paid place says so; an unpaid one says the amount and the way
 * they chose (or the studio takes it at the event, for someone it added).
 */
export function reminderPayment(input: { participant: Row; project: Row; studioName: string }): {
  paid: boolean;
  amountText: string | null;
  howToPay: string | null;
  payUrl: string | null;
} {
  const { participant } = input;
  const amountCents = Number(participant.amountCents ?? 0);
  const paid = text(participant.status) === "paid";
  if (paid || !(amountCents > 0)) return { paid, amountText: null, howToPay: null, payUrl: null };
  const config = normaliseEventSignup(record(input.project.groupEvent));
  const chosen = text(participant.chosenMethod);
  const method = (EVENT_PAYMENT_METHODS as readonly string[]).includes(chosen) ? (chosen as EventPaymentMethod) : null;
  const invoice = record(participant.qbInvoice);
  const athlete = text(participant.athleteName);
  const payUrl =
    method === "venmo" && config.venmoHandle
      ? venmoPayUrl(config.venmoHandle, amountCents, [athlete, text(participant.packageName)].filter(Boolean).join(" — "))
      : method === "pay_link" && config.payLinkUrl
        ? config.payLinkUrl
        : method === "quickbooks" && (invoice.state === "open" || invoice.state === "partially_paid") && text(invoice.hostedUrl)
          ? text(invoice.hostedUrl)
          : null;
  return {
    paid,
    amountText: eventPrice(amountCents),
    howToPay: method ? howToPay(method, config, input.studioName) : `${input.studioName} will take payment at the event.`,
    payUrl,
  };
}

export type ParticipantReminderPlan = { hold: string } | { values: Record<string, unknown> };

/**
 * At send time: hold, or the values as they are now — the time they're
 * booked for, what they owe and how to pay it.
 */
export function participantReminderPlan(input: {
  job: Row;
  project: Row | null;
  participant: Row | null;
  studioName: string;
  now: Date;
}): ParticipantReminderPlan {
  const { job, project, participant } = input;
  if (!project) return { hold: "job_missing" };
  const on = eventRemindersOn(project);
  if (!on.on) return { hold: on.reason };
  if (!participant || text(participant.status) === "cancelled") return { hold: "participant_cancelled" };
  const eventDate = dateOnly(project.eventDate);
  if (!eventDate || eventDate !== text(job.eventDate)) return { hold: "event_date_moved" };
  // Held past its day (a lapsed studio's billing hold): "tomorrow" would be wrong.
  const zone = text(job.timezone) || "UTC";
  if (zonedCalendarDate(input.now, zone) >= eventDate) return { hold: "event_passed" };
  const slot = text(participant.slot);
  return {
    values: {
      athleteName: text(participant.athleteName) || null,
      packageName: text(participant.packageName) || null,
      confirmationCode: text(participant.confirmationCode) || null,
      slotLabel: slot ? slotLabel(slot) : null,
      where: eventWhere(project),
      ...reminderPayment({ participant, project, studioName: input.studioName }),
    },
  };
}

/**
 * After the event: one nudge to anyone who still owes, two days on, from
 * 9 AM in the event's zone — what's owed and how to pay it. Under the same
 * switch as the day-before note, and held as it sends if they've paid since.
 */
export const GROUP_BALANCE_EMAIL = "group_event_balance";
export const BALANCE_DAYS_AFTER = 2;
/** Missed sweeps catch up for this many days, then it's left to the studio. */
const BALANCE_CATCH_UP_DAYS = 3;

export const groupBalanceJobId = (participantId: string, eventDate: string) => `group_balance_${participantId}_${eventDate}`;

export function balanceDue(project: Row, now: Date, zone: string): "due" | "not_yet" | "too_late" | "no_date" {
  const eventDate = dateOnly(project.eventDate);
  if (!eventDate) return "no_date";
  const day = addCalendarDays(eventDate, BALANCE_DAYS_AFTER)!;
  const last = addCalendarDays(day, BALANCE_CATCH_UP_DAYS)!;
  const today = zonedCalendarDate(now, zone);
  if (today < day) return "not_yet";
  if (today > last) return "too_late";
  if (today === day && zonedHour(now, zone) < REMINDER_SEND_HOUR) return "not_yet";
  return "due";
}

const owes = (participant: Row) =>
  ["unpaid", "pay_on_day"].includes(text(participant.status)) && Number(participant.amountCents ?? 0) > 0;

export function participantBalanceDecision(input: {
  project: Row;
  participantId: string;
  participant: Row;
  now: Date;
  zone: string;
}): ParticipantReminderDecision {
  const on = eventRemindersOn(input.project);
  if (!on.on) return { send: false, reason: on.reason };
  const due = balanceDue(input.project, input.now, input.zone);
  if (due !== "due") return { send: false, reason: `balance_${due}` };
  if (!owes(input.participant)) return { send: false, reason: "nothing_owed" };
  if (!text(input.participant.email).includes("@")) return { send: false, reason: "no_email" };
  const eventDate = dateOnly(input.project.eventDate)!;
  return { send: true, id: groupBalanceJobId(input.participantId, eventDate), eventDate };
}

/** At send time: hold if they've paid, been cancelled, or the event moved; else what's owed now. */
export function participantBalancePlan(input: {
  job: Row;
  project: Row | null;
  participant: Row | null;
  studioName: string;
}): ParticipantReminderPlan {
  const { job, project, participant } = input;
  if (!project) return { hold: "job_missing" };
  const on = eventRemindersOn(project);
  if (!on.on) return { hold: on.reason };
  if (!participant || text(participant.status) === "cancelled") return { hold: "participant_cancelled" };
  if (!owes(participant)) return { hold: "paid" };
  if (dateOnly(project.eventDate) !== text(job.eventDate)) return { hold: "event_date_moved" };
  return {
    values: {
      athleteName: text(participant.athleteName) || null,
      packageName: text(participant.packageName) || null,
      confirmationCode: text(participant.confirmationCode) || null,
      ...reminderPayment({ participant, project, studioName: input.studioName }),
    },
  };
}
