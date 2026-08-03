import { createHash } from "node:crypto";

type Json = Record<string, unknown>;

const asRecord = (value: unknown): Json =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Json)
    : {};

const asString = (value: unknown): string =>
  typeof value === "string" ? value : "";

const digest = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

export type DocusignWebhookEvent = {
  providerEventId: string;
  event: string;
  accountId: string;
  envelopeId: string;
  occurredAt: string;
};

export function normalizeDocusignWebhook(
  input: unknown,
): DocusignWebhookEvent | null {
  const payload = asRecord(input);
  const data = asRecord(payload.data);
  const event = asString(payload.event);
  const accountId =
    asString(data.accountId) || asString(payload.accountId);
  const envelopeId =
    asString(data.envelopeId) || asString(payload.envelopeId);
  const occurredAt =
    asString(payload.generatedDateTime) || asString(payload.occurredAt);

  if (!event || !accountId || !envelopeId || !occurredAt) return null;

  const explicitEventId = asString(payload.eventId);
  const providerEventId =
    explicitEventId ||
    digest(
      [
        asString(payload.configurationId),
        event,
        accountId,
        envelopeId,
        occurredAt,
        String(payload.retryCount ?? ""),
      ].join(":"),
    );

  return {
    providerEventId,
    event,
    accountId,
    envelopeId,
    occurredAt,
  };
}

// Shape confirmed against Dropbox Sign's documented webhook payload
// (developers.hellosign.com/docs/events/walkthrough): the callback is
// delivered as multipart/form-data with the JSON payload in a "json" field
// (parsed by the caller before this normalizer runs), and every event
// carries `event.event_type` / `event.event_time` / `event.event_hash` plus
// an `event.event_metadata` block. `event_hash` is documented as
// HMAC-SHA256(event_time + event_type, key=apiKey) — verification happens
// in the webhook handler, not here. Dropbox Sign does not send a discrete
// event id, so providerEventId is derived the same way normalizeDocusignWebhook
// derives one when a provider omits it.
export type DropboxSignWebhookEvent = {
  providerEventId: string;
  eventType: string;
  eventTime: string;
  eventHash: string;
  accountId: string;
  signatureRequestId: string;
};

export function normalizeDropboxSignWebhook(
  input: unknown,
): DropboxSignWebhookEvent | null {
  const payload = asRecord(input);
  const eventBlock = asRecord(payload.event);
  const eventMetadata = asRecord(eventBlock.event_metadata);
  const signatureRequest = asRecord(payload.signature_request);

  const eventType = asString(eventBlock.event_type);
  const eventTime = asString(eventBlock.event_time);
  const eventHash = asString(eventBlock.event_hash);
  const accountId = asString(eventMetadata.reported_for_account_id);
  const signatureRequestId =
    asString(signatureRequest.signature_request_id) ||
    asString(eventMetadata.related_signature_id);

  if (!eventType || !eventTime || !eventHash || !accountId || !signatureRequestId) {
    return null;
  }

  return {
    providerEventId: digest(
      [accountId, signatureRequestId, eventType, eventTime].join(":"),
    ),
    eventType,
    eventTime,
    eventHash,
    accountId,
    signatureRequestId,
  };
}

export type QuickBooksWebhookEvent = {
  providerEventId: string;
  realmId: string;
  entityName: string;
  entityId: string;
  operation: string;
  occurredAt: string;
};

function normalizeQuickBooksCloudEvent(
  input: unknown,
): QuickBooksWebhookEvent | null {
  const payload = asRecord(input);
  const type = asString(payload.type).toLowerCase();
  const match = /^qbo\.([^.]+)\.([^.]+)\.v\d+$/.exec(type);
  const entityName = match?.[1] ?? "";
  const operation = match?.[2] ?? "";
  const providerEventId = asString(payload.id);
  const realmId = asString(payload.intuitaccountid);
  const entityId = asString(payload.intuitentityid);
  const occurredAt = asString(payload.time);

  if (
    !entityName ||
    !operation ||
    !providerEventId ||
    !realmId ||
    !entityId ||
    !occurredAt
  ) {
    return null;
  }

  return {
    providerEventId,
    realmId,
    entityName,
    entityId,
    operation,
    occurredAt,
  };
}

function normalizeQuickBooksLegacyPayload(
  input: unknown,
): QuickBooksWebhookEvent[] {
  const payload = asRecord(input);
  const notifications = Array.isArray(payload.eventNotifications)
    ? payload.eventNotifications
    : [];
  const events: QuickBooksWebhookEvent[] = [];

  for (const notificationValue of notifications) {
    const notification = asRecord(notificationValue);
    const realmId = asString(notification.realmId);
    const dataChangeEvent = asRecord(notification.dataChangeEvent);
    const entities = Array.isArray(dataChangeEvent.entities)
      ? dataChangeEvent.entities
      : [];

    for (const entityValue of entities) {
      const entity = asRecord(entityValue);
      const entityName = asString(entity.name).toLowerCase();
      const entityId = asString(entity.id);
      const operation = asString(entity.operation).toLowerCase();
      const occurredAt = asString(entity.lastUpdated);
      if (
        !realmId ||
        !entityName ||
        !entityId ||
        !operation ||
        !occurredAt
      ) {
        continue;
      }

      events.push({
        providerEventId: digest(
          [realmId, entityName, entityId, operation, occurredAt].join(":"),
        ),
        realmId,
        entityName,
        entityId,
        operation,
        occurredAt,
      });
    }
  }

  return events;
}

export function normalizeQuickBooksWebhooks(
  input: unknown,
): QuickBooksWebhookEvent[] {
  if (Array.isArray(input)) {
    return input
      .map(normalizeQuickBooksCloudEvent)
      .filter(
        (event): event is QuickBooksWebhookEvent => event !== null,
      );
  }

  return normalizeQuickBooksLegacyPayload(input);
}
