type Json = Record<string, unknown>;

const record = (value: unknown): Json =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Json)
    : {};

const text = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const firstUrl = (value: string): string | null =>
  value.match(/https?:\/\/[^\s<>"')\]]+/i)?.[0]?.replace(/[.,;:]+$/, "") ??
  null;

const messageKeyMatchers: Array<[RegExp, string]> = [
  [/(inquiry|lead).*(acknowledge|received|thank)/, "inquiry_acknowledgement"],
  [/consultation.*remind/, "consultation_reminder"],
  [/consultation.*(confirm|book)/, "consultation_confirmation"],
  [/package.*follow/, "package_follow_up"],
  [/proposal/, "proposal_sent"],
  [/contract/, "contract_sent"],
  [/retainer.*invoice/, "retainer_invoice"],
  [/booking.*confirm/, "booking_confirmation"],
  [/questionnaire.*remind/, "questionnaire_reminder"],
  [/questionnaire/, "questionnaire_request"],
  [/(coi|insurance).*(correct|fix)/, "coi_correction"],
  [/(coi|insurance).*(venue|deliver|send)/, "coi_venue_delivery"],
  [/(coi|insurance)/, "coi_request"],
  [/crew.*remind/, "crew_reminder"],
  [/final.*(invoice|balance|payment)/, "final_invoice"],
  [/schedule.*(review|confirm)/, "schedule_review"],
  [/schedule.*(final|publish)/, "final_schedule_published"],
  [/(event|wedding).*(remind|prepar|tomorrow)/, "event_reminder"],
  [/(thank.?you|gratitude)/, "thank_you"],
  [/(gallery|deliver)/, "delivery"],
  [/(review|testimonial)/, "review_request"],
  [/client.*invit/, "client_invitation"],
  [/crew.*invit/, "crew_invitation"],
];

export function importedMessageTemplate(input: {
  name: string;
  structuredContent: unknown;
}) {
  const content = record(input.structuredContent);
  const source = text(content.sourceText);
  const rawBody = text(content.body) || source;
  const searchText = `${input.name} ${text(content.subject)} ${rawBody}`
    .toLowerCase()
    .replace(/\s+/g, " ");
  const key =
    messageKeyMatchers.find(([pattern]) => pattern.test(searchText))?.[1] ??
    "manual_message";
  const subject =
    text(content.subject) ||
    rawBody.match(/^\s*subject\s*:\s*(.+)$/im)?.[1]?.trim() ||
    input.name;
  const body = rawBody.replace(/^\s*subject\s*:\s*.+(?:\r?\n)?/im, "").trim();
  const paragraphs = body
    .split(/\n\s*\n|\r?\n(?=\S)/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .slice(0, 20);
  const firstParagraph = paragraphs[0]?.replace(/\{\{[^}]+\}\}/g, "").trim();

  return {
    key,
    name: input.name,
    subject,
    preheader:
      firstParagraph?.slice(0, 180) ||
      `A message from your photography studio.`,
    eyebrow: input.name,
    heading: input.name,
    paragraphs: paragraphs.length ? paragraphs : [body || input.name],
    actionLabel: firstUrl(body) ? "Open details" : null,
    note: null,
  };
}

export function importedDeliveryDefaults(
  structuredContent: unknown,
): Json {
  const content = record(structuredContent);
  const source = `${text(content.sourceText)} ${text(content.body)}`.trim();
  const normalized = source.toLowerCase();
  const galleryProviders: Array<[string, string]> = [
    ["pic-time", "pic_time"],
    ["pictime", "pic_time"],
    ["pixieset", "pixieset"],
    ["shootproof", "shootproof"],
    ["cloudspot", "cloudspot"],
  ];
  const provider = galleryProviders.find(([label]) =>
    normalized.includes(label),
  )?.[1];
  const expiration = normalized.match(
    /(?:expire|expiration|available for)\D{0,20}(\d{1,3})\s*days?/,
  )?.[1];
  const url = firstUrl(source);

  return {
    ...(provider ? { "deliveryDefaults.galleryProvider": provider } : {}),
    ...(expiration
      ? {
          "deliveryDefaults.galleryExpirationDays": Math.max(
            1,
            Math.min(3650, Number(expiration)),
          ),
        }
      : {}),
    ...(url ? { "deliveryDefaults.albumInstructionsUrl": url } : {}),
  };
}

export function importedReviewLink(
  structuredContent: unknown,
): { field: string; url: string } | null {
  const content = record(structuredContent);
  const source = `${text(content.sourceText)} ${text(content.body)}`.trim();
  const url = firstUrl(source);
  if (!url) return null;
  const normalized = source.toLowerCase();
  const field = normalized.includes("weddingwire")
    ? "weddingwire"
    : normalized.includes("the knot") || normalized.includes("theknot")
      ? "theKnot"
      : normalized.includes("facebook")
        ? "facebook"
        : normalized.includes("google")
          ? "google"
          : "custom";
  return { field, url };
}
