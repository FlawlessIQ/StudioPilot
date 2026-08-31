import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import {
  isOfferedProvider,
  offeredProviders,
  offeredSigningProvider,
} from "@/features/integrations/schema";

/**
 * What the product offers, said once.
 *
 * `offeredProviders` exists because "we do not offer this" is a fact about the
 * product rather than about one screen — the settings page, the proposal
 * capability note and the server resolving which app signs a contract all have
 * to agree. The comment on it records what happened when they did not: a tenant
 * with a leftover `docusign` connection read unambiguously in settings and
 * ambiguously everywhere else, and the booking command sent contracts through a
 * provider the studio could not see, had not chosen and could not have
 * connected.
 *
 * The centralisation fixed the resolver and missed two literals. The booking
 * workspace seeded its state with `"docusign"` and ended its resolution
 * `: "docusign"`, so every studio without a signing connection — which is all
 * of them — was told "DocuSign remains the authority for signature" and sent
 * looking for a $600/year account the product does not offer.
 *
 * These are the two ways that recurs: a hard-coded provider name where the
 * offered set belongs, and apphosting.yaml's OAuth list drifting from it.
 */

const REPO = process.cwd();

test("DocuSign is not offered, and that is a deliberate cost decision", () => {
  // Deferred until revenue covers a live DocuSign API subscription. The server
  // code stays; restoring it is one apphosting.yaml entry plus a client id.
  assert.equal(isOfferedProvider("docusign"), false);
  assert.equal(isOfferedProvider("stripe"), false);
});

test("exactly one signing app is offered, and it is derived", () => {
  const signing = offeredSigningProvider();
  assert.equal(signing, "dropbox_sign");
  assert.ok(signing !== null, "no signing app is offered at all");
  assert.equal(isOfferedProvider(signing!), true);
});

test("the OAuth list never offers a provider the product hides", () => {
  /**
   * apphosting.yaml's list controls what can *start* an OAuth flow. A provider
   * in it but absent from `offeredProviders` is a flow with no way in — and,
   * worse, a declaration of intent that the rest of the product contradicts.
   */
  const yaml = readFileSync(`${REPO}/apphosting.yaml`, "utf8");
  const block = yaml.slice(yaml.indexOf("NEXT_PUBLIC_ENABLED_OAUTH_PROVIDERS"));
  const value = /value:\s*([a-z_,]+)/.exec(block)?.[1] ?? "";
  assert.ok(value.length > 0, "could not read the enabled OAuth provider list");
  for (const provider of value.split(",").filter(Boolean)) {
    assert.ok(
      offeredProviders.has(provider as never),
      `apphosting.yaml enables OAuth for "${provider}", which offeredProviders hides`,
    );
  }
});

/** Every .ts/.tsx under these roots. */
const sources = (): string[] => {
  const out: string[] = [];
  const walk = (path: string) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const next = `${path}/${entry.name}`;
      if (entry.isDirectory()) walk(next);
      else if (/\.tsx?$/.test(entry.name)) out.push(next);
    }
  };
  for (const root of ["components", "features", "lib", "app", "server"]) {
    walk(`${REPO}/${root}`);
  }
  return out;
};

test("no unoffered provider is hard-coded as a default or fallback", () => {
  /**
   * The two shapes that bit, and only those: a state seed
   * (`useState("docusign")`) and a nullish or ternary *fallback*
   * (`?? "docusign"`, `: "docusign"`). Both put a provider name where the
   * offered set belongs.
   *
   * Deliberately not flagged, because all three are legitimate and the first
   * version of this test reported them:
   *   - `provider: "docusign"` in the integration definitions, which must exist
   *     so a leftover connection can still be recognised and labelled;
   *   - `authority: "docusign"` in the state machine, the name of an evidence
   *     authority rather than a provider choice;
   *   - `=== "docusign"` comparisons anywhere.
   */
  const offenders: string[] = [];
  const hidden = ["docusign", "stripe"] as const;
  // The `[?:]\s*` branch consumes the colon, so `before` ends at the key name.
  const KEYS_THAT_ARE_NOT_CHOICES = /\b(provider|accent|authority|source|key|id)\s*$/;
  for (const file of sources()) {
    if (file.endsWith("features/integrations/schema.ts")) continue;
    const text = readFileSync(file, "utf8");
    for (const name of hidden) {
      for (const match of text.matchAll(
        new RegExp(`(useState<[^>]*>\\(|useState\\(|\\?\\?\\s*|[?:]\\s*)"${name}"`, "g"),
      )) {
        const before = text.slice(Math.max(0, match.index! - 60), match.index!);
        if (/[=!]==\s*$/.test(before)) continue;
        if (KEYS_THAT_ARE_NOT_CHOICES.test(before)) continue;
        // A last resort already guarded by the derived value is the fix, not
        // the fault: `offeredSigningProvider() ?? "docusign"` only lands if no
        // signing app is offered at all, and the type has to be inhabited.
        if (/offeredSigningProvider\(\)[^"]*$/.test(before)) continue;
        const line = text.slice(0, match.index!).split("\n").length;
        offenders.push(`${file.replace(`${REPO}/`, "")}:${line} -> "${name}"`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "a provider the product hides is hard-coded as a default; derive it from " +
      "offeredSigningProvider() or offeredProviders instead",
  );
});
