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
        await setDoc(doc(adminDb, "memberships/tenant-a_crew-a"), {
          tenantId: "tenant-a",
          userId: "crew-a",
          status: "active",
          role: "subcontractor",
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
        await setDoc(doc(adminDb, "questionnaireResponses/questionnaire-a"), { tenantId: "tenant-a", projectId: "project-a" });
        await setDoc(doc(adminDb, "vendors/vendor-a"), { tenantId: "tenant-a", projectIds: ["project-a"] });
        await setDoc(doc(adminDb, "insuranceRequests/coi-a"), { tenantId: "tenant-a", projectId: "project-a" });
        await setDoc(doc(adminDb, "schedules/schedule-a"), { tenantId: "tenant-a", projectId: "project-a", status: "client_review" });
        await setDoc(doc(adminDb, "crewProfiles/profile-a"), { tenantId: "tenant-a", userId: "crew-a" });
        await setDoc(doc(adminDb, "crewProfiles/profile-private"), { tenantId: "tenant-a", userId: "crew-private" });
        await setDoc(doc(adminDb, "crewAssignments/assignment-a"), { tenantId: "tenant-a", projectId: "project-a", userId: "crew-a", status: "accepted" });
        await setDoc(doc(adminDb, "crewAssignments/assignment-private"), { tenantId: "tenant-a", projectId: "project-a", userId: "crew-private", status: "accepted" });
        await setDoc(doc(adminDb, "crewAvailability/availability-a"), { tenantId: "tenant-a", crewProfileId: "profile-a", userId: "crew-a" });
        await setDoc(doc(adminDb, "postProductionRecords/post-a"), { tenantId: "tenant-a", projectId: "project-a", currentStep: "editing_started" });
        await setDoc(doc(adminDb, "deliveryRecords/delivery-a"), { tenantId: "tenant-a", projectId: "project-a", status: "sent" });
        await setDoc(doc(adminDb, "reviewRequests/review-a"), { tenantId: "tenant-a", projectId: "project-a", status: "clicked" });
        await setDoc(doc(adminDb, "projectCloseouts/closeout-a"), { tenantId: "tenant-a", projectId: "project-a", status: "blocked" });
        await setDoc(doc(adminDb, "subscriptions/tenant-a"), { tenantId: "tenant-a", plan: "studio", status: "active" });
        await setDoc(doc(adminDb, "tenantInvitations/invite-a"), { tenantId: "tenant-a", email: "staff@example.test", status: "pending" });
        await setDoc(doc(adminDb, "clientInvitations/client-invite-a"), { tenantId: "tenant-a", projectId: "project-a", tokenHash: "server-only", status: "pending" });
        await setDoc(doc(adminDb, "messages/message-studio"), { tenantId: "tenant-a", projectId: "project-a", visibility: "studio" });
        await setDoc(doc(adminDb, "messages/message-shared"), { tenantId: "tenant-a", projectId: "project-a", visibility: "shared" });
        await setDoc(doc(adminDb, "usageCounters/tenant-a_2026-07"), { tenantId: "tenant-a", period: "2026-07", aiActions: 1200 });
        await setDoc(doc(adminDb, "featureFlags/advanced-ai"), { key: "advanced-ai", enabled: true, tenantIds: ["tenant-a"] });
        await setDoc(doc(adminDb, "supportAccess/support-a"), { tenantId: "tenant-a", platformUserId: "platform-a", status: "active" });
        await setDoc(doc(adminDb, "systemHealth/health-a"), { tenantId: "tenant-a", status: "healthy" });
      });

      const userDb = environment.authenticatedContext("user-a").firestore();
      await assertSucceeds(getDoc(doc(userDb, "projects/project-a")));
      await assertFails(getDoc(doc(userDb, "projects/project-b")));
      await assertSucceeds(getDoc(doc(userDb, "contacts/contact-a")));
      await assertFails(getDoc(doc(userDb, "contacts/contact-private")));
      await assertFails(getDoc(doc(userDb, "packageSnapshots/snapshot-a")));
      await assertFails(updateDoc(doc(userDb, "packageSnapshots/snapshot-a"), { totalCents: 1 }));
      await assertSucceeds(getDoc(doc(userDb, "checkpoints/studio-a")));
      await assertSucceeds(getDoc(doc(userDb, "tasks/task-a")));
      await assertSucceeds(getDoc(doc(userDb, "readinessAssessments/project-a")));
      await assertFails(
        updateDoc(doc(userDb, "checkpoints/studio-a"), { status: "complete" }),
      );
      await assertFails(getDoc(doc(userDb, "consultations/consultation-a")));
      await assertFails(getDoc(doc(userDb, "invoiceReferences/invoice-a")));
      await assertSucceeds(getDoc(doc(userDb, "schedules/schedule-a")));
      await assertSucceeds(getDoc(doc(userDb, "vendors/vendor-a")));
      await assertFails(getDoc(doc(userDb, "insuranceRequests/coi-a")));
      await assertSucceeds(getDoc(doc(userDb, "postProductionRecords/post-a")));
      await assertFails(getDoc(doc(userDb, "deliveryRecords/delivery-a")));

      const proposalCoordinatorDb = environment
        .authenticatedContext("coordinator-a")
        .firestore();
      await assertSucceeds(
        getDoc(doc(proposalCoordinatorDb, "proposals/proposal-a")),
      );
      await assertFails(
        updateDoc(doc(proposalCoordinatorDb, "proposals/proposal-a"), {
          status: "sent",
        }),
      );

      const proposalOwnerDb = environment
        .authenticatedContext("owner-a")
        .firestore();
      await assertSucceeds(
        getDoc(doc(proposalOwnerDb, "proposals/proposal-a")),
      );
      await assertFails(
        updateDoc(doc(proposalOwnerDb, "proposals/proposal-a"), {
          status: "approved",
        }),
      );

      const clientDb = environment.authenticatedContext("client-a").firestore();
      await assertFails(getDoc(doc(clientDb, "projects/project-a")));
      await assertFails(getDoc(doc(clientDb, "workflowRuns/run-a")));
      await assertFails(getDoc(doc(clientDb, "leads/lead-a")));
      await assertFails(getDoc(doc(clientDb, "contacts/contact-a")));
      await assertFails(getDoc(doc(clientDb, "packages/package-a")));
      await assertFails(getDoc(doc(clientDb, "packageSnapshots/snapshot-a")));
      await assertFails(getDoc(doc(clientDb, "checkpoints/shared-a")));
      await assertFails(getDoc(doc(clientDb, "checkpoints/studio-a")));
      await assertFails(getDoc(doc(clientDb, "tasks/task-a")));
      await assertFails(getDoc(doc(clientDb, "readinessAssessments/project-a")));
      await assertFails(getDoc(doc(clientDb, "proposals/proposal-a")));
      await assertFails(getDoc(doc(clientDb, "contracts/contract-a")));
      await assertFails(getDoc(doc(clientDb, "invoiceReferences/invoice-a")));
      await assertFails(getDoc(doc(clientDb, "documents/document-client")));
      await assertFails(getDoc(doc(clientDb, "documents/document-studio")));
      await assertFails(getDoc(doc(clientDb, "integrationConnections/connection-a")));
      await assertSucceeds(getDoc(doc(clientDb, "consultations/consultation-a")));
      await assertFails(getDoc(doc(clientDb, "questionnaireResponses/questionnaire-a")));
      await assertFails(getDoc(doc(clientDb, "schedules/schedule-a")));
      await assertFails(getDoc(doc(clientDb, "insuranceRequests/coi-a")));
      await assertFails(updateDoc(doc(clientDb, "schedules/schedule-a"), { status: "approved" }));
      await assertFails(getDoc(doc(clientDb, "postProductionRecords/post-a")));
      await assertFails(getDoc(doc(clientDb, "deliveryRecords/delivery-a")));
      await assertFails(getDoc(doc(clientDb, "reviewRequests/review-a")));
      await assertFails(getDoc(doc(clientDb, "projectCloseouts/closeout-a")));
      await assertFails(updateDoc(doc(clientDb, "reviewRequests/review-a"), { status: "client_confirmed" }));
      await assertFails(getDoc(doc(clientDb, "subscriptions/tenant-a")));
      await assertFails(getDoc(doc(clientDb, "usageCounters/tenant-a_2026-07")));
      await assertFails(getDoc(doc(clientDb, "tenantInvitations/invite-a")));
      await assertFails(getDoc(doc(clientDb, "clientInvitations/client-invite-a")));
      await assertFails(getDoc(doc(clientDb, "messages/message-studio")));
      await assertFails(getDoc(doc(clientDb, "messages/message-shared")));

      const crewDb = environment.authenticatedContext("crew-a").firestore();
      await assertSucceeds(getDoc(doc(crewDb, "projects/project-a")));
      await assertSucceeds(getDoc(doc(crewDb, "crewProfiles/profile-a")));
      await assertFails(getDoc(doc(crewDb, "crewProfiles/profile-private")));
      await assertSucceeds(getDoc(doc(crewDb, "crewAssignments/assignment-a")));
      await assertFails(getDoc(doc(crewDb, "crewAssignments/assignment-private")));
      await assertSucceeds(getDoc(doc(crewDb, "crewAvailability/availability-a")));
      await assertFails(updateDoc(doc(crewDb, "crewAssignments/assignment-a"), { status: "completed" }));
      await assertFails(getDoc(doc(crewDb, "invoiceReferences/invoice-a")));

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
      await assertSucceeds(getDoc(doc(ownerDb, "subscriptions/tenant-a")));
      await assertSucceeds(getDoc(doc(ownerDb, "usageCounters/tenant-a_2026-07")));
      await assertSucceeds(getDoc(doc(ownerDb, "systemHealth/health-a")));
      await assertSucceeds(getDoc(doc(ownerDb, "tenantInvitations/invite-a")));
      await assertFails(getDoc(doc(ownerDb, "clientInvitations/client-invite-a")));
      await assertSucceeds(getDoc(doc(ownerDb, "messages/message-studio")));
      await assertFails(
        updateDoc(doc(ownerDb, "tenantInvitations/invite-a"), { status: "accepted" }),
      );
      await assertFails(getDoc(doc(ownerDb, "featureFlags/advanced-ai")));

      const platformDb = environment.authenticatedContext("platform-a", { platformAdmin: true }).firestore();
      await assertSucceeds(getDoc(doc(platformDb, "featureFlags/advanced-ai")));
      await assertSucceeds(getDoc(doc(platformDb, "supportAccess/support-a")));
      await assertFails(getDoc(doc(platformDb, "projects/project-a")));
      await assertFails(getDoc(doc(platformDb, "contacts/contact-a")));

      const coordinatorDb = environment.authenticatedContext("coordinator-a").firestore();
      await assertSucceeds(getDoc(doc(coordinatorDb, "messages/message-studio")));
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
