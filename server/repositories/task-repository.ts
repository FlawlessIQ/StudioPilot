import type { Firestore } from "firebase-admin/firestore";
import { taskSchema, type Task } from "@/features/tasks/schema";
import { TenantRepository } from "./base-repository";

export class TasksRepository extends TenantRepository<Task> {
  constructor(firestore: Firestore) {
    super(firestore, "tasks", taskSchema);
  }

  async listOpen(tenantId: string, assignedUserId: string | null): Promise<Task[]> {
    let query = this.collection
      .where("tenantId", "==", tenantId)
      .where("archivedAt", "==", null)
      .where("status", "in", ["not_started", "in_progress", "waiting"]);
    if (assignedUserId) query = query.where("assignedUserId", "==", assignedUserId);
    const snapshot = await query.orderBy("dueDate", "asc").limit(100).get();
    return snapshot.docs.map((document) =>
      taskSchema.parse({ id: document.id, ...document.data() }),
    );
  }
}
