import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeDocusignWebhook,
  normalizeQuickBooksWebhooks,
} from "../functions/src/booking/webhook-normalizers.ts";

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
