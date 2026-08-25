import type { Firestore } from "firebase-admin/firestore";
import { isStandingInvoice } from "../booking/invoice-standing.js";
import type { PreparedAnswerFacts } from "./prepared-answers.js";

/**
 * Gather the project facts a prepared answer is built from.
 *
 * Every read is deliberately narrow, and every field the composer needs can come
 * back null — that is how an answer declines to exist rather than guessing. The
 * composer is the only thing that decides what is enough.
 */

function firstName(displayName: string | null): string | null {
  const first = displayName?.trim().split(/\s+/)[0];
  return first || null;
}

export async function gatherAnswerFacts(
  firestore: Firestore,
  input: { tenantId: string; projectId: string | null },
): Promise<PreparedAnswerFacts> {
  const [tenant, project] = await Promise.all([
    firestore.doc(`tenants/${input.tenantId}`).get(),
    input.projectId
      ? firestore.doc(`projects/${input.projectId}`).get()
      : Promise.resolve(null),
  ]);

  const studioName = String(tenant.get("name") ?? "your studio");
  const facts: PreparedAnswerFacts = {
    studioName,
    clientFirstName: null,
    projectName: (project?.get("name") as string | null) ?? null,
    eventDate: (project?.get("eventDate") as string | null) ?? null,
    invoice: null,
    arrivalTime: null,
    gallery: null,
  };
  if (!project?.exists || !input.projectId) return facts;

  const clientIds = Array.isArray(project.get("clientContactIds"))
    ? (project.get("clientContactIds") as unknown[]).map(String)
    : [];
  if (clientIds[0]) {
    const contact = await firestore.doc(`contacts/${clientIds[0]}`).get();
    facts.clientFirstName = firstName(
      (contact.get("displayName") as string | null) ?? null,
    );
  }

  const [invoices, schedules, deliveries] = await Promise.all([
    firestore
      .collection("invoiceReferences")
      .where("projectId", "==", input.projectId)
      .limit(20)
      .get(),
    firestore
      .collection("schedules")
      .where("projectId", "==", input.projectId)
      .limit(20)
      .get(),
    firestore
      .collection("deliveryRecords")
      .where("projectId", "==", input.projectId)
      .limit(10)
      .get(),
  ]);

  // Only a standing invoice. A superseded or refused one is not something a
  // client owes, and quoting its figure would be quoting a retracted number —
  // the shared predicate exists precisely because several places disagreed
  // about that once.
  const standing = invoices.docs
    .filter((document) => isStandingInvoice(document.get("status")))
    .sort((left, right) =>
      String(right.get("createdAt") ?? "").localeCompare(
        String(left.get("createdAt") ?? ""),
      ),
    );
  // Prefer something still owed; fall back to the newest so "all paid up" can be
  // answered truthfully rather than not at all.
  const invoice =
    standing.find(
      (document) => Number(document.get("balanceCents") ?? 0) > 0,
    ) ?? standing[0];
  if (invoice) {
    facts.invoice = {
      balanceCents: Number(invoice.get("balanceCents") ?? 0),
      currency: String(invoice.get("currency") ?? "USD"),
      dueDate: (invoice.get("dueDate") as string | null) ?? null,
      hostedUrl: (invoice.get("hostedUrl") as string | null) ?? null,
    };
  }

  // Approved or published only. An arrival time from a draft schedule is a
  // promise nobody has made to this client yet.
  const settled = schedules.docs
    .filter((document) =>
      ["approved", "published"].includes(String(document.get("status"))),
    )
    .sort((left, right) =>
      Number(right.get("version") ?? 0) - Number(left.get("version") ?? 0),
    )[0];
  if (settled) {
    const items = Array.isArray(settled.get("items"))
      ? (settled.get("items") as Array<Record<string, unknown>>)
      : [];
    const earliest = items
      .map((item) => String(item.startAt ?? ""))
      .filter(Boolean)
      .sort()[0];
    if (earliest) {
      const at = new Date(earliest);
      if (!Number.isNaN(at.valueOf())) {
        facts.arrivalTime = new Intl.DateTimeFormat("en-US", {
          hour: "numeric",
          minute: "2-digit",
          timeZone: String(settled.get("timezone") ?? "UTC"),
        }).format(at);
      }
    }
  }

  const delivered = deliveries.docs.find(
    (document) =>
      String(document.get("status")) === "delivered" &&
      typeof document.get("galleryUrl") === "string",
  );
  if (delivered) {
    facts.gallery = {
      url: String(delivered.get("galleryUrl")),
      ready: true,
    };
  }

  return facts;
}
