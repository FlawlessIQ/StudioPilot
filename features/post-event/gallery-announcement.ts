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

export function parseGalleryAnnouncement(source: string): GalleryAnnouncement {
  const rawUrl = firstMatch(source, [
    /(https:\/\/[^\s<>"']+)/i,
    /(www\.[^\s<>"']+)/i,
  ]).replace(/[),.;!?]+$/, "");
  const galleryUrl = rawUrl
    ? rawUrl.startsWith("https://")
      ? rawUrl
      : `https://${rawUrl}`
    : "";
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
  const accessCode = firstMatch(source, [
    /(?:access|download|gallery|pin|password|passcode)\s*(?:code|pin|password)?\s*[:#-]\s*([A-Z0-9-]{3,24})/i,
    /\bPIN\s+([A-Z0-9-]{3,24})\b/i,
  ]);
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
