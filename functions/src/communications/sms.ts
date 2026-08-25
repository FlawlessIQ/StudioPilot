import { createHmac, timingSafeEqual } from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import { onRequest, type Request } from "firebase-functions/v2/https";
import {
  applyMessageToConversation,
  conversationIdFor,
} from "./conversation.js";
import {
  applyConsentIntent,
  canSendSms,
  consentIntentOf,
  optOutAcknowledgement,
  unknownSmsConsent,
  type SmsConsent,
} from "./sms-consent.js";

/**
 * SMS, the third channel on the same threads.
 *
 * Last of the five phases on purpose: this is a compliance project as much as an
 * engineering one. `docs/production-readiness.md` gates SMS behind Twilio
 * credentials, sender registration, and consent, and nothing here changes that —
 * it stays inert until TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and
 * TWILIO_SMS_FROM_NUMBER are all configured.
 *
 * Consent is enforced on the send path rather than trusted from the caller, and
 * an inbound STOP takes effect before the message is threaded — so a client who
 * opts out cannot receive anything except the acknowledgement the carriers
 * require.
 */

function twilioConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_SMS_FROM_NUMBER,
  );
}

/**
 * Twilio signs each webhook with HMAC-SHA1 over the full URL followed by every
 * POST parameter in alphabetical order. Without this check the endpoint would
 * accept anyone's claim that a client had texted — including a forged STOP, or a
 * message put into a stranger's thread.
 */
function verifyTwilioSignature(request: Request): boolean {
  const token = process.env.TWILIO_AUTH_TOKEN;
  const signature = request.header("x-twilio-signature");
  if (!token || !signature) return false;
  const url =
    process.env.TWILIO_WEBHOOK_URL ??
    `https://${request.hostname}${request.originalUrl.split("?")[0]}`;
  const body = (request.body ?? {}) as Record<string, unknown>;
  const payload = Object.keys(body)
    .sort()
    .reduce((accumulator, key) => accumulator + key + String(body[key]), url);
  const expected = createHmac("sha1", token).update(payload).digest("base64");
  const left = Buffer.from(expected);
  const right = Buffer.from(signature);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function sendTwilioMessage(to: string, body: string): Promise<string> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID ?? "";
  const authToken = process.env.TWILIO_AUTH_TOKEN ?? "";
  const from = process.env.TWILIO_SMS_FROM_NUMBER ?? "";
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`,
    {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: to, From: from, Body: body }),
    },
  );
  const payload = (await response.json().catch(() => ({}))) as {
    sid?: string;
    message?: string;
  };
  if (!response.ok || !payload.sid) {
    throw new Error(
      `TWILIO_SEND_FAILED:${response.status}:${payload.message ?? "unknown"}`,
    );
  }
  return payload.sid;
}

/**
 * Outbound text for a contact, refused unless consent is on record.
 *
 * Exported for the job worker rather than called from a request handler: sending
 * belongs on the same retrying, idempotent path as email.
 */
export async function sendClientSms(input: {
  tenantId: string;
  projectId: string | null;
  contactId: string;
  body: string;
}): Promise<{ sid: string; conversationId: string }> {
  if (!twilioConfigured()) throw new Error("SMS_NOT_CONFIGURED");
  const db = getFirestore();
  const contact = await db.doc(`contacts/${input.contactId}`).get();
  if (!contact.exists || contact.get("tenantId") !== input.tenantId) {
    throw new Error("CONTACT_NOT_FOUND");
  }
  const phone = (contact.get("mobilePhone") ?? contact.get("phone")) as
    | string
    | null;
  const consent = (contact.get("smsConsent") as SmsConsent | undefined) ??
    unknownSmsConsent;
  const decision = canSendSms(consent, phone);
  // Checked here, not by the caller: consent is the whole legal basis for the
  // channel and a UI that forgot to ask must not be able to send anyway.
  if (!decision.allowed) {
    throw new Error(`SMS_CONSENT_REQUIRED:${decision.reason ?? "not allowed"}`);
  }

  const sid = await sendTwilioMessage(String(phone), input.body);
  const now = new Date().toISOString();
  const conversationId = await applyMessageToConversation(db, {
    tenantId: input.tenantId,
    projectId: input.projectId,
    leadId: null,
    participant: {
      contactId: input.contactId,
      email: (contact.get("email") as string | null) ?? null,
      phone: String(phone),
      name: (contact.get("displayName") as string | null) ?? null,
    },
    channel: "sms",
    direction: "outbound",
    subject: null,
    preview: input.body.slice(0, 240),
    occurredAt: now,
  });

  await db.doc(`messages/sms_out_${sid}`).set(
    {
      id: `sms_out_${sid}`,
      tenantId: input.tenantId,
      projectId: input.projectId,
      conversationId,
      direction: "outbound",
      channel: "sms",
      visibility: "shared",
      subject: null,
      body: input.body,
      bodyPreview: input.body.slice(0, 280),
      provider: "twilio",
      providerMessageId: sid,
      deliveryStatus: "sent",
      recipient: String(phone),
      sentAt: now,
      createdAt: now,
      updatedAt: now,
      createdBy: "sms-worker",
      updatedBy: "sms-worker",
      archivedAt: null,
    },
    { merge: true },
  );
  return { sid, conversationId };
}

export const twilioInboundSms = onRequest(
  {
    cors: false,
    invoker: "public",
    secrets: ["TWILIO_AUTH_TOKEN"],
  },
  async (request, response) => {
    // Public because Twilio posts here; the signature is the authentication.
    if (!verifyTwilioSignature(request)) {
      response.status(401).send("");
      return;
    }
    const body = (request.body ?? {}) as Record<string, string>;
    const from = String(body.From ?? "").trim();
    const text = String(body.Body ?? "");
    const sid = String(body.MessageSid ?? "");
    if (!from || !sid) {
      response.status(200).send("");
      return;
    }

    const db = getFirestore();
    const now = new Date().toISOString();

    // Find the contact by number. Without one there is no tenant to attribute
    // the message to, and guessing would put a stranger's text on a thread.
    const contacts = await db
      .collection("contacts")
      .where("mobilePhone", "==", from)
      .limit(1)
      .get();
    const contact = contacts.docs[0];
    if (!contact) {
      await db.doc(`inboundSmsQuarantine/${sid}`).set(
        {
          id: sid,
          reason: "UNKNOWN_NUMBER",
          from,
          bodyPreview: text.slice(0, 320),
          receivedAt: now,
        },
        { merge: true },
      );
      response.status(200).send("");
      return;
    }

    const tenantId = String(contact.get("tenantId") ?? "");
    const currentConsent =
      (contact.get("smsConsent") as SmsConsent | undefined) ??
      unknownSmsConsent;
    const intent = consentIntentOf(text);

    // Consent first, always. An opt-out has to take effect even if everything
    // after this fails.
    if (intent !== "none") {
      const nextConsent = applyConsentIntent(currentConsent, text, now, from);
      await contact.ref.set(
        { smsConsent: nextConsent, updatedAt: now, updatedBy: "sms-inbound" },
        { merge: true },
      );
      await db.doc(`auditEvents/sms_consent_${sid}`).set({
        id: `sms_consent_${sid}`,
        tenantId,
        projectId: null,
        actorId: from,
        actorType: "client",
        action:
          intent === "opt_out" ? "sms.consent_revoked" : "sms.consent_granted",
        entityType: "contact",
        entityId: contact.id,
        timestamp: now,
        before: { state: currentConsent.state },
        after: { state: nextConsent.state },
        ipAddress: null,
        userAgent: "twilio",
        correlationId: sid,
        automationRunId: null,
        providerEventId: sid,
      });
    }

    if (intent === "opt_out") {
      const tenant = await db.doc(`tenants/${tenantId}`).get();
      const studioName = String(tenant.get("name") ?? "This studio");
      // The one message a revoked client may still receive, because carriers
      // require the confirmation. Sent directly rather than through
      // sendClientSms, which would refuse it — correctly.
      if (twilioConfigured()) {
        await sendTwilioMessage(from, optOutAcknowledgement(studioName)).catch(
          () => undefined,
        );
      }
      response.status(200).send("");
      return;
    }

    // A bare START is consent bookkeeping, not something to put in a thread.
    if (intent === "opt_in") {
      response.status(200).send("");
      return;
    }

    const projectIds = Array.isArray(contact.get("projectIds"))
      ? (contact.get("projectIds") as unknown[]).map(String)
      : [];
    const projectId = projectIds[0] ?? null;
    const conversationId = conversationIdFor({
      tenantId,
      projectId,
      participant: { contactId: contact.id, phone: from },
    });

    const messageId = `sms_in_${sid}`;
    const existing = await db.doc(`messages/${messageId}`).get();
    if (existing.exists) {
      response.status(200).send("");
      return;
    }

    await db.doc(`messages/${messageId}`).set(
      {
        id: messageId,
        tenantId,
        projectId,
        conversationId,
        direction: "inbound",
        channel: "sms",
        visibility: "shared",
        subject: null,
        body: text.slice(0, 2000),
        bodyPreview: text.slice(0, 280),
        provider: "twilio",
        providerMessageId: sid,
        senderPhone: from,
        status: "received",
        receivedAt: now,
        createdAt: now,
        updatedAt: now,
        createdBy: "sms-inbound",
        updatedBy: "sms-inbound",
        archivedAt: null,
      },
      { merge: true },
    );

    await applyMessageToConversation(db, {
      tenantId,
      projectId,
      leadId: null,
      participant: {
        contactId: contact.id,
        email: (contact.get("email") as string | null) ?? null,
        phone: from,
        name: (contact.get("displayName") as string | null) ?? null,
      },
      channel: "sms",
      direction: "inbound",
      subject: null,
      preview: text.slice(0, 240),
      occurredAt: now,
    });

    const tenant = await db.doc(`tenants/${tenantId}`).get();
    const branding = tenant.get("emailBranding");
    const notify =
      (typeof branding === "object" && branding !== null
        ? (branding as Record<string, unknown>).replyTo
        : null) ??
      tenant.get("contactEmail") ??
      tenant.get("email");
    if (typeof notify === "string" && notify.trim()) {
      await db.doc(`emailJobs/notify_${messageId}`).set(
        {
          id: `notify_${messageId}`,
          tenantId,
          projectId,
          type: "client_message_received",
          recipient: notify,
          senderName: contact.get("displayName") ?? from,
          messageSubject: "Text message",
          messagePreview: text.slice(0, 240),
          actionUrl: `${(process.env.NEXT_PUBLIC_APP_URL ?? "https://studio-cue.com").replace(/\/$/, "")}/studio/messages`,
          status: "queued",
          attempts: 0,
          createdAt: now,
          updatedAt: now,
        },
        { merge: true },
      );
    }

    response.status(200).send("");
  },
);

/** Whether the SMS channel is available at all, for the UI to reflect. */
export function smsChannelEnabled(): boolean {
  return twilioConfigured();
}
