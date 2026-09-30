import { logoPageService } from "@/features/branding/tenant-brand";

/**
 * Whether a pasted logo link can actually be shown as an image — the sentence
 * to show the studio, or null when it may be one.
 *
 * GR Productions' logo was
 * `https://www.dropbox.com/preview/…/GRP%20LOGO%20BLACK.png?role=work`: a
 * Dropbox page behind Dropbox's sign-in. It ends in ".png", so it looked fine,
 * and it was broken everywhere the logo appears (2026-09-30). The answer is
 * the upload beside the field. Which links are pages is decided once, in
 * tenant-brand.ts, which also keeps them off every surface.
 *
 * Pure.
 */
export function logoUrlProblem(value: string): string | null {
  const text = value.trim();
  if (!text) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return "That isn't a web address. Upload your logo file instead.";
  }
  // Local development serves uploads from the storage emulator over http.
  const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (url.protocol !== "https:" && !local) {
    return "The link must start with https://. Upload your logo file instead.";
  }
  const service = logoPageService(text);
  return service
    ? `That's a ${service} page, not the image itself, so it can't show on your emails or forms. Upload the file instead.`
    : null;
}
