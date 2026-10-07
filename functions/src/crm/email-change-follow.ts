import type { Firestore } from "firebase-admin/firestore";
import { draftFollows, leadFollows } from "./email-change.js";

/**
 * The inquiry and its waiting drafts, moved to a client's corrected address
 * (email-change.ts). After the client's own save rather than inside it: a
 * lookup that fails here must never fail the edit, and what it misses is still
 * caught when a draft is approved (followedRecipient, ai/actions.ts).
 */
export async function followEmailToInquiries(
  db: Firestore,
  input: {
    tenantId: string;
    contactId: string;
    from: string;
    to: string;
    actorId: string;
    now: string;
  },
): Promise<{ leads: string[]; drafts: string[] }> {
  const moved = { leads: [] as string[], drafts: [] as string[] };
  const leads = await db
    .collection("leads")
    .where("tenantId", "==", input.tenantId)
    .where("primaryContactId", "==", input.contactId)
    .limit(25)
    .get();
  const leadIds = leads.docs.map((lead) => lead.id);
  for (const lead of leads.docs) {
    if (!leadFollows(lead.data(), input.contactId, input.from)) continue;
    await lead.ref.update({
      email: input.to,
      normalizedEmail: input.to.toLowerCase(),
      updatedAt: input.now,
      updatedBy: input.actorId,
    });
    moved.leads.push(lead.id);
  }

  const waiting = db
    .collection("aiActions")
    .where("tenantId", "==", input.tenantId)
    .where("status", "==", "review_required");
  const lookups = [
    waiting.where("structuredOutput.contactId", "==", input.contactId).limit(50).get(),
    ...leadIds.map((leadId) =>
      waiting.where("structuredOutput.leadId", "==", leadId).limit(50).get(),
    ),
  ];
  const seen = new Set<string>();
  for (const result of await Promise.all(lookups)) {
    for (const draft of result.docs) {
      if (seen.has(draft.id)) continue;
      seen.add(draft.id);
      if (!draftFollows(draft.data(), { contactId: input.contactId, leadIds }, input.from)) continue;
      await draft.ref.update({
        "structuredOutput.recipientEmail": input.to,
        updatedAt: input.now,
      });
      moved.drafts.push(draft.id);
    }
  }
  return moved;
}
