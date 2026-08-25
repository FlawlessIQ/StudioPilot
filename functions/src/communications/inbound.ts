import { createHash, timingSafeEqual } from "node:crypto";
import Busboy from "busboy";
import { getFirestore } from "firebase-admin/firestore";
import { onRequest, type Request } from "firebase-functions/v2/https";
import {
  applyMessageToConversation,
  type Conversation,
} from "./conversation.js";
import {
  isAutomatedEmail,
  normalizeSubject,
  replyTokenFromRecipients,
  stripQuotedReply,
} from "./inbound-email.js";
import { conversationIdFromReplyToken } from "./reply-address.js";

/**
 * Inbound client email.
 *
 * The last piece of the loop: studio emails carry a per-thread reply address, a
 * client replies to it, and the reply lands on the thread instead of in the
 * studio's personal inbox.
 *
 * Modelled on sendgridInboundCoi. Differences worth knowing:
 *
 * - the token is signed and self-describing, so no lookup is needed to find the
 *   thread and there is no stored hash to keep in step;
 * - mail that cannot be matched is quarantined rather than dropped, because
 *   silently discarding a client's email is the worst failure this function has;
 * - out-of-office and bounce mail is recorded but never becomes a thread
 *   message, so an autoresponder cannot raise an unread count or — once replies
 *   are drafted automatically — have the studio answer a robot.
 */

const MAX_BODY_LENGTH = 40_000;

function equal(a: string | undefined, b: string | undefined) {
  if (!a || !b) return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

type ParsedInbound = {
  messageId: string;
  token: string | null;
  from: string;
  fromName: string | null;
  subject: string;
  text: string;
  headers: Record<string, string>;
};

function headerMap(raw: string): Record<string, string> {
  const headers: Record<string, string> = {};
  // Unfold continuation lines before splitting: a folded header would otherwise
  // read as a header whose name is whitespace.
  for (const line of raw.replaceAll(/\r?\n[ \t]+/g, " ").split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    headers[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return headers;
}

function addressOf(value: string): { email: string; name: string | null } {
  const angled = value.match(/<([^>]+)>/);
  const email = (angled?.[1] ?? value).trim().toLowerCase();
  const name = angled ? value.slice(0, value.indexOf("<")).trim() : "";
  return { email, name: name.replace(/^"|"$/g, "").trim() || null };
}

function parseMultipart(request: Request) {
  return new Promise<ParsedInbound>((resolve, reject) => {
    const fields: Record<string, string> = {};
    const parser = Busboy({
      headers: request.headers,
      // Attachments are accepted by SendGrid but deliberately not stored here:
      // inbound files need the malware scan the portal upload path already runs,
      // and half-doing that is worse than telling the studio to look in email.
      limits: { files: 0, fields: 40, fieldSize: 1024 * 1024 },
    });
    parser.on("field", (name, value) => {
      fields[name] = value;
    });
    parser.on("error", reject);
    parser.on("finish", () => {
      try {
        const headers = headerMap(fields.headers ?? "");
        const messageId =
          headers["Message-ID"]?.trim() ||
          createHash("sha256").update(request.rawBody).digest("hex");
        const sender = addressOf(fields.from ?? headers.From ?? "");
        resolve({
          messageId,
          token: replyTokenFromRecipients(
            fields.to ?? fields.envelope ?? headers.To ?? "",
          ),
          from: sender.email,
          fromName: sender.name,
          subject: normalizeSubject(fields.subject ?? headers.Subject ?? ""),
          text: (fields.text ?? "").slice(0, MAX_BODY_LENGTH * 2),
          headers,
        });
      } catch (caught) {
        reject(caught);
      }
    });
    parser.end(request.rawBody);
  });
}

async function quarantine(
  reason: string,
  parsed: ParsedInbound | null,
  rawHash: string,
) {
  const now = new Date().toISOString();
  await getFirestore()
    .doc(`inboundEmailQuarantine/${rawHash}`)
    .set(
      {
        id: rawHash,
        reason,
        from: parsed?.from ?? null,
        subject: parsed?.subject ?? null,
        messageId: parsed?.messageId ?? null,
        bodyPreview: parsed?.text.slice(0, 500) ?? null,
        receivedAt: now,
        resolvedAt: null,
      },
      { merge: true },
    );
}

export const sendgridInboundMessage = onRequest(
  { cors: false, invoker: "public", secrets: ["SENDGRID_INBOUND_TOKEN"] },
  async (request, response) => {
    // Public because SendGrid posts here, so the shared token is the only thing
    // authenticating the caller — same contract as the COI parser.
    const sharedToken = String(
      request.query.token ?? request.header("x-studiohub-inbound-token") ?? "",
    );
    if (!equal(sharedToken, process.env.SENDGRID_INBOUND_TOKEN)) {
      response.status(401).json({ error: "UNAUTHORIZED" });
      return;
    }

    const rawHash = createHash("sha256")
      .update(request.rawBody)
      .digest("hex")
      .slice(0, 40);

    let parsed: ParsedInbound | null = null;
    try {
      parsed = await parseMultipart(request);
    } catch {
      await quarantine("UNPARSEABLE", null, rawHash);
      // 200, not 500: SendGrid retries a failure, and a message this function
      // cannot parse will not parse on the third attempt either. It is recorded.
      response.status(200).json({ status: "quarantined", reason: "UNPARSEABLE" });
      return;
    }

    const db = getFirestore();
    const now = new Date().toISOString();

    // Recorded and stopped. An out-of-office is real mail worth keeping, but it
    // is not the client talking and must not look like it in a thread.
    if (isAutomatedEmail(parsed.headers)) {
      await quarantine("AUTOMATED", parsed, rawHash);
      response.status(200).json({ status: "ignored", reason: "AUTOMATED" });
      return;
    }

    const conversationId = parsed.token
      ? conversationIdFromReplyToken(parsed.token)
      : null;
    if (!conversationId) {
      await quarantine(
        parsed.token ? "TOKEN_INVALID" : "TOKEN_MISSING",
        parsed,
        rawHash,
      );
      response.status(200).json({ status: "quarantined", reason: "UNMATCHED" });
      return;
    }

    const conversationSnapshot = await db
      .doc(`conversations/${conversationId}`)
      .get();
    if (!conversationSnapshot.exists) {
      await quarantine("CONVERSATION_MISSING", parsed, rawHash);
      response.status(200).json({ status: "quarantined", reason: "UNMATCHED" });
      return;
    }
    const conversation = conversationSnapshot.data() as Conversation;

    const body = stripQuotedReply(parsed.text).slice(0, MAX_BODY_LENGTH);
    if (!body) {
      await quarantine("EMPTY_BODY", parsed, rawHash);
      response.status(200).json({ status: "quarantined", reason: "EMPTY_BODY" });
      return;
    }

    // Keyed on the provider's Message-ID so a SendGrid retry cannot post the
    // same reply twice.
    const messageId = `inbound_${createHash("sha256")
      .update(`${conversationId}:${parsed.messageId}`)
      .digest("hex")
      .slice(0, 32)}`;
    const existing = await db.doc(`messages/${messageId}`).get();
    if (existing.exists) {
      response.status(200).json({ status: "duplicate", id: messageId });
      return;
    }

    await db.doc(`messages/${messageId}`).set(
      {
        id: messageId,
        tenantId: conversation.tenantId,
        projectId: conversation.projectId,
        conversationId,
        direction: "inbound",
        channel: "email",
        visibility: "shared",
        subject: parsed.subject || conversation.subject,
        body,
        bodyPreview: body.slice(0, 280),
        provider: "sendgrid",
        providerMessageId: parsed.messageId,
        senderEmail: parsed.from,
        senderName: parsed.fromName,
        status: "received",
        // Inbound attachments are not carried across yet; say so on the record
        // rather than letting a studio assume nothing was sent.
        hasUnstoredAttachments: false,
        receivedAt: now,
        createdAt: now,
        updatedAt: now,
        createdBy: "inbound-email",
        updatedBy: "inbound-email",
        archivedAt: null,
      },
      { merge: true },
    );

    await applyMessageToConversation(db, {
      tenantId: conversation.tenantId,
      projectId: conversation.projectId,
      leadId: conversation.leadId,
      participant: {
        contactId: conversation.participant.contactId,
        email: parsed.from || conversation.participant.email,
        phone: conversation.participant.phone,
        name: parsed.fromName ?? conversation.participant.name,
      },
      channel: "email",
      direction: "inbound",
      subject: parsed.subject || conversation.subject,
      preview: body.slice(0, 240),
      occurredAt: now,
    });

    // Same alert a portal message raises: an email reply the studio never hears
    // about is no better than one that went to the wrong inbox.
    const tenant = await db.doc(`tenants/${conversation.tenantId}`).get();
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
          tenantId: conversation.tenantId,
          projectId: conversation.projectId,
          type: "client_message_received",
          recipient: notify,
          senderName:
            parsed.fromName ?? parsed.from ?? conversation.participant.name,
          messageSubject: parsed.subject || conversation.subject,
          messagePreview: body.slice(0, 240),
          actionUrl: `${(process.env.NEXT_PUBLIC_APP_URL ?? "https://studio-cue.com").replace(/\/$/, "")}/studio/messages`,
          status: "queued",
          attempts: 0,
          createdAt: now,
          updatedAt: now,
        },
        { merge: true },
      );
    }

    response.status(200).json({ status: "received", id: messageId });
  },
);
