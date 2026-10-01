import { randomBytes } from "node:crypto";
import type { Auth } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";

/** Who the Console writes to about a studio: its active owner. */
export async function studioOwner(db: Firestore, auth: Auth, tenantId: string) {
  const [owners, tenant] = await Promise.all([
    db
      .collection("memberships")
      .where("tenantId", "==", tenantId)
      .where("role", "==", "studio_owner")
      .where("status", "==", "active")
      .limit(1)
      .get(),
    db.doc(`tenants/${tenantId}`).get(),
  ]);
  const uid = String(owners.docs[0]?.get("userId") ?? tenant.get("createdBy") ?? "");
  if (!tenant.exists) return null;
  const studioName =
    [tenant.get("brandName"), tenant.get("businessName"), tenant.get("legalName")].find(
      (value): value is string => typeof value === "string" && value.trim().length > 0,
    ) ?? tenantId;
  if (!uid) return { uid: null, email: null, name: null, studioName };
  try {
    const user = await auth.getUser(uid);
    return { uid, email: user.email ?? null, name: user.displayName ?? null, studioName };
  } catch {
    const doc = await db.doc(`users/${uid}`).get();
    return {
      uid,
      email: typeof doc.get("email") === "string" ? String(doc.get("email")) : null,
      name: typeof doc.get("displayName") === "string" ? String(doc.get("displayName")) : null,
      studioName,
    };
  }
}

export function appUrl(path = ""): string {
  return `${process.env.NEXT_PUBLIC_APP_URL ?? "https://studio-cue.com"}${path}`;
}

/** Where a studio's reply to team mail lands. Never a person's own address. */
export function teamReplyAddress(): string {
  return process.env.FEEDBACK_REPLY_TO?.trim() || "support@studio-cue.com";
}

/**
 * An action link in team mail may only point into StudioCue. A path is
 * resolved against the app; anything else is dropped rather than sent.
 */
export function safeActionUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  const value = path.trim();
  if (value.startsWith("/") && !value.startsWith("//")) return appUrl(value);
  try {
    const url = new URL(value);
    const app = new URL(appUrl());
    return url.protocol === "https:" && url.host === app.host ? url.toString() : null;
  } catch {
    return null;
  }
}

export function shortToken(bytes = 6): string {
  return randomBytes(bytes).toString("hex");
}

/** A platform email job: StudioCue's letterhead, queued for the render worker. */
export function platformEmailJob(id: string, fields: Record<string, unknown> & { type: string; recipient: string }, now: string) {
  return {
    id,
    tenantId: "platform",
    projectId: null,
    status: "queued",
    attempts: 0,
    createdAt: now,
    updatedAt: now,
    ...fields,
  };
}
