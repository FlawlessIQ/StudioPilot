/**
 * A link in a studio's own email words (Settings → Email templates → Add a
 * link). Written as `[text](address)`, which the email renderer turns into an
 * underlined link (functions/src/communications/email-templates.ts
 * `inlineHtml`) and the plain-text part into "text (address)".
 *
 * Accepts what people type: "yourstudio.com/pricing" gets https://, an email
 * address gets mailto:. Anything else that isn't a web, mailto or tel address
 * is refused (null), so a link can never carry a script.
 */
/** `[text](address)`, the link form the email renderer reads (email-templates.ts `inlineHtml`). */
export function linkMarkup(text: string, address: string): string | null {
  const url = address.trim();
  const withScheme = /^(https?:\/\/|mailto:|tel:)/i.test(url) ? url : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(url) ? `mailto:${url}` : /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(url) ? `https://${url}` : null;
  if (!withScheme || /\s|\)/.test(withScheme)) return null;
  const label = text.trim().replace(/[[\]\n]/g, " ").trim() || withScheme.replace(/^(https?:\/\/|mailto:|tel:)/i, "");
  return `[${label}](${withScheme})`;
}
