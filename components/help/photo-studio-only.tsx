"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useWorkspace } from "@/features/auth/workspace-context";
import { tradeProfile } from "@/features/trades/trades";

/**
 * A page that walks a photographer's wedding, shown only to a photo studio.
 * Every link to it is gated (useOffersWeddingFilm), but a DJ who typed the
 * address read a year of galleries and albums (2026-10-09).
 */
export function PhotoStudioOnly({ children }: { children: ReactNode }) {
  const { tenantTrade } = useWorkspace();
  if (tradeProfile(tenantTrade).family === "photo") return <>{children}</>;
  return (
    <section className="panel">
      <p>
        This walk-through is written for photography studios. Your own guides are on the{" "}
        <Link href="/studio/help">Help page</Link>.
      </p>
    </section>
  );
}
