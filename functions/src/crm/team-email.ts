import { getAuth } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";

/**
 * Whether an email a studio is putting on a client already belongs to someone
 * on its own team or crew.
 *
 * A person holds one membership per studio, so a crew member's address can
 * never become that studio's client login: the portal invitation fails later,
 * at the couple's end, with the proposal already sent. On the production walk
 * (2026-09-25) a client record was given an address that was a crew member's,
 * and the first anyone knew was the couple's invite not working.
 *
 * Returns the role, so the studio can be told who it is. Advisory: the save
 * goes ahead, because the studio may be fixing it next.
 */
export async function teamRoleForEmail(
  db: Firestore,
  tenantId: string,
  email: string | null | undefined,
): Promise<string | null> {
  const address = email?.trim().toLowerCase();
  if (!address) return null;
  let uid: string;
  try {
    uid = (await getAuth().getUserByEmail(address)).uid;
  } catch {
    return null;
  }
  const membership = await db.doc(`memberships/${tenantId}_${uid}`).get();
  if (!membership.exists || membership.get("status") !== "active") return null;
  const role = String(membership.get("role") ?? "");
  return role && role !== "client" ? role : null;
}
