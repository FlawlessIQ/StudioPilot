import { readFile } from "node:fs/promises";
import test from "node:test";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, query, setDoc, where } from "firebase/firestore";

/**
 * The vendor network (docs/vendor-network-plan-2026-10-12.md):
 * - `clientVendorTeams/{projectId}`, the couple's answer, read by the studio
 *   side that runs the job and written only by the server;
 * - `platformVendors/{hash}`, StudioCue's vendor database, read by nobody in
 *   a browser — not even a platform admin, who reads it through the Console's
 *   handlers.
 */
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;

test("vendor network: the couple's answer is the studio's to read; the vendor database is nobody's", { skip: !emulatorHost }, async () => {
  const [host, portValue] = (emulatorHost ?? "127.0.0.1:8080").split(":");
  const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
  const environment = await initializeTestEnvironment({
    projectId: `studiohub-rules-vendor-network-${Date.now()}`,
    firestore: { host, port: Number(portValue), rules },
  });
  try {
    await environment.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      const member = (tenantId: string, userId: string, role: string, projectIds: string[]) =>
        setDoc(doc(adminDb, `memberships/${tenantId}_${userId}`), { tenantId, userId, status: "active", role, projectIds });
      await member("tenant-a", "owner-a", "studio_owner", []);
      await member("tenant-a", "crew-a", "subcontractor", ["project-a"]);
      await member("tenant-a", "client-a", "client", ["project-a"]);
      await member("tenant-b", "owner-b", "studio_owner", []);
      await setDoc(doc(adminDb, "clientVendorTeams/project-a"), { id: "project-a", tenantId: "tenant-a", projectId: "project-a", answer: "listed", count: 3 });
      await setDoc(doc(adminDb, `platformVendors/${"a".repeat(64)}`), { id: "a".repeat(64), email: "dee@soundwave.co", kind: "dj", jobsSeen: 2 });
    });
    const as = (uid: string, claims: Record<string, unknown> = {}) => environment.authenticatedContext(uid, claims).firestore();

    // The studio reads its own couple's answer, by document and by the panel's tenant query.
    await assertSucceeds(getDoc(doc(as("owner-a"), "clientVendorTeams/project-a")));
    await assertSucceeds(getDocs(query(collection(as("owner-a"), "clientVendorTeams"), where("tenantId", "==", "tenant-a"))));
    // Not the crew, not another studio; nobody writes it from a browser, the couple included.
    await assertFails(getDoc(doc(as("crew-a"), "clientVendorTeams/project-a")));
    await assertFails(getDoc(doc(as("owner-b"), "clientVendorTeams/project-a")));
    await assertFails(setDoc(doc(as("client-a"), "clientVendorTeams/project-a"), { tenantId: "tenant-a", projectId: "project-a", answer: "none" }));
    await assertFails(setDoc(doc(as("owner-a"), "clientVendorTeams/project-a"), { tenantId: "tenant-a", projectId: "project-a", answer: "none" }));

    // The vendor database: no browser reads or writes it, a platform admin included.
    const admin = as("platform-admin", { platformAdmin: true, platformRole: "owner" });
    await assertFails(getDoc(doc(admin, `platformVendors/${"a".repeat(64)}`)));
    await assertFails(getDocs(collection(admin, "platformVendors")));
    await assertFails(getDoc(doc(as("owner-a"), `platformVendors/${"a".repeat(64)}`)));
    await assertFails(setDoc(doc(admin, `platformVendors/${"b".repeat(64)}`), { email: "x@y.co" }));
  } finally {
    await environment.cleanup();
  }
});
