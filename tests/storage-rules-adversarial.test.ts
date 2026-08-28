import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, setDoc } from "firebase/firestore";
import { getBytes, ref, uploadBytes } from "firebase/storage";

/**
 * The adversarial half of the storage suite.
 *
 * `storage-rules.test.ts` has 25 assertions in one `test()`, all of them
 * tenant A's own members against tenant A's own paths. Nobody in a second
 * tenant, nobody unauthenticated, and no attempt to walk out of an assigned
 * folder or past the virus scanner.
 *
 * The scanner cases matter most: every read is gated on
 * `resource.metadata.scanStatus == "clean"`, and every upload must declare
 * `pending`. If an uploader could declare `clean` themselves, the gate is
 * decoration.
 */

const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
const storageHost = process.env.FIREBASE_STORAGE_EMULATOR_HOST;
const skip = !firestoreHost || !storageHost;

let environment: RulesTestEnvironment;

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
const pdf = (
  scanStatus = "pending",
  visibility = "studio",
  extra: Record<string, string> = {},
) => ({
  contentType: "application/pdf",
  customMetadata: { scanStatus, visibility, ...extra },
});

before(async () => {
  if (skip) return;
  const [fsHost, fsPort] = (firestoreHost ?? "").split(":");
  const [stHost, stPort] = (storageHost ?? "").split(":");
  environment = await initializeTestEnvironment({
    projectId: "studiohub-dev",
    firestore: {
      host: fsHost,
      port: Number(fsPort),
      rules: await readFile(new URL("../firestore.rules", import.meta.url), "utf8"),
    },
    storage: {
      host: stHost,
      port: Number(stPort),
      rules: await readFile(new URL("../storage.rules", import.meta.url), "utf8"),
    },
  });

  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    for (const [uid, role, tenant, projects] of [
      ["owner-a", "studio_owner", "tenant-a", []],
      ["crew-a", "subcontractor", "tenant-a", ["project-a"]],
      ["crew-other", "subcontractor", "tenant-a", ["project-a"]],
      ["client-a", "client", "tenant-a", ["project-a"]],
      ["client-partner", "client", "tenant-a", ["project-a"]],
      ["owner-b", "studio_owner", "tenant-b", []],
      ["crew-b", "subcontractor", "tenant-b", ["project-b"]],
    ] as const) {
      await setDoc(doc(db, `memberships/${tenant}_${uid}`), {
        tenantId: tenant,
        userId: uid,
        status: "active",
        role,
        projectIds: projects,
      });
    }

    // Files already in place, as the scanner would have left them.
    const storage = context.storage();
    await uploadBytes(
      ref(storage, "tenants/tenant-a/projects/project-a/shared-clean.pdf"),
      PDF,
      pdf("clean", "shared"),
    );
    await uploadBytes(
      ref(storage, "tenants/tenant-a/projects/project-a/studio-only.pdf"),
      PDF,
      pdf("clean", "studio"),
    );
    await uploadBytes(
      ref(storage, "tenants/tenant-a/projects/project-a/unscanned.pdf"),
      PDF,
      pdf("pending", "shared"),
    );
    await uploadBytes(
      ref(storage, "tenants/tenant-a/projects/project-a/infected.pdf"),
      PDF,
      pdf("infected", "shared"),
    );
    await uploadBytes(
      ref(storage, "tenants/tenant-a/projects/project-a/crew/crew-other/w9.pdf"),
      PDF,
      pdf("clean", "crew"),
    );
    // Client questionnaire uploads are *required* by the rules to carry
    // visibility "client", so this is the shape the product actually produces.
    await uploadBytes(
      ref(
        storage,
        "tenants/tenant-a/projects/project-a/clients/client-a/questionnaires/q-a/scan.pdf",
      ),
      PDF,
      pdf("clean", "client"),
    );
  });
});

after(async () => {
  if (!skip) await environment.cleanup();
});

const as = (uid: string) => environment.authenticatedContext(uid).storage();
const anonymous = () => environment.unauthenticatedContext().storage();

// ── The scanner gate ────────────────────────────────────────────────

test(
  "an uploader cannot declare their own file clean",
  { skip },
  async () => {
    // If this passes, every `scanStatus == "clean"` read gate is decoration.
    await assertFails(
      uploadBytes(
        ref(as("crew-a"), "tenants/tenant-a/projects/project-a/crew/crew-a/w9.pdf"),
        PDF,
        pdf("clean", "crew"),
      ),
    );
    await assertFails(
      uploadBytes(
        ref(as("owner-a"), "tenants/tenant-a/projects/project-a/brief.pdf"),
        PDF,
        pdf("clean", "studio"),
      ),
    );
  },
);

test(
  "an uploader cannot omit the scan status altogether",
  { skip },
  async () => {
    await assertFails(
      uploadBytes(
        ref(as("crew-a"), "tenants/tenant-a/projects/project-a/crew/crew-a/nometa.pdf"),
        PDF,
        { contentType: "application/pdf" },
      ),
    );
  },
);

test(
  "a file that has not been scanned, or failed, is unreadable to everyone",
  { skip },
  async () => {
    for (const uid of ["owner-a", "crew-a", "client-a"]) {
      for (const name of ["unscanned.pdf", "infected.pdf"]) {
        await assertFails(
          getBytes(ref(as(uid), `tenants/tenant-a/projects/project-a/${name}`)),
        );
      }
    }
  },
);

test(
  "nobody can relabel an infected file as clean",
  { skip },
  async () => {
    // update is allowed for operators on the project path, so the metadata has
    // to be re-declared as pending there too.
    await assertFails(
      uploadBytes(
        ref(as("owner-a"), "tenants/tenant-a/projects/project-a/infected.pdf"),
        PDF,
        pdf("clean", "shared"),
      ),
    );
  },
);

// ── Cross-tenant ────────────────────────────────────────────────────

test(
  "another studio cannot read one file of tenant A's",
  { skip },
  async () => {
    for (const uid of ["owner-b", "crew-b"]) {
      for (const path of [
        "tenants/tenant-a/projects/project-a/shared-clean.pdf",
        "tenants/tenant-a/projects/project-a/studio-only.pdf",
        "tenants/tenant-a/projects/project-a/crew/crew-other/w9.pdf",
      ]) {
        await assertFails(getBytes(ref(as(uid), path)));
      }
    }
  },
);

test(
  "another studio cannot upload into tenant A's folders",
  { skip },
  async () => {
    await assertFails(
      uploadBytes(
        ref(as("owner-b"), "tenants/tenant-a/projects/project-a/planted.pdf"),
        PDF,
        pdf(),
      ),
    );
    await assertFails(
      uploadBytes(
        ref(as("crew-b"), "tenants/tenant-a/projects/project-a/crew/crew-b/planted.pdf"),
        PDF,
        pdf(),
      ),
    );
  },
);

// ── Anonymous ───────────────────────────────────────────────────────

test("an anonymous reader gets nothing, clean or not", { skip }, async () => {
  for (const path of [
    "tenants/tenant-a/projects/project-a/shared-clean.pdf",
    "tenants/tenant-a/projects/project-a/studio-only.pdf",
    "tenants/tenant-a/projects/project-a/crew/crew-other/w9.pdf",
  ]) {
    await assertFails(getBytes(ref(anonymous(), path)));
  }
});

test("an anonymous writer cannot plant a file", { skip }, async () => {
  await assertFails(
    uploadBytes(
      ref(anonymous(), "tenants/tenant-a/projects/project-a/planted.pdf"),
      PDF,
      pdf(),
    ),
  );
  await assertFails(
    uploadBytes(ref(anonymous(), "anything/at/all.pdf"), PDF, pdf()),
  );
});

// ── Walking out of your own folder ──────────────────────────────────

test(
  "a subcontractor cannot read another one's folder",
  { skip },
  async () => {
    await assertFails(
      getBytes(
        ref(
          as("crew-a"),
          "tenants/tenant-a/projects/project-a/crew/crew-other/w9.pdf",
        ),
      ),
    );
  },
);

test(
  "one client cannot read another client's questionnaire upload",
  { skip },
  async () => {
    /**
     * The questionnaire rule restricts reads to `request.auth.uid == userId`,
     * and the catch-all project rule underneath it grants any client member of
     * the project a read on visibility "client" — which that upload is required
     * to carry. Storage grants on *any* matching rule, so the narrow rule
     * narrows nothing.
     */
    await assertFails(
      getBytes(
        ref(
          as("client-partner"),
          "tenants/tenant-a/projects/project-a/clients/client-a/questionnaires/q-a/scan.pdf",
        ),
      ),
    );
  },
);

test(
  "a subcontractor cannot see a client's questionnaire upload",
  { skip },
  async () => {
    await assertFails(
      getBytes(
        ref(
          as("crew-a"),
          "tenants/tenant-a/projects/project-a/clients/client-a/questionnaires/q-a/scan.pdf",
        ),
      ),
    );
  },
);

test(
  "a subcontractor cannot widen their own upload's visibility",
  { skip },
  async () => {
    // safeUpload() constrains size, type and scan status but not visibility, so
    // nothing stopped a W-9 being uploaded as "shared" — which the catch-all
    // rule then exposes to the couple.
    await assertFails(
      uploadBytes(
        ref(
          as("crew-a"),
          "tenants/tenant-a/projects/project-a/crew/crew-a/shared-w9.pdf",
        ),
        PDF,
        pdf("pending", "shared"),
      ),
    );
  },
);

test(
  "a subcontractor cannot upload into another one's folder",
  { skip },
  async () => {
    await assertFails(
      uploadBytes(
        ref(
          as("crew-a"),
          "tenants/tenant-a/projects/project-a/crew/crew-other/planted.pdf",
        ),
        PDF,
        pdf("pending", "crew"),
      ),
    );
  },
);

test(
  "a subcontractor cannot upload into an unassigned project",
  { skip },
  async () => {
    await assertFails(
      uploadBytes(
        ref(
          as("crew-a"),
          "tenants/tenant-a/projects/project-unassigned/crew/crew-a/w9.pdf",
        ),
        PDF,
        pdf("pending", "crew"),
      ),
    );
  },
);

test(
  "a client cannot read a studio-only file on their own project",
  { skip },
  async () => {
    await assertFails(
      getBytes(
        ref(as("client-a"), "tenants/tenant-a/projects/project-a/studio-only.pdf"),
      ),
    );
  },
);

test(
  "a client cannot upload straight into the project folder",
  { skip },
  async () => {
    // Client uploads have their own narrower path with its own size and type
    // limits; the general project folder is operators only.
    await assertFails(
      uploadBytes(
        ref(as("client-a"), "tenants/tenant-a/projects/project-a/planted.pdf"),
        PDF,
        pdf(),
      ),
    );
  },
);

test("no path outside the tenant tree is writable", { skip }, async () => {
  for (const path of [
    "anything.pdf",
    "tenants/tenant-a/loose.pdf",
    "backups/tenant-a.pdf",
  ]) {
    await assertFails(uploadBytes(ref(as("owner-a"), path), PDF, pdf()));
  }
});

// ── The control ─────────────────────────────────────────────────────

test(
  "the people who should read these files still can",
  { skip },
  async () => {
    await assertSucceeds(
      getBytes(
        ref(as("owner-a"), "tenants/tenant-a/projects/project-a/studio-only.pdf"),
      ),
    );
    await assertSucceeds(
      getBytes(
        ref(as("client-a"), "tenants/tenant-a/projects/project-a/shared-clean.pdf"),
      ),
    );
    await assertSucceeds(
      getBytes(
        ref(
          as("crew-other"),
          "tenants/tenant-a/projects/project-a/crew/crew-other/w9.pdf",
        ),
      ),
    );
  },
);

test(
  "a subcontractor can still upload into their own folder as pending",
  { skip },
  async () => {
    await assertSucceeds(
      uploadBytes(
        ref(
          as("crew-a"),
          "tenants/tenant-a/projects/project-a/crew/crew-a/insurance.pdf",
        ),
        PDF,
        pdf("pending", "crew"),
      ),
    );
  },
);
