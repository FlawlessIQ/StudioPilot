import type { Firestore } from "firebase-admin/firestore";
import {
  readinessAssessmentSchema,
  type ReadinessAssessment,
} from "@/features/readiness/schema";

export class ReadinessRepository {
  constructor(private readonly firestore: Firestore) {}

  async get(tenantId: string, projectId: string): Promise<ReadinessAssessment | null> {
    const document = await this.firestore.doc(`readinessAssessments/${projectId}`).get();
    if (!document.exists) return null;
    const assessment = readinessAssessmentSchema.parse({
      id: document.id,
      ...document.data(),
    });
    return assessment.tenantId === tenantId ? assessment : null;
  }

  async save(assessment: ReadinessAssessment): Promise<void> {
    const parsed = readinessAssessmentSchema.parse(assessment);
    await this.firestore.doc(`readinessAssessments/${parsed.projectId}`).set(parsed);
  }
}
