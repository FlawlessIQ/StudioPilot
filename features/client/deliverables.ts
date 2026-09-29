import { hostByKey, linkHost, type LinkMedia } from "@/features/post-event/link-host";

/**
 * The couple's deliveries, as they should read them: "Your photos",
 * "Highlight film", "Sneak peek", each with its own link and code.
 *
 * H4 adds `mediaType`, `kind` and `label` to delivery records. Until a
 * record carries them, they are read from what it has: the provider, then the
 * link's host, then "a photo gallery", which is what every delivery was
 * before. Pure.
 */

export type DeliverableMedia = Exclude<LinkMedia, "other"> | "other";

export type ClientDeliverable = {
  id: string;
  projectId: string;
  mediaType: DeliverableMedia;
  kind: string;
  title: string;
  hostName: string;
  url: string | null;
  /** Where the button goes: the view-recording redirect when there is one, else `url`. */
  href: string | null;
  code: string | null;
  codeLabel: "Access code" | "Password";
  deliveredAt: string | null;
  expiresAt: string | null;
  downloaded: boolean;
};

const MEDIA = new Set(["photo", "video", "files", "other"]);

const KIND_TITLE: Record<string, string> = {
  sneak_peek: "Sneak peek",
  gallery: "Your gallery",
  highlight_film: "Highlight film",
  full_film: "Full film",
  teaser: "Film teaser",
  film: "Your film",
  raw_files: "Your raw files",
  album: "Your album",
};

const str = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

export function clientDeliverable(record: Record<string, unknown> & { id: string }): ClientDeliverable {
  const url = str(record.galleryUrl);
  const host = linkHost(url);
  const fromProvider = hostByKey(str(record.provider));
  const stored = str(record.mediaType);
  const mediaType: DeliverableMedia =
    stored === "album"
      ? "other"
      : stored && MEDIA.has(stored)
        ? (stored as DeliverableMedia)
        : host.mediaType !== "other"
          ? host.mediaType
          : fromProvider.mediaType !== "other"
            ? fromProvider.mediaType
            : "photo";
  const kind =
    str(record.kind) ?? (mediaType === "video" ? "film" : mediaType === "files" ? "raw_files" : "gallery");
  return {
    id: record.id,
    projectId: str(record.projectId) ?? "",
    mediaType,
    kind,
    title: str(record.label) ?? KIND_TITLE[kind] ?? "Your delivery",
    hostName: host.name || fromProvider.name,
    url,
    href: str(record.openUrl) ?? url,
    code: str(record.accessCode),
    codeLabel: mediaType === "video" ? "Password" : "Access code",
    deliveredAt: str(record.deliveryDate),
    expiresAt: str(record.expirationDate),
    downloaded: record.status === "downloaded" || Boolean(record.downloadedAt),
  };
}

/** Newest first. */
export function clientDeliverables(
  records: ReadonlyArray<Record<string, unknown> & { id: string }>,
): ClientDeliverable[] {
  return records
    .map(clientDeliverable)
    .sort((left, right) => String(right.deliveredAt ?? "").localeCompare(String(left.deliveredAt ?? "")));
}

/** "Your photos", "Your film", or both, for the page's heading. */
export function deliveriesHeading(deliverables: readonly ClientDeliverable[]): string {
  const photos = deliverables.some((item) => item.mediaType === "photo");
  const film = deliverables.some((item) => item.mediaType === "video");
  if (photos && film) return "Your photos and film";
  if (film) return "Your film";
  if (photos) return "Your photos";
  return "Your wedding";
}

/** Whole days until access closes (negative once it has), or null with no expiry. */
export function daysLeft(expiresAt: string | null, now: number): number | null {
  if (!expiresAt) return null;
  const at = new Date(/^\d{4}-\d{2}-\d{2}$/.test(expiresAt) ? `${expiresAt}T23:59:59` : expiresAt).valueOf();
  return Number.isNaN(at) ? null : Math.ceil((at - now) / 86_400_000);
}
