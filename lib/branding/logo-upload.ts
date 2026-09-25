"use client";

import { getDownloadURL, getStorage, ref, uploadBytes } from "firebase/storage";
import { getFirebaseClient } from "@/lib/firebase/client";

/**
 * Uploading the studio's own logo, instead of asking for a URL.
 *
 * Branding was a "Logo URL" field, which quietly assumed the studio hosts
 * images somewhere and can paste a link to one. Most cannot, so most had no
 * logo — and it reached emails only: the proposal PDF printed the studio name
 * as plain text and the client portal showed nothing at all.
 *
 * Stored under the tenant's own branding path, which is world-readable on
 * purpose: the proposal renderer and the portal both fetch it without a
 * session, and a logo is the least private thing a studio owns.
 */

/** What the storage rule accepts, stated once so the UI and the check agree. */
export const LOGO_CONTENT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
] as const;

export const LOGO_MAX_BYTES = 2 * 1024 * 1024;

export type LogoRejection = { ok: true } | { ok: false; reason: string };

/**
 * Checked here as well as in the rule, so the studio is told what is wrong
 * rather than watching an upload fail.
 */
export function checkLogoFile(file: { type: string; size: number }): LogoRejection {
  if (
    !LOGO_CONTENT_TYPES.includes(file.type as (typeof LOGO_CONTENT_TYPES)[number])
  ) {
    return {
      ok: false,
      reason: "That file type isn't supported. Use a PNG, JPEG, WebP or SVG.",
    };
  }
  if (file.size > LOGO_MAX_BYTES) {
    return {
      ok: false,
      reason: "That image is over 2 MB. A logo should be well under it.",
    };
  }
  return { ok: true };
}

/** Uploads the logo and returns the URL to store on the tenant. */
export async function uploadStudioLogo(
  tenantId: string,
  file: File,
): Promise<string> {
  const check = checkLogoFile(file);
  if (!check.ok) throw new Error(check.reason);
  const client = getFirebaseClient();
  const storage = getStorage(client.app);
  /**
   * A new object name per upload rather than one fixed "logo.png".
   *
   * Overwriting a single object would leave every already-sent email and every
   * generated PDF pointing at the new image, so changing the logo would
   * silently rewrite history. A new name means old documents keep the mark they
   * were sent with.
   */
  const extension = file.name.includes(".")
    ? file.name.slice(file.name.lastIndexOf(".") + 1).toLowerCase().slice(0, 5)
    : "png";
  const objectName = `tenants/${tenantId}/branding/logo-${Date.now()}.${extension}`;
  const stored = await uploadBytes(ref(storage, objectName), file, {
    contentType: file.type,
  });
  return getDownloadURL(stored.ref);
}
