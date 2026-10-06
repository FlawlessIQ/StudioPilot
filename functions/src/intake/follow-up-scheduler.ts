import { getFirestore } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { advanceFollowUp } from "./follow-ups.js";
import { advanceProposalFollowUps } from "../booking/proposal-follow-ups.js";

/**
 * Once a day: every open inquiry the couple has gone quiet on gets its
 * follow-up brought up to date (./follow-ups.ts) — a nudge drafted on day 3
 * and day 7, the close offered on day 14. Drafts wait for the studio.
 *
 * Open inquiries are jobs at the inquiry stage (every dated inquiry is one)
 * and leads that aren't jobs yet; both are reached through their leads.
 *
 * Then proposals the client hasn't answered get theirs, on day 3 and day 7
 * (../booking/proposal-follow-ups.ts). Same idea, same tap to send.
 */
export const inquiryFollowUpScheduler = onSchedule(
  { schedule: "every day 14:00", timeZone: "UTC", retryCount: 1, region: "us-east4" },
  async () => {
    const db = getFirestore();
    const now = new Date().toISOString();
    const [jobs, openLeads] = await Promise.all([
      db.collection("projects").where("state", "==", "LEAD").limit(2000).get(),
      db.collection("leads").where("status", "==", "new").limit(2000).get(),
    ]);
    const leadIds = new Set<string>(openLeads.docs.filter((lead) => !lead.get("projectId")).map((lead) => lead.id));
    for (const job of jobs.docs) {
      if (job.get("archivedAt")) continue;
      const leadId = job.get("leadId");
      if (typeof leadId === "string" && leadId) leadIds.add(leadId);
    }
    let drafted = 0;
    let offered = 0;
    for (const leadId of leadIds) {
      try {
        const lead = await db.doc(`leads/${leadId}`).get();
        if (!lead.exists) continue;
        const step = await advanceFollowUp(db, lead, now);
        if (step === "first" || step === "second") drafted += 1;
        if (step === "close") offered += 1;
      } catch (caught: unknown) {
        console.warn(`[follow-up] ${leadId}: ${String(caught).slice(0, 160)}`);
      }
    }
    console.info(`[follow-up] ${leadIds.size} open inquiries; ${drafted} nudges drafted, ${offered} closes offered`);
    try {
      const proposals = await advanceProposalFollowUps(db, now);
      console.info(`[follow-up] proposals: ${proposals.drafted} follow-ups drafted, ${proposals.retired} withdrawn`);
    } catch (caught: unknown) {
      console.error("[follow-up] proposal follow-ups failed", caught);
    }
  },
);
