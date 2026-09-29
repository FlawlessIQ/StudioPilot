/**
 * The couple's messages as a chat (M4 of
 * docs/mobile-first-client-crew-plan-2026-09-28.md).
 *
 * The studio's inbox still files every message under a subject (the portal
 * send requires one, 1–120 characters), but a couple texting their
 * photographer should never be asked for one. So it is derived: a question
 * started from a page ("Ask about the schedule") is named for that page, a
 * reply carries the studio message's subject, and anything else takes its
 * first line.
 */

const SUBJECT_MAX = 120;
const FIRST_LINE_MAX = 60;

export function chatSubject(input: {
  body: string;
  context: string | null;
  replyToSubject: string | null;
}): string {
  if (input.context?.trim()) return `${input.context.trim()} question`.slice(0, SUBJECT_MAX);
  const replyTo = input.replyToSubject?.trim();
  if (replyTo) return (/^re:/i.test(replyTo) ? replyTo : `Re: ${replyTo}`).slice(0, SUBJECT_MAX);
  const firstLine = input.body.trim().split(/\r?\n/)[0]?.trim() ?? "";
  if (!firstLine) return "Message from the portal";
  return firstLine.length > FIRST_LINE_MAX
    ? `${firstLine.slice(0, FIRST_LINE_MAX - 1).trimEnd()}…`
    : firstLine;
}

function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/** "Today", "Yesterday", or the date, for the separator above a day's messages. */
export function chatDayLabel(iso: string, now: Date = new Date()): string {
  const when = new Date(iso);
  if (Number.isNaN(when.valueOf())) return "Earlier";
  if (localDayKey(when) === localDayKey(now)) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (localDayKey(when) === localDayKey(yesterday)) return "Yesterday";
  return when.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(when.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

/** Messages in the order they were sent, each marked with whether it starts a new day. */
export function chatThread<T extends Record<string, unknown>>(
  messages: readonly T[],
): Array<{ message: T; at: string; newDay: boolean }> {
  const sorted = messages
    .map((message) => ({ message, at: String(message.sentAt ?? message.createdAt ?? "") }))
    .sort((left, right) => left.at.localeCompare(right.at));
  return sorted.map((entry, index) => {
    const previous = sorted[index - 1];
    const newDay =
      !previous ||
      localDayKey(new Date(previous.at)) !== localDayKey(new Date(entry.at));
    return { ...entry, newDay };
  });
}
