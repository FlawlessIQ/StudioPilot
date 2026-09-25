import { eventDateFrom } from "../communications/forwarded-inquiry.js";

/**
 * Reading an inquiry out of an email.
 *
 * Most couples don't email a studio: they fill in the contact form on its
 * website, and the website emails the studio. That notification is written by
 * Squarespace, Wix, Showit, WordPress and the rest — each its own shape, sent
 * from a no-reply address, with the couple's details laid out as labelled
 * fields. The studio has typically been retyping those fields into whatever it
 * books with. This module reads them.
 *
 * Three layers, each only when the one before has nothing:
 *
 *  1. The form's own fields — `Label: value` lines, or a label on one line and
 *     its value on the next (how HTML notifications flatten to text). Mapped to
 *     lead fields by label, with the studio's own saved mapping first.
 *  2. The email's headers — Reply-To is where most builders put the couple.
 *  3. The free text — left for the model, which fills only what is still empty
 *     (functions/src/intake/enrich.ts). Nothing here guesses.
 *
 * Every value carries where it came from, so the studio can see which fields
 * the form stated and which were read out of a sentence.
 *
 * Pure: no I/O. Fixtures in tests/fixtures/form-emails/ are the contract.
 */

export type FormBuilder =
  | "squarespace"
  | "wix"
  | "showit"
  | "wordpress"
  | "pixieset"
  | "jotform"
  | "google_forms"
  | "123formbuilder"
  | "the_knot"
  | "weddingwire"
  | "zola"
  | "unknown";

export const BUILDER_LABEL: Record<FormBuilder, string> = {
  squarespace: "Squarespace form",
  wix: "Wix form",
  showit: "Showit form",
  wordpress: "WordPress form",
  pixieset: "Pixieset form",
  jotform: "Jotform",
  google_forms: "Google Form",
  "123formbuilder": "123FormBuilder form",
  the_knot: "The Knot",
  weddingwire: "WeddingWire",
  zola: "Zola",
  unknown: "Email",
};

/**
 * The senders each builder uses. Marketplaces are inquiries by definition;
 * builders are the studio's own website form.
 */
const BUILDER_SENDERS: Array<[RegExp, FormBuilder]> = [
  [/@squarespace\.(info|com)$/i, "squarespace"],
  [/@(wix-forms\.com|crm\.wix\.com|wixsiteautomations\.com|wix\.com|wixforms\.com)$/i, "wix"],
  [/@showit\.(co|com)$/i, "showit"],
  // Pixieset's notifications come from pixiesetmail.com, not pixieset.com.
  [/@(.*\.)?(pixieset|pixiesetmail)\.com$/i, "pixieset"],
  [/@jotform\.com$/i, "jotform"],
  [/^forms-receipts-noreply@google\.com$/i, "google_forms"],
  [/@(123formbuilder\.com|123contactform\.com)$/i, "123formbuilder"],
  [/@(.*\.)?theknot\.com$/i, "the_knot"],
  [/@(.*\.)?weddingwire\.com$/i, "weddingwire"],
  [/@(.*\.)?zola\.com$/i, "zola"],
];

export const MARKETPLACES: ReadonlySet<FormBuilder> = new Set(["the_knot", "weddingwire", "zola"]);

export type LeadFieldKey =
  | "fullName"
  | "firstName"
  | "lastName"
  | "partnerName"
  | "email"
  | "phone"
  | "eventDate"
  | "eventType"
  | "venue"
  | "city"
  | "ceremonyTime"
  | "guestCount"
  | "budget"
  | "services"
  | "referralSource"
  | "message";

export const LEAD_FIELD_LABEL: Record<LeadFieldKey, string> = {
  fullName: "Name",
  firstName: "First name",
  lastName: "Last name",
  partnerName: "Partner",
  email: "Email",
  phone: "Phone",
  eventDate: "Event date",
  eventType: "Event type",
  venue: "Venue",
  city: "City",
  ceremonyTime: "Ceremony time",
  guestCount: "Guests",
  budget: "Budget",
  services: "Services",
  referralSource: "How they heard",
  message: "Message",
};

/**
 * Labels as studios' forms actually word them, most specific first. A label
 * matches the first pattern it fits; the studio's saved mapping beats all.
 */
const LABEL_PATTERNS: Array<[RegExp, LeadFieldKey]> = [
  // Unmistakable message prompts first: "Tell us about your wedding day" is a
  // message, not a date.
  [/\b(tell us|anything else|additional (info|information|details)|your message|message( body)?|comments?)\b/i, "message"],
  // "Where did you hear about us" is a referral, not a venue.
  [/\b(how did you (hear|find)|where did you (hear|find)|referr|found us|heard about)\b/i, "referralSource"],
  // No trailing \b after "fiancé": "é" is not a word character, so the
  // boundary never matches before "'s".
  [/\b(partner|spouse|other half|significant other)\b|\bfianc[eé]|\b(groom|bride)'?s? name\b/i, "partnerName"],
  [/\bfirst\s*name\b/i, "firstName"],
  [/\b(last\s*name|surname|family name)\b/i, "lastName"],
  [/\b(e-?mail)\b/i, "email"],
  [/\b(phone|mobile|cell|telephone|tel)\b/i, "phone"],
  [/\b(ceremony\s*(start\s*)?time|start time)\b/i, "ceremonyTime"],
  [/\b(date|big day|wedding day|when)\b/i, "eventDate"],
  [/\b(venue|location|where|ceremony site|reception site)\b/i, "venue"],
  [/\b(city|town|state)\b/i, "city"],
  [/\b(guests?|guest count|headcount|number of people|attendees)\b/i, "guestCount"],
  [/\b(budget|investment|price range|spend)\b/i, "budget"],
  [/\b(services?|interested in|photo.*video|coverage|looking for|package)\b/i, "services"],
  [/\b(event\s*type|type of (event|session|shoot)|occasion)\b/i, "eventType"],
  [/\b(message|tell us|about (you|your)|details|comments?|anything else|questions?|notes?|story|vision|inquiry|enquiry)\b/i, "message"],
  [/\b(your\s+names?|names?|full name|who)\b/i, "fullName"],
];

export function labelToField(
  label: string,
  studioMapping: Record<string, LeadFieldKey | "ignore"> = {},
): LeadFieldKey | null {
  const clean = normaliseLabel(label);
  const mapped = studioMapping[clean];
  if (mapped) return mapped === "ignore" ? null : mapped;
  for (const [pattern, key] of LABEL_PATTERNS) if (pattern.test(clean)) return key;
  return null;
}

export function normaliseLabel(label: string): string {
  return label.replace(/[*:]+$/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// HTML → text
// ---------------------------------------------------------------------------

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", hellip: "…",
};

/**
 * Flatten a notification's HTML to text, keeping the structure that carries
 * meaning: a table row of two cells becomes "Label: value", block elements
 * become line breaks. Found on production: the pipeline read only the plain
 * text part, and an HTML-only notification was quarantined as empty.
 */
export function htmlToText(html: string): string {
  let text = html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");
  // Two-cell table rows are label/value pairs in nearly every builder's layout.
  text = text.replace(/<tr[^>]*>([\s\S]*?)<\/tr>/gi, (_, row: string) => {
    const cells = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) =>
      stripTags(cell[1]!).replace(/\s+/g, " ").trim(),
    ).filter(Boolean);
    if (cells.length === 2 && cells[0]!.length <= 60) {
      const label = cells[0]!.replace(/:$/, "");
      return `\n${label}: ${cells[1]}\n`;
    }
    return `\n${cells.join("\n")}\n`;
  });
  text = text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|section|article|table|tbody|thead|blockquote)>/gi, "\n")
    .replace(/<(p|div|li|h[1-6]|section|article|table|blockquote)[^>]*>/gi, "\n");
  text = stripTags(text);
  return decodeEntities(text)
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, "");
}

function decodeEntities(value: string): string {
  return value
    .replace(/&([a-z]+|#\d+);/gi, (match, name: string) => {
      const lower = name.toLowerCase();
      if (ENTITIES[lower]) return ENTITIES[lower]!;
      if (lower.startsWith("#")) {
        const code = Number(lower.slice(1));
        return Number.isFinite(code) ? String.fromCodePoint(code) : match;
      }
      return match;
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)));
}

// ---------------------------------------------------------------------------
// Forwarded wrappers
// ---------------------------------------------------------------------------

const FORWARD_MARKERS = [
  /-{2,}\s*Forwarded message\s*-{2,}/i,
  /^Begin forwarded message:/im,
  /-{2,}\s*Original Message\s*-{2,}/i,
  /^_{8,}\s*$/m,
];

type Unwrapped = {
  forwarded: boolean;
  from: string | null;
  fromName: string | null;
  replyTo: string | null;
  subject: string | null;
  body: string;
};

function parseAddress(value: string): { email: string | null; name: string | null } {
  const angle = /^(.*?)\s*<([^>]+@[^>]+)>/.exec(value.trim());
  if (angle) {
    return {
      email: angle[2]!.trim().toLowerCase(),
      name: angle[1]!.replace(/^"|"$/g, "").trim() || null,
    };
  }
  const bare = /([^\s<>"]+@[^\s<>"]+\.[a-z]{2,})/i.exec(value);
  return { email: bare ? bare[1]!.toLowerCase() : null, name: null };
}

/** A manually forwarded message: take the original's headers and body. */
export function unwrapForward(text: string): Unwrapped {
  const marker = FORWARD_MARKERS.map((pattern) => pattern.exec(text)).find(Boolean);
  if (!marker) {
    return { forwarded: false, from: null, fromName: null, replyTo: null, subject: null, body: text };
  }
  const lines = text.slice(marker.index + marker[0].length).replace(/^\s+/, "").split("\n");
  let from: string | null = null;
  let fromName: string | null = null;
  let replyTo: string | null = null;
  let subject: string | null = null;
  let index = 0;
  let sawHeader = false;
  for (; index < Math.min(lines.length, 14); index += 1) {
    const line = lines[index]!.trim();
    if (!line) {
      if (sawHeader) {
        index += 1;
        break;
      }
      continue;
    }
    const header = /^(From|Reply-To|Subject|Date|Sent|To|Cc):\s*(.*)$/i.exec(line);
    if (!header) break;
    sawHeader = true;
    const name = header[1]!.toLowerCase();
    if (name === "from") {
      const address = parseAddress(header[2]!);
      from = address.email;
      fromName = address.name ?? (address.email ? null : header[2]!.trim() || null);
    } else if (name === "reply-to") {
      replyTo = parseAddress(header[2]!).email;
    } else if (name === "subject") {
      subject = header[2]!.trim() || null;
    }
  }
  return {
    forwarded: true,
    from,
    fromName,
    replyTo,
    subject,
    body: lines.slice(index).join("\n"),
  };
}

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

export type FormField = { label: string; value: string; key: LeadFieldKey | null };

const NOISE_LINE =
  /^\(?(sent via|this e-?mail was sent from|this is a notification|powered by|view (it )?in|unsubscribe|reply to this|manage (your )?notifications|submitted (on|at)|submission (id|date|time)|page url|form name|you('ve| have) (received|got) a new|new form submission|you have a new (form )?submission|--|__)/i;

/**
 * Labelled fields. "Label: value" on one line, or a short label line followed
 * by its value (how an HTML table or card flattens). A multi-line message
 * value runs until the next label.
 */
export function readFields(
  body: string,
  studioMapping: Record<string, LeadFieldKey | "ignore"> = {},
): FormField[] {
  const lines = body.split("\n").map((line) => line.trim());
  const fields: FormField[] = [];
  const isLabelLine = (line: string) =>
    line.length >= 2 &&
    line.length <= 60 &&
    !/[.!?]$/.test(line) &&
    !/@/.test(line) &&
    labelToField(line, studioMapping) !== null;
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!;
    if (!line || NOISE_LINE.test(line)) {
      index += 1;
      continue;
    }
    // Contact Form 7's default: "From: Emma Hart <emma@example.com>"
    const cf7From = /^From:\s*(.+?)\s*<([^>]+@[^>]+)>\s*$/i.exec(line);
    if (cf7From) {
      fields.push({ label: "Name", value: cf7From[1]!.trim(), key: "fullName" });
      fields.push({ label: "Email", value: cf7From[2]!.trim(), key: "email" });
      index += 1;
      continue;
    }
    const inline = /^([^:]{1,60}):\s*(.*)$/.exec(line);
    if (inline && !/^https?$/i.test(inline[1]!.trim())) {
      const label = inline[1]!.trim();
      const key = labelToField(label, studioMapping);
      let value = inline[2]!.trim();
      index += 1;
      // "Message Body:" with its text on the following lines.
      if (!value || key === "message") {
        const collected: string[] = value ? [value] : [];
        while (index < lines.length) {
          const next = lines[index]!;
          if (/^([^:]{1,60}):\s*/.test(next) && labelToField(next.split(":")[0]!, studioMapping)) break;
          if (NOISE_LINE.test(next)) break;
          if (!next && collected.length && key !== "message") break;
          collected.push(next);
          index += 1;
          if (key !== "message" && collected.filter(Boolean).length >= 1) break;
        }
        value = collected.join("\n").trim();
      }
      if (value && label.length <= 60) fields.push({ label, value, key });
      continue;
    }
    if (isLabelLine(line) && index + 1 < lines.length) {
      const label = line;
      const key = labelToField(label, studioMapping);
      const collected: string[] = [];
      index += 1;
      while (index < lines.length) {
        const next = lines[index]!;
        if (!next) {
          if (collected.length) break;
          index += 1;
          continue;
        }
        if (NOISE_LINE.test(next) || (isLabelLine(next) && collected.length)) break;
        collected.push(next);
        index += 1;
        if (key !== "message") break;
      }
      const value = collected.join("\n").trim();
      if (value) fields.push({ label, value, key });
      continue;
    }
    index += 1;
  }
  return fields;
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

export type ValueSource = "form" | "header" | "message" | "studio";

export type CapturedValue = {
  value: string | number | string[];
  source: ValueSource;
  label?: string;
};

export type CapturedValues = Partial<Record<Exclude<LeadFieldKey, "fullName">, CapturedValue>>;

const PLATFORM_OR_NOREPLY =
  /(^|[._+-])(no-?reply|donotreply|do-not-reply|notifications?|mailer-daemon|postmaster|form-submission|forms-receipts|wordpress|alerts?)@|@(.*\.)?(squarespace\.(info|com)|wix-forms\.com|crm\.wix\.com|wixsiteautomations\.com|wix\.com|showit\.(co|com)|pixieset\.com|jotform\.com|123formbuilder\.com|123contactform\.com|theknot\.com|weddingwire\.com|weddingpro\.com|pixiesetmail\.com|zola\.com|facebookmail\.com|instagram\.com)$/i;

export function isPlatformAddress(email: string | null | undefined): boolean {
  return Boolean(email && PLATFORM_OR_NOREPLY.test(email));
}

function splitCouple(value: string): { first: string | null; last: string | null; partner: string | null } {
  const parts = value.split(/\s+(?:&|and|\+)\s+|\s*&\s*/i).map((part) => part.trim()).filter(Boolean);
  const person = (parts[0] ?? "").split(/\s+/).filter(Boolean);
  return {
    first: person[0] ?? null,
    last: person.length > 1 ? person.slice(1).join(" ") : null,
    partner: parts[1] ?? null,
  };
}

function firstNumber(value: string): number | null {
  const match = /(\d[\d,]*)/.exec(value);
  if (!match) return null;
  const number = Number(match[1]!.replace(/,/g, ""));
  return Number.isFinite(number) && number > 0 && number < 100_000 ? number : null;
}

function servicesFrom(value: string): string[] | null {
  const lower = value.toLowerCase();
  const services: string[] = [];
  if (/photo/.test(lower)) services.push("photography");
  if (/video|film|cinema|cinematic/.test(lower)) services.push("videography");
  if (/both/.test(lower) && !services.length) services.push("photography", "videography");
  return services.length ? services : null;
}

function eventTypeFrom(value: string): string | null {
  const lower = value.toLowerCase();
  if (/wedding|elopement|marriage|ceremony/.test(lower)) return "Wedding";
  if (/engagement/.test(lower)) return "Engagement";
  if (/corporate|conference|business|brand/.test(lower)) return "Corporate";
  if (/sport|team|league|game/.test(lower)) return "Sports";
  if (/portrait|family|newborn|maternity|headshot/.test(lower)) return "Portrait";
  return value.trim().slice(0, 60) || null;
}

/** Turn labelled fields into lead values, each with its source. */
export function valuesFromFields(fields: FormField[], today: string): CapturedValues {
  const values: CapturedValues = {};
  const set = (key: keyof CapturedValues, value: CapturedValue["value"] | null, label: string) => {
    if (value === null || value === "" || values[key]) return;
    values[key] = { value, source: "form", label };
  };
  for (const field of fields) {
    const value = field.value.trim();
    switch (field.key) {
      case "fullName": {
        const couple = splitCouple(value);
        set("firstName", couple.first, field.label);
        set("lastName", couple.last, field.label);
        set("partnerName", couple.partner, field.label);
        break;
      }
      case "email": {
        const email = parseAddress(value).email;
        if (email && !isPlatformAddress(email)) set("email", email, field.label);
        break;
      }
      case "eventDate":
        set("eventDate", eventDateFrom(value, today) ?? eventDateFrom(`${value} ${today.slice(0, 4)}`, today), field.label);
        break;
      case "guestCount":
        set("guestCount", firstNumber(value), field.label);
        break;
      case "services":
        set("services", servicesFrom(value), field.label);
        break;
      case "eventType":
        set("eventType", eventTypeFrom(value), field.label);
        break;
      case "phone":
        set("phone", /\d{3}/.test(value) ? value.slice(0, 40) : null, field.label);
        break;
      case "message":
        set("message", value.slice(0, 5000), field.label);
        break;
      case null:
        break;
      default:
        set(field.key, value.slice(0, 200), field.label);
    }
  }
  return values;
}

// ---------------------------------------------------------------------------
// The whole read
// ---------------------------------------------------------------------------

export type InquiryEmail = {
  from: string;
  fromName: string | null;
  replyTo: string | null;
  subject: string;
  text: string;
  html: string | null;
  /** Addresses that belong to the studio — never the couple. */
  studioAddresses: string[];
};

export type ContactSource = "reply_to" | "form_field" | "from" | "forwarded_from" | null;

export type InquiryRead = {
  builder: FormBuilder;
  builderLabel: string;
  formName: string | null;
  forwarded: boolean;
  /** The sender the studio would set a filter on, lowercased. */
  notificationSender: string;
  fields: FormField[];
  values: CapturedValues;
  contactSource: ContactSource;
  contactName: string | null;
  message: string;
  verdict: "inquiry" | "unsure";
  verdictReason: string;
};

export function builderFor(sender: string, subject: string, body: string): FormBuilder {
  for (const [pattern, builder] of BUILDER_SENDERS) if (pattern.test(sender)) return builder;
  // The Knot and WeddingWire both belong to WeddingPro and send leads from
  // pros@weddingpro.com, so the sender alone can't say which; the email does.
  if (/@(.*\.)?weddingpro\.com$/i.test(sender))
    return /weddingwire/i.test(`${subject}\n${body}`) ? "weddingwire" : "the_knot";
  if (/^wordpress@/i.test(sender) || /this e-?mail was sent from a contact form on/i.test(body)) return "wordpress";
  if (/^form submission\s*-/i.test(subject)) return "squarespace";
  return "unknown";
}

function formNameFrom(builder: FormBuilder, subject: string): string | null {
  if (builder === "squarespace") {
    const match = /^form submission\s*-\s*([^-]+)/i.exec(subject);
    return match ? match[1]!.trim() : null;
  }
  const quoted = /"([^"]{2,60})"/.exec(subject);
  return quoted ? quoted[1]! : null;
}

export function readInquiryEmail(input: InquiryEmail, options: {
  today: string;
  studioMapping?: Record<string, LeadFieldKey | "ignore">;
  learnedInquirySenders?: string[];
}): InquiryRead {
  const plain = input.text.trim() ? input.text : input.html ? htmlToText(input.html) : "";
  const text = plain.replace(/\r\n?/g, "\n");
  const unwrapped = unwrapForward(text);
  const studio = new Set(input.studioAddresses.map((address) => address.toLowerCase()));
  const notificationSender = (unwrapped.from ?? input.from).toLowerCase();
  const subject = unwrapped.subject ?? input.subject;
  const body = unwrapped.body;
  const builder = builderFor(notificationSender, subject, body);
  const fields = readFields(body, options.studioMapping);
  const values = valuesFromFields(fields, options.today);

  // Who the couple is: Reply-To, then the form's email field, then From —
  // never the studio, never a platform's no-reply.
  const usable = (email: string | null | undefined) =>
    email && !studio.has(email.toLowerCase()) && !isPlatformAddress(email) ? email.toLowerCase() : null;
  const replyTo = usable(unwrapped.replyTo) ?? (unwrapped.forwarded ? null : usable(input.replyTo));
  let contactSource: ContactSource = null;
  if (replyTo) {
    values.email = { value: replyTo, source: "header", label: "Reply-To" };
    contactSource = "reply_to";
  } else if (values.email) {
    contactSource = "form_field";
  } else if (usable(unwrapped.from)) {
    values.email = { value: usable(unwrapped.from)!, source: "header", label: "From" };
    contactSource = "forwarded_from";
  } else if (!unwrapped.forwarded && usable(input.from)) {
    values.email = { value: usable(input.from)!, source: "header", label: "From" };
    contactSource = "from";
  }
  // A person's name in the From header, when it is the couple writing.
  const headerName =
    contactSource === "from" ? input.fromName : contactSource === "forwarded_from" ? unwrapped.fromName : null;
  if (headerName && !values.firstName) {
    const couple = splitCouple(headerName);
    if (couple.first) values.firstName = { value: couple.first, source: "header", label: "From" };
    if (couple.last && !values.lastName) values.lastName = { value: couple.last, source: "header", label: "From" };
  }

  // The message: the form's message field, or the body without its fields.
  const message =
    (values.message?.value as string | undefined) ??
    body
      .split("\n")
      .filter((line) => !NOISE_LINE.test(line.trim()))
      .join("\n")
      .trim()
      .slice(0, 5000);
  if (!values.message && message) values.message = { value: message, source: "message" };
  if (!values.eventDate) {
    const date = eventDateFrom(message, options.today);
    if (date) values.eventDate = { value: date, source: "message" };
  }

  const learned = new Set((options.learnedInquirySenders ?? []).map((sender) => sender.toLowerCase()));
  const hasPerson = Boolean(values.email || values.firstName || values.phone);
  const hasEventSignal = Boolean(
    values.eventDate || values.venue || values.guestCount || /\b(wedding|engage|elope|photograph|videograph|shoot|session|event)\b/i.test(message),
  );
  let verdict: InquiryRead["verdict"] = "unsure";
  let verdictReason = "Nothing identifies who wrote or what they want.";
  if (builder !== "unknown") {
    verdict = hasPerson ? "inquiry" : "unsure";
    verdictReason = MARKETPLACES.has(builder)
      ? `A ${BUILDER_LABEL[builder]} inquiry.`
      : `A submission from the studio's ${BUILDER_LABEL[builder]}.`;
    if (!hasPerson) verdictReason += " No contact details were found in it.";
  } else if (learned.has(notificationSender)) {
    verdict = "inquiry";
    verdictReason = "From a sender this studio has confirmed sends inquiries.";
  } else if (hasPerson && hasEventSignal) {
    verdict = "inquiry";
    verdictReason = "Someone wrote about an event and left their details.";
  } else if (hasPerson) {
    verdictReason = "Someone wrote, but nothing says it's about booking.";
  }

  return {
    builder,
    builderLabel: BUILDER_LABEL[builder],
    formName: formNameFrom(builder, subject),
    forwarded: unwrapped.forwarded,
    notificationSender,
    fields,
    values,
    contactSource,
    contactName: [values.firstName?.value, values.lastName?.value].filter(Boolean).join(" ") || null,
    message,
    verdict,
    verdictReason,
  };
}
