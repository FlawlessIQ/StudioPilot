import type { DomainEvent } from "@/server/integrations/contracts";
import type { Firestore } from "firebase-admin/firestore";

export class WebhookEventRepository {
  constructor(private readonly firestore: Firestore) {}

  async recordOnce(event: DomainEvent): Promise<boolean> {
    const reference = this.firestore.collection("webhookEvents").doc(event.id);
    return this.firestore.runTransaction(async (transaction) => {
      if ((await transaction.get(reference)).exists) return false;
      transaction.create(reference, { ...event, status: "received", attempts: 0 });
      return true;
    });
  }
}
