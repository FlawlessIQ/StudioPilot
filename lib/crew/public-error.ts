"use client";

import { reportHandledError } from "@/components/observability/error-reporter";

export function crewPublicError(
  caught: unknown,
  fallback: string,
  code = "CREW_OPERATION_FAILED",
): string {
  const message = caught instanceof Error ? caught.message.toLowerCase() : "";
  void reportHandledError(code);

  if (
    message.includes("permission") ||
    message.includes("forbidden") ||
    message.includes("unauthorized")
  ) {
    return "This record is not available for your current assignment. Return to Jobs or ask the studio to confirm your access.";
  }
  if (
    message.includes("offline") ||
    message.includes("network") ||
    message.includes("failed to fetch") ||
    message.includes("unavailable")
  ) {
    return "StudioCue could not be reached. Check your connection and try again.";
  }
  if (
    message.includes("authentication") ||
    message.includes("sign in") ||
    message.includes("token") ||
    message.includes("session")
  ) {
    return "Your secure session needs to be refreshed. Sign in again, then retry.";
  }
  if (message.includes("too long") || message.includes("timeout")) {
    return "This is taking longer than expected. Try again in a moment.";
  }
  return fallback;
}
