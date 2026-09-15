export type GalleryAnnouncement = {
  provider: "manual" | "pixieset" | "pic_time" | "shootproof";
  galleryUrl: string;
  accessCode: string;
  expirationDate: string;
};

const firstMatch = (source: string, patterns: RegExp[]) => {
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return "";
};

/**
 * Mail clients wrap links. Gmail rewrites them as google.com/url?q=… and
 * Outlook as …safelinks.protection.outlook.com/?url=…, so a forwarded gallery
 * notice carries the wrapper rather than the gallery. Unwrap before reading.
 */
function unwrapLink(value: string): string {
  try {
    const url = new URL(value.replaceAll("&amp;", "&"));
    const host = url.hostname.toLowerCase();
    const inner =
      (host.endsWith("google.com") && url.pathname === "/url" && (url.searchParams.get("q") || url.searchParams.get("url"))) ||
      (host.endsWith("safelinks.protection.outlook.com") && url.searchParams.get("url")) ||
      "";
    return inner ? unwrapLink(inner) : value;
  } catch {
    return value;
  }
}

const GALLERY_HOSTS = /pixieset|pic-?time|shootproof/i;

function galleryLinkFrom(source: string): string {
  const candidates = [...source.matchAll(/(https:\/\/[^\s<>"']+|www\.[^\s<>"']+)/gi)]
    .map((match) => match[1]!.replace(/[),.;!?\]]+$/, ""))
    .map((raw) => (raw.startsWith("https://") ? raw : `https://${raw}`))
    .map(unwrapLink);
  const hostOf = (value: string) => {
    try {
      return new URL(value).hostname;
    } catch {
      return "";
    }
  };
  return (
    candidates.find((value) => GALLERY_HOSTS.test(hostOf(value))) ??
    candidates.find((value) => !/unsubscribe|\.(png|jpe?g|gif)(\?|$)/i.test(value)) ??
    ""
  );
}

/**
 * The access code, from a label that means one. "View gallery: https://…" is
 * not a code — a bare "gallery:" label read "https" as the password.
 */
const ACCESS_CODE_PATTERNS = [
  /\b(?:password|passcode|pin|access\s*code|download\s*(?:code|pin|password)|gallery\s*(?:code|pin|password))\s*[:#-]\s*(?![A-Za-z0-9-]*:\/\/)([A-Z0-9-]{3,24})\b/i,
  // "PIN 4411", without a colon — capitals only, so "pin the date" is not a code.
  /\bPIN\s+([A-Z0-9-]{3,24})\b/,
];

export function parseGalleryAnnouncement(source: string): GalleryAnnouncement {
  // Mirrors functions/src/post-event/inbound.ts.
  const galleryUrl = galleryLinkFrom(source);
  const host = (() => {
    try {
      return new URL(galleryUrl).hostname.toLowerCase();
    } catch {
      return "";
    }
  })();
  const provider = host.includes("pixieset")
    ? "pixieset"
    : host.includes("pic-time") || host.includes("pictime")
      ? "pic_time"
      : host.includes("shootproof")
        ? "shootproof"
        : "manual";
  const accessCode = firstMatch(source, ACCESS_CODE_PATTERNS);
  const expirationDate = firstMatch(source, [
    /(?:expires?|expiration(?: date)?)\s*(?::|on)?\s*(\d{4}-\d{2}-\d{2})/i,
    /(?:expires?|expiration(?: date)?)\s*(?::|on)?\s*(\d{1,2}\/\d{1,2}\/\d{4})/i,
  ]);
  const normalizedExpiration = expirationDate.includes("/")
    ? (() => {
        const [month, day, year] = expirationDate.split("/");
        return `${year}-${month?.padStart(2, "0")}-${day?.padStart(2, "0")}`;
      })()
    : expirationDate;

  return {
    provider,
    galleryUrl,
    accessCode,
    expirationDate: normalizedExpiration,
  };
}
