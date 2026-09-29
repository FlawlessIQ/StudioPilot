/**
 * Lines in a studio's own contract that state a price of their own.
 *
 * Once the agreement is written from the job, the proposal sets the price and
 * `{{price.total}}` / `{{price.retainer}}` carry it into the contract. A
 * clause that still says "$4,500" or "a retainer of $1,000" is a second price,
 * and the day a package changes the two disagree in a signed document (H2,
 * docs/proposal-agreement-and-addons-plan-2026-09-28.md, open decision 3:
 * the proposal governs). StudioCue flags them; the studio decides — the
 * wording is theirs, so nothing is removed for them.
 */

export type PricingClause = {
  /** 1-based line number in the agreement text. */
  line: number;
  text: string;
};

const AMOUNT = /(?:[$£€]\s?\d[\d,]*(?:\.\d{2})?|\b\d[\d,]*(?:\.\d{2})?\s?(?:usd|dollars|gbp|eur)\b)/i;
const PERCENT_OF_PRICE = /\b\d{1,3}\s?%\s+(?:of|retainer|deposit|non-?refundable)/i;

export function pricingClauses(body: string): PricingClause[] {
  return body
    .split("\n")
    .map((text, index) => ({ line: index + 1, text: text.trim() }))
    .filter(({ text }) => text && (AMOUNT.test(text) || PERCENT_OF_PRICE.test(text)))
    .map(({ line, text }) => ({ line, text: text.length > 180 ? `${text.slice(0, 179)}…` : text }));
}
