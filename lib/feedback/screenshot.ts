"use client";

import { FEEDBACK_SCREENSHOT_MAX_BYTES } from "@/features/feedback/model";

/**
 * A picture of the screen as the studio sees it, for a feedback report.
 *
 * Rendered by the browser itself (modern-screenshot draws the page through an
 * SVG foreignObject, so the app's own CSS paints it) and downsized to a JPEG
 * that fits the feedback command. Captured before the feedback sheet opens, so
 * the sheet isn't in the picture. Anything that fails returns null: feedback
 * without a screenshot beats no feedback.
 */

const MAX_WIDTH = 1600;

export async function captureScreen(): Promise<string | null> {
  try {
    const { domToCanvas } = await import("modern-screenshot");
    const width = window.innerWidth;
    const height = window.innerHeight;
    const scale = Math.min(1, MAX_WIDTH / width) * Math.min(window.devicePixelRatio || 1, 2);
    const canvas = await domToCanvas(document.documentElement, {
      width,
      height,
      scale,
      backgroundColor: getComputedStyle(document.body).backgroundColor || "#ffffff",
      // The visible window, not the whole page: the screen they were looking at.
      style: { transform: `translate(${-window.scrollX}px, ${-window.scrollY}px)` },
      timeout: 8000,
      filter: (node) =>
        !(node instanceof HTMLElement && node.dataset.feedbackExclude === "true"),
    });
    return fitCanvas(canvas);
  } catch {
    return null;
  }
}

/** A file the studio picked instead, made the same shape as a capture. */
export async function imageFileToDataUrl(file: File): Promise<string | null> {
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type) || file.size > 20 * 1024 * 1024) return null;
  try {
    const bitmap = await createImageBitmap(file);
    const ratio = Math.min(1, MAX_WIDTH / bitmap.width);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * ratio);
    canvas.height = Math.round(bitmap.height * ratio);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return fitCanvas(canvas);
  } catch {
    return null;
  }
}

function fitCanvas(source: HTMLCanvasElement): string | null {
  let canvas = source;
  if (canvas.width > MAX_WIDTH) {
    const resized = document.createElement("canvas");
    resized.width = MAX_WIDTH;
    resized.height = Math.round((canvas.height * MAX_WIDTH) / canvas.width);
    resized.getContext("2d")?.drawImage(canvas, 0, 0, resized.width, resized.height);
    canvas = resized;
  }
  // base64 is 4/3 of the bytes; step the quality down until it fits.
  for (const quality of [0.82, 0.7, 0.55, 0.4]) {
    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    if ((dataUrl.length * 3) / 4 <= FEEDBACK_SCREENSHOT_MAX_BYTES) return dataUrl;
  }
  return null;
}
