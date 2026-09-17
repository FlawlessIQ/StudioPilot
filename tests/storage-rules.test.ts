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

/**
 * A file dropped into Cue is staged for one server-side reading, then deleted.
 *
 * It is usually a signed client agreement, so the folder is as narrow as the
 * one thing a reading can lead to — recording a signature, which only owners
 * and admins may do — and no browser may read it back at all.
 */
test(
  "Storage rules stage Cue attachments for owners and admins, write-once and unreadable",
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
    const pdf = new Uint8Array([37, 80, 68, 70]);
    const staged = (visibility = "studio") => ({
      contentType: "application/pdf",
      customMetadata: { scanStatus: "pending", visibility },
    });
    try {
      await environment.withSecurityRulesDisabled(async (context) => {
        for (const [userId, role] of [
          ["owner-a", "studio_owner"],
          ["admin-a", "studio_admin"],
          ["coordinator-a", "studio_coordinator"],
          ["crew-a", "subcontractor"],
          ["client-a", "client"],
        ] as const) {
          await setDoc(doc(context.firestore(), `memberships/tenant-a_${userId}`), {
            tenantId: "tenant-a", userId, status: "active", role, projectIds: ["project-a"],
          });
        }
        await setDoc(doc(context.firestore(), "memberships/tenant-b_owner-b"), {
          tenantId: "tenant-b", userId: "owner-b", status: "active",
          role: "studio_owner", projectIds: [],
        });
        await uploadBytes(
          ref(context.storage(), "tenants/tenant-a/cueAttachments/owner-a/cleared.pdf"),
          pdf,
          { contentType: "application/pdf", customMetadata: { scanStatus: "clean", visibility: "studio" } },
        );
      });

      const owner = environment.authenticatedContext("owner-a").storage();
      const admin = environment.authenticatedContext("admin-a").storage();
      const folder = "tenants/tenant-a/cueAttachments";

      // Owners and admins stage into their own folder.
      await assertSucceeds(uploadBytes(ref(owner, `${folder}/owner-a/signed.pdf`), pdf, staged()));
      await assertSucceeds(uploadBytes(ref(admin, `${folder}/admin-a/signed.pdf`), pdf, staged()));

      // Never into somebody else's, which the reader would then act on.
      await assertFails(uploadBytes(ref(owner, `${folder}/admin-a/planted.pdf`), pdf, staged()));
      // Nor across tenants.
      await assertFails(uploadBytes(
        ref(environment.authenticatedContext("owner-b").storage(), `${folder}/owner-b/signed.pdf`),
        pdf,
        staged(),
      ));

      // Nobody who cannot record a signature can stage one to be read.
      for (const userId of ["coordinator-a", "crew-a", "client-a"]) {
        await assertFails(uploadBytes(
          ref(environment.authenticatedContext(userId).storage(), `${folder}/${userId}/signed.pdf`),
          pdf,
          staged(),
        ));
      }

      // It is studio-only: filed as shared, the couple or the crew could be meant to see it.
      await assertFails(uploadBytes(ref(owner, `${folder}/owner-a/shared.pdf`), pdf, staged("shared")));
      // It cannot skip the scan.
      await assertFails(uploadBytes(ref(owner, `${folder}/owner-a/unscanned.pdf`), pdf, {
        contentType: "application/pdf",
        customMetadata: { scanStatus: "clean", visibility: "studio" },
      }));
      // Write-once: no overwriting a staged file in place.
      await assertFails(uploadBytes(ref(owner, `${folder}/owner-a/cleared.pdf`), pdf, staged()));

      // And nobody reads it back — not even whoever staged it, once cleared.
      await assertFails(getBytes(ref(owner, `${folder}/owner-a/cleared.pdf`)));
    } finally {
      await environment.cleanup();
    }
  },
);
