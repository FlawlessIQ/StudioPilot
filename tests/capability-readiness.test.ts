import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  capabilityReadiness,
  providerName,
} from "@/features/integrations/capability-readiness";
import type { RoutableConnection } from "@/features/integrations/routing";
import {
  offeredProviders,
  providerCapabilities,
} from "@/features/integrations/schema";
import { friendlyError } from "@/lib/ai/friendly-error";

const connected = (provider: string): RoutableConnection =>
  ({ provider, status: "connected", archivedAt: null }) as RoutableConnection;
const degraded = (provider: string): RoutableConnection =>
  ({ provider, status: "degraded", archivedAt: null }) as RoutableConnection;

test("one connected provider needs no choosing", () => {
  // Was written with Dropbox Sign, which is no longer offered — both signing
  // apps are deferred on subscription cost. QuickBooks carries the same
  // sole-connected-provider case.
  const readiness = capabilityReadiness({
    capability: "invoicing",
    connections: [connected("quickbooks")],
    selections: null,
  });
  assert.equal(readiness.ok, true);
  assert.equal(readiness.provider, "quickbooks");
  assert.equal(
    readiness.summary,
    "StudioCue will raise and track invoices through QuickBooks.",
  );
  assert.equal(readiness.remedy, null);
});

test("a connected signing app that is not offered still does not resolve", () => {
  /**
   * The semantics `offeredProviders` exists for: not offered means not routed
   * to, even when a connection is sitting there. A studio that connected
   * Dropbox Sign while it was offered must not have contracts quietly continue
   * through a plan nobody is paying for.
   */
  const readiness = capabilityReadiness({
    capability: "signing",
    connections: [connected("dropbox_sign")],
    selections: null,
  });
  assert.equal(readiness.ok, false);
  assert.equal(readiness.state, "none_connected");
  assert.match(readiness.summary, /record the signature/);
});

test("nothing connected to sign points at the path that still works", () => {
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
  // The point of the sentence. A studio deciding whether it can work
  // without Dropbox Sign is told yes, and how.
  assert.match(readiness.summary, /record the signature/);
  // And no remedy at all now: with neither signing app offered there is
  // nothing to send anyone to, and "Connect a provider" would point at a
  // settings page with no signing row on it. The summary is the answer.
  assert.equal(readiness.remedy, null);
});

test("nothing connected to invoice names the manual path it has", () => {
  /**
   * This test used to assert the opposite, and was wrong.
   *
   * It required the summary to say the booking "cannot be confirmed" without a
   * connected provider, on the reasoning that signing had a manual path and
   * invoicing did not. `recordRetainerPayment` and `recordFinalPayment` had
   * already been added for precisely that studio, and the walk of 2026-09-02
   * took a job from inquiry to "Booking is confirmed" with nothing connected —
   * reading that sentence, on the proposal page, one click before a new studio
   * sends its first proposal.
   *
   * The invariant worth keeping is the original one: no vague "stays manual",
   * which was unearned reassurance. Say what the studio actually does.
   */
  const readiness = capabilityReadiness({
    capability: "invoicing",
    connections: [],
    selections: null,
  });
  assert.equal(readiness.state, "none_connected");
  assert.match(readiness.summary, /record the payment on the booking/);
  assert.doesNotMatch(readiness.summary, /stays manual/);
  assert.doesNotMatch(readiness.summary, /cannot be confirmed/);
});

test("ambiguity is currently unreachable, because each job has one offered app", () => {
  // Worth stating rather than leaving implicit. DocuSign and Stripe Connect
  // are implemented but not offered, which leaves exactly one offered
  // provider per capability — so the "choose one in Studio settings" path
  // is dormant. When a second signer or a second invoicer is offered, this
  // test fails and the ambiguity copy starts earning its place.
  const byCapability = new Map<string, string[]>();
  for (const provider of offeredProviders) {
    for (const capability of providerCapabilities[provider]) {
      byCapability.set(capability, [
        ...(byCapability.get(capability) ?? []),
        provider,
      ]);
    }
  }
  for (const [capability, providers] of byCapability) {
    assert.equal(
      providers.length,
      1,
      `${capability} now has ${providers.length} offered providers — the ambiguity path is live`,
    );
  }
});

test("an explicit choice is honoured", () => {
  // Re-pointed at storage, which still has two offered providers; signing has
  // none, so an explicit signing choice can no longer be honoured by design.
  const readiness = capabilityReadiness({
    capability: "invoicing",
    connections: [connected("quickbooks")],
    selections: { invoicing: "quickbooks" },
  });
  assert.equal(readiness.ok, true);
  assert.equal(readiness.provider, "quickbooks");
});

test("an explicit choice cannot revive an unoffered app", () => {
  // Choosing it in settings is not a licence either.
  const readiness = capabilityReadiness({
    capability: "signing",
    connections: [connected("dropbox_sign")],
    selections: { signing: "dropbox_sign" },
  });
  assert.equal(readiness.ok, false);
});

test("a choice pointing at a disconnected app names that app", () => {
  const readiness = capabilityReadiness({
    capability: "invoicing",
    connections: [],
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

test("a provider StudioCue does not offer cannot win the routing", () => {
  // The reported contradiction. Studio settings showed "Document signing →
  // Dropbox Sign" while the proposal page said StudioCue did not know which
  // app to use. Settings was filtering DocuSign out of its own copy of the
  // list; the resolver was not — and neither was the server, which fell
  // back to DocuSign and queued a signature request through a provider the
  // studio cannot see, has not chosen, and could not have connected.
  //
  // Both signing apps are now unoffered, so the case has gone from "the
  // offered one wins" to "neither does" — which is the same rule, applied to a
  // set that has since emptied.
  const readiness = capabilityReadiness({
    capability: "signing",
    connections: [connected("docusign"), connected("dropbox_sign")],
    selections: null,
  });
  assert.equal(readiness.state, "none_connected");
  assert.equal(readiness.provider, null);
});

test("with only an unoffered provider connected, nothing is connected", () => {
  const readiness = capabilityReadiness({
    capability: "signing",
    connections: [connected("docusign")],
    selections: null,
  });
  assert.equal(readiness.state, "none_connected");
});

test("the offered set is the same in features/ and functions/", () => {
  // Two copies of this list is how the divergence happened in the first
  // place. functions/ cannot import from features/, so the copies stay —
  // but they may not disagree.
  /**
   * The contents of the `new Set([...])`, not "the first five quoted strings
   * after the word offeredProviders" — which is what this did, and which broke
   * the moment the set held four rather than five: it read the fifth name out
   * of whatever followed and compared garbage.
   */
  const read = (path: string) => {
    const source = readFileSync(path, "utf8");
    const declaration = source.indexOf("export const offeredProviders");
    assert.notEqual(declaration, -1, `${path} has no offeredProviders`);
    const open = source.indexOf("[", declaration);
    const close = source.indexOf("]", open);
    assert.ok(open !== -1 && close > open, `${path} offeredProviders is not a list`);
    return [...source.slice(open, close).matchAll(/"([a-z_]+)"/g)]
      .map((match) => match[1])
      .sort();
  };
  assert.deepEqual(
    read("functions/src/integrations/capability-resolution.ts"),
    read("features/integrations/schema.ts"),
    "offeredProviders disagrees between features/ and functions/",
  );
});

test("an unoffered provider is never eligible, whatever its status", () => {
  for (const status of ["connected", "degraded", "error", "disconnected"]) {
    const readiness = capabilityReadiness({
      capability: "invoicing",
      connections: [
        { provider: "stripe", status, archivedAt: null } as RoutableConnection,
      ],
      selections: null,
    });
    assert.equal(readiness.state, "none_connected", status);
  }
});

test("a remedy never names an app the studio cannot connect", () => {
  // "Connect QuickBooks or Stripe" sent someone to a page with no Stripe
  // row on it.
  const unofferedNames = ["DocuSign", "Stripe"];
  for (const capability of ["signing", "invoicing", "calendar", "meetings", "storage"] as const) {
    const readiness = capabilityReadiness({
      capability,
      connections: [],
      selections: null,
    });
    for (const name of unofferedNames) {
      assert.ok(
        !(readiness.remedy ?? "").includes(name),
        `${capability} remedy names ${name}, which is not offered`,
      );
    }
  }
});
