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

/**
 * The sealed copy of a StudioCue contract is written by the PDF worker at
 * tenants/{t}/projects/{p}/contracts/signed/{id}.pdf with visibility "client".
 * The couple on the job and the studio's office read it; crew do not — it
 * carries the couple's fee — and nobody overwrites or deletes it.
 */
test(
  "a sealed contract is readable by the couple and the studio, not the crew",
  { skip: !firestoreHost || !storageHost },
  async () => {
    const [firestoreAddress, firestorePort] = (firestoreHost ?? "127.0.0.1:8080").split(":");
    const [storageAddress, storagePort] = (storageHost ?? "127.0.0.1:9199").split(":");
    const environment = await initializeTestEnvironment({
      projectId: "studiohub-dev",
      firestore: {
        host: firestoreAddress,
        port: Number(firestorePort),
        rules: await readFile(new URL("../firestore.rules", import.meta.url), "utf8"),
      },
      storage: {
        host: storageAddress,
        port: Number(storagePort),
        rules: await readFile(new URL("../storage.rules", import.meta.url), "utf8"),
      },
    });
    const path = "tenants/tenant-a/projects/project-a/contracts/signed/contract-a.pdf";
    try {
      await environment.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        for (const [id, role, projectIds] of [
          ["owner-a", "studio_owner", []],
          ["client-a", "client", ["project-a"]],
          ["client-b", "client", ["project-b"]],
          ["crew-a", "staff_photographer", ["project-a"]],
          ["sub-a", "subcontractor", ["project-a"]],
        ] as const) {
          await setDoc(doc(db, `memberships/tenant-a_${id}`), {
            tenantId: "tenant-a",
            userId: id,
            status: "active",
            role,
            projectIds,
          });
        }
        await uploadBytes(ref(context.storage(), path), new Uint8Array([37, 80, 68, 70]), {
          contentType: "application/pdf",
          customMetadata: { scanStatus: "clean", visibility: "client", trustedGenerator: "studiohub-pdf" },
        });
      });
      const storageFor = (uid: string) => environment.authenticatedContext(uid).storage();
      await assertSucceeds(getBytes(ref(storageFor("client-a"), path)));
      await assertSucceeds(getBytes(ref(storageFor("owner-a"), path)));
      await assertFails(getBytes(ref(storageFor("client-b"), path)));
      await assertFails(getBytes(ref(storageFor("crew-a"), path)));
      await assertFails(getBytes(ref(storageFor("sub-a"), path)));
      await assertFails(
        uploadBytes(ref(storageFor("client-a"), path), new Uint8Array([37, 80, 68, 70]), {
          contentType: "application/pdf",
          customMetadata: { scanStatus: "clean", visibility: "client" },
        }),
      );
    } finally {
      await environment.cleanup();
    }
  },
);
