import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";

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
        await setDoc(doc(adminDb, "projects/project-a"), {
          tenantId: "tenant-a",
          projectId: "project-a",
        });
        await setDoc(doc(adminDb, "projects/project-b"), {
          tenantId: "tenant-b",
          projectId: "project-b",
        });
      });

      const userDb = environment.authenticatedContext("user-a").firestore();
      await assertSucceeds(getDoc(doc(userDb, "projects/project-a")));
      await assertFails(getDoc(doc(userDb, "projects/project-b")));
      assert.ok(true);
    } finally {
      await environment.cleanup();
    }
  },
);
