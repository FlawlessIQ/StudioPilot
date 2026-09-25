import type { DocumentSnapshot, Firestore } from "firebase-admin/firestore";
import { z } from "zod";
import { vertexEndpoint } from "../ai/vertex-endpoint.js";
import { deterministicIntakeExtraction } from "../ai/intake-prefill.js";

/**
 * The model's turn, after the form has had its say.
 *
 * A captured lead already holds everything the notification labelled. What's
 * left is in sentences: "we're thinking about 140 people at the barn in
 * Hudson" — a guest count, a venue, a city the form never asked for. The model
 * reads the message and fills **only fields that are still empty**, and each
 * value it adds is marked as read from the message, so the studio can see
 * which facts the couple stated in a field and which were inferred.
 *
 * Never guesses: nulls for anything not said. A date found here re-runs the
 * availability check, because the availability line is the first thing the
 * studio reads on the card.
 */

const extractionSchema = z.object({
  firstName: z.string().max(80).nullable(),
  lastName: z.string().max(80).nullable(),
  partnerName: z.string().max(120).nullable(),
  email: z.string().max(160).nullable(),
  phone: z.string().max(40).nullable(),
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  venue: z.string().max(160).nullable(),
  city: z.string().max(120).nullable(),
  ceremonyTime: z.string().max(40).nullable(),
  guestCount: z.number().int().min(1).max(100000).nullable(),
  budget: z.string().max(80).nullable(),
  wantsPhotography: z.boolean().nullable(),
  wantsVideography: z.boolean().nullable(),
  referralSource: z.string().max(120).nullable(),
});

export type InquiryExtraction = z.infer<typeof extractionSchema>;

const ACTIVE_STATES = ["CONSULTATION", "PROPOSAL", "CONTRACT_PENDING", "RETAINER_PENDING", "BOOKED", "PLANNING", "READY"];

async function modelExtraction(
  text: string,
  today: string,
  token: string,
): Promise<InquiryExtraction | null> {
  const project = process.env.VERTEX_AI_PROJECT_ID;
  const model = process.env.VERTEX_AI_EXTRACTION_MODEL;
  if (!project || !model) return null;
  const response = await fetch(vertexEndpoint(project, model), {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      systemInstruction: {
        parts: [
          {
            text: `Extract booking details from a prospective client's inquiry to a photography or videography studio. Today is ${today}. Use null for anything not explicitly stated — never guess or invent names, dates, places, numbers or contact details. eventDate must be YYYY-MM-DD and only when the message names a specific future date. partnerName is the other person getting married, when named. guestCount only when a number of guests is stated. wantsPhotography / wantsVideography only when the message says so. Return JSON only.`,
          },
        ],
      },
      contents: [{ role: "user", parts: [{ text: text.slice(0, 6000) }] }],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: Object.fromEntries(
            [
              ["firstName", "STRING"],
              ["lastName", "STRING"],
              ["partnerName", "STRING"],
              ["email", "STRING"],
              ["phone", "STRING"],
              ["eventDate", "STRING"],
              ["venue", "STRING"],
              ["city", "STRING"],
              ["ceremonyTime", "STRING"],
              ["guestCount", "NUMBER"],
              ["budget", "STRING"],
              ["wantsPhotography", "BOOLEAN"],
              ["wantsVideography", "BOOLEAN"],
              ["referralSource", "STRING"],
            ].map(([key, type]) => [key, { type, nullable: true }]),
          ),
        },
      },
    }),
  });
  if (!response.ok) throw new Error(`VERTEX_AI_FAILED:${response.status}`);
  const body = (await response.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const output = body.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!output) return null;
  const parsed = extractionSchema.safeParse(JSON.parse(output));
  return parsed.success ? parsed.data : null;
}

function deterministic(text: string): InquiryExtraction {
  const value = deterministicIntakeExtraction(text);
  return {
    firstName: value.firstName,
    lastName: value.lastName,
    partnerName: value.partnerName,
    email: value.email,
    phone: value.phone,
    eventDate: value.eventDate,
    venue: value.venueName,
    city: value.city,
    ceremonyTime: null,
    guestCount: null,
    budget: null,
    wantsPhotography: null,
    wantsVideography: null,
    referralSource: null,
  };
}

/** Which lead fields to fill from an extraction, given what the lead already has. Pure. */
export function fillsFor(
  lead: Record<string, unknown>,
  extraction: InquiryExtraction,
  today: string,
): Record<string, unknown> {
  const empty = (key: string) => {
    const value = lead[key];
    return value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
  };
  const fills: Record<string, unknown> = {};
  const provenance: Record<string, { source: string; label: null }> = {};
  const fill = (leadKey: string, value: unknown, provenanceKey = leadKey) => {
    if (value === null || value === undefined || value === "") return;
    if (!empty(leadKey)) return;
    fills[leadKey] = value;
    provenance[provenanceKey] = { source: "message", label: null };
  };
  fill("firstName", extraction.firstName);
  fill("lastName", extraction.lastName);
  fill("partnerName", extraction.partnerName);
  if (extraction.email && /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(extraction.email)) fill("email", extraction.email.toLowerCase());
  fill("phone", extraction.phone);
  if (extraction.eventDate && extraction.eventDate >= today) fill("eventDate", extraction.eventDate);
  fill("venue", extraction.venue);
  fill("city", extraction.city);
  fill("ceremonyTime", extraction.ceremonyTime);
  fill("estimatedGuestCount", extraction.guestCount, "guestCount");
  fill("budgetRange", extraction.budget, "budget");
  fill("referralSource", extraction.referralSource);
  // Services only replace the placeholder default when the lead's services
  // weren't read from the form.
  const provenanceSoFar = (lead.fieldProvenance ?? {}) as Record<string, unknown>;
  if (!provenanceSoFar.services) {
    const services = [
      ...(extraction.wantsPhotography ? ["photography"] : []),
      ...(extraction.wantsVideography ? ["videography"] : []),
    ];
    if (services.length) {
      fills.servicesRequested = services;
      provenance.services = { source: "message", label: null };
    }
  }
  if (Object.keys(provenance).length) {
    fills.fieldProvenance = { ...provenanceSoFar, ...provenance };
  }
  return fills;
}

/**
 * Fill the lead's empty fields from its message. Returns what changed; the
 * caller (runLeadIntakeAnalysis) then summarises and drafts the reply from the
 * fuller lead.
 */
export async function enrichCapturedLead(
  db: Firestore,
  lead: DocumentSnapshot,
  options: { mock: boolean; accessToken: () => Promise<string> },
): Promise<Record<string, unknown>> {
  const data = lead.data() ?? {};
  if (data.enrichmentPending !== true) return {};
  const today = new Date().toISOString().slice(0, 10);
  const text = [String(data.message ?? ""), ...(Array.isArray(data.rawFormFields)
    ? (data.rawFormFields as Array<{ label?: string; value?: string }>).map((field) => `${field.label}: ${field.value}`)
    : [])].join("\n");
  let extraction: InquiryExtraction | null = null;
  if (options.mock) {
    extraction = deterministic(text);
  } else {
    try {
      extraction = await modelExtraction(text, today, await options.accessToken());
    } catch {
      extraction = null;
    }
    extraction ??= deterministic(text);
  }
  const fills = fillsFor(data, extraction, today);
  const now = new Date().toISOString();
  if (typeof fills.eventDate === "string") {
    const conflicts = await db
      .collection("projects")
      .where("tenantId", "==", data.tenantId)
      .where("eventDate", "==", fills.eventDate)
      .where("state", "in", ACTIVE_STATES)
      .limit(1)
      .get();
    fills.availabilityStatus = conflicts.empty ? "available" : "conflict";
  }
  if (fills.firstName || fills.lastName || fills.partnerName) {
    const first = String(fills.firstName ?? data.firstName ?? "");
    const last = String(fills.lastName ?? data.lastName ?? "");
    const partner = String(fills.partnerName ?? data.partnerName ?? "");
    const name = [first, last].filter(Boolean).join(" ");
    if (name) fills.displayName = partner ? `${name} & ${partner}` : name;
  }
  const missing = [
    ...((fills.email ?? data.email) || (fills.phone ?? data.phone) ? [] : ["how to reach them"]),
    ...((fills.eventDate ?? data.eventDate) ? [] : ["event date"]),
    ...((fills.venue ?? data.venue) ? [] : ["venue"]),
    ...((fills.estimatedGuestCount ?? data.estimatedGuestCount) ? [] : ["guest count"]),
  ];
  await lead.ref.update({
    ...fills,
    missingInformation: missing,
    enrichmentPending: false,
    enrichedAt: now,
    updatedAt: now,
    updatedBy: "inquiry-enrichment",
  });
  return fills;
}
