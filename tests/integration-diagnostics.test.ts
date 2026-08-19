import assert from "node:assert/strict";
import test from "node:test";
import { buildIntegrationDiagnostics } from "../functions/src/integrations/diagnostics";

const healthy = {
  provider: "google_calendar" as const,
  credentialPresent: true,
  tokenExpiresAt: "2030-01-01T00:00:00.000Z",
  scopes: ["calendar.events.owned"],
  latencyMs: 180,
  webhookEvents7d: 4,
  failedJobs7d: 0,
  lastWebhookAt: "2026-07-28T10:00:00.000Z",
  lastReconciledAt: "2026-07-28T11:00:00.000Z",
  error: null,
};

test("healthy integration diagnostics require no action", () => {
  const result = buildIntegrationDiagnostics(
    healthy,
    "2026-07-29T12:00:00.000Z",
  );
  assert.equal(result.severity, "healthy");
  assert.match(result.recommendedAction, /No action required/);
});

test("missing credentials create a blocked reconnect recommendation", () => {
  const result = buildIntegrationDiagnostics({
    ...healthy,
    credentialPresent: false,
  });
  assert.equal(result.severity, "blocked");
  assert.match(result.recommendedAction, /Reconnect/);
});

test("failed provider jobs create an attention recommendation", () => {
  const result = buildIntegrationDiagnostics({
    ...healthy,
    failedJobs7d: 3,
  });
  assert.equal(result.severity, "attention");
  assert.match(result.recommendedAction, /3 provider jobs/);
});
