/**
 * What a job delivers, and when it has delivered it (H4,
 * docs/delivery-plan-2026-09-28.md).
 *
 * A job was delivered once, with one link, and every word said
 * "photographs": a video-led studio could not send a highlight film after the
 * gallery. A job now has a list of deliverables — a gallery, a highlight film,
 * a full film, a sneak peek — each released on its own, and the job is
 * delivered when every *final* one has gone out (decided 2026-09-28, Q20).
 *
 * The list comes from the package: a structured `deliverables` list when the
 * studio set one, else what its coverage implies (a photographer means a
 * gallery, a videographer a highlight film), plus anything its free-text
 * deliverables name. Pure.
 *
 * Mirrored at functions/src/post-event/deliverables.ts (functions/ is a
 * separate package); tests/delivery-deliverables.test.ts compares the two
 * below the header.
 */

export type DeliverableMediaType = "photo" | "video" | "album" | "files" | "other";
export type DeliverableKind =
  | "sneak_peek"
  | "gallery"
  | "highlight_film"
  | "full_film"
  | "teaser"
  | "raw_files"
  | "album"
  | "other";

export type ExpectedDeliverable = {
  key: string;
  mediaType: DeliverableMediaType;
  kind: DeliverableKind;
  label: string;
  /** Counts toward "delivered". A sneak peek or a teaser does not. */
  final: boolean;
  /** Days after the event it is due; null when the studio never said. */
  turnaroundDays: number | null;
};

export const DELIVERABLE_KINDS: readonly DeliverableKind[] = [
  "sneak_peek",
  "gallery",
  "highlight_film",
  "full_film",
  "teaser",
  "raw_files",
  "album",
  "other",
];

const KIND_DEFAULTS: Record<
  DeliverableKind,
  { mediaType: DeliverableMediaType; label: string; final: boolean; turnaroundDays: number }
> = {
  sneak_peek: { mediaType: "photo", label: "Sneak peek", final: false, turnaroundDays: 7 },
  gallery: { mediaType: "photo", label: "Photo gallery", final: true, turnaroundDays: 42 },
  highlight_film: { mediaType: "video", label: "Highlight film", final: true, turnaroundDays: 60 },
  full_film: { mediaType: "video", label: "Full film", final: true, turnaroundDays: 90 },
  teaser: { mediaType: "video", label: "Film teaser", final: false, turnaroundDays: 14 },
  raw_files: { mediaType: "files", label: "Raw files", final: false, turnaroundDays: 42 },
  album: { mediaType: "album", label: "Album", final: false, turnaroundDays: 120 },
  other: { mediaType: "other", label: "Delivery", final: false, turnaroundDays: 42 },
};

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

export function isDeliverableKind(value: unknown): value is DeliverableKind {
  return typeof value === "string" && (DELIVERABLE_KINDS as readonly string[]).includes(value);
}

export function kindDefaults(kind: DeliverableKind) {
  return KIND_DEFAULTS[kind];
}

/** One structured deliverable as a package stores it, or null when it can't be read. */
export function parseDeliverable(value: unknown, index = 0): ExpectedDeliverable | null {
  const row = record(value);
  if (!isDeliverableKind(row.kind)) return null;
  const defaults = KIND_DEFAULTS[row.kind];
  const turnaround = Number(row.turnaroundDays);
  const mediaType = ["photo", "video", "album", "files", "other"].includes(text(row.mediaType))
    ? (text(row.mediaType) as DeliverableMediaType)
    : defaults.mediaType;
  return {
    key: text(row.key) || `${row.kind}_${index}`,
    mediaType,
    kind: row.kind,
    label: text(row.label) || defaults.label,
    final: typeof row.final === "boolean" ? row.final : defaults.final,
    turnaroundDays:
      Number.isFinite(turnaround) && turnaround >= 0 && turnaround <= 730 ? Math.round(turnaround) : defaults.turnaroundDays,
  };
}

function fromKind(kind: DeliverableKind): ExpectedDeliverable {
  const defaults = KIND_DEFAULTS[kind];
  return { key: kind, kind, ...defaults };
}

/**
 * What this job is expected to deliver.
 *
 * `coverage` is the package's people by trade (features/packages/coverage.ts);
 * `null` when the job has no package, in which case it is one photo gallery —
 * what every delivery was before.
 */
export function expectedDeliverables(input: {
  deliverables?: unknown;
  includedDeliverables?: unknown;
  coverage?: { photographers: number; videographers: number } | null;
}): ExpectedDeliverable[] {
  if (Array.isArray(input.deliverables)) {
    const parsed = input.deliverables
      .map((item, index) => parseDeliverable(item, index))
      .filter((item): item is ExpectedDeliverable => item !== null);
    if (parsed.length) return parsed;
  }
  const kinds = new Set<DeliverableKind>();
  const coverage = input.coverage;
  if (!coverage || coverage.photographers > 0) kinds.add("gallery");
  if (coverage && coverage.videographers > 0) kinds.add("highlight_film");
  const words = (Array.isArray(input.includedDeliverables) ? input.includedDeliverables : [])
    .map((item) => text(item).toLowerCase())
    .join(" · ");
  if (/sneak\s*peek/.test(words)) kinds.add("sneak_peek");
  if (/highlight/.test(words)) kinds.add("highlight_film");
  if (/full[\s-]*(length\s*)?film|feature\s*film|documentary\s*(edit|film)/.test(words)) kinds.add("full_film");
  if (/teaser|trailer/.test(words)) kinds.add("teaser");
  if (/\braw\b/.test(words)) kinds.add("raw_files");
  if (!kinds.size) kinds.add("gallery");
  return DELIVERABLE_KINDS.filter((kind) => kinds.has(kind)).map(fromKind);
}

/** What a delivery record is, read the same way whether or not it predates kinds. */
export function releasedKind(delivery: Record<string, unknown>): DeliverableKind {
  const stored = delivery.kind;
  if (isDeliverableKind(stored)) return stored;
  // A legacy video record said "film" before there were two kinds of film.
  if (stored === "film") return "highlight_film";
  return text(delivery.mediaType) === "video" ? "highlight_film" : "gallery";
}

/** The kind a link most likely is, from what it points at. */
export function defaultKindFor(mediaType: string): DeliverableKind {
  if (mediaType === "video") return "highlight_film";
  if (mediaType === "files") return "raw_files";
  return "gallery";
}

export type DeliveryProgress = {
  sent: ExpectedDeliverable[];
  outstanding: ExpectedDeliverable[];
  /** Every final deliverable has gone out. */
  complete: boolean;
};

/**
 * How far this job has got. An expected deliverable is sent when a released
 * record of its kind exists; revoked records don't count.
 */
export function deliveryProgress(
  expected: readonly ExpectedDeliverable[],
  released: ReadonlyArray<Record<string, unknown>>,
): DeliveryProgress {
  const live = released.filter((item) => !["revoked", "draft"].includes(text(item.status)) && !item.archivedAt);
  const sentKinds = new Set(live.map(releasedKind));
  const sent = expected.filter((item) => sentKinds.has(item.kind));
  const outstanding = expected.filter((item) => !sentKinds.has(item.kind));
  const finals = expected.filter((item) => item.final);
  return {
    sent,
    outstanding,
    complete: finals.length > 0 ? finals.every((item) => sentKinds.has(item.kind)) : live.length > 0,
  };
}

/** When a deliverable is due: the event date plus its turnaround. */
export function deliverableDueDate(eventDate: string | null | undefined, deliverable: ExpectedDeliverable): string | null {
  const day = text(eventDate).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || deliverable.turnaroundDays === null) return null;
  const due = new Date(`${day}T12:00:00.000Z`);
  due.setUTCDate(due.getUTCDate() + deliverable.turnaroundDays);
  return due.toISOString().slice(0, 10);
}

/** How the couple's email and the studio's screens name a release. */
export function releaseHeadline(items: ReadonlyArray<{ mediaType: string; kind: string }>): {
  subject: string;
  heading: string;
} {
  const kinds = items.map((item) => item.kind);
  const photos = items.some((item) => item.mediaType === "photo" && item.kind !== "sneak_peek");
  const films = items.filter((item) => item.mediaType === "video").length;
  if (items.length && kinds.every((kind) => kind === "sneak_peek")) {
    return { subject: "A sneak peek is ready", heading: "A sneak peek is ready" };
  }
  if (photos && films) {
    return { subject: "Your photos and film are ready", heading: "Your photos and film are ready" };
  }
  if (films) {
    const many = films > 1;
    return {
      subject: many ? "Your films are ready" : "Your film is ready",
      heading: many ? "Your films are ready" : "Your film is ready",
    };
  }
  if (items.length && items.every((item) => item.mediaType === "files")) {
    return { subject: "Your files are ready", heading: "Your files are ready" };
  }
  return { subject: "Your photographs are ready", heading: "Your photographs are ready" };
}
