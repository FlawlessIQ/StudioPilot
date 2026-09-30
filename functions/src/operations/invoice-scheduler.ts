import { getFirestore } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { clientAutomationsPaused } from "../imports/existing-booking.js";
import { raiseFinalInvoice } from "../booking/final-invoice.js";

const date = (value: Date) => value.toISOString().slice(0, 10);

export const finalInvoiceScheduler = onSchedule(
  {
    schedule: "every day 06:00",
    timeZone: "UTC",
    retryCount: 3,
  },
  async () => {
    const db = getFirestore();
    const today = new Date();
    const target = new Date(today);
    target.setUTCDate(target.getUTCDate() + 28);
    const projects = await db
      .collection("projects")
      .where("eventDate", "==", date(target))
      .where("state", "in", ["BOOKED", "PLANNING", "READY"])
      .limit(100)
      .get();

    for (const project of projects.docs) {
      // A quiet imported booking is usually billed elsewhere already; raising
      // and emailing a final invoice would be a second bill for one wedding.
      if (clientAutomationsPaused(project.data())) continue;
      await db.runTransaction((transaction) =>
        raiseFinalInvoice(db, transaction, project, {
          invoiceId: `final_${project.id}`,
          actor: "final-invoice-scheduler",
          now: new Date().toISOString(),
        }),
      );
    }

    const overdue = await db
      .collection("invoiceReferences")
      .where("balanceCents", ">", 0)
      .where("dueDate", "<", date(today))
      .limit(200)
      .get();
    const batch = db.batch();
    for (const invoice of overdue.docs) {
      if (
        // A superseded or failed invoice is not owed: a booking change
        // replaced it (booking amendments) or it never reached the provider.
        !["voided", "refunded", "paid", "superseded", "failed"].includes(
          String(invoice.get("status")),
        )
      )
        batch.update(invoice.ref, {
          status: "overdue",
          updatedAt: new Date().toISOString(),
          updatedBy: "invoice-scheduler",
        });
    }
    await batch.commit();
  },
);
