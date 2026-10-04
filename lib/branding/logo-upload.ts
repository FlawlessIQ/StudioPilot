"use client";

import { connectStorageEmulator, getDownloadURL, getStorage, ref, uploadBytes } from "firebase/storage";
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

/**
 * What a studio may pick. An SVG is accepted here and stored as a PNG
 * (`rasterisedSvg` below): the branding path is world-readable, and an SVG is
 * a document that can carry script, so the storage rule no longer takes one.
 */
export const LOGO_CONTENT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
] as const;

/** What the storage rule accepts. */
export const LOGO_STORED_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

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

let storageEmulatorConnected = false;

/** Uploads the logo and returns the URL to store on the tenant. */
export async function uploadStudioLogo(
  tenantId: string,
  file: File,
): Promise<string> {
  const check = checkLogoFile(file);
  if (!check.ok) throw new Error(check.reason);
  const client = getFirebaseClient();
  const storage = getStorage(client.app);
  // Locally, the emulator — as the import and booking uploads do. Without it
  // the upload went to the real bucket and hung.
  if (process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true" && !storageEmulatorConnected) {
    try {
      connectStorageEmulator(storage, "127.0.0.1", 9199);
    } catch {
      // Another uploader may already have connected this shared app instance.
    }
    storageEmulatorConnected = true;
  }
  /**
   * A new object name per upload rather than one fixed "logo.png".
   *
   * Overwriting a single object would leave every already-sent email and every
   * generated PDF pointing at the new image, so changing the logo would
   * silently rewrite history. A new name means old documents keep the mark they
   * were sent with.
   */
  const source = file.type === "image/svg+xml" ? await rasterisedSvg(file) : file;
  const prepared = (await trimmedLogo(source)) ?? source;
  const extension =
    prepared !== file
      ? "png"
      : file.name.includes(".")
        ? file.name.slice(file.name.lastIndexOf(".") + 1).toLowerCase().slice(0, 5)
        : "png";
  const objectName = `tenants/${tenantId}/branding/logo-${Date.now()}.${extension}`;
  const stored = await uploadBytes(ref(storage, objectName), prepared, {
    contentType: prepared.type || file.type,
  });
  return getDownloadURL(stored.ref);
}

/** The longest side a stored logo keeps: sharp in an email header, small to fetch. */
const LOGO_MAX_SIDE = 1200;

/**
 * An SVG drawn to a PNG at the stored size. Drawn through an <img>, which
 * never runs an SVG's scripts. Its size comes from the viewBox, or the
 * width and height, because an SVG with neither has no natural size to draw.
 */
async function rasterisedSvg(file: File): Promise<File> {
  const unreadable = "We couldn't read that SVG. Save your logo as a PNG and upload that instead.";
  const text = await file.text();
  const svg = new DOMParser().parseFromString(text, "image/svg+xml").documentElement;
  if (!svg || svg.nodeName.toLowerCase() !== "svg") throw new Error(unreadable);
  const box = (svg.getAttribute("viewBox") ?? "").trim().split(/[\s,]+/).map(Number);
  const declaredWidth = Number.parseFloat(svg.getAttribute("width") ?? "");
  const declaredHeight = Number.parseFloat(svg.getAttribute("height") ?? "");
  const [boxWidth, boxHeight] = box.length === 4 && box[2]! > 0 && box[3]! > 0 ? [box[2]!, box[3]!] : [declaredWidth, declaredHeight];
  if (!(boxWidth > 0 && boxHeight > 0)) throw new Error(unreadable);
  const scale = LOGO_MAX_SIDE / Math.max(boxWidth, boxHeight);
  const width = Math.max(1, Math.round(boxWidth * scale));
  const height = Math.max(1, Math.round(boxHeight * scale));
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error(unreadable);
    context.drawImage(image, 0, 0, width, height);
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!png) throw new Error(unreadable);
    return new File([png], file.name.replace(/\.svg$/i, "") + ".png", { type: "image/png" });
  } catch (caught: unknown) {
    throw caught instanceof Error && caught.message === unreadable ? caught : new Error(unreadable);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * The logo without its empty margin, at a sensible size.
 *
 * GR Productions uploaded a 9000 x 9738 PNG whose wordmark filled a band across
 * the middle: every header scaled the whole square down, and the name printed a
 * few millimetres wide (2026-09-30). Trims near-white and transparent edges
 * and caps the size. An SVG, or anything the browser can't draw, goes up as
 * it is; the PDF renderer trims too.
 */
async function trimmedLogo(file: File): Promise<Blob | null> {
  if (file.type === "image/svg+xml" || typeof createImageBitmap !== "function") return null;
  try {
    const bitmap = await createImageBitmap(file);
    // Scan at a bounded size: a 9000-pixel canvas is hundreds of megabytes.
    const scan = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scan));
    const height = Math.max(1, Math.round(bitmap.height * scan));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    const { data } = context.getImageData(0, 0, width, height);
    let left = width, top = height, right = -1, bottom = -1;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const at = (y * width + x) * 4;
        const alpha = data[at + 3]!;
        if (alpha < 16) continue;
        const light = 0.299 * data[at]! + 0.587 * data[at + 1]! + 0.114 * data[at + 2]!;
        if (light >= 235) continue;
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
    if (right < 0) return null;
    const pad = Math.max(4, Math.round(0.02 * Math.max(right - left, bottom - top)));
    left = Math.max(0, left - pad);
    top = Math.max(0, top - pad);
    right = Math.min(width - 1, right + pad);
    bottom = Math.min(height - 1, bottom + pad);
    const cropWidth = right - left + 1;
    const cropHeight = bottom - top + 1;
    // Nothing worth changing: leave the studio's own file alone.
    if (scan === 1 && cropWidth >= width * 0.95 && cropHeight >= height * 0.95 && Math.max(width, height) <= LOGO_MAX_SIDE) return null;
    const fit = Math.min(1, LOGO_MAX_SIDE / Math.max(cropWidth, cropHeight));
    const out = document.createElement("canvas");
    out.width = Math.max(1, Math.round(cropWidth * fit));
    out.height = Math.max(1, Math.round(cropHeight * fit));
    out.getContext("2d")?.drawImage(canvas, left, top, cropWidth, cropHeight, 0, 0, out.width, out.height);
    return await new Promise<Blob | null>((resolve) => out.toBlob(resolve, "image/png"));
  } catch {
    return null;
  }
}
