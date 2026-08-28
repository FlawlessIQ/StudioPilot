import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import test from "node:test";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, setDoc } from "firebase/firestore";
import { getBytes, getMetadata, ref, uploadBytes } from "firebase/storage";

const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
const storageHost = process.env.FIREBASE_STORAGE_EMULATOR_HOST;

test(
  "Storage rules bind crew uploads to the authenticated user and assigned project",
  { skip: !firestoreHost || !storageHost },
  async () => {
    const [firestoreAddress, firestorePortValue] = (firestoreHost ?? "127.0.0.1:8080").split(":");
    const [storageAddress, storagePortValue] = (storageHost ?? "127.0.0.1:9199").split(":");
    const environment = await initializeTestEnvironment({
      projectId: "studiohub-dev",
      firestore: {
        host: firestoreAddress,
        port: Number(firestorePortValue),
        rules: await readFile(new URL("../firestore.rules", import.meta.url), "utf8"),
      },
      storage: {
        host: storageAddress,
        port: Number(storagePortValue),
        rules: await readFile(new URL("../storage.rules", import.meta.url), "utf8"),
      },
    });
    const importPath =
      "tenants/tenant-a/studio-imports/session-a/item-a/upload-a/source.pdf";
    try {
      await environment.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), "memberships/tenant-a_crew-a"), {
          tenantId: "tenant-a", userId: "crew-a", status: "active",
          role: "subcontractor", projectIds: ["project-a"],
        });
        await setDoc(doc(context.firestore(), "memberships/tenant-a_client-a"), {
          tenantId: "tenant-a", userId: "client-a", status: "active",
          role: "client", projectIds: ["project-a"],
        });
        await setDoc(doc(context.firestore(), "memberships/tenant-a_owner-a"), {
          tenantId: "tenant-a", userId: "owner-a", status: "active",
          role: "studio_owner", projectIds: [],
        });
        await setDoc(doc(context.firestore(), "memberships/tenant-a_coordinator-a"), {
          tenantId: "tenant-a", userId: "coordinator-a", status: "active",
          role: "studio_coordinator", projectIds: ["project-a"],
        });
        await setDoc(doc(context.firestore(), "studioImportItems/item-a"), {
          tenantId: "tenant-a",
          sessionId: "session-a",
          uploadId: "upload-a",
          status: "awaiting_upload",
          expectedObjectName: importPath,
          sizeBytes: 5,
          contentType: "application/pdf",
        });
        await setDoc(doc(context.firestore(), "questionnaireResponses/response-a"), {
          tenantId: "tenant-a",
          projectId: "project-a",
          status: "in_progress",
        });
        const storage = context.storage();
        for (const [name, visibility] of [
          ["shared.pdf", "shared"],
          ["client.pdf", "client"],
          ["crew.pdf", "crew"],
          ["studio.pdf", "studio"],
        ] as const) {
          await uploadBytes(
            ref(storage, `tenants/tenant-a/projects/project-a/files/${name}`),
            new Uint8Array([37, 80, 68, 70]),
            {
              contentType: "application/pdf",
              customMetadata: { scanStatus: "clean", visibility },
            },
          );
        }
        const metadata = await getMetadata(ref(
          storage,
          "tenants/tenant-a/projects/project-a/files/shared.pdf",
        ));
        assert.equal(metadata.customMetadata?.scanStatus, "clean");
        assert.equal(metadata.customMetadata?.visibility, "shared");
      });
      const ownerReadStorage = environment.authenticatedContext("owner-a").storage();
      await assertSucceeds(getBytes(ref(
        ownerReadStorage,
        "tenants/tenant-a/projects/project-a/files/shared.pdf",
      )));
      const clientStorage = environment.authenticatedContext("client-a").storage();
      await assertSucceeds(getBytes(ref(
        clientStorage,
        "tenants/tenant-a/projects/project-a/files/shared.pdf",
      )));
      await assertSucceeds(getBytes(ref(
        clientStorage,
        "tenants/tenant-a/projects/project-a/files/client.pdf",
      )));
      await assertFails(getBytes(ref(
        clientStorage,
        "tenants/tenant-a/projects/project-a/files/crew.pdf",
      )));
      await assertFails(getBytes(ref(
        clientStorage,
        "tenants/tenant-a/projects/project-a/files/studio.pdf",
      )));
      const crewStorage = environment.authenticatedContext("crew-a").storage();
      await assertSucceeds(getBytes(ref(
        crewStorage,
        "tenants/tenant-a/projects/project-a/files/shared.pdf",
      )));
      await assertSucceeds(getBytes(ref(
        crewStorage,
        "tenants/tenant-a/projects/project-a/files/crew.pdf",
      )));
      await assertFails(getBytes(ref(
        crewStorage,
        "tenants/tenant-a/projects/project-a/files/client.pdf",
      )));
      const ownPath = ref(
        crewStorage,
        "tenants/tenant-a/projects/project-a/crew/crew-a/assignment-a/insurance.pdf",
      );
      await assertSucceeds(uploadBytes(ownPath, new Uint8Array([37, 80, 68, 70]), {
        contentType: "application/pdf",
        customMetadata: { scanStatus: "pending", visibility: "crew" },
      }));
      await assertFails(uploadBytes(ownPath, new Uint8Array([37, 80, 68, 70]), {
        contentType: "application/pdf",
        customMetadata: { scanStatus: "pending", visibility: "crew" },
      }));
      await assertFails(uploadBytes(
        ref(crewStorage, "tenants/tenant-a/projects/project-a/crew/other-user/file.pdf"),
        new Uint8Array([37, 80, 68, 70]),
        { contentType: "application/pdf", customMetadata: { scanStatus: "pending", visibility: "crew" } },
      ));
      await assertFails(uploadBytes(
        ref(crewStorage, "tenants/tenant-a/projects/project-private/crew/crew-a/file.pdf"),
        new Uint8Array([37, 80, 68, 70]),
        { contentType: "application/pdf", customMetadata: { scanStatus: "pending", visibility: "crew" } },
      ));
      await assertFails(uploadBytes(
        ref(crewStorage, "tenants/tenant-a/projects/project-a/crew/crew-a/script.html"),
        new TextEncoder().encode("<script>alert(1)</script>"),
        { contentType: "text/html", customMetadata: { scanStatus: "pending", visibility: "crew" } },
      ));
      const clientQuestionnairePath = ref(
        clientStorage,
        "tenants/tenant-a/projects/project-a/clients/client-a/questionnaires/response-a/details.pdf",
      );
      await assertSucceeds(uploadBytes(
        clientQuestionnairePath,
        new Uint8Array([37, 80, 68, 70]),
        {
          contentType: "application/pdf",
          customMetadata: {
            scanStatus: "pending",
            visibility: "client",
            tenantId: "tenant-a",
            projectId: "project-a",
            responseId: "response-a",
            fieldId: "venue-contract",
            uploaderId: "client-a",
          },
        },
      ));
      const clientMessagePath = ref(
        clientStorage,
        "tenants/tenant-a/projects/project-a/clients/client-a/messages/draft-a/reference.pdf",
      );
      await assertSucceeds(uploadBytes(
        clientMessagePath,
        new Uint8Array([37, 80, 68, 70]),
        {
          contentType: "application/pdf",
          customMetadata: {
            scanStatus: "pending",
            visibility: "shared",
            tenantId: "tenant-a",
            projectId: "project-a",
            messageDraftId: "draft-a",
            uploaderId: "client-a",
          },
        },
      ));
      await assertFails(uploadBytes(
        ref(clientStorage, "tenants/tenant-a/projects/project-a/clients/other/messages/draft-a/forged.pdf"),
        new Uint8Array([37, 80, 68, 70]),
        {
          contentType: "application/pdf",
          customMetadata: {
            scanStatus: "pending",
            visibility: "shared",
            tenantId: "tenant-a",
            projectId: "project-a",
            messageDraftId: "draft-a",
            uploaderId: "client-a",
          },
        },
      ));
      await assertFails(uploadBytes(
        ref(clientStorage, "tenants/tenant-a/projects/project-a/clients/client-a/messages/draft-b/unsafe.html"),
        new TextEncoder().encode("<script>alert(1)</script>"),
        {
          contentType: "text/html",
          customMetadata: {
            scanStatus: "pending",
            visibility: "shared",
            tenantId: "tenant-a",
            projectId: "project-a",
            messageDraftId: "draft-b",
            uploaderId: "client-a",
          },
        },
      ));
      const ownerStorage = environment.authenticatedContext("owner-a").storage();
      await assertFails(getBytes(ref(ownerStorage, clientMessagePath.fullPath)));
      await environment.withSecurityRulesDisabled(async (context) => {
        await uploadBytes(
          ref(context.storage(), clientMessagePath.fullPath),
          new Uint8Array([37, 80, 68, 70]),
          {
            contentType: "application/pdf",
            customMetadata: {
              scanStatus: "clean",
              visibility: "shared",
              tenantId: "tenant-a",
              projectId: "project-a",
              messageDraftId: "draft-a",
              uploaderId: "client-a",
            },
          },
        );
      });
      await assertSucceeds(getBytes(ref(ownerStorage, clientMessagePath.fullPath)));
      await assertSucceeds(uploadBytes(
        ref(ownerStorage, importPath),
        new Uint8Array([37, 80, 68, 70, 45]),
        {
          contentType: "application/pdf",
          customMetadata: {
            scanStatus: "pending",
            visibility: "studio",
            tenantId: "tenant-a",
            importSessionId: "session-a",
            importItemId: "item-a",
            uploadId: "upload-a",
            uploaderId: "owner-a",
          },
        },
      ));
      await assertFails(uploadBytes(
        ref(
          ownerStorage,
          "tenants/tenant-a/studio-imports/session-a/item-a/upload-forged/source.pdf",
        ),
        new Uint8Array([37, 80, 68, 70, 45]),
        {
          contentType: "application/pdf",
          customMetadata: {
            scanStatus: "pending",
            visibility: "studio",
            tenantId: "tenant-a",
            importSessionId: "session-a",
            importItemId: "item-a",
            uploadId: "upload-forged",
            uploaderId: "owner-a",
          },
        },
      ));
      await assertFails(uploadBytes(
        ref(
          environment.authenticatedContext("coordinator-a").storage(),
          "tenants/tenant-a/studio-imports/session-b/item-b/upload-b/source.pdf",
        ),
        new Uint8Array([37, 80, 68, 70, 45]),
        {
          contentType: "application/pdf",
          customMetadata: {
            scanStatus: "pending",
            visibility: "studio",
            tenantId: "tenant-a",
            importSessionId: "session-b",
            importItemId: "item-b",
            uploadId: "upload-b",
            uploaderId: "coordinator-a",
          },
        },
      ));
      await assertFails(uploadBytes(
        ref(
          ownerStorage,
          "tenants/tenant-a/studio-imports/session-c/item-c/upload-c/source.pdf",
        ),
        new Uint8Array([37, 80, 68, 70, 45]),
        {
          contentType: "application/pdf",
          customMetadata: {
            scanStatus: "clean",
            visibility: "studio",
            tenantId: "tenant-a",
            importSessionId: "session-c",
            importItemId: "item-c",
            uploadId: "upload-c",
            uploaderId: "owner-a",
          },
        },
      ));
    } finally {
      await environment.cleanup();
    }
  },
);
