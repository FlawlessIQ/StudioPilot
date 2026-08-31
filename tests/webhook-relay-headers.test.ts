import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

/**
 * Every header a webhook function reads must survive the relay.
 *
 * Provider webhooks are private Cloud Run services — a provider cannot mint a
 * Google ID token — so production traffic arrives at a Next route under
 * `app/api/webhooks/`, which forwards the raw body to the function with a
 * service identity attached. The relay forwards a deliberate *allowlist* of
 * headers, not everything it received.
 *
 * That allowlist is the gap this closes. `scripts/certify-providers.ts` posts
 * straight at the functions, so it certifies signature verification while
 * skipping the hop production actually takes. A route that forgot to forward
 * `x-zm-request-timestamp` would pass 33/33 checks and then fail every real
 * Zoom delivery with a signature mismatch — and the provider console would
 * report a 401 with nothing in our logs explaining why.
 *
 * Reading the required headers out of the functions rather than listing them
 * here is the point: a provider whose scheme grows a header, or a new webhook
 * added next to these, is covered without anyone remembering to update a
 * fixture.
 */

const REPO = new URL("..", import.meta.url).pathname;

/** Which route fronts which function. */
const RELAYS: ReadonlyArray<{
  fn: string;
  source: string;
  route: string;
}> = [
  {
    fn: "docusignWebhook",
    source: "functions/src/booking/webhooks.ts",
    route: "app/api/webhooks/docusign/route.ts",
  },
  {
    fn: "dropboxSignWebhook",
    source: "functions/src/booking/webhooks.ts",
    route: "app/api/webhooks/dropbox-sign/route.ts",
  },
  {
    fn: "quickbooksWebhook",
    source: "functions/src/booking/webhooks.ts",
    route: "app/api/webhooks/quickbooks/route.ts",
  },
  {
    fn: "stripeConnectWebhook",
    source: "functions/src/booking/webhooks.ts",
    route: "app/api/webhooks/stripe-connect/route.ts",
  },
  {
    fn: "zoomWebhook",
    source: "functions/src/booking/zoom-webhook.ts",
    route: "app/api/webhooks/zoom/route.ts",
  },
  {
    fn: "stripeWebhook",
    source: "functions/src/saas/stripe.ts",
    route: "app/api/webhooks/stripe/route.ts",
  },
  {
    fn: "sendgridEventWebhook",
    source: "functions/src/communications/sendgrid-events.ts",
    route: "app/api/webhooks/sendgrid/events/route.ts",
  },
];

/**
 * The handler's own body, not its whole file.
 *
 * `webhooks.ts` defines four handlers, so scoping by file would credit
 * Docusign with QuickBooks' `intuit-signature` and let a genuinely missing
 * forward pass.
 */
function handlerBody(source: string, fn: string): string {
  const text = readFileSync(`${REPO}${source}`, "utf8");
  const start = text.indexOf(`export const ${fn} = onRequest(`);
  assert.ok(start >= 0, `${fn} not found in ${source}`);
  const next = text.indexOf("\nexport const ", start + 1);
  return text.slice(start, next === -1 ? text.length : next);
}

/** Headers the handler reads off the request. */
function headersRead(body: string): string[] {
  const found = new Set<string>();
  for (const match of body.matchAll(
    /request\.header\(\s*["'`]([^"'`]+)["'`]/g,
  )) {
    found.add(match[1].toLowerCase());
  }
  return [...found].sort();
}

/** Headers the route forwards: its signature header plus its allowlist. */
function headersForwarded(route: string): string[] {
  const text = readFileSync(`${REPO}${route}`, "utf8");
  const found = new Set<string>();
  const signature = text.match(/signatureHeader:\s*["']([^"']+)["']/);
  if (signature) found.add(signature[1].toLowerCase());
  const list = text.match(/forwardedHeaders:\s*\[([^\]]*)\]/s);
  if (list) {
    for (const entry of list[1].matchAll(/["']([^"']+)["']/g)) {
      found.add(entry[1].toLowerCase());
    }
  }
  /**
   * A bespoke route sets its headers directly rather than declaring an
   * allowlist, so read what it puts on the upstream request: keys of the
   * `headers` object literal passed to `fetch`, and any `headers.set` call.
   *
   * Both forms have to be handled. Reading only `headers.set` reported the
   * SendGrid events route as dropping `x-twilio-email-event-webhook-timestamp`
   * when it forwards it in an object literal one line below the signature —
   * a false positive, and the kind that gets a real test deleted.
   */
  const literal = text.match(/headers:\s*\{([\s\S]*?)\n\s*\},/);
  if (literal) {
    for (const key of literal[1].matchAll(/["']([a-z0-9-]+)["']\s*:/gi)) {
      found.add(key[1].toLowerCase());
    }
  }
  for (const entry of text.matchAll(/headers\.set\(\s*["']([^"']+)["']/g)) {
    found.add(entry[1].toLowerCase());
  }
  return [...found].sort();
}

/**
 * Content type is forwarded wholesale by the relay, and Dropbox Sign depends
 * on it: it posts `multipart/form-data` with the event JSON in a field named
 * `json`, and the handler parses it with busboy.
 */
const RELAY_ALWAYS_FORWARDS = new Set(["content-type", "content-length"]);

for (const relay of RELAYS) {
  test(`${relay.fn}: the relay forwards every header it reads`, () => {
    const required = headersRead(handlerBody(relay.source, relay.fn));
    const forwarded = new Set(headersForwarded(relay.route));
    const missing = required.filter(
      (name) => !forwarded.has(name) && !RELAY_ALWAYS_FORWARDS.has(name),
    );
    assert.deepEqual(
      missing,
      [],
      `${relay.route} does not forward ${missing.join(", ")} — ` +
        `${relay.fn} reads it, so a real delivery would fail verification ` +
        `even though certify-providers passes by posting to the function ` +
        `directly.`,
    );
  });
}
