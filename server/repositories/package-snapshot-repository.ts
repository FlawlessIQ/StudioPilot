import type { Firestore } from "firebase-admin/firestore";
import {
  packageSnapshotSchema,
  type PackageSnapshot,
} from "@/features/packages/schema";

export class PackageSnapshotsRepository {
  constructor(private readonly firestore: Firestore) {}

  async create(snapshot: PackageSnapshot): Promise<PackageSnapshot> {
    const parsed = packageSnapshotSchema.parse(snapshot);
    await this.firestore.doc(`packageSnapshots/${parsed.id}`).create(parsed);
    return parsed;
  }

  async getByProject(
    tenantId: string,
    projectId: string,
  ): Promise<PackageSnapshot | null> {
    const result = await this.firestore
      .collection("packageSnapshots")
      .where("tenantId", "==", tenantId)
      .where("projectId", "==", projectId)
      .limit(1)
      .get();
    const document = result.docs[0];
    return document
      ? packageSnapshotSchema.parse({ id: document.id, ...document.data() })
      : null;
  }
}
