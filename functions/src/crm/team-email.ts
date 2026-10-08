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
  const role = await signedUpRoleForEmail(db, tenantId, address);
  if (role && role !== "client") return role;
  // Crew invited but not signed up yet hold the address just as surely: the
  // first to accept takes it (GR, 2026-10-08, one inbox for bride and crew).
  return (await crewProfileNameForEmail(db, tenantId, address)) ? "subcontractor" : null;
}

/** The role this address already holds in the studio as a signed-up member, or null. */
export async function signedUpRoleForEmail(
  db: Firestore,
  tenantId: string,
  email: string,
): Promise<string | null> {
  let uid: string;
  try {
    uid = (await getAuth().getUserByEmail(email.trim().toLowerCase())).uid;
  } catch {
    return null;
  }
  const membership = await db.doc(`memberships/${tenantId}_${uid}`).get();
  if (!membership.exists || membership.get("status") !== "active") return null;
  return String(membership.get("role") ?? "") || null;
}

const normal = (value: unknown) => (typeof value === "string" ? value.trim().toLowerCase() : "");

/**
 * The crew member in this studio's directory at this address, by name, or
 * null. Addresses are stored as typed, so the directory is read and compared
 * normalised (crew/commands.ts tenantCrewDirectory does the same).
 */
export async function crewProfileNameForEmail(
  db: Firestore,
  tenantId: string,
  email: string,
): Promise<string | null> {
  const address = normal(email);
  if (!address) return null;
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  for (;;) {
    let query = db
      .collection("crewProfiles")
      .where("tenantId", "==", tenantId)
      .orderBy("__name__")
      .select("email", "name", "archivedAt")
      .limit(500);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    for (const profile of page.docs) {
      if (!profile.get("archivedAt") && normal(profile.get("email")) === address)
        return String(profile.get("name") ?? "").trim() || address;
    }
    if (page.size < 500) return null;
    cursor = page.docs[page.size - 1];
  }
}

/**
 * The client at this address in this studio, by name, or null — the reverse
 * check, for a crew member being added at an address a couple already has.
 */
export async function clientNameForEmail(
  db: Firestore,
  tenantId: string,
  email: string,
): Promise<string | null> {
  const address = normal(email);
  if (!address) return null;
  const matches = await db
    .collection("contacts")
    .where("tenantId", "==", tenantId)
    .where("normalizedEmail", "==", address)
    .limit(5)
    .get();
  const contact = matches.docs.find((entry) => !entry.get("archivedAt"));
  if (!contact) return null;
  return (
    String(contact.get("displayName") ?? "").trim() ||
    `${String(contact.get("firstName") ?? "")} ${String(contact.get("lastName") ?? "")}`.trim() ||
    address
  );
}
