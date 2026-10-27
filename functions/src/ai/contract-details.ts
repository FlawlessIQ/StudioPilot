import { vertexFetch } from "./vertex-fetch.js";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { z } from "zod";
import { cloudAccessToken } from "./vertex-token.js";
import { attachmentReadiness, cueAttachmentPrefix } from "./signed-agreement.js";
import {
  contractQuestions,
  contractRowsFromAnswers,
  matchContractToJob,
  type ContractDetailRow,
  type ContractJobCandidate,
  type ContractQuestion,
} from "../planning/contract-details.js";

/**
 * Reading the day off a signed contract, for a job imported from before
 * StudioCue (GR Productions, 2026-10-27; planning/contract-details.ts).
 *
 * The same shape as reading a signed agreement (./signed-agreement.ts):
 *
 * - It reads. A model answers the studio's own questions — the forms it
 *   sends couples — from what the page says, and nothing else.
 * - It matches, deterministically, the contract to the imported job on its
 *   date whose clients share a surname with it, and leaves the choice to the
 *   studio when that isn't exactly one job.
 * - It records nothing. The studio checks every answer, and the write is
 *   `applyContractDetails` under the studio's own identity. These are the
 *   day's details — names, places, times — never a signature, a payment or
 *   a legal term (tests/ai-write-boundary.test.ts polices this folder).
 *
 * The staged file is read once and deleted; the copy that is kept is the one
 * the browser files against the job when the studio approves.
 */

export const readContractDetailsRequestSchema = z.object({
  kind: z.literal("read_contract_details"),
  tenantId: z.string().min(1),
  attachmentPath: z.string().min(1).max(1024),
  /** The job, when the contract is added from it; otherwise the reading finds it. */
  projectId: z.string().min(1).max(200).optional(),
});

export type ReadContractDetailsResult =
  | { status: "scanning" }
  | { status: "blocked"; reason: "unsafe" | "scanner_unavailable" | "unsupported" }
  | {
      status: "read";
      mode: "ai" | "unavailable";
      /** Whether the page read as a client agreement at all. */
      isAgreement: boolean;
      clientNames: string[];
      eventDate: string | null;
      /** The job it is for: the one asked about, or the one that matched. */
      match: { projectId: string; name: string } | null;
      rows: ContractDetailRow[];
      /** Every question asked, so the studio can answer what the reading couldn't. */
      questions: ContractQuestion[];
    };

const readingSchema = z.object({
  isAgreement: z.boolean().catch(false),
  clientNames: z.array(z.string().max(160)).max(10).catch([]),
  eventDate: z.string().nullable().catch(null),
  answers: z
    .array(z.object({ id: z.string().max(10), answer: z.string().max(2000) }))
    .max(200)
    .catch([]),
});
type Reading = z.infer<typeof readingSchema>;

/** The forms the studio could send this job: the job's own first, then the studio's. */
async function studioForms(db: Firestore, tenantId: string, projectId: string | null) {
  const [responses, templates] = await Promise.all([
    projectId
      ? db.collection("questionnaireResponses").where("tenantId", "==", tenantId).where("projectId", "==", projectId).limit(20).get()
      : null,
    db.collection("questionnaireTemplates").where("tenantId", "==", tenantId).limit(40).get(),
  ]);
  const onJob = (responses?.docs ?? [])
    .filter((response) => !response.get("archivedAt") && response.get("status") !== "withdrawn")
    .map((response) => ({ sections: (response.get("templateSnapshot") as { sections?: unknown } | undefined)?.sections }));
  const studio = templates.docs
    .filter((template) => !template.get("archivedAt") && template.get("status") !== "archived")
    .map((template) => ({ sections: template.get("sections") }));
  return [...onJob, ...studio];
}

/** Imported jobs on a date, with their clients' names, to match a contract against. */
async function importedJobsOn(db: Firestore, tenantId: string, eventDate: string): Promise<ContractJobCandidate[]> {
  const projects = await db.collection("projects").where("tenantId", "==", tenantId).where("eventDate", "==", eventDate).limit(25).get();
  return Promise.all(
    projects.docs
      .filter((project) => project.get("importedAt") && !project.get("archivedAt"))
      .map(async (project) => {
        const ids = (Array.isArray(project.get("clientContactIds")) ? (project.get("clientContactIds") as unknown[]) : [])
          .filter((id): id is string => typeof id === "string" && Boolean(id))
          .slice(0, 4);
        const contacts = await Promise.all(ids.map((id) => db.doc(`contacts/${id}`).get()));
        return {
          projectId: project.id,
          name: String(project.get("name") ?? project.id),
          eventDate: String(project.get("eventDate") ?? "") || null,
          clientNames: contacts
            .filter((contact) => contact.exists && contact.get("tenantId") === tenantId)
            .map((contact) => [contact.get("firstName"), contact.get("lastName")].filter((part) => typeof part === "string" && part).join(" "))
            .filter(Boolean),
        };
      }),
  );
}

async function readWithVertex(input: { fileUri: string; contentType: string; questions: ContractQuestion[] }): Promise<Reading | null> {
  if (process.env.PROVIDER_MOCK_MODE === "true") return null;
  const project = process.env.VERTEX_AI_PROJECT_ID;
  const model = process.env.VERTEX_AI_EXTRACTION_MODEL;
  if (!project || !model) return null;
  const token = await cloudAccessToken();
  const asked = input.questions.map((question) => ({
    id: question.id,
    question: question.label,
    ...(question.section ? { section: question.section } : {}),
    type: question.type || "text",
    ...(question.options.length ? { options: question.options } : {}),
  }));
  const response = await vertexFetch(project, model, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      systemInstruction: {
        parts: [
          {
            text:
              "You read one signed client agreement for an event business, and answer the business's own questions about the event from it. Report only what the document visibly states — never infer, guess, complete or correct anything. isAgreement: true only if this is an agreement between the business and a client. clientNames: every client the agreement is made with, as written. eventDate: the date of the event, as YYYY-MM-DD, or null. answers: for each question the document answers, its id and the answer, in the document's own words. A date is YYYY-MM-DD. A time is as written, with AM or PM when the document gives it (\"4:30 PM\"). For a question with options, answer with one of its options exactly, or leave it out. When a question asks about a person by role (\"Bride's name\", \"Groom's phone\"), answer only if the document says which person has that role. Leave out every question the document does not answer; an empty list is a correct answer. Never answer about payments, prices, signatures or legal terms. Return JSON only.",
          },
        ],
      },
      contents: [
        {
          role: "user",
          parts: [
            { text: `The business's questions:\n${JSON.stringify(asked)}` },
            { fileData: { mimeType: input.contentType, fileUri: input.fileUri } },
          ],
        },
      ],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            isAgreement: { type: "BOOLEAN" },
            clientNames: { type: "ARRAY", items: { type: "STRING" } },
            eventDate: { type: "STRING", nullable: true },
            answers: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: { id: { type: "STRING" }, answer: { type: "STRING" } },
                required: ["id", "answer"],
              },
            },
          },
          required: ["isAgreement", "clientNames", "answers"],
        },
      },
    }),
  });
  if (!response.ok) throw new Error("VERTEX_AI_REQUEST_FAILED");
  const body = (await response.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const text = body.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("VERTEX_AI_EMPTY_RESPONSE");
  return readingSchema.parse(JSON.parse(text));
}

export async function readContractDetails(input: {
  tenantId: string;
  userId: string;
  attachmentPath: string;
  projectId: string | null;
  /** Charges the tenant's AI quota. Only called once a model will actually read. */
  consumeQuota: () => Promise<void>;
}): Promise<ReadContractDetailsResult & { interaction?: Record<string, unknown> }> {
  // Only the caller's own staged file: never somebody else's, nor any other object.
  if (!input.attachmentPath.startsWith(cueAttachmentPrefix(input.tenantId, input.userId)))
    throw new Error("ATTACHMENT_PATH_MISMATCH");
  const db = getFirestore();
  const bucket = getStorage().bucket();
  const file = bucket.file(input.attachmentPath);
  const [exists] = await file.exists();
  if (!exists) throw new Error("ATTACHMENT_NOT_FOUND");
  const [metadata] = await file.getMetadata();
  const readiness = attachmentReadiness({
    scanStatus: (metadata.metadata as Record<string, unknown> | undefined)?.scanStatus as string | undefined,
    contentType: metadata.contentType,
  });
  if (!readiness.ready) {
    if (readiness.result.status === "blocked") await file.delete({ ignoreNotFound: true });
    return readiness.result;
  }

  try {
    let asked: ContractJobCandidate | null = null;
    if (input.projectId) {
      const project = await db.doc(`projects/${input.projectId}`).get();
      if (!project.exists || project.get("tenantId") !== input.tenantId) throw new Error("PROJECT_NOT_FOUND");
      if (!project.get("importedAt")) throw new Error("NOT_AN_IMPORTED_BOOKING");
      asked = { projectId: project.id, name: String(project.get("name") ?? project.id), eventDate: null, clientNames: [] };
    }
    const questions = contractQuestions(await studioForms(db, input.tenantId, input.projectId));
    // No model configured means no reading — it does not mean a guess. The
    // studio is shown the questions to answer from the document.
    const configured =
      process.env.PROVIDER_MOCK_MODE !== "true" && Boolean(process.env.VERTEX_AI_PROJECT_ID) && Boolean(process.env.VERTEX_AI_EXTRACTION_MODEL);
    let reading: Reading | null = null;
    if (configured && questions.length) {
      await input.consumeQuota();
      reading = await readWithVertex({ fileUri: `gs://${bucket.name}/${input.attachmentPath}`, contentType: String(metadata.contentType), questions });
    }
    const eventDate = reading?.eventDate && /^\d{4}-\d{2}-\d{2}$/.test(reading.eventDate) ? reading.eventDate : null;
    const clientNames = reading?.clientNames ?? [];
    const found = asked ?? (eventDate ? matchContractToJob({ clientNames, eventDate }, await importedJobsOn(db, input.tenantId, eventDate)) : null);
    const rows = reading ? contractRowsFromAnswers(questions, reading.answers) : [];
    const mode = reading ? ("ai" as const) : ("unavailable" as const);
    return {
      status: "read",
      mode,
      isAgreement: reading?.isAgreement ?? false,
      clientNames,
      eventDate,
      match: found ? { projectId: found.projectId, name: found.name } : null,
      rows,
      questions,
      // What was concluded, never what the document said.
      interaction: { mode, questionCount: questions.length, answered: rows.length, matched: Boolean(found), fromJob: Boolean(asked) },
    };
  } finally {
    await file.delete({ ignoreNotFound: true });
  }
}
