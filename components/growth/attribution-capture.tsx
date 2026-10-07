"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { rememberTouch } from "@/features/growth/attribution";

/**
 * Notes how someone reached studio-cue.com, in their own browser, so that a
 * studio created later can say where it came from (features/growth/attribution.ts).
 * Runs on every page because a campaign link can land anywhere.
 */
export function AttributionCapture() {
  const pathname = usePathname();
  useEffect(() => {
    rememberTouch();
  }, [pathname]);
  return null;
}
