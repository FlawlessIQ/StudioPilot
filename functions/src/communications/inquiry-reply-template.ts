import type { Firestore } from "firebase-admin/firestore";

/**
 * The studio's own first reply to a new inquiry (Settings → Email templates →
 * "Your reply to a new inquiry", key `inquiry_reply`).
 *
 * GR Productions, 2026-10-09: the reply drafted on Today wasn't the one in
 * the template editor, and there was no way to change it for next time. It
 * was always written fresh by Cue. Now, when the studio has saved its own:
 * - "replace": the draft is the studio's words, with the inquiry's details
 *   filled in, and Cue writes none of it;
 * - "add": the studio's words go under the greeting, above Cue's reply.
 * No saved version keeps Cue's reply as before. Either way it is still a draft
 * the studio reviews before it is sent.
 */

export type ReplyTemplate = {
  version: number;
  subject: string;
  paragraphs: string[];
  mode: "add" | "replace";
};

export type ReplyFacts = {
  recipientName: string;
  studioName: string;
  eventType: string;
  /** YYYY-MM-DD, as the lead stores it. */
  eventDate: string;
  venue: string;
};

export async function activeReplyTemplate(db: Firestore, tenantId: string): Promise<ReplyTemplate | null> {
  const pointer = await db.doc(`messageTemplatePointers/${tenantId}_inquiry_reply`).get();
  const id = String(pointer.get("activeTemplateId") ?? "");
  if (!id) return null;
  const stored = await db.doc(`messageTemplates/${id}`).get();
  if (!stored.exists || stored.get("tenantId") !== tenantId) return null;
  const data = stored.data() ?? {};
  const paragraphs = Array.isArray(data.paragraphs) ? data.paragraphs.map(String).filter((paragraph: string) => paragraph.trim()) : [];
  if (!paragraphs.length && !String(data.subject ?? "").trim()) return null;
  return {
    version: Number(data.version ?? 0),
    subject: String(data.subject ?? ""),
    paragraphs,
    mode: data.mode === "add" ? "add" : "replace",
  };
}

/** "Saturday, June 12, 2027" from "2027-06-12"; empty for anything else. */
export function eventDateLabel(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime())
    ? ""
    : new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date);
}

export function fillReplyText(value: string, facts: ReplyFacts): string {
  const first = facts.recipientName.trim().split(/\s+/)[0] ?? "";
  const replacements: Record<string, string> = {
    clientFirstName: first,
    recipientName: facts.recipientName.trim(),
    studioName: facts.studioName,
    eventType: facts.eventType,
    eventDate: eventDateLabel(facts.eventDate),
    venue: facts.venue,
    projectName: "",
  };
  return value
    .replace(/\{\{([a-zA-Z][a-zA-Z0-9]*)\}\}/g, (_match, key: string) => replacements[key] ?? "")
    // A field with nothing to fill leaves no double space or " ," behind.
    .replace(/ {2,}/g, " ")
    .replace(/ ([,.;:!?])/g, "$1");
}

const GREETING = /^(hi|hello|dear|hey)\b[^\n]*,?$/i;

/**
 * The draft's subject and body with the studio's template applied to Cue's
 * reply (`cueSubject`, `cueBody`, paragraphs separated by blank lines).
 */
export function applyReplyTemplate(
  template: ReplyTemplate | null,
  cue: { subject: string; body: string },
  facts: ReplyFacts,
): { subject: string; body: string; templateVersion: number | null } {
  if (!template) return { ...cue, templateVersion: null };
  const theirs = template.paragraphs.map((paragraph) => fillReplyText(paragraph, facts).trim()).filter(Boolean);
  const subject = fillReplyText(template.subject, facts).trim() || cue.subject;
  if (!theirs.length) return { subject, body: cue.body, templateVersion: template.version };
  const cueParagraphs = cue.body.split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean);
  const greeting = cueParagraphs[0] && GREETING.test(cueParagraphs[0]) ? cueParagraphs[0] : null;
  const ownGreeting = theirs[0] ? GREETING.test(theirs[0]) : false;
  const first = facts.recipientName.trim().split(/\s+/)[0];
  const plain = first ? `Hi ${first},` : "Hello,";
  // Adding keeps Cue's greeting over the whole reply; their own reply opens
  // as the email itself does, unless they wrote a greeting of their own.
  const body =
    template.mode === "add"
      ? [...(ownGreeting ? [] : [greeting ?? plain]), ...theirs, ...(greeting ? cueParagraphs.slice(1) : cueParagraphs)]
      : [...(ownGreeting ? [] : [plain]), ...theirs];
  return { subject, body: body.join("\n\n"), templateVersion: template.version };
}
