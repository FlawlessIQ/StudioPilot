import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, setDoc } from "firebase/firestore";
import { getBytes, ref, uploadBytes } from "firebase/storage";

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
      });
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
        customMetadata: { scanStatus: "pending" },
      }));
      await assertFails(uploadBytes(ownPath, new Uint8Array([37, 80, 68, 70]), {
        contentType: "application/pdf",
        customMetadata: { scanStatus: "pending" },
      }));
      await assertFails(uploadBytes(
        ref(crewStorage, "tenants/tenant-a/projects/project-a/crew/other-user/file.pdf"),
        new Uint8Array([37, 80, 68, 70]),
        { contentType: "application/pdf", customMetadata: { scanStatus: "pending" } },
      ));
      await assertFails(uploadBytes(
        ref(crewStorage, "tenants/tenant-a/projects/project-private/crew/crew-a/file.pdf"),
        new Uint8Array([37, 80, 68, 70]),
        { contentType: "application/pdf", customMetadata: { scanStatus: "pending" } },
      ));
      await assertFails(uploadBytes(
        ref(crewStorage, "tenants/tenant-a/projects/project-a/crew/crew-a/script.html"),
        new TextEncoder().encode("<script>alert(1)</script>"),
        { contentType: "text/html", customMetadata: { scanStatus: "pending" } },
      ));
    } finally {
      await environment.cleanup();
    }
  },
);
