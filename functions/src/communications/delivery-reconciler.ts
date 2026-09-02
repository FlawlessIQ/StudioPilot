import { getFirestore } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";

/**
 * What actually happened to the mail StudioCue sent.
 *
 * The Event Webhook is the normal way to learn this, and StudioCue cannot have
 * one: SendGrid allows two per billing plan and both belong to other products
 * on the same account. So a crew offer could record `status: succeeded` with a
 * real provider message id while its delivery status sat at "sent" for ever,
 * and a bounce, block or spam report was invisible — the studio was told the
 * offer went out, and had no way to learn it had not arrived.
 *
 * This asks instead of waiting. The Email Activity API answers for our own
 * sender only, so nothing here can see the other products' mail.
 *
 * Deliberately a summary sweep plus a few detail lookups, not one call per
 * message: the Activity API allows six requests per seven seconds — measured,
 * not assumed — so a per-message design would spend the whole budget on jobs
 * that were already delivered.
 */

const ACTIVITY = "https://api.sendgrid.com/v3/messages";

/**
 * SendGrid's activity id is our message id plus a routing suffix.
 *
 * We store `oEFJhQ8ORt6NuTjWKmlY6g`; the Activity API answers
 * `oEFJhQ8ORt6NuTjWKmlY6g.recvd-6d4864cb4-hglw4-1-6A9850E6-10.0`. Matching the
 * two is the whole join, so it is exported and tested rather than trusted.
 */
export const messageIdPrefix = (value: string): string =>
  value.split(".")[0] ?? value;

type Pending = {
  id: string;
  providerMessageId: string;
};

/**
 * The summary the sweep gets: "delivered", "not_delivered", "processing".
 * The event name behind a failure needs the detail call below.
 */
type ActivityRow = {
  msg_id?: unknown;
  status?: unknown;
  last_event_time?: unknown;
};

type ActivityEntry = {
  summary: string;
  activityId: string;
  /** When SendGrid last acted on it — not when we noticed. */
  lastEventTime: string;
};

/**
 * Index the activity rows by the message id we stored.
 *
 * Pure and exported so the timestamp carry is tested: recording the sweep's
 * own clock as `deliveredAt` is wrong by up to the polling interval, and
 * wrong in a way that looks perfectly reasonable in the UI.
 */
export function activityEntriesFromRows(
  rows: readonly ActivityRow[],
): Map<string, ActivityEntry> {
  const byPrefix = new Map<string, ActivityEntry>();
  for (const row of rows) {
    const id = text(row.msg_id);
    const summary = text(row.status);
    if (!id || !summary) continue;
    // Most recent first, so an earlier entry wins over a later duplicate.
    const key = messageIdPrefix(id);
    if (byPrefix.has(key)) continue;
    byPrefix.set(key, {
      summary,
      activityId: id,
      lastEventTime: text(row.last_event_time),
    });
  }
  return byPrefix;
}

const text = (value: unknown): string =>
  typeof value === "string" ? value : "";

async function activityForSender(
  apiKey: string,
  fromEmail: string,
  limit: number,
): Promise<Map<string, ActivityEntry>> {
  const url = new URL(ACTIVITY);
  // Scoped to our own sender, so this never reads another product's activity
  // even though the API key is shared across the account.
  url.searchParams.set("query", `from_email='${fromEmail}'`);
  url.searchParams.set("limit", String(limit));
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) throw new Error(`ACTIVITY_QUERY_FAILED:${response.status}`);
  const body = (await response.json()) as { messages?: ActivityRow[] };
  return activityEntriesFromRows(body.messages ?? []);
}

/**
 * The event name and time behind a failure.
 *
 * "not_delivered" is not something to show a studio — it needs to say bounce,
 * dropped or spam report, and why.
 */
async function failureDetail(
  apiKey: string,
  activityId: string,
): Promise<{ event: string; occurredAt: string; reason: string | null }> {
  const response = await fetch(
    `${ACTIVITY}/${encodeURIComponent(activityId)}`,
    { headers: { authorization: `Bearer ${apiKey}` } },
  );
  if (!response.ok) throw new Error(`ACTIVITY_DETAIL_FAILED:${response.status}`);
  const body = (await response.json()) as {
    events?: Array<Record<string, unknown>>;
  };
  const events = body.events ?? [];
  // The last event that explains a failure, not merely the last event.
  const decisive = [...events]
    .reverse()
    .find((event) =>
      ["bounce", "blocked", "dropped", "spamreport", "deferred"].includes(
        text(event.event_name),
      ),
    );
  const chosen = decisive ?? events.at(-1) ?? {};
  return {
    event: text(chosen.event_name) || "not_delivered",
    occurredAt: text(chosen.processed) || new Date().toISOString(),
    reason: text(chosen.reason) || null,
  };
}

export const emailDeliveryReconciler = onSchedule(
  {
    schedule: "every 15 minutes",
    timeZone: "UTC",
    retryCount: 1,
    secrets: ["SENDGRID_API_KEY"],
    timeoutSeconds: 120,
  },
  async () => {
    const apiKey = process.env.SENDGRID_API_KEY;
    const fromEmail = process.env.SENDGRID_FROM_EMAIL;
    // Nothing to reconcile in mock mode: no message was handed to a provider,
    // so there is no provider truth to fetch.
    if (
      !apiKey ||
      !fromEmail ||
      process.env.EMAIL_DELIVERY_MODE !== "live"
    ) {
      return;
    }

    const db = getFirestore();
    // One equality filter, so this needs no composite index. Everything else
    // is narrowed in memory.
    const snapshot = await db
      .collection("messages")
      .where("deliveryStatus", "==", "sent")
      .limit(500)
      .get();

    const pending: Pending[] = [];
    for (const document of snapshot.docs) {
      if (document.get("provider") !== "sendgrid") continue;
      if (document.get("channel") !== "email") continue;
      const providerMessageId = text(document.get("providerMessageId"));
      if (!providerMessageId) continue;
      pending.push({ id: document.id, providerMessageId });
    }
    if (!pending.length) return;

    const activity = await activityForSender(apiKey, fromEmail, 1000);

    // A failure costs one extra request each, against a budget of six per
    // seven seconds. Capped so a backlog of bounces cannot exhaust it and
    // fail the whole sweep; the rest are picked up next run.
    let detailBudget = 4;
    const now = new Date().toISOString();

    for (const item of pending) {
      const entry = activity.get(messageIdPrefix(item.providerMessageId));
      if (!entry) continue;
      const { summary, activityId, lastEventTime } = entry;
      if (summary === "processing") continue;

      let status = "delivered";
      // SendGrid's own event time, falling back to ours only when it gave
      // none. Recording the sweep's clock here put `deliveredAt` up to fifteen
      // minutes late — and looked entirely plausible while doing it.
      let occurredAt = lastEventTime || now;
      let reason: string | null = null;

      if (summary !== "delivered") {
        if (detailBudget <= 0) continue;
        detailBudget -= 1;
        try {
          const detail = await failureDetail(apiKey, activityId);
          status = detail.event;
          occurredAt = detail.occurredAt;
          reason = detail.reason;
        } catch {
          // Leave it pending rather than record a status we could not read.
          continue;
        }
      }

      // The same field shape the Event Webhook writes, so a studio reading a
      // message cannot tell which route learned it — and so this keeps working
      // if StudioCue ever gets a webhook slot of its own.
      const failed = ["bounce", "blocked", "dropped", "spamreport"].includes(
        status,
      );
      const update = {
        deliveryStatus: status,
        lastDeliveryEventAt: occurredAt,
        deliveryStatusSource: "activity_api",
        ...(status === "delivered" ? { deliveredAt: occurredAt } : {}),
        ...(failed ? { deliveryError: reason ?? status } : {}),
        updatedAt: now,
      };

      const batch = db.batch();
      batch.set(db.doc(`messages/${item.id}`), update, { merge: true });
      // The job document carries the same status for the operations views. It
      // shares the message's id by construction.
      batch.set(db.doc(`emailJobs/${item.id}`), update, { merge: true });
      await batch.commit();
    }
  },
);
