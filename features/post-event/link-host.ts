/**
 * Where a delivery link points, worked out from the URL.
 *
 * H4 (docs/delivery-plan-2026-09-28.md) makes this the one place the
 * provider comes from, instead of a list the studio picks from. The couple's
 * portal uses it first: a Vimeo link is a film and should say "Watch your
 * film", with a password, not "Open secure gallery" and an access code.
 *
 * A studio's own domain (galleries are often white-labelled) is `other`; the
 * record's own fields decide then. Pure.
 */

export type LinkMedia = "photo" | "video" | "files" | "other";
export type LinkHost = { host: string; name: string; mediaType: LinkMedia };

const HOSTS: Array<[RegExp, string, string, LinkMedia]> = [
  [/(^|\.)pixieset\.com$/, "pixieset", "Pixieset", "photo"],
  [/(^|\.)pic-time\.com$/, "pic_time", "Pic-Time", "photo"],
  [/(^|\.)shootproof\.com$/, "shootproof", "ShootProof", "photo"],
  [/(^|\.)smugmug\.com$/, "smugmug", "SmugMug", "photo"],
  [/(^|\.)vimeo\.com$/, "vimeo", "Vimeo", "video"],
  [/(^|\.)(youtube\.com|youtu\.be)$/, "youtube", "YouTube", "video"],
  [/(^|\.)frame\.io$/, "frame_io", "Frame.io", "video"],
  [/(^|\.)dropbox\.com$/, "dropbox", "Dropbox", "files"],
  [/^drive\.google\.com$/, "google_drive", "Google Drive", "files"],
  [/(^|\.)(wetransfer\.com|we\.tl)$/, "wetransfer", "WeTransfer", "files"],
];

const OTHER: LinkHost = { host: "other", name: "", mediaType: "other" };

export function linkHost(url: unknown): LinkHost {
  if (typeof url !== "string" || !url.trim()) return OTHER;
  let hostname: string;
  try {
    hostname = new URL(url.trim()).hostname.toLowerCase();
  } catch {
    return OTHER;
  }
  for (const [pattern, host, name, mediaType] of HOSTS) {
    if (pattern.test(hostname)) return { host, name, mediaType };
  }
  return OTHER;
}

/** A provider key the studio's form stored (`vimeo`, `pic_time`…), for when the URL can't say. */
export function hostByKey(provider: unknown): LinkHost {
  const known = HOSTS.find(([, host]) => host === provider);
  return known ? { host: known[1], name: known[2], mediaType: known[3] } : OTHER;
}
