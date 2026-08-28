import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
} from "firebase/firestore";

/**
 * The adversarial half of the rules suite.
 *
 * `firestore-rules.test.ts` seeds one tenant and authenticates six of its own
 * members, so it proves that the right people can read the right records. It
 * does not test the attack: there was no user anywhere in a *second* tenant, no
 * unauthenticated reader, and no attempt to escalate a membership — and all 121
 * of its assertions lived in a single `test()`, so the first failure hid the
 * rest of them.
 *
 * This file is the other direction. Every case here is somebody trying to reach
 * something that is not theirs, and each is its own `test()` so a regression
 * names itself instead of stopping the run.
 */

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const skip = !emulatorHost;

let environment: RulesTestEnvironment;

/** Every top-level collection the rules file governs. */
const COLLECTIONS = [
  "tenants",
  "projects",
  "contacts",
  "leads",
  "packages",
  "packageSnapshots",
  "proposals",
  "contracts",
  "invoiceReferences",
  "questionnaireResponses",
  "schedules",
  "documents",
  "messages",
  "checkpoints",
  "tasks",
  "crewProfiles",
  "crewAssignments",
  "crewMessages",
  "insuranceRequests",
  "deliveryRecords",
  "reviewRequests",
  "projectCloseouts",
  "subscriptions",
  "auditEvents",
  "commandExecutions",
];

before(async () => {
  if (skip) return;
  const [host, portValue] = (emulatorHost ?? "127.0.0.1:8080").split(":");
  const rules = await readFile(
    new URL("../firestore.rules", import.meta.url),
    "utf8",
  );
  environment = await initializeTestEnvironment({
    projectId: `studiohub-adversarial-${Date.now()}`,
    firestore: { host, port: Number(portValue), rules },
  });

  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const put = (path: string, data: Record<string, unknown>) =>
      setDoc(doc(db, path), data);

    // ── Tenant A: the victim ──────────────────────────────────────────
    await put("tenants/tenant-a", { tenantId: "tenant-a", name: "Alder" });
    for (const [uid, role] of [
      ["owner-a", "studio_owner"],
      ["photographer-a", "staff_photographer"],
      ["client-a", "client"],
      ["crew-a", "subcontractor"],
      ["suspended-a", "studio_owner"],
    ] as const) {
      await put(`memberships/tenant-a_${uid}`, {
        tenantId: "tenant-a",
        userId: uid,
        role,
        status: uid === "suspended-a" ? "suspended" : "active",
        projectIds: ["project-a"],
      });
    }

    // ── Tenant B: a real, legitimate studio that must see nothing ─────
    await put("tenants/tenant-b", { tenantId: "tenant-b", name: "Muse" });
    await put("memberships/tenant-b_owner-b", {
      tenantId: "tenant-b",
      userId: "owner-b",
      role: "studio_owner",
      status: "active",
      projectIds: ["project-b"],
    });
    await put("projects/project-b", {
      tenantId: "tenant-b",
      projectId: "project-b",
    });

    // ── Tenant A's records ────────────────────────────────────────────
    await put("projects/project-a", {
      tenantId: "tenant-a",
      projectId: "project-a",
      name: "Maya & Theo",
    });
    await put("projects/project-a2", {
      tenantId: "tenant-a",
      projectId: "project-a2",
      name: "Another couple",
    });
    await put("contacts/contact-a", {
      tenantId: "tenant-a",
      projectIds: ["project-a"],
      email: "maya@example.com",
    });
    await put("leads/lead-a", { tenantId: "tenant-a" });
    await put("packages/package-a", { tenantId: "tenant-a", priceCents: 650000 });
    await put("packageSnapshots/snapshot-a", {
      tenantId: "tenant-a",
      projectId: "project-a",
      totalCents: 650000,
    });
    await put("proposals/proposal-a", {
      tenantId: "tenant-a",
      projectId: "project-a",
      status: "accepted",
    });
    await put("contracts/contract-a", {
      tenantId: "tenant-a",
      projectId: "project-a",
      status: "completed",
    });
    await put("invoiceReferences/invoice-a", {
      tenantId: "tenant-a",
      projectId: "project-a",
      amountCents: 325000,
      balanceCents: 325000,
    });
    await put("questionnaireResponses/questionnaire-a", {
      tenantId: "tenant-a",
      projectId: "project-a",
    });
    await put("schedules/schedule-a", {
      tenantId: "tenant-a",
      projectId: "project-a",
      status: "approved",
      version: 4,
    });
    await put("documents/document-a", {
      tenantId: "tenant-a",
      projectId: "project-a",
      visibility: "studio",
    });
    await put("messages/message-a", {
      tenantId: "tenant-a",
      projectId: "project-a",
      visibility: "studio",
    });
    await put("checkpoints/checkpoint-a", {
      tenantId: "tenant-a",
      projectId: "project-a",
      visibility: "studio",
    });
    await put("tasks/task-a", { tenantId: "tenant-a", projectId: "project-a" });
    await put("crewProfiles/profile-a", { tenantId: "tenant-a", userId: "crew-a" });
    await put("crewProfiles/profile-other", {
      tenantId: "tenant-a",
      userId: "crew-other",
    });
    await put("crewAssignments/assignment-a", {
      tenantId: "tenant-a",
      projectId: "project-a",
      userId: "crew-a",
      status: "accepted",
      compensationCents: 80000,
    });
    await put("crewAssignments/assignment-other", {
      tenantId: "tenant-a",
      projectId: "project-a",
      userId: "crew-other",
      status: "accepted",
      compensationCents: 120000,
    });
    await put("crewMessages/crew-message-other", {
      tenantId: "tenant-a",
      projectId: "project-a",
      assignmentId: "assignment-other",
      userId: "crew-other",
      direction: "crew_to_studio",
    });
    await put("insuranceRequests/coi-a", {
      tenantId: "tenant-a",
      projectId: "project-a",
    });
    await put("deliveryRecords/delivery-a", {
      tenantId: "tenant-a",
      projectId: "project-a",
      status: "sent",
    });
    await put("reviewRequests/review-a", {
      tenantId: "tenant-a",
      projectId: "project-a",
      status: "sent",
    });
    await put("projectCloseouts/closeout-a", {
      tenantId: "tenant-a",
      projectId: "project-a",
      status: "blocked",
    });
    await put("subscriptions/tenant-a", { tenantId: "tenant-a", plan: "studio" });
    await put("auditEvents/audit-a", {
      tenantId: "tenant-a",
      action: "project.transitioned",
    });
    await put("commandExecutions/command-a", {
      tenantId: "tenant-a",
      type: "transitionProject",
    });
  });
});

after(async () => {
  if (!skip) await environment.cleanup();
});

const as = (uid: string, claims?: Record<string, unknown>) =>
  environment.authenticatedContext(uid, claims).firestore();
const anonymous = () => environment.unauthenticatedContext().firestore();

// ── A · Nobody signed in reads anything ──────────────────────────────

test(
  "an unauthenticated reader is refused every collection",
  { skip },
  async () => {
    const db = anonymous();
    for (const name of COLLECTIONS) {
      await assertFails(getDocs(collection(db, name)));
    }
  },
);

test(
  "an unauthenticated reader cannot fetch a document by its exact id",
  { skip },
  async () => {
    const db = anonymous();
    for (const path of [
      "tenants/tenant-a",
      "projects/project-a",
      "contacts/contact-a",
      "invoiceReferences/invoice-a",
      "documents/document-a",
      "memberships/tenant-a_owner-a",
      "subscriptions/tenant-a",
    ]) {
      await assertFails(getDoc(doc(db, path)));
    }
  },
);

test("an unauthenticated writer cannot create anything", { skip }, async () => {
  const db = anonymous();
  for (const name of COLLECTIONS) {
    await assertFails(
      setDoc(doc(db, `${name}/forged-anon`), { tenantId: "tenant-a" }),
    );
  }
});

// ── B · A legitimate owner of another studio ─────────────────────────

test(
  "another studio's owner cannot read one document of tenant A's",
  { skip },
  async () => {
    // The headline promise of a multi-tenant product, and nothing asserted it:
    // every identity in the original suite was a member of tenant A.
    const db = as("owner-b");
    for (const path of [
      "tenants/tenant-a",
      "projects/project-a",
      "contacts/contact-a",
      "leads/lead-a",
      "packages/package-a",
      "packageSnapshots/snapshot-a",
      "proposals/proposal-a",
      "contracts/contract-a",
      "invoiceReferences/invoice-a",
      "questionnaireResponses/questionnaire-a",
      "schedules/schedule-a",
      "documents/document-a",
      "messages/message-a",
      "checkpoints/checkpoint-a",
      "tasks/task-a",
      "crewProfiles/profile-a",
      "crewAssignments/assignment-a",
      "crewMessages/crew-message-other",
      "insuranceRequests/coi-a",
      "deliveryRecords/delivery-a",
      "reviewRequests/review-a",
      "projectCloseouts/closeout-a",
      "subscriptions/tenant-a",
      "auditEvents/audit-a",
      "commandExecutions/command-a",
    ]) {
      await assertFails(getDoc(doc(db, path)));
    }
  },
);

test(
  "another studio's owner cannot list any collection across the tenant boundary",
  { skip },
  async () => {
    const db = as("owner-b");
    for (const name of COLLECTIONS) {
      await assertFails(getDocs(collection(db, name)));
    }
  },
);

test(
  "another studio's owner cannot write to tenant A's records",
  { skip },
  async () => {
    const db = as("owner-b");
    await assertFails(updateDoc(doc(db, "projects/project-a"), { name: "mine" }));
    await assertFails(
      updateDoc(doc(db, "contacts/contact-a"), { email: "attacker@example.com" }),
    );
    await assertFails(
      updateDoc(doc(db, "invoiceReferences/invoice-a"), { balanceCents: 0 }),
    );
    await assertFails(deleteDoc(doc(db, "projects/project-a")));
  },
);

test(
  "another studio's owner cannot read tenant A's memberships",
  { skip },
  async () => {
    const db = as("owner-b");
    for (const uid of ["owner-a", "photographer-a", "client-a", "crew-a"]) {
      await assertFails(getDoc(doc(db, `memberships/tenant-a_${uid}`)));
    }
  },
);

// ── C · Forging a record into somebody else's tenant ─────────────────

test(
  "an owner cannot create a record stamped with another tenant's id",
  { skip },
  async () => {
    const db = as("owner-a");
    await assertFails(
      setDoc(doc(db, "projects/forged-b"), {
        tenantId: "tenant-b",
        projectId: "forged-b",
      }),
    );
    await assertFails(
      setDoc(doc(db, "contacts/forged-b"), {
        tenantId: "tenant-b",
        projectIds: ["project-b"],
      }),
    );
  },
);

test(
  "an owner cannot move one of their own records into another tenant",
  { skip },
  async () => {
    const db = as("owner-a");
    await assertFails(
      updateDoc(doc(db, "projects/project-a"), { tenantId: "tenant-b" }),
    );
    await assertFails(
      updateDoc(doc(db, "contacts/contact-a"), { tenantId: "tenant-b" }),
    );
    await assertFails(
      updateDoc(doc(db, "tenants/tenant-a"), { tenantId: "tenant-b" }),
    );
  },
);

// ── D · Escalating your own membership ───────────────────────────────

test(
  "a photographer cannot promote themselves",
  { skip },
  async () => {
    const db = as("photographer-a");
    await assertFails(
      updateDoc(doc(db, "memberships/tenant-a_photographer-a"), {
        role: "studio_owner",
      }),
    );
    await assertFails(
      updateDoc(doc(db, "memberships/tenant-a_photographer-a"), {
        projectIds: ["project-a", "project-a2"],
      }),
    );
  },
);

test(
  "a photographer cannot mint themselves a membership in another tenant",
  { skip },
  async () => {
    const db = as("photographer-a");
    await assertFails(
      setDoc(doc(db, "memberships/tenant-b_photographer-a"), {
        tenantId: "tenant-b",
        userId: "photographer-a",
        role: "studio_owner",
        status: "active",
        projectIds: [],
      }),
    );
  },
);

test(
  "a client cannot promote themselves out of being a client",
  { skip },
  async () => {
    const db = as("client-a");
    await assertFails(
      updateDoc(doc(db, "memberships/tenant-a_client-a"), {
        role: "studio_owner",
      }),
    );
  },
);

test(
  "a subcontractor cannot widen their own project list",
  { skip },
  async () => {
    const db = as("crew-a");
    await assertFails(
      updateDoc(doc(db, "memberships/tenant-a_crew-a"), {
        projectIds: ["project-a", "project-a2"],
      }),
    );
  },
);

test(
  "nobody can rewrite a membership's userId out from under its document id",
  { skip },
  async () => {
    /**
     * `create` enforces that the document id is `${tenantId}_${userId}` — the
     * denormalization the whole rules file depends on to resolve one
     * deterministic membership without a query. `update` only checks that
     * tenantId is unchanged, so nothing stopped the id and the field from being
     * made to disagree.
     */
    for (const uid of ["owner-a", "photographer-a"]) {
      await assertFails(
        updateDoc(doc(as(uid), "memberships/tenant-a_photographer-a"), {
          userId: "somebody-else",
        }),
      );
    }
  },
);

// ── E · A suspended member is not a member ───────────────────────────

test(
  "a suspended owner has no more access than a stranger",
  { skip },
  async () => {
    const db = as("suspended-a");
    for (const path of [
      "tenants/tenant-a",
      "projects/project-a",
      "contacts/contact-a",
      "invoiceReferences/invoice-a",
      "subscriptions/tenant-a",
    ]) {
      await assertFails(getDoc(doc(db, path)));
    }
    await assertFails(
      updateDoc(doc(db, "projects/project-a"), { name: "still here" }),
    );
  },
);

// ── F · A client reaching past their own project ─────────────────────

test(
  "a client cannot read another project in the same studio",
  { skip },
  async () => {
    const db = as("client-a");
    await assertFails(getDoc(doc(db, "projects/project-a2")));
    await assertFails(getDocs(collection(db, "projects")));
  },
);

test(
  "a client cannot read the studio's commercial records",
  { skip },
  async () => {
    const db = as("client-a");
    for (const path of [
      "leads/lead-a",
      "packages/package-a",
      "auditEvents/audit-a",
      "commandExecutions/command-a",
      "subscriptions/tenant-a",
      "crewAssignments/assignment-a",
    ]) {
      await assertFails(getDoc(doc(db, path)));
    }
  },
);

test("a client cannot settle their own invoice", { skip }, async () => {
  const db = as("client-a");
  await assertFails(
    updateDoc(doc(db, "invoiceReferences/invoice-a"), { balanceCents: 0 }),
  );
  await assertFails(
    updateDoc(doc(db, "contracts/contract-a"), { status: "completed" }),
  );
});

// ── G · A subcontractor reaching past their own assignment ───────────

test(
  "a subcontractor cannot read another crew member's assignment or pay",
  { skip },
  async () => {
    const db = as("crew-a");
    await assertFails(getDoc(doc(db, "crewAssignments/assignment-other")));
    await assertFails(getDoc(doc(db, "crewProfiles/profile-other")));
    await assertFails(getDoc(doc(db, "crewMessages/crew-message-other")));
  },
);

test(
  "a subcontractor cannot read the studio's money or client records",
  { skip },
  async () => {
    const db = as("crew-a");
    for (const path of [
      "invoiceReferences/invoice-a",
      "proposals/proposal-a",
      "contracts/contract-a",
      "packageSnapshots/snapshot-a",
      "contacts/contact-a",
      "leads/lead-a",
      "subscriptions/tenant-a",
    ]) {
      await assertFails(getDoc(doc(db, path)));
    }
  },
);

test(
  "a subcontractor cannot accept their own assignment by writing to Firestore",
  { skip },
  async () => {
    // Acceptance runs through crewCommand so the cascade, conflicts and expiry
    // are all evaluated server-side. The browser must not be a second door.
    const db = as("crew-a");
    await assertFails(
      updateDoc(doc(db, "crewAssignments/assignment-a"), { status: "accepted" }),
    );
    await assertFails(
      updateDoc(doc(db, "crewAssignments/assignment-a"), {
        compensationCents: 500000,
      }),
    );
  },
);

// ── H · Records only a Cloud Function may create ─────────────────────

test(
  "no browser identity can create the server-owned collections",
  { skip },
  async () => {
    for (const uid of ["owner-a", "photographer-a", "client-a", "crew-a"]) {
      const db = as(uid);
      for (const name of [
        "leads",
        "packages",
        "packageSnapshots",
        "commandExecutions",
        "auditEvents",
        "rateLimitCounters",
      ]) {
        await assertFails(
          setDoc(doc(db, `${name}/forged-by-${uid}`), {
            tenantId: "tenant-a",
            projectId: "project-a",
          }),
        );
      }
    }
  },
);

test("an immutable record cannot be rewritten", { skip }, async () => {
  const db = as("owner-a");
  await assertFails(
    updateDoc(doc(db, "packageSnapshots/snapshot-a"), { totalCents: 1 }),
  );
  await assertFails(
    updateDoc(doc(db, "auditEvents/audit-a"), { action: "nothing.happened" }),
  );
  await assertFails(
    updateDoc(doc(db, "commandExecutions/command-a"), { type: "somethingElse" }),
  );
});

test("nothing at all can be deleted from the browser", { skip }, async () => {
  const db = as("owner-a");
  for (const path of [
    "projects/project-a",
    "contacts/contact-a",
    "leads/lead-a",
    "proposals/proposal-a",
    "contracts/contract-a",
    "invoiceReferences/invoice-a",
    "packageSnapshots/snapshot-a",
    "auditEvents/audit-a",
    "crewProfiles/profile-a",
    "memberships/tenant-a_photographer-a",
  ]) {
    await assertFails(deleteDoc(doc(db, path)));
  }
});

// ── I · The platform-admin claim ─────────────────────────────────────

test(
  "the platform-admin claim is what grants platform access, not a role name",
  { skip },
  async () => {
    // An owner is the most privileged role inside a tenant and must still be
    // refused another tenant's records; the claim is a separate axis.
    await assertFails(getDoc(doc(as("owner-a"), "tenants/tenant-b")));
    await assertSucceeds(
      getDoc(doc(as("someone", { platformAdmin: true }), "tenants/tenant-b")),
    );
  },
);

test(
  "a forged non-boolean platform-admin claim does not pass",
  { skip },
  async () => {
    for (const claim of ["true", 1, {}, ["true"]]) {
      await assertFails(
        getDoc(doc(as("forger", { platformAdmin: claim }), "tenants/tenant-b")),
      );
    }
  },
);

// ── J · The control: the right people still get through ──────────────

test(
  "tenant A's owner can still read tenant A",
  { skip },
  async () => {
    // A rules file that denies everything would pass every test above.
    const db = as("owner-a");
    await assertSucceeds(getDoc(doc(db, "tenants/tenant-a")));
    await assertSucceeds(getDoc(doc(db, "projects/project-a")));
    await assertSucceeds(getDoc(doc(db, "contacts/contact-a")));
    await assertSucceeds(getDoc(doc(db, "invoiceReferences/invoice-a")));
    await assertSucceeds(
      getDoc(doc(db, "memberships/tenant-a_photographer-a")),
    );
  },
);

test(
  "tenant B's owner can still read tenant B",
  { skip },
  async () => {
    const db = as("owner-b");
    await assertSucceeds(getDoc(doc(db, "tenants/tenant-b")));
    await assertSucceeds(getDoc(doc(db, "projects/project-b")));
  },
);

test(
  "a subcontractor can still read their own assignment and profile",
  { skip },
  async () => {
    const db = as("crew-a");
    await assertSucceeds(getDoc(doc(db, "crewAssignments/assignment-a")));
    await assertSucceeds(getDoc(doc(db, "crewProfiles/profile-a")));
    await assertSucceeds(getDoc(doc(db, "projects/project-a")));
  },
);
