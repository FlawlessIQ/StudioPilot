/**
 * Group events, after the day: each parent's own delivery (group events
 * Phase 5, docs/group-events-design-2026-10-04.md "After").
 *
 * A cheer day is one job with sixty buyers, so a delivery is per participant:
 * the studio attaches a link to each athlete (one by one, by pasting
 * "name — link" lines matched by athlete name, or one link for everyone for a
 * team set), reviews the matches, and then releases. Releasing emails each
 * parent their own link (`group_delivery`) and shows it on their order page.
 *
 * Unpaid places are held: a parent who still owes isn't sent the link until
 * they've paid, unless the studio sends theirs anyway (`releasedUnpaid`).
 * Cancelled places never get anything.
 *
 * Pure, and safe on both sides of the trust boundary: the roster reads it to
 * show the matches before they're saved, and crmCommand and the close-out
 * check read it to decide. functions/src/group-events/delivery.ts is a copy
 * of everything below the marker; tests/group-event-delivery.test.ts fails on
 * a drift.
 */

// --- shared with functions/src/group-events/delivery.ts ---

/** A participant's delivery, as `eventParticipants/{id}.delivery` holds it. */
export type ParticipantDelivery = {
  /** The link attached now (a gallery or a folder), https only. */
  url: string | null;
  /** Where it's hosted ("pixieset", "dropbox", "other"), for the roster. */
  host?: string | null;
  attachedAt?: string | null;
  attachedBy?: string | null;
  /** The link last released to the parent, and when. */
  releasedUrl?: string | null;
  releasedAt?: string | null;
  releasedBy?: string | null;
  /** The studio sent it though they hadn't paid. */
  releasedUnpaid?: boolean;
};

/** A parent's one review ask (`eventParticipants/{id}.reviewAsk`). */
export type ParticipantReviewAsk = {
  state: "scheduled" | "queued" | "held";
  dueAt: string | null;
  reason?: string | null;
  queuedAt?: string | null;
};

export const DELIVERY_LIMITS = {
  url: 2000,
  /** Links saved in one press: a big cheer day, with room. */
  attachBatch: 200,
  /** Deliveries released in one press (two writes each, in one transaction). */
  releaseBatch: 150,
  /** Lines read from one paste. */
  pasteLines: 400,
} as const;

/** Days after their delivery that a parent is asked for a review (the wedding's first ask is at three). */
export const GROUP_REVIEW_DAYS_AFTER = 3;

/** Why a link can't be saved, or null when it can. */
export function deliveryUrlProblem(value: unknown): "required" | "too_long" | "not_https" | "invalid" | null {
  const url = typeof value === "string" ? value.trim() : "";
  if (!url) return "required";
  if (url.length > DELIVERY_LIMITS.url) return "too_long";
  if (!/^https:\/\//i.test(url)) return "not_https";
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || !parsed.hostname.includes(".") || /\s/.test(url)) return "invalid";
  } catch {
    return "invalid";
  }
  return null;
}

/**
 * A name as a match key: case, accents, curly quotes, punctuation at the edges
 * and runs of spaces don't count. "  Ava  O’Neil " and "ava o'neil" match.
 */
export function nameKey(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[‘’ʼ`]/g, "'")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^[\s.,;:'"-]+|[\s.,;:'"-]+$/g, "")
    .trim();
}

export type DeliveryLine =
  | { line: number; text: string; name: string; url: string }
  | { line: number; text: string; problem: "no_link" | "no_name" | "bad_link" };

const URL_IN_LINE = /https?:\/\/[^\s,|]+/i;
/** What sits between a name and its link: a dash, a comma, a tab, a bar or a colon. */
const SEPARATORS = /^[\s,;|:\t–—-]+|[\s,;|:\t–—-]+$/g;

/**
 * Pasted lines, one per athlete: "Ava Smith — https://…", "Ava Smith, https://…",
 * a spreadsheet's two columns (tab-separated), or the link first. Blank lines
 * are skipped; a line with no link or no name is reported, never guessed at.
 */
export function parseDeliveryLines(text: string): DeliveryLine[] {
  const lines = String(text ?? "").split(/\r?\n/).slice(0, DELIVERY_LIMITS.pasteLines);
  const parsed: DeliveryLine[] = [];
  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (!line) return;
    const found = URL_IN_LINE.exec(line);
    if (!found) {
      parsed.push({ line: index + 1, text: line, problem: "no_link" });
      return;
    }
    const url = found[0].replace(/[).,;]+$/, "");
    const before = line.slice(0, found.index).replace(SEPARATORS, "");
    const after = line.slice(found.index + found[0].length).replace(SEPARATORS, "");
    const name = (before || after).replace(/\s+/g, " ").trim();
    if (!name) parsed.push({ line: index + 1, text: line, problem: "no_name" });
    else if (deliveryUrlProblem(url)) parsed.push({ line: index + 1, text: line, problem: "bad_link" });
    else parsed.push({ line: index + 1, text: line, name, url });
  });
  return parsed;
}

type Matchable = { id: string; athleteName: string; parentName?: string | null; status: string };

export type DeliveryMatch = {
  matched: { participantId: string; athleteName: string; url: string; line: number }[];
  /** A name on nobody's place. */
  unmatched: { line: number; name: string; url: string }[];
  /** A name two places share: the studio picks. */
  ambiguous: { line: number; name: string; url: string; candidates: { id: string; athleteName: string; parentName: string | null }[] }[];
  /** A place named twice: the first line stands, the others wait for the studio. */
  repeated: { line: number; name: string; url: string; participantId: string }[];
  problems: { line: number; text: string; problem: "no_link" | "no_name" | "bad_link" }[];
};

/**
 * Pasted lines matched to the roster by athlete name. Nothing is matched to a
 * cancelled place, a name two places share is never decided for the studio,
 * and nothing is saved until the studio has looked (the roster shows this
 * before it sends the links).
 */
export function matchDeliveryLines(lines: readonly DeliveryLine[], participants: readonly Matchable[]): DeliveryMatch {
  const byName = new Map<string, Matchable[]>();
  for (const participant of participants) {
    if (participant.status === "cancelled") continue;
    const key = nameKey(participant.athleteName);
    if (!key) continue;
    byName.set(key, [...(byName.get(key) ?? []), participant]);
  }
  const result: DeliveryMatch = { matched: [], unmatched: [], ambiguous: [], repeated: [], problems: [] };
  const taken = new Set<string>();
  for (const entry of lines) {
    if ("problem" in entry) {
      result.problems.push(entry);
      continue;
    }
    const found = byName.get(nameKey(entry.name)) ?? [];
    if (!found.length) result.unmatched.push({ line: entry.line, name: entry.name, url: entry.url });
    else if (found.length > 1)
      result.ambiguous.push({
        line: entry.line,
        name: entry.name,
        url: entry.url,
        candidates: found.map((item) => ({ id: item.id, athleteName: item.athleteName, parentName: item.parentName ?? null })),
      });
    else if (taken.has(found[0]!.id))
      result.repeated.push({ line: entry.line, name: entry.name, url: entry.url, participantId: found[0]!.id });
    else {
      taken.add(found[0]!.id);
      result.matched.push({ participantId: found[0]!.id, athleteName: found[0]!.athleteName, url: entry.url, line: entry.line });
    }
  }
  return result;
}

type Deliverable = {
  status: string;
  amountCents?: number | null;
  email?: string | null;
  delivery?: ParticipantDelivery | null;
};

/**
 * Where one place's delivery stands:
 * - `none`: no link yet;
 * - `ready`: a link, not yet sent, and nothing in the way;
 * - `held_unpaid`: a link, not sent, because they still owe;
 * - `sent`: the link they have is the one attached;
 * - `changed`: they were sent a link, and a different one is attached now;
 * - `cancelled`: their place was cancelled.
 */
export type DeliveryState = "none" | "ready" | "held_unpaid" | "sent" | "changed" | "cancelled";

const linkOf = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/** Settled: paid, or nothing to pay. */
export function participantSettled(participant: Pick<Deliverable, "status" | "amountCents">): boolean {
  return participant.status === "paid" || !(Number(participant.amountCents ?? 0) > 0);
}

export function participantDeliveryState(participant: Deliverable): DeliveryState {
  if (participant.status === "cancelled") return "cancelled";
  const delivery = participant.delivery ?? null;
  const url = linkOf(delivery?.url);
  const released = linkOf(delivery?.releasedUrl);
  if (released && delivery?.releasedAt) return url && url !== released ? "changed" : "sent";
  if (!url) return "none";
  return participantSettled(participant) ? "ready" : "held_unpaid";
}

/** Delivered, for close-out and the count: sent a link at some point, and not cancelled. */
export function participantDelivered(participant: Deliverable): boolean {
  const state = participantDeliveryState(participant);
  return state === "sent" || state === "changed";
}

export type ReleaseDecision =
  | { release: true; url: string; email: boolean; unpaid: boolean }
  | { release: false; reason: "cancelled" | "no_link" | "already_sent" | "unpaid" };

/**
 * Whether releasing sends this place their link now. Unpaid places wait
 * unless the studio says to send anyway (`allowUnpaid`, one place at a time);
 * a link already sent isn't sent again, and a replaced link is. A place with
 * no email is still released — its order page shows the link, and it counts
 * as delivered — but nothing is emailed.
 */
export function releaseDecision(participant: Deliverable, options: { allowUnpaid?: boolean } = {}): ReleaseDecision {
  const state = participantDeliveryState(participant);
  if (state === "cancelled") return { release: false, reason: "cancelled" };
  if (state === "none") return { release: false, reason: "no_link" };
  if (state === "sent") return { release: false, reason: "already_sent" };
  // A changed link goes to someone who was already given one: paid or not,
  // the studio chose to give it to them then.
  if (state === "held_unpaid" && !options.allowUnpaid) return { release: false, reason: "unpaid" };
  return {
    release: true,
    url: linkOf(participant.delivery?.url),
    email: linkOf(participant.email).includes("@"),
    unpaid: !participantSettled(participant),
  };
}

export type DeliveryProgress = {
  /** Everyone not cancelled. */
  total: number;
  delivered: number;
  /** Attached and ready to send (including replaced links). */
  ready: number;
  heldUnpaid: number;
  /** No link yet. */
  missing: number;
};

export function groupDeliveryProgress(participants: readonly Deliverable[]): DeliveryProgress {
  const progress: DeliveryProgress = { total: 0, delivered: 0, ready: 0, heldUnpaid: 0, missing: 0 };
  for (const participant of participants) {
    const state = participantDeliveryState(participant);
    if (state === "cancelled") continue;
    progress.total += 1;
    if (state === "sent") progress.delivered += 1;
    else if (state === "changed") {
      progress.delivered += 1;
      progress.ready += 1;
    } else if (state === "ready") progress.ready += 1;
    else if (state === "held_unpaid") progress.heldUnpaid += 1;
    else progress.missing += 1;
  }
  return progress;
}

export type ParticipantsCloseout = {
  /** Whether the job's roster is part of its close-out at all. */
  applies: boolean;
  complete: boolean;
  total: number;
  settled: number;
  delivered: number;
};

/**
 * The close-out rule for a group event: every place not cancelled is settled
 * (paid, or owing nothing) and delivered. A job with no roster, or nobody on
 * it, is left to the ordinary checks.
 */
export function participantsCloseout(rosterOn: boolean, participants: readonly Deliverable[]): ParticipantsCloseout {
  const live = participants.filter((participant) => participant.status !== "cancelled");
  const settled = live.filter((participant) => participantSettled(participant)).length;
  const delivered = live.filter((participant) => participantDelivered(participant)).length;
  const applies = rosterOn && live.length > 0;
  return {
    applies,
    complete: applies && settled === live.length && delivered === live.length,
    total: live.length,
    settled,
    delivered,
  };
}

/** The close-out line, as the requirement's label says it. */
export function participantsCloseoutLabel(closeout: ParticipantsCloseout): string {
  if (closeout.complete) return "Everyone on the roster paid and delivered";
  const parts = [
    closeout.settled < closeout.total ? `${closeout.settled} of ${closeout.total} paid` : null,
    closeout.delivered < closeout.total ? `${closeout.delivered} of ${closeout.total} delivered` : null,
  ].filter(Boolean);
  return `Everyone on the roster paid and delivered (${parts.join(", ")})`;
}

/** When a parent's review ask is due: some days after their delivery. */
export function groupReviewDueAt(releasedAt: string): string {
  return new Date(Date.parse(releasedAt) + GROUP_REVIEW_DAYS_AFTER * 86_400_000).toISOString();
}

/** The stages a roster job moves to DELIVERED from, once everyone has their link. */
export const ROSTER_DELIVERY_FROM: readonly string[] = ["EVENT_COMPLETE", "POST_PRODUCTION"];

/**
 * Before the day: only once the event date has passed. A studio that never
 * marked the day done still delivered everyone, and photos sent are proof
 * enough that it happened.
 */
export const ROSTER_DELIVERY_FROM_BEFORE_DAY: readonly string[] = ["BOOKED", "PLANNING", "READY"];

/**
 * Whether a group event's job moves to DELIVERED on its own: its photos go to
 * each parent, not to the job's client, so the ordinary gallery release never
 * happens. Once every place not cancelled has been sent a link (paid or not —
 * money is close-out's question, not delivery's), the job is delivered. A job
 * already past delivery, cancelled or postponed is left where it is.
 */
export function rosterDeliveryMove(
  state: string,
  rosterOn: boolean,
  participants: readonly Deliverable[],
  eventDate: string | null = null,
  today: string = new Date().toISOString().slice(0, 10),
): boolean {
  const dayPassed = /^\d{4}-\d{2}-\d{2}/.test(eventDate ?? "") && eventDate!.slice(0, 10) <= today;
  if (!ROSTER_DELIVERY_FROM.includes(state) && !(dayPassed && ROSTER_DELIVERY_FROM_BEFORE_DAY.includes(state))) return false;
  const roster = participantsCloseout(rosterOn, participants);
  return roster.applies && roster.delivered === roster.total;
}
