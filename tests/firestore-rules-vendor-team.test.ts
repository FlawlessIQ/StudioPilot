import { readFile } from "node:fs/promises";
import test from "node:test";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from "firebase/firestore";

/**
 * A wedding's vendor team (functions/src/planning/vendor-team.ts).
 *
 * The team carries what the couple pays and still owes each vendor, so only
 * the studio side that runs it reads it: an owner or admin, or a coordinator
 * on the job. Crew read the contacts projection, which has no money in it.
 * Nobody writes either from a browser, and no other tenant reads them.
 */
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;

test("vendor team: the studio reads its own, nobody writes, the crew see contacts only", { skip: !emulatorHost }, async () => {
  const [host, portValue] = (emulatorHost ?? "127.0.0.1:8080").split(":");
  const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
  const environment = await initializeTestEnvironment({
    projectId: `studiohub-rules-vendor-team-${Date.now()}`,
    firestore: { host, port: Number(portValue), rules },
  });
  try {
    await environment.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      const member = (tenantId: string, userId: string, role: string, projectIds: string[]) =>
        setDoc(doc(adminDb, `memberships/${tenantId}_${userId}`), { tenantId, userId, status: "active", role, projectIds });
      await member("tenant-a", "owner-a", "studio_owner", []);
      await member("tenant-a", "coordinator-a", "studio_coordinator", ["project-a"]);
      await member("tenant-a", "coordinator-other", "studio_coordinator", ["project-b"]);
      await member("tenant-a", "crew-a", "subcontractor", ["project-a"]);
      await member("tenant-a", "client-a", "client", ["project-a"]);
      await member("tenant-b", "owner-b", "studio_owner", []);
      const entry = { tenantId: "tenant-a", projectId: "project-a", entryId: "pv_1", vendorId: "vendor-1", category: "florist", status: "booked", costCents: 420000, balanceDueCents: 120000 };
      await setDoc(doc(adminDb, "projectVendors/project-a_pv_1"), entry);
      await setDoc(doc(adminDb, "crewVendorContacts/project-a"), {
        id: "project-a",
        tenantId: "tenant-a",
        projectId: "project-a",
        vendors: [{ entryId: "pv_1", category: "florist", company: "Petal & Stem", contactName: "Rosa", phone: "555-0101", arrivalTime: "14:00" }],
      });
    });

    const as = (uid: string) => environment.authenticatedContext(uid).firestore();
    const team = (db: ReturnType<typeof as>, tenantId: string, projectId: string) =>
      getDocs(query(collection(db, "projectVendors"), where("tenantId", "==", tenantId), where("projectId", "==", projectId)));

    // The studio reads its own team, by document and by the panel's query.
    await assertSucceeds(getDoc(doc(as("owner-a"), "projectVendors/project-a_pv_1")));
    await assertSucceeds(team(as("owner-a"), "tenant-a", "project-a"));
    await assertSucceeds(getDoc(doc(as("coordinator-a"), "projectVendors/project-a_pv_1")));
    await assertSucceeds(team(as("coordinator-a"), "tenant-a", "project-a"));
    // Not a coordinator on another job, not the crew, not the couple, not another studio.
    await assertFails(getDoc(doc(as("coordinator-other"), "projectVendors/project-a_pv_1")));
    await assertFails(getDoc(doc(as("crew-a"), "projectVendors/project-a_pv_1")));
    await assertFails(getDoc(doc(as("client-a"), "projectVendors/project-a_pv_1")));
    await assertFails(getDoc(doc(as("owner-b"), "projectVendors/project-a_pv_1")));
    await assertFails(team(as("owner-b"), "tenant-a", "project-a"));
    // Nobody writes it from a browser, the owner included.
    await assertFails(setDoc(doc(as("owner-a"), "projectVendors/project-a_pv_2"), { ...{ tenantId: "tenant-a", projectId: "project-a" }, status: "booked" }));
    await assertFails(updateDoc(doc(as("owner-a"), "projectVendors/project-a_pv_1"), { costCents: 1 }));

    // The crew's view: names, numbers and times, for the job they're on.
    const contacts = (db: ReturnType<typeof as>) =>
      getDocs(query(collection(db, "crewVendorContacts"), where("tenantId", "==", "tenant-a"), where("projectId", "==", "project-a")));
    await assertSucceeds(contacts(as("crew-a")));
    await assertSucceeds(contacts(as("coordinator-a")));
    await assertSucceeds(getDoc(doc(as("owner-a"), "crewVendorContacts/project-a")));
    await assertFails(getDoc(doc(as("client-a"), "crewVendorContacts/project-a")));
    await assertFails(getDoc(doc(as("coordinator-other"), "crewVendorContacts/project-a")));
    await assertFails(getDoc(doc(as("owner-b"), "crewVendorContacts/project-a")));
    await assertFails(setDoc(doc(as("crew-a"), "crewVendorContacts/project-a"), { tenantId: "tenant-a", projectId: "project-a", vendors: [] }));
  } finally {
    await environment.cleanup();
  }
});
