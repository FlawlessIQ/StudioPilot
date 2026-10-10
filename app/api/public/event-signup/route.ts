import { createHash, randomBytes, randomUUID } from "node:crypto";
import { adminAppCheck, adminFirestore } from "@/server/firebase/admin";
import { requestClientIp } from "@/lib/security/client-ip";
import {
  EVENT_PAYMENT_LABEL,
  confirmationCodeFrom,
  eventPrice,
  eventSignupInputSchema,
  howToPay,
  normaliseEventSignup,
  signupState,
  statusForMethod,
  venmoPayUrl,
  type EventPaymentMethod,
  type EventSignupConfig,
} from "@/features/group-events/signup";

/**
 * A parent's sign-up for a group event (docs/group-event-signup-plan-2026-10-10.md).
 *
 * Public, behind the event's link or QR code: no account. GET with `token`
 * shows the event (packages, how to pay); GET with `order` shows one parent's
 * own order, from the link in their emails (`/e/order/{orderToken}`), which
 * keeps working after the studio replaces the event's link. POST signs them
 * up. Everything the parent sends is checked against the event as it stands —
 * the package, its price and the payment method are the studio's, never the
 * browser's. The event link is looked up by its hash (`eventSignupLinks`), and
 * only what a parent needs leaves this route.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HOURLY_LIMIT = 60;
const WINDOW_MS = 60 * 60 * 1000;

const linkIdFor = (token: string) => createHash("sha256").update(`event-signup:${token}`).digest("hex");
const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const appUrl = () => (process.env.NEXT_PUBLIC_APP_URL ?? "https://studio-cue.com").replace(/\/$/, "");

/**
 * Generous: at a cheer day many parents share the venue's wifi, so one
 * address can be dozens of honest sign-ups in an hour.
 */
async function withinRateLimit(request: Request, linkId: string): Promise<boolean> {
  const ip = requestClientIp(request) ?? "unknown";
  const id = `event_signup_${createHash("sha256").update(`${linkId}|${ip}`).digest("hex")}`;
  const reference = adminFirestore.doc(`publicRateLimits/${id}`);
  const now = Date.now();
  try {
    await adminFirestore.runTransaction(async (transaction) => {
      const data = (await transaction.get(reference)).data() as { windowStartedAt: number; count: number } | undefined;
      const within = data && now - data.windowStartedAt < WINDOW_MS;
      const count = within ? data.count + 1 : 1;
      if (count > HOURLY_LIMIT) throw new Error("RATE_LIMITED");
      transaction.set(reference, { windowStartedAt: within ? data.windowStartedAt : now, count, expiresAt: new Date(now + WINDOW_MS * 2).toISOString() });
    });
    return true;
  } catch {
    return false;
  }
}

type Resolved = {
  linkId: string;
  tenantId: string;
  projectId: string;
  project: FirebaseFirestore.DocumentSnapshot;
  tenant: FirebaseFirestore.DocumentSnapshot;
  config: EventSignupConfig;
};

/** The event behind a link, or why there isn't one. */
async function resolve(token: string): Promise<Resolved | { error: string; status: number }> {
  if (!TOKEN.test(token)) return { error: "EVENT_LINK_NOT_FOUND", status: 404 };
  const linkId = linkIdFor(token);
  const link = await adminFirestore.doc(`eventSignupLinks/${linkId}`).get();
  if (!link.exists) return { error: "EVENT_LINK_NOT_FOUND", status: 404 };
  if (link.get("status") === "revoked") return { error: "EVENT_LINK_RETIRED", status: 410 };
  const tenantId = text(link.get("tenantId"));
  const projectId = text(link.get("projectId"));
  const [project, tenant] = await Promise.all([
    adminFirestore.doc(`projects/${projectId}`).get(),
    adminFirestore.doc(`tenants/${tenantId}`).get(),
  ]);
  if (!project.exists || project.get("tenantId") !== tenantId || project.get("archivedAt") || !tenant.exists)
    return { error: "EVENT_LINK_NOT_FOUND", status: 404 };
  const config = normaliseEventSignup(project.get("groupEvent"));
  // The link must be the event's current one: a reset retires the old token.
  if (config.token !== token) return { error: "EVENT_LINK_RETIRED", status: 410 };
  return { linkId, tenantId, projectId, project, tenant, config };
}

const TOKEN = /^[A-Za-z0-9_-]{16,80}$/;

async function signedUpCount(tenantId: string, projectId: string): Promise<number> {
  const snapshot = await adminFirestore
    .collection("eventParticipants")
    .where("tenantId", "==", tenantId)
    .where("projectId", "==", projectId)
    .get();
  return snapshot.docs.filter((participant) => participant.get("status") !== "cancelled").length;
}

function studioOf(tenant: FirebaseFirestore.DocumentSnapshot) {
  const branding = (tenant.get("emailBranding") ?? {}) as Record<string, unknown>;
  return {
    name: text(tenant.get("brandName")) || text(tenant.get("businessName")) || "Your studio",
    logoUrl: text(branding.logoUrl) || text(tenant.get("logoUrl")) || null,
  };
}

function eventOf(project: FirebaseFirestore.DocumentSnapshot) {
  const venue = (project.get("venue") ?? {}) as Record<string, unknown>;
  return {
    name: text(project.get("name")) || "The event",
    date: text(project.get("eventDate")) || null,
    venue: text(venue.name) || text(project.get("venueName")) || null,
    city: text(project.get("city")) || null,
  };
}

/** How the parent pays, and the button that does it, for one order. */
function payment(method: EventPaymentMethod, config: EventSignupConfig, studioName: string, amountCents: number, note: string) {
  return {
    method,
    label: EVENT_PAYMENT_LABEL[method],
    howToPay: howToPay(method, config, studioName),
    payUrl:
      method === "venmo" && config.venmoHandle
        ? venmoPayUrl(config.venmoHandle, amountCents, note)
        : method === "pay_link" && config.payLinkUrl
          ? config.payLinkUrl
          : null,
  };
}

function orderView(
  participant: FirebaseFirestore.DocumentSnapshot,
  config: EventSignupConfig,
  studioName: string,
) {
  const method = text(participant.get("chosenMethod")) as EventPaymentMethod;
  const amountCents = Number(participant.get("amountCents") ?? 0);
  const athlete = text(participant.get("athleteName"));
  const packageName = text(participant.get("packageName"));
  return {
    confirmationCode: text(participant.get("confirmationCode")),
    athleteName: athlete,
    packageName,
    amount: eventPrice(amountCents),
    paid: participant.get("status") === "paid",
    cancelled: participant.get("status") === "cancelled",
    payment: config.methods.includes(method)
      ? payment(method, config, studioName, amountCents, `${athlete} — ${packageName}`)
      : null,
  };
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const orderToken = text(url.searchParams.get("order"));
  if (orderToken) return orderResponse(orderToken);
  const resolved = await resolve(text(url.searchParams.get("token")));
  if ("error" in resolved) return Response.json({ error: resolved.error }, { status: resolved.status });
  const { tenantId, projectId, project, tenant, config } = resolved;
  return Response.json({
    studio: studioOf(tenant),
    event: eventOf(project),
    state: signupState(config, new Date().toISOString(), await signedUpCount(tenantId, projectId)),
    closesAt: config.closesAt,
    options: config.options.map((option) => ({ ...option, price: eventPrice(option.priceCents) })),
    methods: config.methods.map((method) => ({ method, label: EVENT_PAYMENT_LABEL[method] })),
    order: null,
    signupPath: null,
  });
}

/** One parent's order, with the event it's for, and the way back to sign up another athlete while that's open. */
async function orderResponse(orderToken: string): Promise<Response> {
  if (!TOKEN.test(orderToken)) return Response.json({ error: "ORDER_NOT_FOUND" }, { status: 404 });
  const match = await adminFirestore.collection("eventParticipants").where("orderToken", "==", orderToken).limit(1).get();
  const participant = match.docs[0];
  if (!participant) return Response.json({ error: "ORDER_NOT_FOUND" }, { status: 404 });
  const tenantId = text(participant.get("tenantId"));
  const projectId = text(participant.get("projectId"));
  const [project, tenant] = await Promise.all([
    adminFirestore.doc(`projects/${projectId}`).get(),
    adminFirestore.doc(`tenants/${tenantId}`).get(),
  ]);
  if (!project.exists || project.get("tenantId") !== tenantId || !tenant.exists)
    return Response.json({ error: "ORDER_NOT_FOUND" }, { status: 404 });
  const config = normaliseEventSignup(project.get("groupEvent"));
  const studio = studioOf(tenant);
  const state = signupState(config, new Date().toISOString(), await signedUpCount(tenantId, projectId));
  return Response.json({
    studio,
    event: eventOf(project),
    state,
    closesAt: config.closesAt,
    options: [],
    methods: [],
    order: orderView(participant, config, studio.name),
    signupPath: state === "open" && config.token ? `/e/${config.token}` : null,
  });
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "INVALID_SIGNUP" }, { status: 400 });
  }
  const parsed = eventSignupInputSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "INVALID_SIGNUP", fields: parsed.error.issues.map((issue) => issue.path.join(".")) }, { status: 400 });
  }
  const input = parsed.data;
  if (input.website) return Response.json({ error: "INVALID_SIGNUP" }, { status: 400 });
  if (process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS !== "true") {
    const appCheckToken = request.headers.get("x-firebase-appcheck");
    try {
      if (!appCheckToken) throw new Error("APP_CHECK_REQUIRED");
      await adminAppCheck.verifyToken(appCheckToken);
    } catch {
      return Response.json({ error: "APP_CHECK_REQUIRED" }, { status: 401 });
    }
  }
  const resolved = await resolve(input.token);
  if ("error" in resolved) return Response.json({ error: resolved.error }, { status: resolved.status });
  const { linkId, tenantId, projectId, project, tenant, config } = resolved;
  if (!(await withinRateLimit(request, linkId))) return Response.json({ error: "RATE_LIMITED" }, { status: 429 });
  const option = config.options.find((candidate) => candidate.id === input.optionId);
  if (!option) return Response.json({ error: "EVENT_OPTION_UNAVAILABLE" }, { status: 409 });
  if (!config.methods.includes(input.method)) return Response.json({ error: "EVENT_METHOD_UNAVAILABLE" }, { status: 409 });
  const studio = studioOf(tenant);
  const now = new Date().toISOString();

  const participants = adminFirestore
    .collection("eventParticipants")
    .where("tenantId", "==", tenantId)
    .where("projectId", "==", projectId);
  const result = await adminFirestore.runTransaction(async (transaction) => {
    const roster = (await transaction.get(participants)).docs;
    const live = roster.filter((participant) => participant.get("status") !== "cancelled");
    // The same parent for the same athlete again — a double tap, a second
    // scan at the field — is the order they already have, not a second one.
    const repeat = live.find(
      (participant) =>
        text(participant.get("email")).toLowerCase() === input.email &&
        text(participant.get("athleteName")).toLowerCase() === input.athleteName.toLowerCase(),
    );
    if (repeat) return { kind: "repeat" as const, participant: repeat };
    const state = signupState(config, now, live.length);
    if (state !== "open") return { kind: "refused" as const, state };
    const participantId = randomUUID();
    const orderToken = randomBytes(18).toString("base64url");
    const confirmationCode = confirmationCodeFrom(randomBytes(6));
    const reference = adminFirestore.doc(`eventParticipants/${participantId}`);
    const record = {
      id: participantId,
      tenantId,
      projectId,
      parentName: input.parentName,
      email: input.email,
      phone: input.phone || null,
      athleteName: input.athleteName,
      team: input.team || null,
      packageName: option.name,
      optionId: option.id,
      amountCents: option.priceCents,
      status: statusForMethod(input.method),
      chosenMethod: input.method,
      source: "signup_link",
      confirmationCode,
      // Opens this one order (/e/order/{orderToken}), from the parent's emails.
      orderToken,
      consentAt: now,
      payment: null,
      receiptQueuedAt: null,
      createdAt: now,
      updatedAt: now,
      createdBy: "event_signup",
      updatedBy: "event_signup",
    };
    transaction.create(reference, record);
    const orderPath = `/e/order/${orderToken}`;
    const orderUrl = `${appUrl()}${orderPath}`;
    const pay = payment(input.method, config, studio.name, option.priceCents, `${input.athleteName} — ${option.name}`);
    transaction.create(adminFirestore.doc(`emailJobs/group_signup_${participantId}`), {
      id: `group_signup_${participantId}`,
      tenantId,
      projectId,
      participantId,
      type: "group_signup_confirmation",
      recipient: input.email,
      recipientName: input.parentName,
      // The parent alone: the job's own client (the organiser) isn't copied.
      soleRecipient: true,
      audience: "parent",
      athleteName: input.athleteName,
      packageName: option.name,
      amountText: eventPrice(option.priceCents),
      howToPay: pay.howToPay,
      methodLabel: pay.label,
      chosenMethod: input.method,
      confirmationCode,
      eventDate: project.get("eventDate") ?? null,
      // Their own order page; the Venmo or pay-link button leads when there is one.
      actionUrl: orderUrl,
      payUrl: pay.payUrl,
      status: "queued",
      attempts: 0,
      maxAttempts: 5,
      createdAt: now,
      updatedAt: now,
    });
    const auditId = randomUUID();
    transaction.create(adminFirestore.doc(`auditEvents/${auditId}`), {
      id: auditId,
      tenantId,
      projectId,
      actorId: "event_signup",
      actorType: "client",
      action: "participant.signed_up",
      entityType: "eventParticipant",
      entityId: participantId,
      timestamp: now,
      before: null,
      after: { optionId: option.id, method: input.method, status: record.status },
      ipAddress: null,
      userAgent: request.headers.get("user-agent"),
      correlationId: participantId,
      automationRunId: null,
      providerEventId: null,
    });
    return { kind: "created" as const, record, orderPath };
  });

  if (result.kind === "refused") {
    return Response.json({ error: result.state === "full" ? "EVENT_FULL" : "EVENT_SIGNUP_CLOSED" }, { status: 409 });
  }
  if (result.kind === "repeat") {
    const orderToken = text(result.participant.get("orderToken"));
    return Response.json({
      order: orderView(result.participant, config, studio.name),
      orderPath: orderToken ? `/e/order/${orderToken}` : null,
      repeat: true,
    });
  }
  const participant = await adminFirestore.doc(`eventParticipants/${result.record.id}`).get();
  return Response.json({ order: orderView(participant, config, studio.name), orderPath: result.orderPath, repeat: false });
}
