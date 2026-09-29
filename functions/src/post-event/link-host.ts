/**
 * Mirror of features/post-event/link-host.ts — functions/ is a separate
 * package with no "@/features" path. Compared below the header by
 * tests/delivery-deliverables.test.ts.
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
