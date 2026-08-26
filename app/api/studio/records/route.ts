import { z } from "zod";
import { adminAppCheck, adminAuth, adminFirestore } from "@/server/firebase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const collections = [
  "actionReceipts", "aiActions", "albumWorkflows", "automationApprovals",
  "automationRuns", "bookingGateRuns", "bookingOrchestrations",
  "communicationDrafts", "consultations", "contacts", "contracts",
  "crewAssignments", "crewAvailability", "crewCascades", "crewProfiles",
  "deliveryDrafts", "deliveryRecords", "documents", "emailJobs",
  "galleryInboxes", "insuranceRequests", "integrationConnections",
  "invoiceReferences", "leads", "memberships", "messages", "packages",
  "packageSnapshots", "postProductionRecords", "productEvents", "projects",
  "projectCloseouts", "proposals", "providerJobs", "questionnaireResponses",
  "questionnaireTemplates", "readinessAssessments", "reviewRequests",
  "schedules", "studioAssetVersions", "studioImportSessions", "tasks",
  "tenants", "timingRules", "vendors", "workflowTemplates",
] as const;

const requestSchema = z.object({
  collection: z.enum(collections),
  tenantId: z.string().min(1).max(160),
  projectId: z.string().min(1).max(200).nullable().optional(),
  projectScoped: z.boolean().default(false),
  vendorScoped: z.boolean().default(false),
});

type StudioRecord = { id: string; [key: string]: unknown };

function bearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  return authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : null;
}

async function verifyRequest(request: Request) {
  const token = bearerToken(request);
  if (!token) throw new Error("AUTHENTICATION_REQUIRED");
  if (process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS !== "true") {
    const appCheckToken = request.headers.get("x-firebase-appcheck");
    if (!appCheckToken) throw new Error("APP_CHECK_REQUIRED");
    await adminAppCheck.verifyToken(appCheckToken);
  }
  return adminAuth.verifyIdToken(token, true);
}

export async function POST(request: Request): Promise<Response> {
  try {
    const [identity, input] = await Promise.all([
      verifyRequest(request),
      request.json().then((body) => requestSchema.parse(body)),
    ]);
    const memberships = await adminFirestore.collection("memberships")
      .where("userId", "==", identity.uid).where("status", "==", "active").limit(20).get();
    const membership = memberships.docs.map((document) => document.data()).find(
      (candidate) =>
        candidate.tenantId === input.tenantId &&
        ["studio_owner", "studio_admin"].includes(String(candidate.role)),
    );
    if (!membership) return Response.json({ error: "WORKSPACE_ACCESS_DENIED" }, { status: 403 });

    const documents = input.collection === "tenants"
      ? await adminFirestore.getAll(adminFirestore.doc(`tenants/${input.tenantId}`))
      : await adminFirestore.collection(input.collection)
          .where("tenantId", "==", input.tenantId).limit(250).get()
          .then((result) => result.docs);
    const records: StudioRecord[] = documents
      .filter((document) => document.exists)
      .map<StudioRecord>((document) => ({ id: document.id, ...document.data() }))
      .filter((record) => {
      if (input.projectId && input.projectScoped) {
        return input.collection === "projects"
          ? record.id === input.projectId
          : record.projectId === input.projectId;
      }
      if (input.projectId && input.vendorScoped) {
        return Array.isArray(record.projectIds) && record.projectIds.includes(input.projectId);
      }
        return true;
      })
      .slice(0, 100);
    const projectIds = Array.from(new Set(records.map((record) => record.projectId).filter((value): value is string => typeof value === "string")));
    const projects = await Promise.all(projectIds.map((projectId) => adminFirestore.doc(`projects/${projectId}`).get()));
    const names = Object.fromEntries(projects.filter((project) => project.exists).map((project) => [project.id, String(project.get("name") ?? project.id)]));

    return Response.json({
      records: records.map((record) => ({
        ...record,
        // Fell back to the raw `projectId`, so a record whose project has been
        // deleted rendered "wedding-delivered" as its heading — a document id
        // used as a couple's name, twice on the same card. Naming the state is
        // more use than echoing an internal identifier.
        projectName:
          typeof record.projectId === "string"
            ? (names[record.projectId] ?? "Project unavailable")
            : record.projectName,
      })),
    });
  } catch (caught: unknown) {
    const code = caught instanceof Error ? caught.message : "RECORDS_UNAVAILABLE";
    return Response.json({ error: code }, { status: code === "AUTHENTICATION_REQUIRED" ? 401 : 503 });
  }
}
