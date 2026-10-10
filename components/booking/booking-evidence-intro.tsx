"use client";

import { useWorkspace } from "@/features/auth/workspace-context";
import { tradeVocab } from "@/features/trades/trades";

/**
 * What books a job, in the studio's own word for the payment that holds the
 * date: a photographer's retainer, a DJ's or makeup artist's deposit
 * (trades.ts `deposit`; vendor wording sweep, 2026-10-10).
 */
export function BookingEvidenceIntro() {
  const workspace = useWorkspace();
  const deposit = tradeVocab(workspace.tenantTrade).deposit;
  return (
    <p>
      {`The job is booked once what its kind asks for is in — a signed agreement and a ${deposit} for a wedding, payment alone for a family session — confirmed by a connected app, or recorded by you.`}
    </p>
  );
}
