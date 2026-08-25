import { getAuth } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";

/**
 * Where a studio's own alerts go.
 *
 * This was read straight off the tenant — emailBranding.replyTo, then
 * contactEmail, then email — and skipped quietly when none were set. The
 * production tenant has none of the three, so every "a client wrote to you"
 * notification since it shipped resolved to nothing and was never sent. The
 * feature reported success and did nothing, which is the failure mode worth
 * hunting: a studio cannot notice a message it was never told about.
 *
 * So there is a real fallback — the owner's sign-in address, which by definition
 * exists — and no silent path out. If nothing resolves, the caller logs it.
 */
export async function studioNotificationAddress(
  firestore: Firestore,
  tenantId: string,
): Promise<string | null> {
  const tenant = await firestore.doc(`tenants/${tenantId}`).get();
  const branding = tenant.get("emailBranding");
  const configured = [
    typeof branding === "object" && branding !== null
      ? (branding as Record<string, unknown>).replyTo
      : null,
    tenant.get("contactEmail"),
    tenant.get("email"),
  ].find((value) => typeof value === "string" && value.trim());
  if (typeof configured === "string") return configured.trim();

  // Filtered in memory rather than with a compound query: a tenant has a
  // handful of memberships, and this avoids a composite index existing only to
  // serve a fallback.
  const memberships = await firestore
    .collection("memberships")
    .where("tenantId", "==", tenantId)
    .limit(50)
    .get();
  const owners = memberships.docs.filter(
    (document) =>
      String(document.get("role")) === "studio_owner" &&
      String(document.get("status")) === "active",
  );
  for (const owner of owners) {
    const userId = String(owner.get("userId") ?? "");
    if (!userId) continue;
    try {
      const user = await getAuth().getUser(userId);
      if (user.email) return user.email;
    } catch {
      // A membership pointing at a deleted user is not a reason to give up on
      // the others.
    }
  }
  return null;
}
