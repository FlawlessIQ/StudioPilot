import { z } from "zod";

/**
 * A contract StudioCue writes and the couple signs.
 *
 * The studio's own agreement is the source. It arrives as plain text — pasted,
 * or extracted from the docx or PDF they uploaded at import — and it is held
 * as a *template*: that text in a small markdown subset, with `{{field}}`
 * tokens where the couple's details go. A contract is the template resolved
 * against one job's accepted proposal: the tokens replaced by values read from
 * records, frozen into a `ContractDocument`.
 *
 * The document is data, and it is the thing that is signed. `canonicalJson`
 * gives it one byte-exact form so a hash over it names exactly one text. The
 * portal page and the sealed PDF are both renderings of it; neither is the
 * record. PDF bytes are not deterministic from one renderer version to the
 * next, and the JSON is — which is why the couple signs the hash of the JSON,
 * not of a file.
 *
 * Values that decide money are never typed by the studio. A price, a retainer,
 * a payment schedule and a date come from the proposal the couple accepted. A
 * studio may fill a gap the records cannot answer (no venue on the job yet, or
 * a field of the studio's own like "second location"), and that value is
 * recorded as the studio's, beside the document.
 *
 * Pure and deterministic, and deliberately free of any "@/" import. It is
 * duplicated at functions/src/contracts/document.ts, because functions/ is a
 * separate package; tests/contract-document.test.ts fails if the two differ.
 */

export const CONTRACT_DOCUMENT_FORMAT = 1 as const;

/** Enough for a long agreement, short enough that nobody pastes a book. */
export const TEMPLATE_BODY_MAX = 60_000;

export type ContractInline = {
  text: string;
  bold?: true;
  /** The merge field this text came from, so a page can show what was filled. */
  field?: string;
};

export type ContractBlock =
  | { type: "heading"; level: 1 | 2; content: ContractInline[] }
  | { type: "paragraph"; content: ContractInline[] }
  /**
   * Each item is an object, never a bare array: Firestore refuses an array
   * nested directly in an array ("invalid nested entity"). A list of lists
   * passed every test and the emulator walk, and failed on the first real
   * agreement with a bulleted list (production, 2026-09-25).
   */
  | { type: "list"; items: Array<{ content: ContractInline[] }> }
  | {
      type: "payment_schedule";
      rows: Array<{ label: string; amount: string; due: string }>;
    };

export type ContractDocument = {
  format: typeof CONTRACT_DOCUMENT_FORMAT;
  title: string;
  blocks: ContractBlock[];
};

const inlineSchema = z.object({
  text: z.string(),
  bold: z.literal(true).optional(),
  field: z.string().optional(),
});

export const contractDocumentSchema = z.object({
  format: z.literal(CONTRACT_DOCUMENT_FORMAT),
  title: z.string().min(1).max(200),
  blocks: z
    .array(
      z.discriminatedUnion("type", [
        z.object({
          type: z.literal("heading"),
          level: z.union([z.literal(1), z.literal(2)]),
          content: z.array(inlineSchema),
        }),
        z.object({ type: z.literal("paragraph"), content: z.array(inlineSchema) }),
        z.object({
          type: z.literal("list"),
          items: z.array(z.object({ content: z.array(inlineSchema) })),
        }),
        z.object({
          type: z.literal("payment_schedule"),
          rows: z.array(
            z.object({ label: z.string(), amount: z.string(), due: z.string() }),
          ),
        }),
      ]),
    )
    .max(2_000),
});

/**
 * The fields StudioCue can fill from its own records.
 *
 * `block` fields render as a whole block and only mean something on a line of
 * their own; written mid-sentence they fall back to a short inline form.
 */
export const contractMergeFields = [
  { key: "client.names", label: "Client names", example: "Emma Hart & James Cole" },
  { key: "client.email", label: "Client email", example: "emma@example.com" },
  { key: "event.name", label: "Event name", example: "Emma & James's wedding" },
  { key: "event.type", label: "Event type", example: "Wedding" },
  { key: "event.date", label: "Event date", example: "Saturday, June 12, 2027" },
  { key: "event.venue", label: "Venue", example: "Wildflower Barn" },
  { key: "package.name", label: "Package", example: "Full Day Collection" },
  { key: "package.coverage", label: "Coverage", example: "2 photographers, 8 hours" },
  { key: "package.deliverables", label: "Deliverables (list)", example: "Online gallery; 10x10 album", block: true },
  { key: "price.total", label: "Total price", example: "$6,400.00" },
  { key: "price.retainer", label: "Retainer", example: "$1,600.00" },
  { key: "price.balance", label: "Balance after retainer", example: "$4,800.00" },
  { key: "payment.schedule", label: "Payment schedule (table)", example: "Retainer $1,600.00 …", block: true },
  /**
   * What the couple told the studio before the meeting, printed into the
   * thing they sign.
   *
   * "I need the wedding venue form sent to them and on the contract" — and
   * when asked whether the answers should travel alongside or be printed in:
   * "They should be on the signed contract document itself." Venue, timings
   * and access are what the studio is agreeing to work around, so they belong
   * inside the agreement rather than attached beside it.
   */
  { key: "form.answers", label: "Details form answers (list)", example: "Ceremony start: 3:00 PM", block: true },
  { key: "studio.name", label: "Studio name", example: "Hart Light Photography" },
  { key: "studio.legal_name", label: "Studio legal name", example: "Hart Light Photography LLC" },
  { key: "contract.date", label: "Date prepared", example: "September 25, 2026" },
] as const;

export type ContractMergeFieldKey = (typeof contractMergeFields)[number]["key"];

const catalogueKeys = new Set<string>(contractMergeFields.map((field) => field.key));

/** Fields whose value is money or a date: filled only from records, never typed. */
export const recordOnlyFields: ReadonlySet<string> = new Set([
  "event.date",
  "price.total",
  "price.retainer",
  "price.balance",
  "payment.schedule",
]);

export type ContractCustomField = { key: string; label: string };

/** Everything a contract is resolved from. Assembled server-side from records. */
export type ContractSources = {
  client: { names: string; email: string };
  event: {
    name: string;
    type: string;
    /** YYYY-MM-DD */
    date: string;
    venue: string | null;
  };
  package: {
    name: string;
    coverage: string | null;
    deliverables: string[];
  };
  pricing: {
    currency: string;
    totalCents: number;
    retainerCents: number;
  };
  paymentSchedule: Array<{
    label: string;
    amountCents: number;
    /** YYYY-MM-DD or null when the date is set by agreement. */
    dueDate: string | null;
  }>;
  /**
   * The couple's own answers to the details form, in the order asked.
   * Empty when nothing has been submitted — the field then renders as an
   * unfilled placeholder like any other, rather than an empty heading.
   */
  formAnswers: Array<{ question: string; answer: string }>;
  studio: { name: string; legalName: string | null };
  /** YYYY-MM-DD, the day the contract was prepared. */
  contractDate: string;
};

export type ContractTemplateInput = {
  title: string;
  body: string;
  customFields: ContractCustomField[];
};

export type ResolvedField = {
  key: string;
  label: string;
  value: string | null;
  source: "record" | "studio" | "missing";
};

export type ResolvedContract = {
  document: ContractDocument;
  fields: ResolvedField[];
  /** Keys with no value. A contract cannot be sent while this is non-empty. */
  unresolved: string[];
};

export function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

export function formatContractDate(
  isoDate: string,
  withWeekday = false,
): string {
  const date = new Date(`${isoDate.slice(0, 10)}T12:00:00.000Z`);
  if (Number.isNaN(date.valueOf())) return isoDate;
  return new Intl.DateTimeFormat("en-US", {
    ...(withWeekday ? { weekday: "long" as const } : {}),
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

/** "client names" → "custom.client_names"; the key a custom field is held under. */
export function customFieldKey(label: string): string {
  const slug = label
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
  return `custom.${slug || "field"}`;
}

/** The key a `{{token}}` refers to: a catalogue field, or a custom one. */
export function normaliseTokenKey(token: string): string {
  const trimmed = token.trim();
  if (catalogueKeys.has(trimmed)) return trimmed;
  if (/^custom\.[a-z0-9_]+$/.test(trimmed)) return trimmed;
  return customFieldKey(trimmed.replace(/^custom\./, ""));
}

function labelFor(key: string, customFields: readonly ContractCustomField[]): string {
  const catalogue = contractMergeFields.find((field) => field.key === key);
  if (catalogue) return catalogue.label;
  const custom = customFields.find((field) => field.key === key);
  if (custom) return custom.label;
  const words = key.replace(/^custom\./, "").replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function recordValue(key: string, sources: ContractSources): string | null {
  const nonEmpty = (value: string | null | undefined) =>
    value && value.trim() ? value.trim() : null;
  switch (key) {
    case "client.names":
      return nonEmpty(sources.client.names);
    case "client.email":
      return nonEmpty(sources.client.email);
    case "event.name":
      return nonEmpty(sources.event.name);
    case "event.type":
      return nonEmpty(sources.event.type);
    case "event.date":
      return nonEmpty(sources.event.date)
        ? formatContractDate(sources.event.date, true)
        : null;
    case "event.venue":
      return nonEmpty(sources.event.venue);
    case "package.name":
      return nonEmpty(sources.package.name);
    case "package.coverage":
      return nonEmpty(sources.package.coverage);
    case "package.deliverables": {
      const items = sources.package.deliverables.map((item) => item.trim()).filter(Boolean);
      return items.length ? items.join("; ") : null;
    }
    case "form.answers": {
      // Inline fallback for a field written mid-sentence, the same shape the
      // other block fields take. Nothing submitted reads as missing, not blank.
      const rows = sources.formAnswers
        .map((row) => `${row.question.trim()}: ${row.answer.trim()}`)
        .filter((row) => row.length > 2);
      return rows.length ? rows.join("; ") : null;
    }
    case "price.total":
      return formatMoney(sources.pricing.totalCents, sources.pricing.currency);
    case "price.retainer":
      return formatMoney(sources.pricing.retainerCents, sources.pricing.currency);
    case "price.balance":
      return formatMoney(
        Math.max(0, sources.pricing.totalCents - sources.pricing.retainerCents),
        sources.pricing.currency,
      );
    case "payment.schedule":
      return sources.paymentSchedule.length
        ? sources.paymentSchedule
            .map(
              (row) =>
                `${row.label} ${formatMoney(row.amountCents, sources.pricing.currency)}`,
            )
            .join("; ")
        : null;
    case "studio.name":
      return nonEmpty(sources.studio.name);
    case "studio.legal_name":
      return nonEmpty(sources.studio.legalName) ?? nonEmpty(sources.studio.name);
    case "contract.date":
      return formatContractDate(sources.contractDate);
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Template format
// ---------------------------------------------------------------------------

type RawBlock =
  | { type: "heading"; level: 1 | 2; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] }
  | { type: "field_block"; key: string };

const TOKEN = /\{\{\s*([^{}]{1,80}?)\s*\}\}/g;
const BULLET = /^\s*[-*•]\s+(.*)$/;
const HEADING = /^(#{1,2})\s+(.*)$/;
const LONE_TOKEN = /^\s*\{\{\s*([^{}]{1,80}?)\s*\}\}\s*$/;

function normaliseText(value: string): string {
  return value.normalize("NFC").replace(/\r\n?/g, "\n").replace(/\t/g, "    ");
}

function parseRawBlocks(body: string): RawBlock[] {
  const lines = normaliseText(body).slice(0, TEMPLATE_BODY_MAX).split("\n");
  const blocks: RawBlock[] = [];
  let paragraph: string[] = [];
  let list: string[] | null = null;
  const flush = () => {
    if (paragraph.length) {
      blocks.push({ type: "paragraph", text: paragraph.join("\n") });
      paragraph = [];
    }
    if (list) {
      blocks.push({ type: "list", items: list });
      list = null;
    }
  };
  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, "");
    if (!line.trim()) {
      flush();
      continue;
    }
    const heading = line.match(HEADING);
    if (heading) {
      flush();
      blocks.push({
        type: "heading",
        level: heading[1]!.length === 1 ? 1 : 2,
        text: heading[2]!.trim(),
      });
      continue;
    }
    const lone = line.match(LONE_TOKEN);
    if (lone) {
      const key = normaliseTokenKey(lone[1]!);
      if (
        key === "payment.schedule" ||
        key === "package.deliverables" ||
        key === "form.answers"
      ) {
        flush();
        blocks.push({ type: "field_block", key });
        continue;
      }
    }
    const bullet = line.match(BULLET);
    if (bullet) {
      if (paragraph.length) {
        blocks.push({ type: "paragraph", text: paragraph.join("\n") });
        paragraph = [];
      }
      list ??= [];
      list.push(bullet[1]!.trim());
      continue;
    }
    if (list) {
      // A wrapped bullet: an indented line continues the item above it.
      if (/^\s{2,}/.test(rawLine) && list.length) {
        list[list.length - 1] = `${list[list.length - 1]} ${line.trim()}`;
        continue;
      }
      blocks.push({ type: "list", items: list });
      list = null;
    }
    paragraph.push(line.trim());
  }
  flush();
  return blocks;
}

/** Every field a template refers to, in first-use order. */
export function templateFieldKeys(body: string): string[] {
  const keys: string[] = [];
  for (const match of normaliseText(body).matchAll(TOKEN)) {
    const key = normaliseTokenKey(match[1]!);
    if (!keys.includes(key)) keys.push(key);
  }
  return keys;
}

function inlines(
  text: string,
  valueFor: (key: string) => string | null,
): ContractInline[] {
  const out: ContractInline[] = [];
  const push = (piece: ContractInline) => {
    if (!piece.text) return;
    const last = out[out.length - 1];
    if (
      last &&
      !last.field &&
      !piece.field &&
      Boolean(last.bold) === Boolean(piece.bold)
    ) {
      last.text += piece.text;
      return;
    }
    out.push(piece);
  };
  // Bold first, then tokens inside each run, so **{{client.names}}** works.
  const runs = text.split(/(\*\*[^*]+\*\*)/g);
  for (const run of runs) {
    if (!run) continue;
    const bold = run.startsWith("**") && run.endsWith("**") && run.length > 4;
    const inner = bold ? run.slice(2, -2) : run;
    let cursor = 0;
    for (const match of inner.matchAll(TOKEN)) {
      const index = match.index ?? 0;
      push({ text: inner.slice(cursor, index), ...(bold ? { bold: true as const } : {}) });
      const key = normaliseTokenKey(match[1]!);
      const value = valueFor(key);
      push({
        text: value ?? `[${key}]`,
        field: key,
        ...(bold ? { bold: true as const } : {}),
      });
      cursor = index + match[0].length;
    }
    push({ text: inner.slice(cursor), ...(bold ? { bold: true as const } : {}) });
  }
  return out;
}

/**
 * Resolve a template against one job's records.
 *
 * `overrides` are values the studio typed for fields the records cannot
 * answer. They are ignored for any field the records *do* answer, and for the
 * record-only fields (money and dates) always — see `recordOnlyFields`.
 */
export function resolveContractDocument(input: {
  template: ContractTemplateInput;
  sources: ContractSources;
  overrides: Record<string, string>;
}): ResolvedContract {
  const { template, sources } = input;
  const fields = new Map<string, ResolvedField>();
  const valueFor = (key: string): string | null => {
    const known = fields.get(key);
    if (known) return known.value;
    const fromRecord = recordValue(key, sources);
    const typed = input.overrides[key]?.trim();
    const allowOverride = !recordOnlyFields.has(key);
    const resolved: ResolvedField = fromRecord
      ? { key, label: labelFor(key, template.customFields), value: fromRecord, source: "record" }
      : typed && allowOverride
        ? { key, label: labelFor(key, template.customFields), value: typed.slice(0, 500), source: "studio" }
        : { key, label: labelFor(key, template.customFields), value: null, source: "missing" };
    fields.set(key, resolved);
    return resolved.value;
  };

  const blocks: ContractBlock[] = [];
  for (const raw of parseRawBlocks(template.body)) {
    if (raw.type === "heading") {
      blocks.push({ type: "heading", level: raw.level, content: inlines(raw.text, valueFor) });
    } else if (raw.type === "paragraph") {
      blocks.push({ type: "paragraph", content: inlines(raw.text, valueFor) });
    } else if (raw.type === "list") {
      blocks.push({
        type: "list",
        items: raw.items.map((item) => ({ content: inlines(item, valueFor) })),
      });
    } else if (raw.key === "payment.schedule") {
      const value = valueFor("payment.schedule");
      blocks.push(
        value
          ? {
              type: "payment_schedule",
              rows: sources.paymentSchedule.map((row) => ({
                label: row.label,
                amount: formatMoney(row.amountCents, sources.pricing.currency),
                due: row.dueDate ? formatContractDate(row.dueDate) : undatedPaymentDue(row.label),
              })),
            }
          : { type: "paragraph", content: [{ text: "[payment.schedule]", field: "payment.schedule" }] },
      );
    } else if (raw.key === "form.answers") {
      // Rendered as a list rather than a new block type, so the document
      // format, its schema and the PDF renderer are all untouched.
      const answered = valueFor("form.answers");
      const rows = sources.formAnswers
        .map((row) => ({
          question: row.question.trim(),
          answer: row.answer.trim(),
        }))
        .filter((row) => row.question && row.answer);
      blocks.push(
        answered && rows.length
          ? {
              type: "list",
              items: rows.map((row) => ({
                content: [
                  { text: `${row.question}: `, bold: true, field: "form.answers" },
                  { text: row.answer, field: "form.answers" },
                ],
              })),
            }
          : { type: "paragraph", content: [{ text: "[form.answers]", field: "form.answers" }] },
      );
    } else {
      const value = valueFor("package.deliverables");
      const items = sources.package.deliverables.map((item) => item.trim()).filter(Boolean);
      blocks.push(
        value && items.length
          ? {
              type: "list",
              items: items.map((item) => ({
                content: [{ text: item, field: "package.deliverables" }],
              })),
            }
          : { type: "paragraph", content: [{ text: "[package.deliverables]", field: "package.deliverables" }] },
      );
    }
  }
  const resolvedFields = [...fields.values()];
  return {
    document: {
      format: CONTRACT_DOCUMENT_FORMAT,
      title: template.title.trim().slice(0, 200) || "Agreement",
      blocks,
    },
    fields: resolvedFields,
    unresolved: resolvedFields
      .filter((field) => field.value === null)
      .map((field) => field.key),
  };
}

/**
 * What an undated payment says instead of a date. The same words everywhere a
 * schedule is shown — proposal page, proposal PDF, contract — because on the
 * production walk the proposal said "On signing" and the contract said "As
 * agreed" for the same retainer.
 */
export function undatedPaymentDue(label: string): string {
  return /\b(retainer|deposit|booking fee)\b/i.test(label) ? "On signing" : "As agreed";
}

/** The text of an inline run, as a reader sees it. */
export function inlineText(content: readonly ContractInline[]): string {
  return content.map((piece) => piece.text).join("");
}

/**
 * Whether a value can be stored in Firestore as written: no array directly
 * inside another array. Checked by tests over every block shape, because the
 * emulator walk did not catch it and production did.
 */
export function firestoreStorable(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.every((item) => !Array.isArray(item) && firestoreStorable(item));
  }
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).every(firestoreStorable);
  }
  return true;
}

// ---------------------------------------------------------------------------
// Canonical form
// ---------------------------------------------------------------------------

function canonicalValue(value: unknown): unknown {
  if (typeof value === "string") return value.normalize("NFC");
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
        .sort()
        .map((key) => [key, canonicalValue((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

/**
 * One exact serialisation: sorted keys, NFC strings, no undefined. The hash of
 * this string is what the couple signs.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

// ---------------------------------------------------------------------------
// Bringing an imported agreement in
// ---------------------------------------------------------------------------

/**
 * Placeholder names as studios actually write them, mapped to the field
 * StudioCue fills. Order matters: the specific names come before the general
 * ones they contain ("retainer amount" before "amount").
 */
const placeholderSynonyms: ReadonlyArray<[RegExp, ContractMergeFieldKey]> = [
  [/\b(today|signing date|contract date|effective date|date of (this )?agreement)\b/i, "contract.date"],
  [/\blegal (business )?name\b/i, "studio.legal_name"],
  [/\b(retainer|deposit|booking fee)\b/i, "price.retainer"],
  [/\b(balance|remaining|remainder)\b/i, "price.balance"],
  [/\b(payment schedule|payment plan|installments?)\b/i, "payment.schedule"],
  [/\b(total|fee|price|investment|amount|cost)\b/i, "price.total"],
  [/\b(deliverables|what'?s included|includes)\b/i, "package.deliverables"],
  [/\b(hours|coverage)\b/i, "package.coverage"],
  [/\b(package|collection)\b/i, "package.name"],
  // "Location" alone, or the event's location — but not "getting ready
  // location" or "second location", which are places the venue field does
  // not hold. Those fall through to a custom field the studio fills.
  [/\bvenue\b|^\s*(event |wedding |ceremony |reception )?(location|site)\s*$/i, "event.venue"],
  [/\b(event|wedding|session) type\b|\btype of (event|session)\b/i, "event.type"],
  [/\b(event|wedding|session) name\b/i, "event.name"],
  [/\bdate\b/i, "event.date"],
  [/\bemail\b/i, "client.email"],
  [/\b(studio|photographer|videographer|company|business)\b/i, "studio.name"],
  [/\b(client|couple|bride|groom|partner|customer|names?)\b/i, "client.names"],
];

/** What an imported placeholder most likely means, or null when nothing fits. */
export function suggestFieldForPlaceholder(name: string): ContractMergeFieldKey | null {
  const trimmed = name.trim();
  if (catalogueKeys.has(trimmed)) return trimmed as ContractMergeFieldKey;
  for (const [pattern, key] of placeholderSynonyms) {
    if (pattern.test(trimmed)) return key;
  }
  return null;
}

/** A line whose only job was to be signed on paper. */
const SIGNATURE_LINE =
  /^(?:[\s_.-]*|.*\b(signature|signed|sign here|print name|initials?|date)\b\s*:?\s*[_.]{3,}.*)$/i;

export type ImportedAgreementConversion = {
  /** The agreement's own title, when its first line was one. */
  title: string | null;
  body: string;
  customFields: ContractCustomField[];
  mapped: Array<{ placeholder: string; key: string }>;
  signatureLinesRemoved: number;
  /** The agreement had no place for the couple, date or price, so a details section was added. */
  detailsAdded: boolean;
  /** The text arrived as one run and was split back into its clauses. */
  clausesRestored: number;
};

/**
 * A clause label as agreements write them: "Booking Fee:", "Payment & Prices:",
 * "Limitation of Liability:" — a capitalised run of up to five words and a colon.
 */
const CLAUSE_LABEL =
  /(^|[.!?]["”’)]?\s+)([A-Z][A-Za-z’']*(?:\s+(?:&|and|of|the|or|[A-Z][A-Za-z’']*)){0,4}):\s+/g;

/**
 * Put back the paragraph breaks an extractor flattened.
 *
 * Found on production: an agreement imported from a PDF arrived as a single
 * 3,000-character line, so the contract rendered as one wall of text. Its
 * clauses were still marked — every one opened with a label and a colon — so
 * each labelled clause becomes its own paragraph, the label in bold. Text that
 * already has its line breaks is left exactly as written.
 */
export function restoreClauseBreaks(text: string): { text: string; restored: number } {
  const lines = text.split("\n").filter((line) => line.trim());
  const longest = Math.max(0, ...lines.map((line) => line.length));
  if (lines.length > 3 && longest < 800) return { text, restored: 0 };
  let restored = 0;
  const rebuilt = text.replace(CLAUSE_LABEL, (_, before: string, label: string) => {
    restored += 1;
    return `${before.trimEnd()}${before ? "\n\n" : ""}**${label}:** `;
  });
  return restored >= 2 ? { text: rebuilt, restored } : { text, restored: 0 };
}

/**
 * Where a contract names who, when and how much, when the studio's own
 * agreement never did. Every value is filled from the job; the studio sees it
 * in the editor and may move or reword it before saving.
 */
export const DETAILS_SECTION = [
  "## The details",
  "This agreement is between {{studio.legal_name}} (\"the Studio\") and {{client.names}} (\"the Client\") for {{event.type}} coverage on {{event.date}} at {{event.venue}}.",
  "",
  "- Package: {{package.name}}",
  "- Total: {{price.total}}",
  "- Retainer: {{price.retainer}}",
  "",
  "{{payment.schedule}}",
].join("\n");

/**
 * Turn an imported agreement's text into a template the studio then reviews.
 *
 * Placeholders in the three shapes the importer detects — `{{x}}`, `[X]`,
 * `<<x>>` — become `{{field}}` tokens: a catalogue field where the name makes
 * the meaning plain, a custom field (filled per contract) where it does not.
 * Paper signature lines are dropped because StudioCue adds the signature page;
 * the count is reported so the editor can say so. Short all-caps lines become
 * headings. Nothing else in the studio's wording changes.
 *
 * This prepares a draft. It writes nothing; the studio saves the result.
 */
export function convertImportedAgreement(text: string): ImportedAgreementConversion {
  const customFields: ContractCustomField[] = [];
  const mapped: Array<{ placeholder: string; key: string }> = [];
  const tokenFor = (placeholder: string): string => {
    const name = placeholder.trim();
    const suggested = suggestFieldForPlaceholder(name);
    const key = suggested ?? customFieldKey(name);
    if (!suggested && !customFields.some((field) => field.key === key)) {
      customFields.push({ key, label: name.slice(0, 80) });
    }
    if (!mapped.some((entry) => entry.placeholder === name)) {
      mapped.push({ placeholder: name, key });
    }
    return `{{${key}}}`;
  };
  let signatureLinesRemoved = 0;
  const restoredText = restoreClauseBreaks(normaliseText(text));
  const lines = restoredText.text.split("\n").flatMap((line) => {
    if (line.trim() && SIGNATURE_LINE.test(line.trim())) {
      signatureLinesRemoved += 1;
      return [];
    }
    const converted = line
      .replace(/\{\{\s*([^{}]{1,80}?)\s*\}\}/g, (_, name: string) => tokenFor(name))
      .replace(/<<\s*([^<>]{1,80}?)\s*>>/g, (_, name: string) => tokenFor(name))
      .replace(/\[\s*([A-Za-z][A-Za-z0-9 _'-]{1,60})\s*\]/g, (_, name: string) => tokenFor(name));
    const trimmed = converted.trim();
    const isHeading =
      trimmed.length >= 3 &&
      trimmed.length <= 60 &&
      /[A-Z]/.test(trimmed) &&
      trimmed === trimmed.toUpperCase() &&
      !/[.:;,]$/.test(trimmed) &&
      !trimmed.includes("{{");
    return [isHeading ? `## ${trimmed}` : converted];
  });
  // An agreement's first line is usually its title. The contract prints the
  // title once, above everything, so it comes out of the body rather than
  // appearing twice.
  const firstIndex = lines.findIndex((line) => line.trim().length > 0);
  let title: string | null = null;
  if (firstIndex >= 0 && lines[firstIndex]!.startsWith("## ")) {
    const heading = lines[firstIndex]!.slice(3).trim();
    if (!/^\d/.test(heading)) {
      title = heading
        .toLowerCase()
        .replace(/(^|[\s&/-])(\p{L})/gu, (_, lead: string, letter: string) => `${lead}${letter.toUpperCase()}`)
        .replace(/\b(And|Or|Of|The|For|To|In|On)\b/g, (word) => word.toLowerCase())
        .replace(/^./, (letter) => letter.toUpperCase());
      lines.splice(firstIndex, 1);
    }
  }
  // An agreement with nowhere for the couple's names, the date or the price
  // would go out as terms alone. The studio's own words stay untouched; the
  // details go above them.
  const essentials = ["client.names", "event.date", "price.total"];
  const detailsAdded = !mapped.some((entry) => essentials.includes(entry.key));
  const joined = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  const body = (detailsAdded ? `${DETAILS_SECTION}\n\n## Terms\n${joined}` : joined).slice(
    0,
    TEMPLATE_BODY_MAX,
  );
  return {
    title,
    body,
    customFields,
    mapped,
    signatureLinesRemoved,
    detailsAdded,
    clausesRestored: restoredText.restored,
  };
}

/**
 * The text of a stored `agreementTemplates.body`, whichever extractor wrote
 * it. The deterministic extractor stores `{ body, sourceText, variables }`;
 * the model-backed one may store only `sourceText`, or a bare string.
 */
export function importedAgreementText(body: unknown): string {
  if (typeof body === "string") return body;
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    for (const key of ["body", "sourceText", "text", "content"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return value;
    }
  }
  return "";
}
