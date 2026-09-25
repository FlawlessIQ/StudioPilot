/**
 * The exact mailbox filter that forwards a studio's inquiries — and nothing
 * else — to its StudioCue address.
 *
 * Forwarding everything would hand StudioCue the studio's personal mail, and
 * asking a photographer to write a Gmail search is how setup stalls. So the
 * studio picks the website builder it uses and gets a search it can paste.
 * The senders mirror BUILDER_SENDERS in functions/src/intake/form-email.ts.
 */

export type FormSource =
  | "squarespace"
  | "wix"
  | "showit"
  | "wordpress"
  | "pixieset"
  | "jotform"
  | "google_forms"
  | "the_knot"
  | "weddingwire"
  | "zola";

export const FORM_SOURCES: ReadonlyArray<{ key: FormSource; label: string; marketplace: boolean }> = [
  { key: "squarespace", label: "Squarespace", marketplace: false },
  { key: "wix", label: "Wix", marketplace: false },
  { key: "showit", label: "Showit", marketplace: false },
  { key: "wordpress", label: "WordPress", marketplace: false },
  { key: "pixieset", label: "Pixieset", marketplace: false },
  { key: "jotform", label: "Jotform", marketplace: false },
  { key: "google_forms", label: "Google Forms", marketplace: false },
  { key: "the_knot", label: "The Knot", marketplace: true },
  { key: "weddingwire", label: "WeddingWire", marketplace: true },
  { key: "zola", label: "Zola", marketplace: true },
];

/** Gmail search terms per source. Gmail's `from:` matches a whole domain. */
const TERMS: Record<FormSource, string[]> = {
  squarespace: ["from:squarespace.info", 'subject:"Form Submission"'],
  wix: ["from:wix-forms.com", "from:crm.wix.com", "from:wixsiteautomations.com"],
  showit: ["from:showit.co", "from:showit.com"],
  wordpress: ['"sent from a contact form on"'],
  pixieset: ["from:pixieset.com"],
  jotform: ["from:jotform.com"],
  google_forms: ["from:forms-receipts-noreply@google.com"],
  the_knot: ["from:theknot.com"],
  weddingwire: ["from:weddingwire.com"],
  zola: ["from:zola.com"],
};

/**
 * One Gmail search for every source the studio picked. Squarespace sends
 * other account mail from the same domain, so its term is narrowed to form
 * submissions.
 */
export function gmailFilterQuery(sources: readonly FormSource[]): string {
  const parts = sources.flatMap((source) =>
    source === "squarespace" ? ['(from:squarespace.info subject:"Form Submission")'] : TERMS[source],
  );
  if (!parts.length) return "";
  return parts.length === 1 ? parts[0] : `{${parts.join(" ")}}`;
}

/** Opens Gmail on that search, where "Create filter" is one click away. */
export function gmailSearchLink(query: string): string {
  return `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(query)}`;
}

export const GMAIL_FORWARDING_SETTINGS = "https://mail.google.com/mail/u/0/#settings/fwdandpop";
export const OUTLOOK_RULES = "https://outlook.office.com/mail/options/mail/rules";
