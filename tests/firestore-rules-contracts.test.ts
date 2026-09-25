import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;

/**
 * StudioCue's own contracts. A signature record is evidence the booking gate
 * relies on (ADR 0006), so nobody — not the couple, not the studio owner —
 * can write, change or delete one from a browser. Drafts and the agreement
 * are the studio's; the couple reads their contract only through the portal
 * route, which filters it.
 */
test(
  "contract signatures, drafts, agreements and feature switches are server-written only",
  { skip: !emulatorHost },
  async () => {
    const [host, portValue] = (emulatorHost ?? "127.0.0.1:8080").split(":");
    const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
    const environment = await initializeTestEnvironment({
      projectId: `studiohub-contract-rules-${Date.now()}`,
      firestore: { host, port: Number(portValue), rules },
    });
    try {
      await environment.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        const member = (id: string, role: string) =>
          setDoc(doc(db, `memberships/tenant-a_${id}`), {
            tenantId: "tenant-a",
            userId: id,
            status: "active",
            role,
            projectIds: ["project-a"],
          });
        await member("owner-a", "studio_owner");
        await member("coordinator-a", "studio_coordinator");
        await member("crew-a", "staff_photographer");
        await member("client-a", "client");
        await setDoc(doc(db, "memberships/tenant-b_owner-b"), {
          tenantId: "tenant-b",
          userId: "owner-b",
          status: "active",
          role: "studio_owner",
          projectIds: [],
        });
        await setDoc(doc(db, "contractSignatures/contract-a_client"), {
          id: "contract-a_client",
          tenantId: "tenant-a",
          projectId: "project-a",
          contractId: "contract-a",
          role: "client",
          typedName: "Erin Walsh",
        });
        await setDoc(doc(db, "contractDrafts/project-a"), {
          id: "project-a",
          tenantId: "tenant-a",
          projectId: "project-a",
          status: "draft",
        });
        await setDoc(doc(db, "agreementTemplates/agreement-a"), {
          id: "agreement-a",
          tenantId: "tenant-a",
          name: "Wedding agreement",
        });
        await setDoc(doc(db, "agreementTemplateVersions/agreement-a_v1"), {
          id: "agreement-a_v1",
          tenantId: "tenant-a",
          templateId: "agreement-a",
          body: "…",
        });
        await setDoc(doc(db, "tenantFeatures/tenant-a"), {
          tenantId: "tenant-a",
          nativeContractSigning: true,
        });
      });

      const as = (uid: string) => environment.authenticatedContext(uid).firestore();
      const owner = as("owner-a");
      const coordinator = as("coordinator-a");
      const crew = as("crew-a");
      const client = as("client-a");
      const otherOwner = as("owner-b");

      // Signatures: the owner reads the evidence; nobody writes it.
      await assertSucceeds(getDoc(doc(owner, "contractSignatures/contract-a_client")));
      await assertFails(getDoc(doc(client, "contractSignatures/contract-a_client")));
      await assertFails(getDoc(doc(crew, "contractSignatures/contract-a_client")));
      await assertFails(getDoc(doc(otherOwner, "contractSignatures/contract-a_client")));
      for (const db of [owner, client]) {
        await assertFails(
          setDoc(doc(db, "contractSignatures/forged"), {
            tenantId: "tenant-a",
            projectId: "project-a",
            contractId: "contract-a",
            role: "client",
          }),
        );
        await assertFails(updateDoc(doc(db, "contractSignatures/contract-a_client"), { typedName: "X" }));
        await assertFails(deleteDoc(doc(db, "contractSignatures/contract-a_client")));
      }

      // Drafts: the studio sees them; the couple and crew never do.
      await assertSucceeds(getDoc(doc(owner, "contractDrafts/project-a")));
      await assertSucceeds(getDoc(doc(coordinator, "contractDrafts/project-a")));
      await assertFails(getDoc(doc(client, "contractDrafts/project-a")));
      await assertFails(getDoc(doc(crew, "contractDrafts/project-a")));
      await assertFails(updateDoc(doc(owner, "contractDrafts/project-a"), { status: "sent" }));

      // The agreement: the studio's office reads it; only the server saves it.
      await assertSucceeds(getDoc(doc(owner, "agreementTemplates/agreement-a")));
      await assertSucceeds(
        getDocs(query(collection(coordinator, "agreementTemplates"), where("tenantId", "==", "tenant-a"))),
      );
      await assertSucceeds(getDoc(doc(owner, "agreementTemplateVersions/agreement-a_v1")));
      await assertFails(getDoc(doc(client, "agreementTemplates/agreement-a")));
      await assertFails(getDoc(doc(crew, "agreementTemplateVersions/agreement-a_v1")));
      await assertFails(getDoc(doc(otherOwner, "agreementTemplates/agreement-a")));
      await assertFails(updateDoc(doc(owner, "agreementTemplateVersions/agreement-a_v1"), { body: "changed" }));
      await assertFails(setDoc(doc(owner, "agreementTemplates/new"), { tenantId: "tenant-a" }));

      // Feature switches: members see what is on; nobody switches it on themselves.
      await assertSucceeds(getDoc(doc(owner, "tenantFeatures/tenant-a")));
      await assertSucceeds(getDoc(doc(client, "tenantFeatures/tenant-a")));
      await assertFails(getDoc(doc(otherOwner, "tenantFeatures/tenant-a")));
      await assertFails(setDoc(doc(owner, "tenantFeatures/tenant-a"), { tenantId: "tenant-a", nativeContractSigning: true }));
      await assertFails(setDoc(doc(otherOwner, "tenantFeatures/tenant-b"), { tenantId: "tenant-b", nativeContractSigning: true }));
    } finally {
      await environment.cleanup();
    }
  },
);
