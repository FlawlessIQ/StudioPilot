import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  capabilityReadiness,
  providerName,
} from "@/features/integrations/capability-readiness";
import type { RoutableConnection } from "@/features/integrations/routing";
import { friendlyError } from "@/lib/ai/friendly-error";

const connected = (provider: string): RoutableConnection =>
  ({ provider, status: "connected", archivedAt: null }) as RoutableConnection;
const degraded = (provider: string): RoutableConnection =>
  ({ provider, status: "degraded", archivedAt: null }) as RoutableConnection;

test("one connected signer needs no choosing", () => {
  const readiness = capabilityReadiness({
    capability: "signing",
    connections: [connected("dropbox_sign")],
    selections: null,
  });
  assert.equal(readiness.ok, true);
  assert.equal(readiness.provider, "dropbox_sign");
  assert.equal(
    readiness.summary,
    "StudioCue will send the agreement for signature through Dropbox Sign.",
  );
  assert.equal(readiness.remedy, null);
});

test("nothing connected says the step stays manual", () => {
  // The reported case: a proposal page that never mentioned signing at all,
  // on a studio with nothing connected.
  const readiness = capabilityReadiness({
    capability: "signing",
    connections: [],
    selections: null,
  });
  assert.equal(readiness.ok, false);
  assert.equal(readiness.state, "none_connected");
  assert.match(readiness.summary, /Nothing is connected/);
  assert.equal(readiness.remedy, "Connect DocuSign or Dropbox Sign");
});

test("two signers with no choice is ambiguous, not a silent pick", () => {
  const readiness = capabilityReadiness({
    capability: "signing",
    connections: [connected("docusign"), connected("dropbox_sign")],
    selections: null,
  });
  assert.equal(readiness.state, "ambiguous");
  assert.equal(readiness.provider, null);
  assert.match(readiness.remedy ?? "", /Choose one/);
});

test("an explicit choice settles ambiguity", () => {
  const readiness = capabilityReadiness({
    capability: "signing",
    connections: [connected("docusign"), connected("dropbox_sign")],
    selections: { signing: "dropbox_sign" },
  });
  assert.equal(readiness.ok, true);
  assert.equal(readiness.provider, "dropbox_sign");
});

test("a choice pointing at a disconnected app names that app", () => {
  const readiness = capabilityReadiness({
    capability: "invoicing",
    connections: [connected("stripe")],
    selections: { invoicing: "quickbooks" },
  });
  assert.equal(readiness.state, "selection_broken");
  assert.match(readiness.summary, /QuickBooks is set to raise and track invoices/);
  assert.equal(readiness.remedy, "Reconnect QuickBooks");
});

test("a degraded connection resolves but is not ready", () => {
  // resolveActiveProvider only checks for "connected", so this is the one
  // case where routing is right and the honest answer is still "not yet".
  const readiness = capabilityReadiness({
    capability: "invoicing",
    connections: [degraded("quickbooks"), connected("stripe")],
    selections: { invoicing: "quickbooks" },
  });
  assert.equal(readiness.ok, false);
  assert.equal(readiness.state, "selection_broken");
});

test("invoicing speaks about invoices, not about signing", () => {
  const readiness = capabilityReadiness({
    capability: "invoicing",
    connections: [connected("quickbooks")],
    selections: null,
  });
  assert.match(readiness.summary, /raise and track invoices through QuickBooks/);
});

test("providers are named the way their vendors spell them", () => {
  assert.equal(providerName("dropbox_sign"), "Dropbox Sign");
  assert.equal(providerName("quickbooks"), "QuickBooks");
  assert.equal(providerName("google_calendar"), "Google Calendar");
});

test("every refusal the server can throw has plain-English copy", () => {
  // requireProviderForTenant throws `${CAPABILITY}_${REASON}`. If a reason
  // is added without copy, the studio gets a raw code at the moment a
  // contract fails to send.
  const source = readFileSync(
    "functions/src/integrations/capability-resolution.ts",
    "utf8",
  );
  // Only the unresolved union — "explicit_selection" and
  // "sole_connected_provider" are success reasons and never become codes.
  const union = /outcome: "unresolved"; reason: ([^;}]+)/.exec(source);
  assert.ok(union, "the unresolved union has moved or changed shape");
  const reasons = [...union[1].matchAll(/"([a-z_]+)"/g)].map(
    (match) => match[1],
  );
  assert.ok(reasons.length >= 3, "no refusal reasons found to check");
  for (const capability of ["SIGNING", "INVOICING"]) {
    for (const reason of new Set(reasons)) {
      const code = `${capability}_${reason.toUpperCase()}`;
      const copy = friendlyError(new Error(code), "fallback");
      assert.notEqual(copy, "fallback", `${code} has no friendly copy`);
      assert.ok(
        !copy.includes(code),
        `${code} is shown to the reader as a raw code`,
      );
    }
  }
});
