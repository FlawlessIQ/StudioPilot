import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { z } from "zod";
import {
  assessSignedAgreement,
  type SignedAgreementAssessment,
  type SignedAgreementCandidate,
  type SignedAgreementReading,
} from "../booking/signed-agreement-match.js";
import { cloudAccessToken } from "./vertex-token.js";
import { vertexEndpoint } from "./vertex-endpoint.js";

/**
 * Cue reading a signed agreement a studio has dropped into the chat.
 *
 * What this does and does not do is the whole design:
 *
 * - It reads. A model pulls signer names, dates and the couple off the page.
 * - It matches, deterministically, against jobs actually waiting on a
 *   signature (features/booking/signed-agreement-match.ts), and says what to
 *   doubt.
 * - It records nothing. No contract, project or proposal is touched here. The
 *   result prefills the same "Record the signature" form a studio fills by
 *   hand, and the write goes through `recordSignedAgreement` under the studio's
 *   own identity when a person presses the button — the same command, the same
 *   owner/admin permission, the same manual attestation it has always been.
 *   AI output may never write a signature, and tests/ai-write-boundary.test.ts
 *   polices every file in this folder for it.
 *
 * The staged file is read once and deleted. It is an input to one reading,
 * not a record: the signed copy that is kept is the one the confirmation
 * uploads to the project, where every other contract file lives.
 */

export const readSignedAgreementRequestSchema = z.object({
  kind: z.literal("read_signed_agreement"),
  tenantId: z.string().min(1),
  attachmentPath: z.string().min(1).max(1024),
});

/**
 * The rest of what a contract states, for importing it as a booking the studio
 * already has.
 *
 * Only ever a prefill for a form a person checks and submits; nothing here is
 * recorded. Amounts are as the document writes them, in its own currency.
 */
export type SignedAgreementDetails = {
  clientEmails: string[];
  clientPhones: string[];
  packageName: string | null;
  contractTotal: number | null;
  taxAmount: number | null;
  coverageHours: number | null;
  photographers: number | null;
  videographers: number | null;
  venueName: string | null;
  city: string | null;
  retainerAmount: number | null;
};

export type ReadSignedAgreementResult =
  | { status: "scanning" }
  | { status: "blocked"; reason: "unsafe" | "scanner_unavailable" | "unsupported" }
  | {
      status: "read";
      mode: "ai" | "unavailable";
      reading: SignedAgreementReading;
      details: SignedAgreementDetails;
      assessment: SignedAgreementAssessment;
      candidates: Array<{
        projectId: string;
        projectName: string;
        proposalId: string | null;
      }>;
    };

const readableTypes = new Set(["application/pdf", "image/jpeg", "image/png"]);

/** The folder a studio member may stage attachments into — their own only. */
export function cueAttachmentPrefix(tenantId: string, userId: string): string {
  return `tenants/${tenantId}/cueAttachments/${userId}/`;
}

const readingSchema = z.object({
  isSignedAgreement: z.boolean(),
  signatureVisible: z.boolean(),
  signerNames: z.array(z.string().max(160)).max(10).catch([]),
  clientNames: z.array(z.string().max(160)).max(10).catch([]),
  signedDate: z.string().nullable().catch(null),
  eventDate: z.string().nullable().catch(null),
});

const money = z.number().nonnegative().max(1_000_000).nullable().catch(null);
const detailsSchema = z
  .object({
    clientEmails: z.array(z.string().max(254)).max(4).catch([]),
    clientPhones: z.array(z.string().max(40)).max(4).catch([]),
    packageName: z.string().max(160).nullable().catch(null),
    contractTotal: money,
    taxAmount: money,
    coverageHours: z.number().positive().max(24).nullable().catch(null),
    photographers: z.number().int().positive().max(10).nullable().catch(null),
    videographers: z.number().int().positive().max(10).nullable().catch(null),
    venueName: z.string().max(160).nullable().catch(null),
    city: z.string().max(120).nullable().catch(null),
    retainerAmount: money,
  })
  .catch({
    clientEmails: [],
    clientPhones: [],
    packageName: null,
    contractTotal: null,
    taxAmount: null,
    coverageHours: null,
    photographers: null,
    videographers: null,
    venueName: null,
    city: null,
    retainerAmount: null,
  });

const emptyDetails: SignedAgreementDetails = detailsSchema.parse({});

const emptyReading: SignedAgreementReading = {
  isSignedAgreement: false,
  signatureVisible: false,
  signerNames: [],
  clientNames: [],
  signedDate: null,
  eventDate: null,
};

/**
 * Whether the scanner has cleared the staged object, and what to do if not.
 *
 * AI never reads a file the malware scan has not passed — the same guard the
 * COI extraction uses. Pending is not a failure: the scan runs on upload and
 * usually finishes in seconds, so the browser asks again.
 */
export function attachmentReadiness(input: {
  scanStatus: string | undefined;
  contentType: string | undefined;
}):
  | { ready: true }
  | { ready: false; result: Extract<ReadSignedAgreementResult, { status: "scanning" | "blocked" }> } {
  const scan = input.scanStatus ?? "pending";
  if (scan === "pending")
    return { ready: false, result: { status: "scanning" } };
  if (scan === "scanner_unavailable")
    return {
      ready: false,
      result: { status: "blocked", reason: "scanner_unavailable" },
    };
  if (scan !== "clean")
    return { ready: false, result: { status: "blocked", reason: "unsafe" } };
  if (!readableTypes.has(String(input.contentType)))
    return { ready: false, result: { status: "blocked", reason: "unsupported" } };
  return { ready: true };
}

async function readWithVertex(input: {
  fileUri: string;
  contentType: string;
}): Promise<{ reading: SignedAgreementReading; details: SignedAgreementDetails } | null> {
  if (process.env.PROVIDER_MOCK_MODE === "true") return null;
  const project = process.env.VERTEX_AI_PROJECT_ID;
  const model = process.env.VERTEX_AI_EXTRACTION_MODEL;
  if (!project || !model) return null;
  const token = await cloudAccessToken();
  const response = await fetch(
    vertexEndpoint(project, model),
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [
            {
              text:
                "You read one document a wedding photography studio believes is a signed client agreement. Report only what is visibly on the page — never infer, complete or correct it. isSignedAgreement: true only if it is an agreement between the studio and a client. signatureVisible: true only if a handwritten, drawn or typed-and-attested client signature is actually present, not merely a signature line. signerNames: the names of the clients who signed, as written. clientNames: every client the agreement is made with, as written. signedDate: the date the client signed, as YYYY-MM-DD, or null if not stated. eventDate: the date of the event the agreement covers, as YYYY-MM-DD, or null. details, each only if the document states it and otherwise null or empty: clientEmails and clientPhones as written; packageName as the agreement names the package or collection; contractTotal as the total price as a plain number including any tax; taxAmount as a plain number; coverageHours as the number of hours of coverage; photographers as the number of photographers included; videographers as the number of videographers included, and null rather than zero when the agreement does not mention video; venueName and city of the event; retainerAmount as the retainer or deposit amount as a plain number. Never compute a figure the document does not state. Do not judge whether the agreement is valid, enforceable or complete. Return JSON only.",
            },
          ],
        },
        contents: [
          {
            role: "user",
            parts: [
              { text: "Read this agreement." },
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
              isSignedAgreement: { type: "BOOLEAN" },
              signatureVisible: { type: "BOOLEAN" },
              signerNames: { type: "ARRAY", items: { type: "STRING" } },
              clientNames: { type: "ARRAY", items: { type: "STRING" } },
              signedDate: { type: "STRING", nullable: true },
              eventDate: { type: "STRING", nullable: true },
              details: {
                type: "OBJECT",
                properties: {
                  clientEmails: { type: "ARRAY", items: { type: "STRING" } },
                  clientPhones: { type: "ARRAY", items: { type: "STRING" } },
                  packageName: { type: "STRING", nullable: true },
                  contractTotal: { type: "NUMBER", nullable: true },
                  taxAmount: { type: "NUMBER", nullable: true },
                  coverageHours: { type: "NUMBER", nullable: true },
                  photographers: { type: "NUMBER", nullable: true },
                  videographers: { type: "NUMBER", nullable: true },
                  venueName: { type: "STRING", nullable: true },
                  city: { type: "STRING", nullable: true },
                  retainerAmount: { type: "NUMBER", nullable: true },
                },
              },
            },
            required: [
              "isSignedAgreement",
              "signatureVisible",
              "signerNames",
              "clientNames",
            ],
          },
        },
      }),
    },
  );
  if (!response.ok) throw new Error("VERTEX_AI_REQUEST_FAILED");
  const body = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = body.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("VERTEX_AI_EMPTY_RESPONSE");
  // Schema failure rejects rather than guessing a shape — AI output that does
  // not parse is not evidence of anything.
  const raw = JSON.parse(text) as { details?: unknown };
  return {
    reading: readingSchema.parse(raw),
    // A details section that doesn't parse costs the prefill, never the reading.
    details: detailsSchema.parse(raw.details ?? {}),
  };
}

/** Today in the studio's own calendar, so "dated in the future" means theirs. */
function studioToday(timeZone: unknown, now: Date): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: typeof timeZone === "string" && timeZone ? timeZone : "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/** Jobs a signature could be recorded against: waiting on one, with an accepted proposal. */
async function jobsAwaitingSignature(
  db: Firestore,
  tenantId: string,
): Promise<SignedAgreementCandidate[]> {
  const projects = await db
    .collection("projects")
    .where("tenantId", "==", tenantId)
    .where("state", "==", "CONTRACT_PENDING")
    .limit(50)
    .get();
  return Promise.all(
    projects.docs.map(async (project) => {
      const contactIds = Array.isArray(project.get("clientContactIds"))
        ? (project.get("clientContactIds") as unknown[])
            .filter((id): id is string => typeof id === "string")
            .slice(0, 4)
        : [];
      const [proposals, ...contacts] = await Promise.all([
        db
          .collection("proposals")
          .where("tenantId", "==", tenantId)
          .where("projectId", "==", project.id)
          .where("status", "==", "accepted")
          .limit(1)
          .get(),
        ...contactIds.map((id) => db.doc(`contacts/${id}`).get()),
      ]);
      const proposal = proposals.docs[0];
      const acceptedAt = proposal?.get("acceptedAt");
      return {
        projectId: project.id,
        projectName: String(project.get("name") ?? project.id),
        eventDate:
          typeof project.get("eventDate") === "string"
            ? String(project.get("eventDate"))
            : null,
        proposalId: proposal?.id ?? null,
        proposalAcceptedOn:
          typeof acceptedAt === "string" ? acceptedAt.slice(0, 10) : null,
        clientNames: contacts
          .filter(
            (contact) =>
              contact.exists && contact.get("tenantId") === tenantId,
          )
          .map((contact) =>
            [contact.get("firstName"), contact.get("lastName")]
              .filter((part) => typeof part === "string" && part)
              .join(" "),
          )
          .filter(Boolean),
      };
    }),
  );
}

export async function readSignedAgreement(input: {
  tenantId: string;
  userId: string;
  attachmentPath: string;
  /** Charges the tenant's AI quota. Only called once a model will actually read. */
  consumeQuota: () => Promise<void>;
}): Promise<ReadSignedAgreementResult & { interaction?: Record<string, unknown> }> {
  // A valid caller must not be able to point Cue at somebody else's staged
  // file, or at any other object in the bucket.
  if (!input.attachmentPath.startsWith(cueAttachmentPrefix(input.tenantId, input.userId)))
    throw new Error("ATTACHMENT_PATH_MISMATCH");

  const db = getFirestore();
  const bucket = getStorage().bucket();
  const file = bucket.file(input.attachmentPath);
  const [exists] = await file.exists();
  if (!exists) throw new Error("ATTACHMENT_NOT_FOUND");
  const [metadata] = await file.getMetadata();
  const readiness = attachmentReadiness({
    scanStatus: (metadata.metadata as Record<string, unknown> | undefined)?.scanStatus as
      | string
      | undefined,
    contentType: metadata.contentType,
  });
  if (!readiness.ready) {
    // Anything that will never become readable goes now rather than sitting
    // in the bucket; a pending scan is left for the next ask.
    if (readiness.result.status === "blocked")
      await file.delete({ ignoreNotFound: true });
    return readiness.result;
  }

  try {
    const [tenant, candidates] = await Promise.all([
      db.doc(`tenants/${input.tenantId}`).get(),
      jobsAwaitingSignature(db, input.tenantId),
    ]);

    let reading: SignedAgreementReading | null = null;
    let details: SignedAgreementDetails = emptyDetails;
    // No model configured means no reading — it does not mean a guess. The
    // card says so and the studio fills the form from the document.
    const configured =
      process.env.PROVIDER_MOCK_MODE !== "true" &&
      Boolean(process.env.VERTEX_AI_PROJECT_ID) &&
      Boolean(process.env.VERTEX_AI_EXTRACTION_MODEL);
    if (configured) {
      await input.consumeQuota();
      const read = await readWithVertex({
        fileUri: `gs://${bucket.name}/${input.attachmentPath}`,
        contentType: String(metadata.contentType),
      });
      reading = read?.reading ?? null;
      details = read?.details ?? emptyDetails;
    }

    const mode = reading ? ("ai" as const) : ("unavailable" as const);
    // Without a reading there is nothing to doubt — only jobs to pick from.
    const assessment: SignedAgreementAssessment = reading
      ? assessSignedAgreement({
          reading,
          candidates,
          today: studioToday(tenant.get("timezone"), new Date()),
        })
      : { matches: [], suggestion: null, flags: [] };
    return {
      status: "read",
      mode,
      reading: reading ?? emptyReading,
      details,
      assessment,
      candidates: candidates.map((candidate) => ({
        projectId: candidate.projectId,
        projectName: candidate.projectName,
        proposalId: candidate.proposalId,
      })),
      interaction: {
        mode,
        candidateCount: candidates.length,
        suggestedProjectId: assessment.suggestion?.projectId ?? null,
        flags: assessment.flags.map((flag) => flag.code),
      },
    };
  } finally {
    await file.delete({ ignoreNotFound: true });
  }
}
