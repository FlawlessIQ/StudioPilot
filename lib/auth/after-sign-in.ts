import type { Auth } from "firebase/auth";
import {
  collection,
  getDocs,
  limit,
  query,
  where,
  type Firestore,
} from "firebase/firestore";
import {
  destinationAfterSignIn,
  type SignInMembership,
} from "@/features/auth/workspace-routing";

/**
 * Where a user who has just signed in goes, by the memberships they hold.
 *
 * Shared by password sign-in and "Continue with Google", so a studio owner
 * lands in the same place whichever they used, and a brand-new account (no
 * membership yet) goes on to setting up a studio.
 */
export async function destinationForSignedInUser(
  auth: Auth,
  firestore: Firestore,
): Promise<string> {
  const token = await auth.currentUser?.getIdTokenResult();
  const memberships = await getDocs(
    query(
      collection(firestore, "memberships"),
      where("userId", "==", auth.currentUser?.uid ?? ""),
      where("status", "==", "active"),
      limit(20),
    ),
  );
  const preferred = window.localStorage.getItem("studiohub.activeTenantId");
  const membership =
    memberships.docs.find((item) => item.data().tenantId === preferred) ??
    memberships.docs[0];
  if (membership)
    window.localStorage.setItem(
      "studiohub.activeTenantId",
      String(membership.data().tenantId),
    );
  const activeMemberships = memberships.docs
    .map((item) => ({
      tenantId: String(item.data().tenantId ?? ""),
      role: String(item.data().role ?? "") as SignInMembership["role"],
    }))
    .filter((item) => Boolean(item.tenantId));
  return destinationAfterSignIn({
    memberships: activeMemberships,
    platformAdmin: token?.claims.platformAdmin === true,
  });
}
