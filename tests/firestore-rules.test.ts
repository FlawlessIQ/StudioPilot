import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;

test(
  "Firestore rules isolate tenants and assigned projects",
  { skip: !emulatorHost },
  async () => {
    const [host, portValue] = (emulatorHost ?? "127.0.0.1:8080").split(":");
    const port = Number(portValue);
    const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
    const environment = await initializeTestEnvironment({
      projectId: `studiohub-rules-${Date.now()}`,
      firestore: { host, port, rules },
    });

    try {
      await environment.withSecurityRulesDisabled(async (context) => {
        const adminDb = context.firestore();
        await setDoc(doc(adminDb, "memberships/tenant-a_user-a"), {
          tenantId: "tenant-a",
          userId: "user-a",
          status: "active",
          role: "staff_photographer",
          projectIds: ["project-a"],
        });
        await setDoc(doc(adminDb, "memberships/tenant-a_client-a"), {
          tenantId: "tenant-a",
          userId: "client-a",
          status: "active",
          role: "client",
          projectIds: ["project-a"],
        });
        await setDoc(doc(adminDb, "projects/project-a"), {
          tenantId: "tenant-a",
          projectId: "project-a",
        });
        await setDoc(doc(adminDb, "projects/project-b"), {
          tenantId: "tenant-b",
          projectId: "project-b",
        });
        await setDoc(doc(adminDb, "contacts/contact-a"), {
          tenantId: "tenant-a",
          projectIds: ["project-a"],
        });
        await setDoc(doc(adminDb, "contacts/contact-private"), {
          tenantId: "tenant-a",
          projectIds: ["project-private"],
        });
        await setDoc(doc(adminDb, "leads/lead-a"), {
          tenantId: "tenant-a",
        });
        await setDoc(doc(adminDb, "packages/package-a"), {
          tenantId: "tenant-a",
        });
        await setDoc(doc(adminDb, "packageSnapshots/snapshot-a"), {
          tenantId: "tenant-a",
          projectId: "project-a",
          totalCents: 680000,
          immutable: true,
        });
      });

      const userDb = environment.authenticatedContext("user-a").firestore();
      await assertSucceeds(getDoc(doc(userDb, "projects/project-a")));
      await assertFails(getDoc(doc(userDb, "projects/project-b")));
      await assertSucceeds(getDoc(doc(userDb, "contacts/contact-a")));
      await assertFails(getDoc(doc(userDb, "contacts/contact-private")));
      await assertSucceeds(getDoc(doc(userDb, "packageSnapshots/snapshot-a")));
      await assertFails(updateDoc(doc(userDb, "packageSnapshots/snapshot-a"), { totalCents: 1 }));

      const clientDb = environment.authenticatedContext("client-a").firestore();
      await assertSucceeds(getDoc(doc(clientDb, "projects/project-a")));
      await assertFails(getDoc(doc(clientDb, "leads/lead-a")));
      await assertFails(getDoc(doc(clientDb, "contacts/contact-a")));
      await assertFails(getDoc(doc(clientDb, "packages/package-a")));
      await assertSucceeds(getDoc(doc(clientDb, "packageSnapshots/snapshot-a")));
      assert.ok(true);
    } finally {
      await environment.cleanup();
    }
  },
);
