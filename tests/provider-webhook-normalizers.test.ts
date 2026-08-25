import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeDocusignWebhook,
  normalizeDropboxSignWebhook,
  normalizeQuickBooksWebhooks,
  normalizeZoomWebhook,
} from "../functions/src/booking/webhook-normalizers.ts";
import { zoomWebhookSignature } from "../functions/src/booking/zoom-webhook.ts";
import { zoomSummaryText } from "../functions/src/operations/provider-runtime.ts";

test("Docusign JSON SIM completion events normalize deterministically", () => {
  const payload = {
    event: "envelope-completed",
    uri: "/restapi/v2.1/accounts/account-a/envelopes/envelope-a",
    retryCount: 0,
    configurationId: "configuration-a",
    apiVersion: "v2.1",
    generatedDateTime: "2026-07-29T17:00:00.000Z",
    data: {
      accountId: "account-a",
      envelopeId: "envelope-a",
    },
  };

  const first = normalizeDocusignWebhook(payload);
  const second = normalizeDocusignWebhook(payload);

  assert.ok(first);
  assert.equal(first.event, "envelope-completed");
  assert.equal(first.accountId, "account-a");
  assert.equal(first.envelopeId, "envelope-a");
  assert.equal(first.providerEventId, second?.providerEventId);
});

test("Dropbox Sign completion events normalize deterministically", () => {
  const payload = {
    event: {
      event_time: "1348177752",
      event_type: "signature_request_all_signed",
      event_hash: "3a31324d1919d7cdc849ff407adf38fc01e01107d9400b028ff8c892469ca947",
      event_metadata: {
        related_signature_id: "ad4d8a769b555fa5ef38691465d426682bf2c992",
        reported_for_account_id: "account-a",
        reported_for_app_id: null,
      },
    },
    signature_request: {
      signature_request_id: "signature-request-a",
    },
  };

  const first = normalizeDropboxSignWebhook(payload);
  const second = normalizeDropboxSignWebhook(payload);

  assert.ok(first);
  assert.equal(first.eventType, "signature_request_all_signed");
  assert.equal(first.eventTime, "1348177752");
  assert.equal(first.accountId, "account-a");
  assert.equal(first.signatureRequestId, "signature-request-a");
  assert.equal(first.providerEventId, second?.providerEventId);
});

test("Dropbox Sign normalizer falls back to event_metadata's related_signature_id when no signature_request object is present", () => {
  const event = normalizeDropboxSignWebhook({
    event: {
      event_time: "1348177752",
      event_type: "signature_request_sent",
      event_hash: "3a31324d1919d7cdc849ff407adf38fc01e01107d9400b028ff8c892469ca947",
      event_metadata: {
        related_signature_id: "ad4d8a769b555fa5ef38691465d426682bf2c992",
        reported_for_account_id: "account-a",
      },
    },
  });

  assert.ok(event);
  assert.equal(event.signatureRequestId, "ad4d8a769b555fa5ef38691465d426682bf2c992");
});

test("Dropbox Sign normalizer rejects payloads missing required fields", () => {
  assert.equal(normalizeDropboxSignWebhook({}), null);
  assert.equal(
    normalizeDropboxSignWebhook({ event: { event_type: "signature_request_all_signed" } }),
    null,
  );
});

test("QuickBooks CloudEvents arrays normalize invoice changes", () => {
  const events = normalizeQuickBooksWebhooks([
    {
      specversion: "1.0",
      id: "event-a",
      source: "intuit.app",
      type: "qbo.invoice.updated.v1",
      time: "2026-07-29T17:01:00.000Z",
      intuitentityid: "invoice-a",
      intuitaccountid: "realm-a",
      data: {},
    },
  ]);

  assert.deepEqual(events, [
    {
      providerEventId: "event-a",
      realmId: "realm-a",
      entityName: "invoice",
      entityId: "invoice-a",
      operation: "updated",
      occurredAt: "2026-07-29T17:01:00.000Z",
    },
  ]);
});

test("legacy QuickBooks data-change payloads remain supported", () => {
  const payload = {
    eventNotifications: [
      {
        realmId: "realm-a",
        dataChangeEvent: {
          entities: [
            {
              name: "Invoice",
              id: "invoice-a",
              operation: "Update",
              lastUpdated: "2026-07-29T17:02:00.000Z",
            },
          ],
        },
      },
    ],
  };

  const first = normalizeQuickBooksWebhooks(payload);
  const second = normalizeQuickBooksWebhooks(payload);

  assert.equal(first.length, 1);
  assert.equal(first[0]?.entityName, "invoice");
  assert.equal(first[0]?.operation, "update");
  assert.equal(first[0]?.providerEventId, second[0]?.providerEventId);
});

test("Zoom meeting summary events normalize deterministically", () => {
  const payload = {
    event: "meeting.summary_completed",
    event_ts: 1786629600000,
    payload: {
      account_id: "zoom-account-a",
      object: {
        meeting_id: 987654321,
        uuid: "meeting-uuid-a",
        meeting_end_time: "2026-08-13T14:00:00Z",
        topic: "Smith consultation",
      },
    },
  };
  const first = normalizeZoomWebhook(payload);
  const second = normalizeZoomWebhook(payload);
  assert.ok(first);
  assert.equal(first.event, "meeting.summary_completed");
  assert.equal(first.meetingId, "987654321");
  assert.equal(first.accountId, "zoom-account-a");
  assert.equal(first.providerEventId, second?.providerEventId);
});

test("Zoom normalizer ignores unsupported or incomplete events", () => {
  assert.equal(normalizeZoomWebhook({ event: "meeting.started" }), null);
  assert.equal(
    normalizeZoomWebhook({
      event: "meeting.ended",
      event_ts: 1786629600000,
      payload: { object: { id: 1 } },
    }),
    null,
  );
});

test("Zoom signatures use the provider's v0 timestamp and raw-body contract", () => {
  assert.equal(
    zoomWebhookSignature({
      timestamp: "1654503849",
      rawBody: '{"event":"meeting.ended"}',
      secret: "secret-token",
    }),
    "v0=5747349c3398a37fb4eadee5286c982d6874631a8ba32a178096a17eec02a5dc",
  );
});

test("Zoom summary sections become consultation notes without inventing content", () => {
  assert.equal(
    zoomSummaryText({
      summary_overview: "The couple prioritized candid coverage.",
      summary_details: [
        { summary_label: "Timeline", summary: "Ceremony begins at 4 PM." },
      ],
      next_steps: [{ next_step: "Confirm family photo list." }],
    }),
    "The couple prioritized candid coverage.\n\nTimeline: Ceremony begins at 4 PM.\n\nNext steps: Confirm family photo list.",
  );
});

test("a cloud event is read whether or not Intuit batches it", () => {
  // The payload shape is a toggle in Intuit's developer portal, and the
  // cloud format arrives as a batch array for several changes and as a bare
  // object for one. Only the array was handled, so a single change parsed
  // to nothing and the delivery was rejected as INVALID_PAYLOAD — a client's
  // payment lost to a format nobody chose deliberately.
  const event = {
    id: "evt_single",
    type: "qbo.invoice.update.v1",
    intuitaccountid: "9341457776990679",
    intuitentityid: "6",
    time: "2026-08-25T18:00:00Z",
  };
  const batched = normalizeQuickBooksWebhooks([event]);
  const bare = normalizeQuickBooksWebhooks(event);
  assert.deepEqual(bare, batched);
  assert.equal(bare.length, 1);
  assert.equal(bare[0]?.entityName, "invoice");
  assert.equal(bare[0]?.entityId, "6");
  assert.equal(bare[0]?.realmId, "9341457776990679");

  // The classic shape still wins where it applies — an object carrying
  // eventNotifications is not a cloud event and must not be read as one.
  const classic = normalizeQuickBooksWebhooks({
    eventNotifications: [
      {
        realmId: "9341457776990679",
        dataChangeEvent: {
          entities: [
            { name: "Invoice", id: "6", operation: "Update", lastUpdated: "2026-08-25T18:00:00-0700" },
          ],
        },
      },
    ],
  });
  assert.equal(classic.length, 1);
  assert.equal(classic[0]?.entityId, "6");

  // Junk is still junk, and must not become a phantom event.
  assert.deepEqual(normalizeQuickBooksWebhooks({ hello: "world" }), []);
  assert.deepEqual(normalizeQuickBooksWebhooks({ type: "qbo.invoice.update.v1" }), []);
});
