import assert from "node:assert/strict";
import test from "node:test";
import { MockProviderAdapter } from "@/server/integrations/mock-provider";

test("mock providers expose deterministic development health", async () => {
  const provider = new MockProviderAdapter("quickbooks");
  const context = { tenantId: "tenant-a", correlationId: "corr-a" };
  const connection = await provider.connect(context, "mock-code");
  const health = await provider.healthCheck(context);

  assert.equal(connection.providerAccountId, "mock_tenant-a_quickbooks");
  assert.equal(health.status, "healthy");
  assert.equal(health.latencyMs, 0);
});
