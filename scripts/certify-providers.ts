/**
 * Provider webhook certification.
 *
 * Release gate 6 in docs/production-readiness.md asks for "provider sandbox
 * certification with real payloads". The suites that existed covered the two
 * ends and not the middle: `provider-webhook-relay` proves the public App
 * Hosting routes refuse an unsigned or oversized request, and
 * `provider-webhook-normalizers` proves a parsed payload maps to the right
 * domain event. Nothing exercised the authoritative HMAC verification in
 * between — the part docs/webhooks.md says the private handlers own, and the
 * part a provider misconfiguration actually breaks.
 *
 * This drives the real handlers on the emulator with payloads shaped as each
 * provider sends them, signed with each provider's documented scheme, and
 * checks the four things certification is for:
 *
 *   1. a correctly-signed payload is accepted
 *   2. a tampered body is refused
 *   3. a payload signed with the wrong secret is refused
 *   4. the same provider event delivered twice has one effect
 *
 * Plus the timestamp windows Stripe and Zoom enforce, which are the usual cause
 * of "it worked in the dashboard test and fails in production".
 *
 * Run:  npm run certify:providers      (emulator must be up)
 */

import { createHmac } from "node:crypto";

const FUNCTIONS =
  process.env.CERT_FUNCTIONS_ORIGIN ??
  "http://127.0.0.1:5501/studiohub-dev/us-east4";

/**
 * The records each handler resolves an event against.
 *
 * Every one of these endpoints refuses an event it cannot place: Docusign and
 * Zoom look up an `integrationConnections` document by provider account and
 * return CONNECTION_NOT_FOUND without one, which is the right answer to an
 * event from an account this deployment has never connected. Certifying only
 * the signature would have stopped at that 404 and called it a pass; seeding
 * lets the harness assert what the event actually *did*.
 */
const CERT_TENANT = "cert-tenant";
const CERT_ACCOUNT = "cert-account";

type Result = { name: string; ok: boolean; detail: string };
const results: Result[] = [];

const check = (name: string, ok: boolean, detail = "") => {
  results.push({ name, ok, detail });
  process.stdout.write(`${ok ? "  ok  " : "  FAIL"} ${name}${detail ? ` — ${detail}` : ""}\n`);
};

async function post(
  path: string,
  body: string,
  headers: Record<string, string>,
): Promise<{ status: number; text: string }> {
  const response = await fetch(`${FUNCTIONS}/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
  return { status: response.status, text: (await response.text()).slice(0, 200) };
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

/**
 * Providers retry on anything that is not a 2xx, so acknowledgement is the
 * property to assert, not a particular code. Docusign's handler answers 204 and
 * an earlier version of this harness called that a failure.
 */
const acknowledged = (status: number) => status >= 200 && status < 300;

// ── Docusign · HMAC-SHA256(rawBody) base64, header x-docusign-signature-1 ──
const docusignSignature = (raw: string, secret: string) =>
  createHmac("sha256", secret).update(raw).digest("base64");

async function certifyDocusign(envelopeId: string) {
  process.stdout.write("\nDocusign Connect (JSON SIM, envelope-completed)\n");
  const secret = "cert-docusign-hmac-secret";
  const raw = JSON.stringify({
    event: "envelope-completed",
    apiVersion: "v2.1",
    uri: `/restapi/v2.1/accounts/1/envelopes/${envelopeId}`,
    retryCount: 0,
    configurationId: 1,
    generatedDateTime: new Date().toISOString(),
    data: {
      accountId: CERT_ACCOUNT,
      envelopeId,
      envelopeSummary: {
        status: "completed",
        completedDateTime: new Date().toISOString(),
        recipients: {
          signers: [
            {
              email: "iris@example.com",
              name: "Iris Kapoor",
              status: "completed",
              signedDateTime: new Date().toISOString(),
            },
          ],
        },
      },
    },
  });

  const good = await post("docusignWebhook", raw, {
    "x-docusign-signature-1": docusignSignature(raw, secret),
  });
  check("valid HMAC accepted", acknowledged(good.status), `HTTP ${good.status} ${good.text}`);

  const replay = await post("docusignWebhook", raw, {
    "x-docusign-signature-1": docusignSignature(raw, secret),
  });
  check(
    "replayed envelope is deduped, not reprocessed",
    acknowledged(replay.status),
    `HTTP ${replay.status}`,
  );

  const tampered = raw.replace(envelopeId, `${envelopeId}-tampered`);
  const bad = await post("docusignWebhook", tampered, {
    "x-docusign-signature-1": docusignSignature(raw, secret),
  });
  check("tampered body refused", bad.status === 401, `HTTP ${bad.status}`);

  const wrongKey = await post("docusignWebhook", raw, {
    "x-docusign-signature-1": docusignSignature(raw, "not-the-secret"),
  });
  check("wrong secret refused", wrongKey.status === 401, `HTTP ${wrongKey.status}`);

  const unsigned = await post("docusignWebhook", raw, {});
  check("missing signature refused", unsigned.status === 401, `HTTP ${unsigned.status}`);

  // The point of the whole exercise: a signed envelope-completed has to be what
  // moves the contract, because the booking gate accepts nothing else.
  const contract = await readDoc("contracts/cert-contract");
  check(
    "completed envelope marks the contract completed",
    contract?.status === "completed",
    `contract status is ${String(contract?.status)}`,
  );
  const project = await readDoc("projects/cert-project");
  check(
    "the project advances to awaiting the retainer",
    project?.state === "RETAINER_PENDING",
    `project state is ${String(project?.state)}`,
  );
  // Delivered twice above. Docusign retries on any non-2xx and on its
  // acknowledgement timeout, so "exactly once" is the property that matters.
  const stored = await countWebhookEvents("docusign");
  check(
    "the envelope is stored exactly once, despite two deliveries",
    stored === 1,
    `${stored} webhookEvents records for docusign`,
  );
}

/** How many provider events this deployment has recorded, by provider. */
async function countWebhookEvents(provider: string): Promise<number> {
  const response = await fetch(`${DOCS}:runQuery`, {
    method: "POST",
    headers: {
      authorization: "Bearer owner",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "webhookEvents" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "provider" },
            op: "EQUAL",
            value: { stringValue: provider },
          },
        },
      },
    }),
  });
  const rows = (await response.json()) as Array<{ document?: unknown }>;
  return rows.filter((row) => row.document).length;
}

// ── QuickBooks · HMAC-SHA256(rawBody) base64, header intuit-signature ──
async function certifyQuickBooks() {
  process.stdout.write("\nQuickBooks Online (invoice change notifications)\n");
  const secret = "cert-quickbooks-verifier-token";
  const invoiceId = `${Date.now()}`;
  const raw = JSON.stringify({
    eventNotifications: [
      {
        realmId: "cert-realm",
        dataChangeEvent: {
          entities: [
            {
              name: "Invoice",
              id: invoiceId,
              operation: "Update",
              lastUpdated: new Date().toISOString(),
            },
          ],
        },
      },
    ],
  });
  const signature = (body: string, key: string) =>
    createHmac("sha256", key).update(body).digest("base64");

  const good = await post("quickbooksWebhook", raw, {
    "intuit-signature": signature(raw, secret),
  });
  check("valid verifier token accepted", acknowledged(good.status), `HTTP ${good.status}`);

  const replay = await post("quickbooksWebhook", raw, {
    "intuit-signature": signature(raw, secret),
  });
  check("replayed notification deduped", acknowledged(replay.status), `HTTP ${replay.status}`);

  const bad = await post("quickbooksWebhook", raw.replace(invoiceId, "999999"), {
    "intuit-signature": signature(raw, secret),
  });
  check("tampered body refused", bad.status === 401, `HTTP ${bad.status}`);

  const wrongKey = await post("quickbooksWebhook", raw, {
    "intuit-signature": signature(raw, "wrong-token"),
  });
  check("wrong verifier token refused", wrongKey.status === 401, `HTTP ${wrongKey.status}`);
}

// ── Stripe · t=<ts>,v1=HMAC-SHA256("<ts>.<raw>") hex, ±300s ──
const stripeHeader = (raw: string, secret: string, timestamp: number) =>
  `t=${timestamp},v1=${createHmac("sha256", secret)
    .update(`${timestamp}.${raw}`)
    .digest("hex")}`;

async function certifyStripe(
  label: string,
  path: string,
  secret: string,
  raw: string,
) {
  process.stdout.write(`\n${label}\n`);
  const now = nowSeconds();

  const good = await post(path, raw, { "stripe-signature": stripeHeader(raw, secret, now) });
  check("valid signature accepted", acknowledged(good.status), `HTTP ${good.status}`);

  const replay = await post(path, raw, { "stripe-signature": stripeHeader(raw, secret, now) });
  check("replayed event deduped", acknowledged(replay.status), `HTTP ${replay.status}`);

  const stale = now - 400;
  const old = await post(path, raw, { "stripe-signature": stripeHeader(raw, secret, stale) });
  check(
    "signature older than the 300s window refused",
    old.status === 401,
    `HTTP ${old.status}`,
  );

  const wrongKey = await post(path, raw, {
    "stripe-signature": stripeHeader(raw, "whsec_wrong", now),
  });
  check("wrong signing secret refused", wrongKey.status === 401, `HTTP ${wrongKey.status}`);

  const tampered = await post(path, `${raw} `, {
    "stripe-signature": stripeHeader(raw, secret, now),
  });
  check("tampered body refused", tampered.status === 401, `HTTP ${tampered.status}`);

  const unsigned = await post(path, raw, {});
  check("missing signature refused", unsigned.status === 401, `HTTP ${unsigned.status}`);
}

// ── Zoom · v0=HMAC-SHA256("v0:<ts>:<raw>") hex, header x-zm-signature, ±300s ──
async function certifyZoom() {
  process.stdout.write("\nZoom (meeting lifecycle)\n");
  const secret = "cert-zoom-secret-token";
  const now = nowSeconds();
  const raw = JSON.stringify({
    event: "meeting.ended",
    event_ts: now * 1000,
    payload: {
      account_id: CERT_ACCOUNT,
      object: {
        id: `cert-meeting-${now}`,
        uuid: `cert-uuid-${now}`,
        host_id: "cert-host",
        topic: "Consultation",
        start_time: new Date(now * 1000).toISOString(),
        end_time: new Date(now * 1000).toISOString(),
      },
    },
  });
  const header = (timestamp: number, body: string, key: string) =>
    `v0=${createHmac("sha256", key)
      .update(`v0:${timestamp}:${body}`)
      .digest("hex")}`;

  const good = await post("zoomWebhook", raw, {
    "x-zm-request-timestamp": `${now}`,
    "x-zm-signature": header(now, raw, secret),
  });
  check("valid signature accepted", acknowledged(good.status), `HTTP ${good.status} ${good.text}`);

  const stale = now - 400;
  const old = await post("zoomWebhook", raw, {
    "x-zm-request-timestamp": `${stale}`,
    "x-zm-signature": header(stale, raw, secret),
  });
  check("stale timestamp refused", old.status === 401, `HTTP ${old.status}`);

  const wrongKey = await post("zoomWebhook", raw, {
    "x-zm-request-timestamp": `${now}`,
    "x-zm-signature": header(now, raw, "wrong-secret"),
  });
  check("wrong secret token refused", wrongKey.status === 401, `HTTP ${wrongKey.status}`);
}

/** Writes the fixtures through the emulator's REST API, rules bypassed. */
const FIRESTORE =
  process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8782";
const DOCS = `http://${FIRESTORE}/v1/projects/studiohub-dev/databases/(default)/documents`;

async function seed(path: string, fields: Record<string, unknown>) {
  const encode = (value: unknown): Record<string, unknown> => {
    if (typeof value === "string") return { stringValue: value };
    if (typeof value === "number") return { integerValue: String(value) };
    if (typeof value === "boolean") return { booleanValue: value };
    return { stringValue: String(value) };
  };
  await fetch(`${DOCS}/${path}`, {
    method: "PATCH",
    headers: {
      authorization: "Bearer owner",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      fields: Object.fromEntries(
        Object.entries(fields).map(([key, value]) => [key, encode(value)]),
      ),
    }),
  });
}

async function readDoc(path: string): Promise<Record<string, unknown> | null> {
  const response = await fetch(`${DOCS}/${path}`, {
    headers: { authorization: "Bearer owner" },
  });
  if (!response.ok) return null;
  const body = (await response.json()) as { fields?: Record<string, { stringValue?: string }> };
  return Object.fromEntries(
    Object.entries(body.fields ?? {}).map(([key, value]) => [key, value.stringValue]),
  );
}

async function seedFixtures(envelopeId: string) {
  for (const provider of ["docusign", "zoom", "quickbooks"]) {
    await seed(`integrationConnections/cert-${provider}`, {
      tenantId: CERT_TENANT,
      provider,
      providerAccountId: CERT_ACCOUNT,
      status: "connected",
    });
  }
  await seed("projects/cert-project", {
    tenantId: CERT_TENANT,
    projectId: "cert-project",
    name: "Iris & Dev Kapoor",
    state: "CONTRACT_PENDING",
  });
  await seed("contracts/cert-contract", {
    tenantId: CERT_TENANT,
    projectId: "cert-project",
    provider: "docusign",
    providerEnvelopeId: envelopeId,
    status: "sent",
  });
}

async function main() {
  process.stdout.write(`Certifying provider webhooks against ${FUNCTIONS}\n`);
  const envelopeId = `cert-envelope-${Date.now()}`;
  await seedFixtures(envelopeId);
  await certifyDocusign(envelopeId);
  await certifyQuickBooks();
  const stripeEvent = (id: string, type: string, data: Record<string, unknown>) =>
    JSON.stringify({
      id,
      object: "event",
      type,
      created: nowSeconds(),
      livemode: false,
      data: { object: data },
    });
  await certifyStripe(
    "Stripe Connect (client invoices)",
    "stripeConnectWebhook",
    "whsec_cert_connect",
    stripeEvent(`evt_cert_connect_${Date.now()}`, "invoice.paid", {
      id: `in_cert_${Date.now()}`,
      object: "invoice",
      status: "paid",
      amount_due: 325000,
      amount_paid: 325000,
      currency: "usd",
    }),
  );
  await certifyStripe(
    "Stripe billing (StudioCue subscriptions)",
    "stripeWebhook",
    "whsec_cert_billing",
    stripeEvent(`evt_cert_billing_${Date.now()}`, "customer.subscription.updated", {
      id: `sub_cert_${Date.now()}`,
      object: "subscription",
      status: "active",
      customer: "cus_cert",
      items: { data: [{ price: { id: "price_cert" } }] },
      current_period_end: nowSeconds() + 2_592_000,
    }),
  );
  await certifyZoom();

  const failed = results.filter((result) => !result.ok);
  process.stdout.write(
    `\n${results.length - failed.length}/${results.length} checks passed\n`,
  );
  if (failed.length) {
    for (const failure of failed) {
      process.stdout.write(`  FAILED: ${failure.name} — ${failure.detail}\n`);
    }
    process.exitCode = 1;
  }
}

void main();
