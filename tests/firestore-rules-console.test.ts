import { readFile } from "node:fs/promises";
import test from "node:test";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from "firebase/firestore";

/**
 * The StudioCue Console's records (docs/console.md): platform admins read
 * them, nobody writes them from a browser, and a studio never sees the team's
 * notes. Also the activity heartbeat: a person may stamp when they were last
 * in the app on their own user document, and nothing more.
 */
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;

test("the Console's records are the team's, read-only from any browser", { skip: !emulatorHost }, async () => {
  const [host, portValue] = (emulatorHost ?? "127.0.0.1:8080").split(":");
  const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
  const environment = await initializeTestEnvironment({
    projectId: `studiohub-console-rules-${Date.now()}`,
    firestore: { host, port: Number(portValue), rules },
  });
  const collections = [
    "consoleStudios",
    "consolePeople",
    "consoleNotes",
    "consoleTasks",
    "consoleSettings",
    "consoleMetrics",
    "consoleReplies",
    "platformAdmins",
    "issues",
    "saasInvoices",
    "saasDiscounts",
  ];
  try {
    await environment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, "memberships/tenant-a_owner-a"), { tenantId: "tenant-a", userId: "owner-a", status: "active", role: "studio_owner", projectIds: [] });
      for (const name of collections) await setDoc(doc(db, `${name}/tenant-a`), { tenantId: "tenant-a", subjectKey: "studio:tenant-a", body: "internal" });
      await setDoc(doc(db, "users/owner-a"), { id: "owner-a", email: "owner@a.test", displayName: "Owner" });
      await setDoc(doc(db, "feedbackMessages/reply"), { feedbackId: "fb", direction: "outbound", visibleToSender: true, senderUserId: "owner-a", body: "Thanks" });
      await setDoc(doc(db, "feedbackMessages/note"), { feedbackId: "fb", direction: "internal", visibleToSender: false, senderUserId: "owner-a", body: "Internal" });
    });
    const platform = environment.authenticatedContext("platform-a", { platformAdmin: true }).firestore();
    const owner = environment.authenticatedContext("owner-a").firestore();
    const stranger = environment.authenticatedContext("someone-else").firestore();

    for (const name of collections) {
      await assertSucceeds(getDoc(doc(platform, `${name}/tenant-a`)));
      // A studio owner — even of the studio the record is about — reads none of it.
      await assertFails(getDoc(doc(owner, `${name}/tenant-a`)));
      await assertFails(setDoc(doc(platform, `${name}/new`), { tenantId: "tenant-a" }));
      await assertFails(setDoc(doc(owner, `${name}/new`), { tenantId: "tenant-a" }));
    }

    // The sender reads the team's replies to them, never the team's notes.
    await assertSucceeds(getDocs(query(collection(owner, "feedbackMessages"), where("senderUserId", "==", "owner-a"), where("visibleToSender", "==", true))));
    await assertFails(getDocs(query(collection(owner, "feedbackMessages"), where("senderUserId", "==", "owner-a"))));
    await assertFails(getDoc(doc(owner, "feedbackMessages/note")));
    await assertFails(getDoc(doc(stranger, "feedbackMessages/reply")));
    await assertSucceeds(getDoc(doc(platform, "feedbackMessages/note")));
    await assertFails(setDoc(doc(platform, "feedbackMessages/x"), { feedbackId: "fb" }));

    // The heartbeat: one field, a string, on your own document.
    await assertSucceeds(updateDoc(doc(owner, "users/owner-a"), { lastActiveAt: new Date().toISOString() }));
    await assertFails(updateDoc(doc(owner, "users/owner-a"), { lastActiveAt: 12345 }));
    await assertFails(updateDoc(doc(owner, "users/owner-a"), { lastActiveAt: new Date().toISOString(), email: "new@a.test" }));
    await assertFails(updateDoc(doc(stranger, "users/owner-a"), { lastActiveAt: new Date().toISOString() }));
  } finally {
    await environment.cleanup();
  }
});
