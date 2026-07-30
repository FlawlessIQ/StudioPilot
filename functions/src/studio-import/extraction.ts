import { createHash } from "node:crypto";
import { getFirestore, type DocumentSnapshot } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

export const studioAssetTypes = [
  "message_template",
  "package",
  "proposal",
  "contract",
  "questionnaire",
  "schedule",
  "timing_rule",
  "crew_preference",
  "coi_instruction",
  "delivery_instruction",
  "review_request",
  "workflow",
] as const;

export type StudioAssetType = (typeof studioAssetTypes)[number];
type Json = Record<string, unknown>;

export type ExtractionCitation = {
  locator: string;
  excerpt: string;
};

export type ExtractedStudioAsset = {
  assetType: StudioAssetType;
  name: string;
  confidence: number;
  structuredContent: Json;
  citations: ExtractionCitation[];
};

export type ValidationIssue = {
  code: string;
  severity: "info" | "warning" | "blocking";
  message: string;
};

const record = (value: unknown): Json =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Json)
    : {};

const string = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const stringList = (value: unknown, limit = 100): string[] =>
  Array.isArray(value)
    ? value.map(string).filter(Boolean).slice(0, limit)
    : [];

const hash = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

function titleFromFileName(name: string): string {
  return name
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function inferStudioAssetType(
  name: string,
  sample = "",
): StudioAssetType {
  const text = `${name} ${sample}`.toLowerCase();
  if (/(email|message|subject line|follow.?up|reply)/.test(text))
    return "message_template";
  if (/(proposal|quote|estimate)/.test(text)) return "proposal";
  if (/(package|pricing|collection|line item|add.?on)/.test(text))
    return "package";
  if (/(contract|agreement|terms|signature (?:line|block|anchor))/.test(text))
    return "contract";
  if (/(question|intake|form field|client details)/.test(text))
    return "questionnaire";
  if (/(timeline|schedule|run.?of.?show|itinerary)/.test(text))
    return "schedule";
  if (/(buffer|duration|travel time|golden hour|timing rule)/.test(text))
    return "timing_rule";
  if (/(crew|photographer preference|second shooter)/.test(text))
    return "crew_preference";
  if (/(certificate of insurance|\bcoi\b|insured)/.test(text))
    return "coi_instruction";
  if (/(gallery|delivery|turnaround|download)/.test(text))
    return "delivery_instruction";
  if (/(review|testimonial|google review)/.test(text))
    return "review_request";
  return "workflow";
}

function extractVariables(text: string): string[] {
  const variables = new Set<string>();
  const patterns = [
    /\{\{\s*([^{}]+?)\s*\}\}/g,
    /\[\s*([A-Za-z][A-Za-z0-9 _-]{1,60})\s*\]/g,
    /<<\s*([^<>]+?)\s*>>/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const value = match[1]?.trim();
      if (value) variables.add(value);
    }
  }
  return [...variables].slice(0, 80);
}

function extractAmounts(text: string): Array<{
  label: string;
  amount: string;
}> {
  return text
    .split(/\r?\n/)
    .flatMap((line) => {
      const amount = line.match(
        /(?:USD\s*)?\$\s?\d[\d,]*(?:\.\d{2})?|(?:\d[\d,]*(?:\.\d{2})?\s?USD)/i,
      )?.[0];
      return amount
        ? [{ label: line.replace(amount, "").trim() || "Line item", amount }]
        : [];
    })
    .slice(0, 60);
}

function extractQuestions(text: string): Array<{
  label: string;
  required: boolean;
  type: "short_text" | "long_text" | "choice";
  options: string[];
}> {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.endsWith("?") ||
        /(?:^|\s)(required|\*required\*)\s*$/i.test(line),
    )
    .slice(0, 80)
    .map((line) => ({
      label: line.replace(/\s*(?:\*?required\*?)\s*$/i, "").trim(),
      required: /required|\*/i.test(line),
      type: line.length > 90 ? "long_text" : "short_text",
      options: [],
    }));
}

function extractScheduleItems(text: string): Array<{
  time: string;
  title: string;
  durationMinutes: number | null;
}> {
  return text
    .split(/\r?\n/)
    .flatMap((line) => {
      const match = line
        .trim()
        .match(
          /^((?:[01]?\d|2[0-3]):[0-5]\d|(?:1[0-2]|0?[1-9])(?::[0-5]\d)?\s?(?:am|pm))\s*[-–—:]?\s*(.+)$/i,
        );
      if (!match?.[1] || !match[2]) return [];
      const duration = match[2].match(/(\d{1,3})\s*(?:min|minutes)/i)?.[1];
      return [
        {
          time: match[1],
          title: match[2].trim(),
          durationMinutes: duration ? Number(duration) : null,
        },
      ];
    })
    .slice(0, 100);
}

export function deterministicExtraction(input: {
  name: string;
  text: string;
}): ExtractedStudioAsset[] {
  const text = input.text.trim();
  const assetType = inferStudioAssetType(input.name, text.slice(0, 2000));
  const shared = {
    sourceText: text.slice(0, 30_000),
    variables: extractVariables(text),
  };
  let structuredContent: Json = shared;
  if (assetType === "message_template") {
    const subject =
      text.match(/^\s*subject\s*:\s*(.+)$/im)?.[1]?.trim() ?? null;
    structuredContent = { ...shared, subject, body: text.slice(0, 20_000) };
  } else if (assetType === "package" || assetType === "proposal") {
    structuredContent = {
      ...shared,
      lineItems: extractAmounts(text),
      options: [],
      exclusions: [],
    };
  } else if (assetType === "questionnaire") {
    structuredContent = { ...shared, fields: extractQuestions(text) };
  } else if (assetType === "contract") {
    structuredContent = {
      ...shared,
      body: text.slice(0, 20_000),
      signers: [],
      signatureAnchors: [],
    };
  } else if (assetType === "schedule" || assetType === "timing_rule") {
    structuredContent = {
      ...shared,
      items: extractScheduleItems(text),
      anchors: [],
      timingRules: [],
    };
  }
  const excerpt = text.slice(0, 260);
  return [
    {
      assetType,
      name: titleFromFileName(input.name) || "Imported studio asset",
      confidence: text.length >= 80 ? 0.82 : 0.58,
      structuredContent,
      citations: excerpt
        ? [{ locator: "source:1", excerpt }]
        : [],
    },
  ];
}

export function validateExtractedAsset(
  asset: ExtractedStudioAsset,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (asset.confidence < 0.8) {
    issues.push({
      code: "LOW_CONFIDENCE",
      severity: "blocking",
      message:
        "AI confidence is below 80%. Confirm the classification and extracted fields.",
    });
  }
  if (!asset.citations.length) {
    issues.push({
      code: "MISSING_SOURCE_CITATION",
      severity: "blocking",
      message: "This draft has no traceable source citation.",
    });
  }
  const content = record(asset.structuredContent);
  const authoritativeKeys = new Set([
    "approvalstatus",
    "balancecents",
    "coiapproved",
    "coistatus",
    "contractstatus",
    "coverageverified",
    "executed",
    "fullypaid",
    "insurancestatus",
    "paid",
    "paymentstatus",
    "providerstatus",
    "signed",
    "signaturestatus",
  ]);
  const authoritativeClaims: string[] = [];
  const visit = (value: unknown, path: string, depth: number) => {
    if (
      depth > 8 ||
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value)
    )
      return;
    for (const [key, nested] of Object.entries(value)) {
      const nextPath = path ? `${path}.${key}` : key;
      if (authoritativeKeys.has(key.toLowerCase()))
        authoritativeClaims.push(nextPath);
      else if (!["sourceText", "body"].includes(key))
        visit(nested, nextPath, depth + 1);
    }
  };
  visit(content, "", 0);
  if (authoritativeClaims.length) {
    issues.push({
      code: "UNSUPPORTED_AUTHORITATIVE_CLAIM",
      severity: "blocking",
      message:
        `Imported drafts cannot assert live legal, financial, insurance, signature, or provider status (${authoritativeClaims.slice(0, 5).join(", ")}). Verify those states from their authoritative provider.`,
    });
  }
  if (
    ["package", "proposal"].includes(asset.assetType) &&
    !Array.isArray(content.lineItems)
  ) {
    issues.push({
      code: "MISSING_LINE_ITEMS",
      severity: "blocking",
      message: "Pricing drafts need explicit line items before activation.",
    });
  }
  if (
    asset.assetType === "questionnaire" &&
    (!Array.isArray(content.fields) || content.fields.length === 0)
  ) {
    issues.push({
      code: "MISSING_QUESTIONNAIRE_FIELDS",
      severity: "blocking",
      message: "No questionnaire fields were found.",
    });
  }
  if (
    asset.assetType === "schedule" &&
    (!Array.isArray(content.items) || content.items.length === 0)
  ) {
    issues.push({
      code: "MISSING_SCHEDULE_ITEMS",
      severity: "blocking",
      message: "No schedule items were found.",
    });
  }
  if (asset.assetType === "contract") {
    if (!Array.isArray(content.signers) || content.signers.length === 0) {
      issues.push({
        code: "CONFIRM_CONTRACT_SIGNERS",
        severity: "warning",
        message: "Confirm every required signer before this contract is used.",
      });
    }
    if (
      !Array.isArray(content.signatureAnchors) ||
      content.signatureAnchors.length === 0
    ) {
      issues.push({
        code: "CONFIRM_SIGNATURE_ANCHORS",
        severity: "warning",
        message: "Signature placement still needs studio confirmation.",
      });
    }
  }
  return issues;
}

export function coverageForAssetTypes(types: readonly StudioAssetType[]) {
  const required: Array<{
    key: string;
    label: string;
    assetTypes: StudioAssetType[];
  }> = [
    {
      key: "booking",
      label: "Booking",
      assetTypes: ["message_template", "package", "proposal", "contract"],
    },
    {
      key: "planning",
      label: "Planning",
      assetTypes: ["questionnaire", "schedule", "timing_rule"],
    },
    {
      key: "event",
      label: "Event",
      assetTypes: ["crew_preference", "coi_instruction", "schedule"],
    },
    {
      key: "delivery",
      label: "Delivery",
      assetTypes: [
        "delivery_instruction",
        "review_request",
        "message_template",
      ],
    },
  ];
  const present = new Set(types);
  const sections = required.map((section) => {
    const matched = section.assetTypes.filter((type) => present.has(type));
    return {
      key: section.key,
      label: section.label,
      matched,
      expected: section.assetTypes,
      complete: matched.length > 0,
    };
  });
  return {
    sections,
    completed: sections.filter((section) => section.complete).length,
    total: sections.length,
    percent: Math.round(
      (sections.filter((section) => section.complete).length /
        sections.length) *
        100,
    ),
  };
}

export function simulateStudioImport(
  assets: readonly Pick<ExtractedStudioAsset, "assetType" | "name">[],
) {
  const byType = new Map(assets.map((asset) => [asset.assetType, asset]));
  const step = (
    stage: string,
    types: StudioAssetType[],
    fallback: string,
  ) => {
    const match = types.map((type) => byType.get(type)).find(Boolean);
    return {
      stage,
      status: match ? "configured" : "gap",
      source: match?.name ?? null,
      outcome: match
        ? `Uses ${match.name}`
        : fallback,
      providerActionExecuted: false,
    };
  };
  return {
    scenario: "Sample wedding: Alex & Jordan · October 10",
    providerActionsExecuted: false,
    steps: [
      step(
        "Inquiry",
        ["message_template", "workflow"],
        "Add an inquiry response template.",
      ),
      step(
        "Booking",
        ["package", "proposal", "contract"],
        "Add package, proposal, or contract content.",
      ),
      step(
        "Planning",
        ["questionnaire", "schedule", "timing_rule"],
        "Add planning questions or timing rules.",
      ),
      step(
        "Event",
        ["crew_preference", "coi_instruction", "schedule"],
        "Add crew, insurance, or event-day guidance.",
      ),
      step(
        "Delivery",
        ["delivery_instruction", "review_request"],
        "Add delivery or review follow-up content.",
      ),
    ],
  };
}

function sanitizeAssets(value: unknown): ExtractedStudioAsset[] {
  const payload = record(value);
  const raw = Array.isArray(payload.assets) ? payload.assets : [];
  return raw.flatMap((entry) => {
    const asset = record(entry);
    const assetType = string(asset.assetType);
    const name = string(asset.name);
    const confidence = Number(asset.confidence);
    const citations = Array.isArray(asset.citations)
      ? asset.citations.flatMap((citation) => {
          const value = record(citation);
          const locator = string(value.locator);
          const excerpt = string(value.excerpt);
          return locator && excerpt ? [{ locator, excerpt }] : [];
        })
      : [];
    return studioAssetTypes.includes(assetType as StudioAssetType) &&
      name &&
      Number.isFinite(confidence)
      ? [
          {
            assetType: assetType as StudioAssetType,
            name: name.slice(0, 240),
            confidence: Math.min(1, Math.max(0, confidence)),
            structuredContent: record(asset.structuredContent),
            citations: citations.slice(0, 30),
          },
        ]
      : [];
  });
}

async function cloudAccessToken(): Promise<string> {
  const response = await fetch(
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
    { headers: { "Metadata-Flavor": "Google" } },
  );
  if (!response.ok) throw new Error("GOOGLE_RUNTIME_IDENTITY_UNAVAILABLE");
  const token = string(record(await response.json()).access_token);
  if (!token) throw new Error("GOOGLE_RUNTIME_IDENTITY_UNAVAILABLE");
  return token;
}

async function vertexExtraction(input: {
  fileUri: string;
  contentType: string;
  name: string;
  text: string | null;
}): Promise<ExtractedStudioAsset[]> {
  const project = process.env.VERTEX_AI_PROJECT_ID;
  const location = process.env.VERTEX_AI_LOCATION ?? "us-east4";
  const model = process.env.VERTEX_AI_EXTRACTION_MODEL;
  if (!project || !model) throw new Error("VERTEX_AI_NOT_CONFIGURED");
  const token = await cloudAccessToken();
  const sourcePart = input.text
    ? { text: `Source file: ${input.name}\n\n${input.text}` }
    : {
        fileData: {
          mimeType: input.contentType,
          fileUri: input.fileUri,
        },
      };
  const response = await fetch(
    `https://${location}-aiplatform.googleapis.com/v1/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(model)}:generateContent`,
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
                "You are StudioCue Import AI for a wedding photography studio. Classify and extract only facts present in the supplied source. Create one or more reusable assets when the document contains distinct materials. Allowed assetType values: message_template, package, proposal, contract, questionnaire, schedule, timing_rule, crew_preference, coi_instruction, delivery_instruction, review_request, workflow. Preserve the studio's wording. For messages extract subject, body, and variables. For packages/proposals extract lineItems, options, exclusions, and currency exactly. For questionnaires extract ordered fields, field type, options, and required state. For contracts extract body, variables, signer roles, and signature anchors without legal conclusions. For schedules extract ordered items, anchors, durations, and timing rules. Every asset must include source citations with a locator and a short exact excerpt. Do not infer missing prices, dates, signatures, approvals, or provider state. Confidence below 0.8 means a human must correct the draft.",
            },
          ],
        },
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `Extract reusable StudioCue assets from ${input.name}. Return structured JSON only.`,
              },
              sourcePart,
            ],
          },
        ],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              assets: {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  properties: {
                    assetType: {
                      type: "STRING",
                      enum: [...studioAssetTypes],
                    },
                    name: { type: "STRING" },
                    confidence: { type: "NUMBER" },
                    structuredContent: { type: "OBJECT" },
                    citations: {
                      type: "ARRAY",
                      items: {
                        type: "OBJECT",
                        properties: {
                          locator: { type: "STRING" },
                          excerpt: { type: "STRING" },
                        },
                        required: ["locator", "excerpt"],
                      },
                    },
                  },
                  required: [
                    "assetType",
                    "name",
                    "confidence",
                    "structuredContent",
                    "citations",
                  ],
                },
              },
            },
            required: ["assets"],
          },
        },
      }),
    },
  );
  if (!response.ok)
    throw new Error(`VERTEX_STUDIO_IMPORT_FAILED:${response.status}`);
  const payload = record(await response.json());
  const candidates = Array.isArray(payload.candidates)
    ? payload.candidates
    : [];
  const parts = Array.isArray(record(record(candidates[0]).content).parts)
    ? (record(record(candidates[0]).content).parts as unknown[])
    : [];
  const output = string(record(parts[0]).text);
  if (!output) throw new Error("VERTEX_AI_EMPTY_OUTPUT");
  const assets = sanitizeAssets(JSON.parse(output));
  if (!assets.length) throw new Error("STUDIO_IMPORT_NO_ASSETS_EXTRACTED");
  return assets;
}

async function sourceText(item: DocumentSnapshot): Promise<string | null> {
  if (!["txt", "csv", "rtf"].includes(string(item.get("extension"))))
    return null;
  const bucket = string(item.get("bucket"));
  const objectName = string(item.get("storageObjectKey"));
  if (!bucket || !objectName) throw new Error("IMPORT_SOURCE_MISSING");
  const [bytes] = await getStorage().bucket(bucket).file(objectName).download();
  return bytes.toString("utf8").slice(0, 120_000);
}

export async function runStudioImportAnalysis(job: DocumentSnapshot) {
  const db = getFirestore();
  const itemId = string(job.get("itemId"));
  const sessionId = string(job.get("sessionId"));
  const item = await db.doc(`studioImportItems/${itemId}`).get();
  if (
    !item.exists ||
    item.get("tenantId") !== job.get("tenantId") ||
    item.get("sessionId") !== sessionId
  )
    throw new Error("IMPORT_ITEM_NOT_FOUND");
  if (
    !["ready_for_analysis", "analyzing"].includes(
      string(item.get("status")),
    )
  )
    throw new Error("IMPORT_ITEM_NOT_READY_FOR_ANALYSIS");
  if (item.get("safety.malwareScanStatus") !== "passed")
    throw new Error("IMPORT_FILE_NOT_CLEARED");

  const now = new Date().toISOString();
  await item.ref.update({
    status: "analyzing",
    updatedAt: now,
    updatedBy: "studio-import-ai",
  });
  const text = await sourceText(item);
  const bucket = string(item.get("bucket"));
  const objectName = string(item.get("storageObjectKey"));
  const mock = process.env.PROVIDER_MOCK_MODE === "true";
  const assets = mock
    ? deterministicExtraction({
        name: string(item.get("name")),
        text: text ?? string(item.get("name")),
      })
    : await vertexExtraction({
        fileUri: `gs://${bucket}/${objectName}`,
        contentType: string(item.get("contentType")),
        name: string(item.get("name")),
        text,
      });
  const modelVersion = mock
    ? "deterministic-import-v1"
    : string(process.env.VERTEX_AI_EXTRACTION_MODEL);
  const instructionVersion = "studio-import-extraction-v1";
  const session = await db.doc(`studioImportSessions/${sessionId}`).get();
  if (!session.exists || session.get("tenantId") !== job.get("tenantId"))
    throw new Error("IMPORT_SESSION_NOT_FOUND");
  const sessionItemIds = Array.isArray(session.get("itemIds"))
    ? (session.get("itemIds") as unknown[]).map(String)
    : [];
  const sessionItems = await Promise.all(
    sessionItemIds.map((candidateId) =>
      db.doc(`studioImportItems/${candidateId}`).get(),
    ),
  );
  const projectedStatuses = sessionItems.map((candidate) =>
    candidate.id === itemId
      ? "review_ready"
      : string(candidate.get("status")),
  );
  const analysisFinished = projectedStatuses.every((status) =>
    ["review_ready", "failed", "rejected", "ignored", "cancelled"].includes(
      status,
    ),
  );
  const hasFailure = projectedStatuses.some((status) =>
    ["failed", "rejected"].includes(status),
  );
  const batch = db.batch();
  const draftVersionIds: string[] = [];
  assets.forEach((asset, index) => {
    const assetId = `asset_${hash(
      `${job.get("tenantId")}:${asset.assetType}:${asset.name.toLowerCase()}`,
    ).slice(0, 32)}`;
    const versionId = `asset_version_${hash(
      `${itemId}:${index}:${string(item.get("sha256"))}:${instructionVersion}`,
    ).slice(0, 32)}`;
    draftVersionIds.push(versionId);
    const issues = validateExtractedAsset(asset);
    batch.set(db.doc(`studioAssetVersions/${versionId}`), {
      id: versionId,
      tenantId: job.get("tenantId"),
      assetId,
      importSessionId: sessionId,
      sourceItemIds: [itemId],
      assetType: asset.assetType,
      name: asset.name,
      version: 1,
      status: "draft",
      confidence: asset.confidence,
      modelVersion,
      instructionVersion,
      structuredContent: asset.structuredContent,
      sourceCitations: asset.citations.map((citation) => ({
        itemId,
        locator: citation.locator,
        excerpt: citation.excerpt.slice(0, 500),
        excerptHash: hash(citation.excerpt),
      })),
      validation: {
        status: issues.some((issue) => issue.severity === "blocking")
          ? "failed"
          : "passed",
        issues,
      },
      reviewDecision: "pending",
      approvedBy: null,
      approvedAt: null,
      activatedAt: null,
      supersededAt: null,
      createdAt: now,
      updatedAt: now,
      createdBy: "studio-import-ai",
      updatedBy: "studio-import-ai",
      archivedAt: null,
    });
  });
  const highestConfidence = Math.max(
    ...assets.map((asset) => asset.confidence),
  );
  batch.update(item.ref, {
    status: "review_ready",
    classification: {
      assetTypes: [...new Set(assets.map((asset) => asset.assetType))],
      confidence: highestConfidence,
      modelVersion,
      instructionVersion,
      citations: assets.flatMap((asset) =>
        asset.citations.map((citation) => ({
          sourceLabel: string(item.get("name")),
          locator: citation.locator,
          excerptHash: hash(citation.excerpt),
        })),
      ),
    },
    draftVersionIds,
    analyzedAt: now,
    updatedAt: now,
    updatedBy: "studio-import-ai",
  });
  batch.update(session.ref, {
    status: analysisFinished
      ? hasFailure
        ? "partially_failed"
        : "review_ready"
      : "processing",
    reviewReadyAt: analysisFinished ? now : null,
    updatedAt: now,
    updatedBy: "studio-import-ai",
  });
  batch.set(db.doc(`aiInteractions/${job.id}`), {
    id: job.id,
    tenantId: job.get("tenantId"),
    type: "studio_import_extraction",
    itemId,
    sessionId,
    model: modelVersion,
    instructionVersion,
    assetCount: assets.length,
    humanReviewRequired: true,
    createdAt: now,
  });
  await batch.commit();
  return {
    sessionId,
    itemId,
    draftVersionIds,
    assetCount: assets.length,
    humanReviewRequired: true,
  };
}

export function sanitizeStructuredContent(value: unknown): Json {
  return record(value);
}

export function importStringList(value: unknown, limit?: number): string[] {
  return stringList(value, limit);
}
