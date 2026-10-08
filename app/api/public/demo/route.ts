import { createHash } from "node:crypto";
import { z } from "zod";
import { adminAppCheck, adminFirestore } from "@/server/firebase/admin";
import { requestClientIp } from "@/lib/security/client-ip";
import { HEARD_OPTIONS } from "@/features/growth/attribution";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "Book a demo" on studio-cue.com/demo (docs/console.md, "Pipeline").
 *
 * A photographer asks for a demo; this files them on the Console's pipeline
 * (`saasLeads`) and emails the team inbox set in Console → Settings, with
 * Reply-To the photographer. A Next route, not a Function, for the reason
 * app/api/public/places gives: one write, no business rules, and no function
 * to add to the invoker allowlist.
 *
 * Guarded like the inquiry form: App Check outside the emulator, a hidden
 * field a person never fills, and five requests an hour per visitor. Nothing
 * is sent to the address they typed, so the form can't be used to mail a
 * stranger.
 */
const requestSchema = z.object({
  name: z.string().trim().min(2).max(120),
  studioName: z.string().trim().max(160).optional().default(""),
  email: z.string().trim().toLowerCase().email().max(200),
  phone: z.string().trim().max(40).optional().default(""),
  website: z.string().trim().max(200).optional().default(""),
  message: z.string().trim().max(4000).optional().default(""),
  preferredTimes: z.string().trim().max(300).optional().default(""),
  heard: z.enum(HEARD_OPTIONS.map((option) => option.value) as [string, ...string[]]).nullable().optional(),
  attribution: z.unknown().optional(),
  /** Hidden from people; a bot fills every field. */
  companyUrl: z.string().max(200).optional().default(""),
});

/** The link they arrived on (features/growth/attribution.ts), kept only if it's the right shape. */
const field = z.string().trim().max(120).nullable();
const touchSchema = z.object({ source: field, medium: field, campaign: field, content: field, referrer: field, landing: z.string().max(120), code: field, at: z.string().max(40) });
const linkSchema = z.object({ first: touchSchema.nullable(), last: touchSchema.nullable() });

const HOURLY_LIMIT = 5;
const WINDOW_MS = 60 * 60 * 1000;

async function withinRateLimit(request: Request): Promise<boolean> {
  const ip = requestClientIp(request) ?? "unknown";
  const id = `demo_${createHash("sha256").update(`demo|${ip}|${request.headers.get("user-agent") ?? ""}`).digest("hex")}`;
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

const HEARD_LABEL = Object.fromEntries(HEARD_OPTIONS.map((option) => [option.value, option.label])) as Record<string, string>;

export async function POST(request: Request): Promise<Response> {
  let input: z.infer<typeof requestSchema>;
  try {
    input = requestSchema.parse(await request.json());
  } catch {
    return Response.json({ error: "INVALID_REQUEST" }, { status: 400 });
  }
  // A filled honeypot gets the same answer as a real request, and nothing else.
  if (input.companyUrl) return Response.json({ ok: true });
  if (process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS !== "true") {
    const appCheckToken = request.headers.get("x-firebase-appcheck");
    try {
      if (!appCheckToken) throw new Error("APP_CHECK_REQUIRED");
      await adminAppCheck.verifyToken(appCheckToken);
    } catch {
      return Response.json({ error: "APP_CHECK_REQUIRED" }, { status: 401 });
    }
  }
  if (!(await withinRateLimit(request))) return Response.json({ error: "RATE_LIMITED" }, { status: 429 });

  const now = new Date().toISOString();
  const attribution = linkSchema.safeParse(input.attribution);
  const settings = (await adminFirestore.doc("consoleSettings/growth").get()).data() ?? {};
  const existing = await adminFirestore.collection("saasLeads").where("email", "==", input.email).limit(1).get();
  const reference = existing.docs[0]?.ref ?? adminFirestore.collection("saasLeads").doc();
  const latest = {
    message: input.message || null,
    preferredTimes: input.preferredTimes || null,
    demoRequestedAt: now,
    updatedAt: now,
  };
  if (existing.empty) {
    await reference.create({
      id: reference.id,
      name: input.name,
      studioName: input.studioName || null,
      email: input.email,
      phone: input.phone || null,
      website: input.website || null,
      instagram: null,
      location: null,
      stage: "new",
      source: null,
      sourceDetail: null,
      heard: input.heard ?? null,
      attribution: attribution.success ? attribution.data : null,
      ownerUid: null,
      ownerEmail: null,
      nextStep: "Reply and book the demo",
      nextStepAt: now.slice(0, 10),
      lostReason: null,
      tenantId: null,
      origin: "demo_form",
      createdBy: "demo_form",
      createdAt: now,
      stageChangedAt: now,
      ...latest,
    });
  } else {
    // Asked again: the newest request wins, and a closed lead opens again.
    const lead = existing.docs[0]!;
    await reference.update({
      ...latest,
      ...(lead.get("stage") === "lost" && !lead.get("tenantId") ? { stage: "new", stageChangedAt: now, lostReason: null } : {}),
    });
  }

  const inbox = typeof settings.demoNotifyEmail === "string" ? settings.demoNotifyEmail : null;
  if (inbox) {
    const jobId = `demo_requested_${reference.id}_${now.replace(/\D/g, "").slice(0, 14)}`;
    const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "https://studio-cue.com").replace(/\/$/, "");
    await adminFirestore.doc(`emailJobs/${jobId}`).create({
      id: jobId,
      tenantId: "platform",
      projectId: null,
      status: "queued",
      attempts: 0,
      type: "platform_demo_requested",
      recipient: inbox,
      recipientName: "StudioCue team",
      replyAddress: input.email,
      leadName: input.name,
      leadStudioName: input.studioName,
      leadEmail: input.email,
      leadPhone: input.phone,
      leadWebsite: input.website,
      leadMessage: input.message,
      leadPreferredTimes: input.preferredTimes,
      leadHeard: input.heard ? HEARD_LABEL[input.heard] ?? input.heard : "",
      actionUrl: `${appUrl}/platform-admin/pipeline?lead=${reference.id}`,
      createdAt: now,
      updatedAt: now,
    });
  } else {
    console.error(JSON.stringify({ severity: "ERROR", event: "demo.inbox_not_configured", leadId: reference.id }));
  }
  return Response.json({ ok: true, bookingUrl: typeof settings.demoBookingUrl === "string" ? settings.demoBookingUrl : null });
}
