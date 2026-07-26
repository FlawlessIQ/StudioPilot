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
        await setDoc(doc(adminDb, "memberships/tenant-a_owner-a"), {
          tenantId: "tenant-a",
          userId: "owner-a",
          status: "active",
          role: "studio_owner",
          projectIds: ["project-a"],
        });
        await setDoc(doc(adminDb, "memberships/tenant-a_coordinator-a"), {
          tenantId: "tenant-a",
          userId: "coordinator-a",
          status: "active",
          role: "studio_coordinator",
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
        await setDoc(doc(adminDb, "projects/project-unassigned"), {
          tenantId: "tenant-a",
          projectId: "project-unassigned",
          updatedAt: "before",
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
        await setDoc(doc(adminDb, "workflowTemplates/workflow-a"), {
          tenantId: "tenant-a",
          status: "active",
        });
        await setDoc(doc(adminDb, "workflowRuns/run-a"), {
          tenantId: "tenant-a",
          projectId: "project-a",
        });
        await setDoc(doc(adminDb, "checkpoints/shared-a"), {
          tenantId: "tenant-a",
          projectId: "project-a",
          visibility: "shared",
          status: "ready",
        });
        await setDoc(doc(adminDb, "checkpoints/studio-a"), {
          tenantId: "tenant-a",
          projectId: "project-a",
          visibility: "studio",
          status: "ready",
        });
        await setDoc(doc(adminDb, "tasks/task-a"), {
          tenantId: "tenant-a",
          projectId: "project-a",
          status: "not_started",
        });
        await setDoc(doc(adminDb, "readinessAssessments/project-a"), {
          tenantId: "tenant-a",
          projectId: "project-a",
          ready: false,
        });
        await setDoc(doc(adminDb, "automationRuns/run-a"), {
          tenantId: "tenant-a",
          status: "succeeded",
        });
        await setDoc(doc(adminDb, "consultations/consultation-a"), {
          tenantId: "tenant-a",
          projectId: "project-a",
        });
        await setDoc(doc(adminDb, "proposals/proposal-a"), {
          tenantId: "tenant-a",
          projectId: "project-a",
          status: "sent",
        });
        await setDoc(doc(adminDb, "contracts/contract-a"), {
          tenantId: "tenant-a",
          projectId: "project-a",
          status: "partially_signed",
        });
        await setDoc(doc(adminDb, "invoiceReferences/invoice-a"), {
          tenantId: "tenant-a",
          projectId: "project-a",
          status: "sent",
        });
        await setDoc(doc(adminDb, "documents/document-client"), {
          tenantId: "tenant-a",
          projectId: "project-a",
          visibility: "client",
        });
        await setDoc(doc(adminDb, "documents/document-studio"), {
          tenantId: "tenant-a",
          projectId: "project-a",
          visibility: "studio",
        });
        await setDoc(doc(adminDb, "integrationConnections/connection-a"), {
          tenantId: "tenant-a",
          provider: "quickbooks",
        });
      });

      const userDb = environment.authenticatedContext("user-a").firestore();
      await assertSucceeds(getDoc(doc(userDb, "projects/project-a")));
      await assertFails(getDoc(doc(userDb, "projects/project-b")));
      await assertSucceeds(getDoc(doc(userDb, "contacts/contact-a")));
      await assertFails(getDoc(doc(userDb, "contacts/contact-private")));
      await assertSucceeds(getDoc(doc(userDb, "packageSnapshots/snapshot-a")));
      await assertFails(updateDoc(doc(userDb, "packageSnapshots/snapshot-a"), { totalCents: 1 }));
      await assertSucceeds(getDoc(doc(userDb, "checkpoints/studio-a")));
      await assertSucceeds(getDoc(doc(userDb, "tasks/task-a")));
      await assertSucceeds(getDoc(doc(userDb, "readinessAssessments/project-a")));
      await assertFails(
        updateDoc(doc(userDb, "checkpoints/studio-a"), { status: "complete" }),
      );
      await assertFails(getDoc(doc(userDb, "consultations/consultation-a")));
      await assertFails(getDoc(doc(userDb, "invoiceReferences/invoice-a")));

      const clientDb = environment.authenticatedContext("client-a").firestore();
      await assertSucceeds(getDoc(doc(clientDb, "projects/project-a")));
      await assertFails(getDoc(doc(clientDb, "leads/lead-a")));
      await assertFails(getDoc(doc(clientDb, "contacts/contact-a")));
      await assertFails(getDoc(doc(clientDb, "packages/package-a")));
      await assertSucceeds(getDoc(doc(clientDb, "packageSnapshots/snapshot-a")));
      await assertSucceeds(getDoc(doc(clientDb, "checkpoints/shared-a")));
      await assertFails(getDoc(doc(clientDb, "checkpoints/studio-a")));
      await assertFails(getDoc(doc(clientDb, "tasks/task-a")));
      await assertFails(getDoc(doc(clientDb, "readinessAssessments/project-a")));
      await assertSucceeds(getDoc(doc(clientDb, "proposals/proposal-a")));
      await assertSucceeds(getDoc(doc(clientDb, "contracts/contract-a")));
      await assertSucceeds(getDoc(doc(clientDb, "invoiceReferences/invoice-a")));
      await assertSucceeds(getDoc(doc(clientDb, "documents/document-client")));
      await assertFails(getDoc(doc(clientDb, "documents/document-studio")));
      await assertFails(getDoc(doc(clientDb, "integrationConnections/connection-a")));
      await assertSucceeds(getDoc(doc(clientDb, "consultations/consultation-a")));

      const ownerDb = environment.authenticatedContext("owner-a").firestore();
      await assertSucceeds(getDoc(doc(ownerDb, "workflowTemplates/workflow-a")));
      await assertSucceeds(getDoc(doc(ownerDb, "automationRuns/run-a")));
      await assertSucceeds(getDoc(doc(ownerDb, "integrationConnections/connection-a")));
      await assertFails(
        updateDoc(doc(ownerDb, "contracts/contract-a"), { status: "completed" }),
      );
      await assertFails(
        updateDoc(doc(ownerDb, "workflowTemplates/workflow-a"), { status: "archived" }),
      );

      const coordinatorDb = environment.authenticatedContext("coordinator-a").firestore();
      await assertSucceeds(
        updateDoc(doc(coordinatorDb, "projects/project-a"), { updatedAt: "after" }),
      );
      await assertFails(
        updateDoc(doc(coordinatorDb, "projects/project-unassigned"), {
          updatedAt: "after",
        }),
      );
      assert.ok(true);
    } finally {
      await environment.cleanup();
    }
  },
);
