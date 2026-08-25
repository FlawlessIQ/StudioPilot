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

test("a healthy connection can still be misconfigured, and says so", () => {
  // A QuickBooks company file with no company name set sends every client an
  // invoice headed "No company name". Nothing is wrong with the connection,
  // which is why nothing reported it and a studio found out from a client.
  const warned = buildIntegrationDiagnostics({
    provider: "quickbooks",
    credentialPresent: true,
    tokenExpiresAt: null,
    scopes: [],
    latencyMs: 120,
    webhookEvents7d: 0,
    failedJobs7d: 0,
    lastWebhookAt: null,
    lastReconciledAt: null,
    error: null,
    configurationWarning: "QuickBooks has no company name set.",
  });
  assert.equal(warned.severity, "attention");
  assert.match(warned.recommendedAction, /no company name/i);

  // It must not mask a real fault. A broken credential is the bigger problem
  // and stays the reported one.
  const broken = buildIntegrationDiagnostics({
    provider: "quickbooks",
    credentialPresent: false,
    tokenExpiresAt: null,
    scopes: [],
    latencyMs: 120,
    webhookEvents7d: 0,
    failedJobs7d: 0,
    lastWebhookAt: null,
    lastReconciledAt: null,
    error: null,
    configurationWarning: "QuickBooks has no company name set.",
  });
  assert.equal(broken.severity, "blocked");
  assert.match(broken.recommendedAction, /Reconnect/);

  // And a connection with nothing to say still says nothing.
  const clean = buildIntegrationDiagnostics({
    provider: "quickbooks",
    credentialPresent: true,
    tokenExpiresAt: null,
    scopes: [],
    latencyMs: 120,
    webhookEvents7d: 0,
    failedJobs7d: 0,
    lastWebhookAt: null,
    lastReconciledAt: null,
    error: null,
    configurationWarning: null,
  });
  assert.equal(clean.severity, "healthy");
});
