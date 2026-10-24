import {
  COVERAGE_ROLES,
  legacyPhotographerCount,
  normaliseCoverage,
  type CoverageRole,
} from "../packages/coverage.js";
import { normalizeUnitLabel } from "../packages/unit-label.js";
import { DEFAULT_TRADE, tradeOf, tradeProfile } from "../trades/trades.js";

type Json = Record<string, unknown>;

const record = (value: unknown): Json =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Json)
    : {};

const text = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const money = (value: unknown): number | null => {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.replace(/[^0-9.-]/g, ""))
        : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const wordsToNumber: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
};

/**
 * A draft's line items as words. The line that is the package itself — the
 * AI writes { name: "Essential", price: "3,200", description: "6 hours…" } —
 * gives its description without the price: the price is the package's, and
 * "…high-resolution downloads. 3,200" was saved as something it includes
 * (onboarding audit, 2026-10-24).
 */
function lineItemText(value: unknown, packageName = "", withPrices = true): string[] {
  const own = packageName.trim().toLowerCase();
  // One priced line among the inclusions is the package's own price hung on
  // its first inclusion; several are a list of priced things, kept as written.
  const pricedLines = Array.isArray(value)
    ? value.filter((item) => typeof item !== "string" && Boolean(text(record(item).amount ?? record(item).price))).length
    : 0;
  return Array.isArray(value)
    ? value.flatMap((item) => {
        if (typeof item === "string" && item.trim()) return [item.trim()];
        const entry = record(item);
        const label = text(
          entry.description ?? entry.label ?? entry.name ?? entry.title,
        );
        const itself = Boolean(own) && text(entry.name).toLowerCase() === own && Boolean(text(entry.description));
        const amount = itself || (!withPrices && pricedLines === 1) ? "" : text(entry.amount ?? entry.price);
        return label ? [`${label}${amount ? ` ${amount}` : ""}`] : [];
      })
    : [];
}

/**
 * The words a price list uses for each role a studio sends. A photographer's
 * two are the ones this importer has always read. A vendor reads its own crew
 * (trades.ts `coverageRoles`): a hair studio's list was read for
 * photographers only, and its package imported as one photographer (Priya
 * Shah, Jess Styles Bridal, 2026-10-10).
 */
const ROLE_WORDS: Record<CoverageRole, string> = {
  photographer: "photographers?",
  videographer: "videographers?",
  dj: String.raw`djs?|disc\s+jockeys?`,
  makeup_artist: String.raw`(?:make-?up\s+)?artists?`,
  hair_stylist: String.raw`(?:hair\s*)?stylists?`,
  coordinator: String.raw`(?:assistant\s+)?(?:coordinators?|assistants?)`,
};

function tradeRoles(trade: unknown): CoverageRole[] {
  const roles = tradeProfile(trade).coverageRoles.filter(
    (role): role is CoverageRole =>
      (COVERAGE_ROLES as readonly string[]).includes(role),
  );
  return roles.length ? roles : ["photographer"];
}

type ImportedRetainerRule =
  | { type: "percentage"; basisPoints: number }
  | { type: "fixed"; amountCents: number };

const percentRule = (percent: number): ImportedRetainerRule => ({
  type: "percentage",
  basisPoints: Math.min(10_000, Math.round(percent * 100)),
});

const fixedRule = (dollars: number): ImportedRetainerRule => ({
  type: "fixed",
  amountCents: Math.round(dollars * 100),
});

/**
 * Spaces and tabs, never a line break. A deposit statement is one line:
 * "Full day $3,000" over "Retainer required to book." is a price and then a
 * sentence, and reading across the break made the whole price the deposit.
 */
const SP = String.raw`[^\S\r\n]`;
const DEPOSIT_WORD = String.raw`(?:non-?refundable${SP}+)?(?:deposit|retainer|booking${SP}+fee)`;
// "No deposit — $375 on the day" states no deposit at all.
const DEPOSIT_LEAD = String.raw`(?<!\bno${SP}+)\b${DEPOSIT_WORD}${SP}*(?:of|is|:|[–—-])?${SP}*`;
const PERCENT = String.raw`(\d{1,3}(?:\.\d+)?)${SP}?(?:%|percent\b)`;
const DOLLARS = String.raw`\$${SP}?(\d[\d,]*(?:\.\d{1,2})?)`;
const DEPOSIT_STATEMENTS: ReadonlyArray<[RegExp, "percent" | "fixed"]> = [
  [new RegExp(String.raw`${PERCENT}${SP}+${DEPOSIT_WORD}\b`, "gi"), "percent"],
  [new RegExp(`${DEPOSIT_LEAD}${PERCENT}`, "gi"), "percent"],
  [new RegExp(String.raw`${DOLLARS}${SP}+${DEPOSIT_WORD}\b`, "gi"), "fixed"],
  [new RegExp(`${DEPOSIT_LEAD}${DOLLARS}`, "gi"), "fixed"],
];

/** The one rule a set of readings agrees on; none, or two, is null. */
function agreed(
  rules: ReadonlyArray<ImportedRetainerRule | null>,
): ImportedRetainerRule | null {
  const found = new Map<string, ImportedRetainerRule>();
  for (const rule of rules) if (rule) found.set(JSON.stringify(rule), rule);
  return found.size === 1 ? ([...found.values()][0] ?? null) : null;
}

/**
 * The deposit a price list states in words: "A 30% deposit holds the date",
 * "$500 non-refundable retainer", "Booking fee: $100". Null when it states
 * none, or states two that disagree — then nothing is guessed.
 *
 * Each text is read on its own and each statement within one line, so a
 * price at the end of one field or line is never read as the deposit the
 * next one names.
 *
 * The import read only structured retainer fields, so Jess Styles Bridal's
 * "A 30% deposit holds the date." became a $0 deposit (2026-10-10).
 */
export function statedDeposit(
  ...sources: readonly string[]
): ImportedRetainerRule | null {
  return agreed(depositReadings(sources));
}

function depositReadings(sources: readonly string[]): ImportedRetainerRule[] {
  const found: ImportedRetainerRule[] = [];
  for (const source of sources) {
    for (const [pattern, kind] of DEPOSIT_STATEMENTS) {
      for (const match of source.matchAll(pattern)) {
        const value = Number((match[1] ?? "").replace(/,/g, ""));
        if (!Number.isFinite(value) || value <= 0) continue;
        if (kind === "percent" && value > 100) continue;
        found.push(kind === "percent" ? percentRule(value) : fixedRule(value));
      }
    }
  }
  return found;
}

/** Every string in a draft, however deep the AI nested it. */
function strings(value: unknown, depth = 0): string[] {
  if (typeof value === "string") return value.trim() ? [value] : [];
  if (depth > 6 || typeof value !== "object" || value === null) return [];
  return (Array.isArray(value) ? value : Object.values(value)).flatMap(
    (nested) => strings(nested, depth + 1),
  );
}

/**
 * A deposit field as the AI wrote it: 500, "$500", "30%". Words around a
 * figure ("30% due at booking, the rest 14 days before") are read for the
 * figure the field names, never as one number run together.
 */
function depositField(value: unknown): ImportedRetainerRule | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? fixedRule(value) : null;
  }
  if (typeof value !== "string") return null;
  // "30%" in a deposit field is 30 percent, never $30.
  const percent = Number(value.match(new RegExp(PERCENT, "i"))?.[1]);
  if (percent > 0 && percent <= 100) return percentRule(percent);
  const dollars = value.match(new RegExp(DOLLARS))?.[1];
  if (dollars) return fixedRule(Number(dollars.replace(/,/g, "")));
  return /^\s*\d[\d,]*(?:\.\d{1,2})?\s*$/.test(value)
    ? fixedRule(Number(value.replace(/[\s,]/g, "")))
    : null;
}

/**
 * The deposit.
 *
 * A photographer's import reads its structured retainer fields exactly as it
 * always has; with no field at all, the deposit its list states in words.
 *
 * A vendor's reads a structured field when the draft has one; else a
 * deposit line in its price list ("Deposit — 30%"); else what the draft's
 * own words state; else what the source the studio gave states; else none.
 * Jess Styles Bridal's "A 30% deposit holds the date." became a $0 deposit
 * because only the fields were read (2026-10-10).
 */
function importedRetainerRule(
  content: Json,
  vendor: { sourceText: string; listed: readonly PriceListItem[] } | null,
  sourceText = "",
): ImportedRetainerRule {
  if (!vendor) {
    const retainerAmount = money(
      content.retainer ?? content.retainerAmount ?? content.bookingFee,
    );
    const retainerPercent = money(content.retainerPercent);
    if (retainerPercent !== null) return percentRule(retainerPercent);
    // A field, however it reads, is read as it always has been. With none at
    // all, the deposit the list states in words: "A 30% retainer reserves
    // your date" imported as $0 down on every package (onboarding audit,
    // 2026-10-24). Two that disagree, or none, is still $0 — never a guess.
    const hasField = [content.retainer, content.retainerAmount, content.bookingFee].some(
      (value) => value !== undefined && value !== null,
    );
    if (hasField || retainerAmount !== null) return fixedRule(retainerAmount ?? 0);
    return statedDeposit(...strings(content), sourceText) ?? fixedRule(0);
  }
  const percent = money(content.retainerPercent ?? content.depositPercent);
  if (percent !== null) return percentRule(percent);
  const field = [
    content.retainer,
    content.retainerAmount,
    content.bookingFee,
    content.deposit,
    content.depositAmount,
  ]
    .map(depositField)
    .find((rule) => rule !== null);
  if (field) return field;
  return (
    agreed([
      ...vendor.listed.map((item) => item.deposit),
      ...depositReadings(strings(content)),
    ]) ??
    statedDeposit(vendor.sourceText) ??
    fixedRule(0)
  );
}

/** One line of a vendor's price list. */
type PriceListItem = {
  /** The item as the list names it, its price and unit taken out. */
  name: string;
  /** Any further words the list gives it. */
  detail: string;
  cents: number | null;
  /** What it is priced per ("person", "hour"), when the list says. */
  unit: string | null;
  /** Sold by the person or the hour, or "each". */
  byQuantity: boolean;
  /** A deposit, balance or total line: terms, never something to sell. */
  terms: boolean;
  /** What a deposit line states: "Deposit — 30%", "Retainer $100". */
  deposit: ImportedRetainerRule | null;
};

const PRICE_TOKEN =
  /(?:USD\s*)?\$\s?(\d[\d,]*(?:\.\d{1,2})?)|(\d[\d,]*(?:\.\d{2})?)\s?USD/i;
const UNIT_PHRASE =
  /\(?\s*(?:\bper\s+|\/\s*)(person|people|guest|head|child|children|kid|hour|hr|mile|mi)s?\b\s*\)?/i;
const PER_PERSON_SHORT = /\bpp\b/i;
/**
 * "$20/table": a unit the list names right after a price, though not one
 * above. It is still what the price is per, and left in the name the couple
 * would read "Travel over 30 miles /mile" (Jess import review, 2026-10-10).
 */
const PRICE_PER_UNIT = new RegExp(
  String.raw`(?:${PRICE_TOKEN.source})\s*\/\s*([a-z]{2,20})\b`,
  "i",
);
// "Deposit $100", "Balance due on the day", "Total: $815" — not "Total glam".
const TERMS_LINE =
  /\b(?:deposit|retainer|booking\s+fee)\b|^\s*(?:(?:remaining\s+)?balance|(?:sub)?total|(?:sales\s+)?tax)\s*(?:due\b|:|$|[–—-]|\$)/i;

const unitFor = (word: string): string =>
  /^(?:child|children|kid)/i.test(word)
    ? "child"
    : /^(?:hour|hr)/i.test(word)
      ? "hour"
      : /^mi/i.test(word)
        ? "mile"
        : "person";

const dollarsToCents = (dollars: number | null): number | null =>
  dollars !== null && Number.isFinite(dollars) && dollars >= 0
    ? Math.round(dollars * 100)
    : null;

/** "$125 per person" → 12500; only the dollar figure, never "under 12". */
const tokenCents = (value: string): number | null => {
  const token = value.match(PRICE_TOKEN);
  return token
    ? dollarsToCents(Number((token[1] ?? token[2] ?? "").replace(/,/g, "")))
    : null;
};

/** The price an item's own fields give; undefined when it has none. */
function fieldCents(entry: Json): number | null | undefined {
  const cents = [entry.amountCents, entry.priceCents, entry.unitPriceCents].find(
    (value) =>
      typeof value === "number" ||
      (typeof value === "string" && /\d/.test(value)),
  );
  if (cents !== undefined) {
    const parsed = money(cents);
    return parsed === null ? null : Math.round(parsed);
  }
  const amount = entry.amount ?? entry.price ?? entry.unitPrice;
  if (typeof amount === "number") return dollarsToCents(amount);
  if (typeof amount === "string" && /\d/.test(amount)) {
    return tokenCents(amount) ?? dollarsToCents(money(amount));
  }
  return undefined;
}

function itemCents(
  entry: Json,
  label: string,
  described: string,
): number | null {
  const own = fieldCents(entry);
  if (own !== undefined) return own;
  return tokenCents(label) ?? (described ? tokenCents(described) : null);
}

/**
 * A line that is the deposit: "Deposit", "Deposit holds the date", "A 30%
 * deposit", "Non-refundable retainer". Not a service that mentions one —
 * "Bridal hair, deposit required" at $375 is the service's price.
 */
const DEPOSIT_LINE = new RegExp(
  String.raw`^\W*(?:(?:a|the|your)${SP}+)?(?:${PERCENT}${SP}*|${DOLLARS}${SP}*)?${DEPOSIT_WORD}\b`,
  "i",
);

/**
 * The deposit a deposit line in the price list states. The AI often lists
 * it as one more item — {description: "Deposit holds the date", amount:
 * "30%"} — and it is the deposit, not a price. Only the line's own amount
 * or its own words are read, never another price in it: "Deposit applied
 * to the $375 total" states no deposit.
 */
function lineDeposit(
  entry: Json,
  label: string,
  amountText: string,
): ImportedRetainerRule | null {
  if (!DEPOSIT_LINE.test(label)) return null;
  const percent = Number(
    `${label} ${amountText}`.match(new RegExp(PERCENT, "i"))?.[1],
  );
  if (percent > 0 && percent <= 100) return percentRule(percent);
  const cents = fieldCents(entry);
  if (typeof cents === "number" && cents > 0) {
    return { type: "fixed", amountCents: cents };
  }
  return statedDeposit(label);
}

const tidy = (value: string): string => {
  const tidied = value
    .replace(/\(\s*\)/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,;:–—-]+|[\s,;:–—-]+$/g, "")
    .trim();
  // "Flower girls (under 12, per person)" keeps its closing bracket.
  const open = tidied.split("(").length - tidied.split(")").length;
  return open > 0 ? `${tidied})` : tidied;
};

function priceListItems(value: unknown): PriceListItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): PriceListItem[] => {
    const entry = record(item);
    const named = text(
      entry.name ?? entry.label ?? entry.title ?? entry.item ?? entry.service,
    );
    const described =
      typeof item === "string" ? item.trim() : text(entry.description);
    const label = named || described;
    if (!label) return [];
    const unitField = text(
      entry.unit ?? entry.unitLabel ?? entry.per ?? entry.priceUnit ?? entry.pricingUnit,
    );
    const amountText = text(entry.amount ?? entry.price);
    const unitSource = [
      unitField && !/^(?:per\b|\/)/i.test(unitField) ? `per ${unitField}` : unitField,
      amountText,
      label,
    ].join(" ");
    const unitWord = unitSource.match(UNIT_PHRASE)?.[1];
    // PRICE_TOKEN's two groups come first.
    const slashUnit = unitSource.match(PRICE_PER_UNIT)?.[3]?.toLowerCase();
    const unit = unitWord
      ? unitFor(unitWord)
      : PER_PERSON_SHORT.test(unitSource)
        ? "person"
        : (slashUnit ?? null);
    const name =
      tidy(
        label
          .replace(new RegExp(PRICE_PER_UNIT.source, "gi"), " ")
          .replace(new RegExp(PRICE_TOKEN.source, "gi"), " ")
          .replace(new RegExp(UNIT_PHRASE.source, "gi"), " ")
          .replace(/\bpp\b/gi, " ")
          .replace(/\s+each\s*$/i, " "),
      ) || label;
    return [
      {
        name: name.slice(0, 120),
        detail: [named ? described : "", text(entry.details), text(entry.notes)]
          .filter(Boolean)
          .join(" ")
          .slice(0, 1000),
        cents: itemCents(entry, label, named ? described : ""),
        unit,
        byQuantity:
          unit !== null ||
          /^each$/i.test(unitField) ||
          /\beach\b/i.test(`${amountText} ${label}`),
        terms: TERMS_LINE.test(label) || statedDeposit(label) !== null,
        deposit: lineDeposit(entry, label, amountText),
      },
    ];
  });
}

const slugOf = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "extra";

/** An extra the package suggests, in the shape the package form and proposals read. */
export type ImportedAddOn = {
  id: string;
  name: string;
  description: string;
  unitPriceCents: number;
  taxable: boolean;
  allowQuantity: boolean;
  unitLabel: string | null;
  active: boolean;
};

/** updatePackage's limit on a package's suggested extras (crm/commands.ts). */
const MAX_IMPORTED_ADD_ONS = 20;

/** The words that make "6 guests per stylist" a ratio, not a crew of six. */
const RATIO_WORD = /\b(?:per|each|every|a|an)\b/i;

// "48 hours notice" is not a service length.
const VENDOR_HOURS =
  /(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)\b(?!\s+(?:notice|before|prior|in\s+advance|ahead))/i;


/**
 * A list of several packages, read from what the studio pasted: the lines
 * under one package's own heading ("Full Planning — $6,500" then its
 * paragraph), and an Extras section every package shares. The AI split Bloom
 * Events' list into three packages and kept only each name and price — the
 * description read "Full Planning 6,500", the hours were lost and the three
 * extras were dropped (UAT 2026-10-13). Nothing here is invented: every word
 * and price is the studio's own.
 */
const PRICED_HEADING = /\$\s*\d/;
const EXTRAS_HEADING = /^(?:extras|add[- ]?ons|optional extras|enhancements|à la carte|a la carte)\b[:\s]*$/i;

export function packageSection(sourceText: string, name: string): string {
  const lines = sourceText.split(/\r?\n/).map((line) => line.trim());
  const wanted = name.trim().toLowerCase();
  if (!wanted) return "";
  const start = lines.findIndex((line) => line.toLowerCase().startsWith(wanted) && PRICED_HEADING.test(line));
  if (start < 0) return "";
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (!line || EXTRAS_HEADING.test(line) || PRICED_HEADING.test(line) && /\s[—–-]\s/.test(line) && line.length < 80) break;
    body.push(line);
  }
  return body.join(" ").slice(0, 3000);
}

/**
 * The price on a package's own line of a pasted list: "Essential - $3,200",
 * "Signature Collection — $4,800". Only a short line that starts with the
 * package's name (and not a longer word: "Essentials" isn't "Essential");
 * null when there is none.
 */
export function headingPriceCents(sourceText: string, name: string): number | null {
  const wanted = name.trim().toLowerCase();
  if (!wanted) return null;
  for (const raw of sourceText.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length > 120 || !line.toLowerCase().startsWith(wanted)) continue;
    const rest = line.slice(wanted.length);
    if (/^[a-z0-9]/i.test(rest)) continue;
    const match = /\$\s*(\d[\d,]*(?:\.\d{1,2})?)/.exec(rest);
    if (!match) continue;
    const cents = Math.round(Number(match[1]!.replace(/,/g, "")) * 100);
    if (cents > 0) return cents;
  }
  return null;
}

export function sharedExtras(sourceText: string): Array<{ name: string; cents: number; unit: string | null; detail: string }> {
  const lines = sourceText.split(/\r?\n/).map((line) => line.trim());
  const start = lines.findIndex((line) => EXTRAS_HEADING.test(line));
  if (start < 0) return [];
  const extras: Array<{ name: string; cents: number; unit: string | null; detail: string }> = [];
  for (const line of lines.slice(start + 1)) {
    if (!line) break;
    const match = /^(.+?)\s*[—–:-]\s*\$\s*([\d,]+(?:\.\d{1,2})?)(?:\s*(?:per|\/|an?|each)\s+([a-z]+))?/i.exec(line);
    if (!match) continue;
    const cents = Math.round(Number(match[2]!.replace(/,/g, "")) * 100);
    if (!(cents > 0)) continue;
    extras.push({ name: match[1]!.trim().slice(0, 120), cents, unit: match[3]?.toLowerCase() ?? null, detail: "" });
    if (extras.length >= MAX_IMPORTED_ADD_ONS) break;
  }
  return extras;
}

/** A planner's tier, from what the package is called (features/planning/planning-scope.ts). */
export function planningScopeFromName(name: string): "full" | "partial" | "coordination" | null {
  const value = name.toLowerCase();
  if (/\b(?:month|day|week)[- ]of\b|\bcoordinat/.test(value)) return "coordination";
  if (/\bpartial\b/.test(value)) return "partial";
  if (/\bfull\b/.test(value)) return "full";
  return null;
}

export function importedStudioPackage(input: {
  name: string;
  structuredContent: unknown;
  displayOrder: number;
  /** The studio's trade (tenants/{id}.trade); missing is a photographer. */
  trade?: unknown;
  /** What the studio gave the import: the pasted list, the excerpts the AI cited. */
  sourceText?: string;
  /** Where the ids of the extras a vendor's list becomes start. */
  addOnIdPrefix?: string;
  /** Where the ids of a list's shared Extras start: the same for every package of one import. */
  sharedAddOnIdPrefix?: string;
}) {
  const content = record(input.structuredContent);
  const trade = tradeOf(input.trade);
  const vendor = trade !== DEFAULT_TRADE;
  // The AI also hangs a photographer's package price on its first inclusion
  // ("6 hours of coverage $3,200"); that price isn't something it includes.
  // A vendor's lines are read with theirs (priceListItems).
  const details = lineItemText(
    content.lineItems ?? content.pricingItems ?? content.items,
    input.name,
    vendor,
  );
  const source = [
    text(content.description),
    ...details,
    text(content.sourceText),
  ]
    .filter(Boolean)
    .join("\n");
  const explicitPrice = money(
    content.price ??
      content.packagePrice ??
      content.basePrice ??
      content.amount,
  );
  const amountCents = money(content.amountCents ?? content.basePriceCents);
  const firstItemPriceCents = Array.isArray(content.lineItems)
    ? content.lineItems.flatMap((item) => {
        const entry = record(item);
        const cents = money(entry.amountCents);
        if (cents !== null) return [Math.round(cents)];
        const dollars = money(entry.amount ?? entry.price);
        return dollars === null ? [] : [Math.round(dollars * 100)];
      })[0] ?? 0
    : 0;
  const statedPriceCents =
    explicitPrice !== null
      ? Math.round(explicitPrice * 100)
      : amountCents !== null
        ? Math.round(amountCents)
        : null;

  /**
   * A vendor's price list is one service and its extras: "Bridal hair $375",
   * then the trial, the bridesmaids per person, the extensions. It imported
   * as one package whose description was all five lines run together (Jess
   * Styles Bridal, 2026-10-10). The first priced line — or the one the draft
   * names as the price — is the package; every other priced line becomes an
   * extra it suggests, at the price the list gives and nothing else. A
   * photographer's list reads as it always has.
   */
  const listed = vendor
    ? priceListItems(content.lineItems ?? content.pricingItems ?? content.items)
    : [];
  // A line at $0 ("Veil placement, included") is part of the package.
  const priced = listed.filter((item) => (item.cents ?? 0) > 0 && !item.terms);
  const baseIndex =
    statedPriceCents === null
      ? 0
      : priced.findIndex((item) => item.cents === statedPriceCents);
  // A package suggests at most 20 extras (updatePackage's addOnIds), or the
  // studio could not save it again. A longer list is a menu of services, not
  // one service and its extras: it reads as one package, as it always did,
  // and no line is lost.
  const base =
    priced.length >= 2 &&
    priced.length - 1 <= MAX_IMPORTED_ADD_ONS &&
    baseIndex >= 0
      ? priced[baseIndex]
      : null;
  const inclusions = base
    ? [
        base,
        ...listed.filter((item) => !priced.includes(item) && !item.terms),
      ].map((item) => (item.detail ? `${item.name} — ${item.detail}` : item.name))
    : [];
  const addOnIds = new Set<string>();
  // One package of several on a vendor's list: its own paragraph and the
  // list's shared extras, from the studio's text (packageSection above).
  const pasted = text(input.sourceText);
  const ownSection = vendor && !base ? packageSection(pasted, input.name) : "";
  // A photographer's list has its add-ons section too ("Extra hour — $400"):
  // it was dropped whole (onboarding audit, 2026-10-24).
  const listExtras =
    !base
      ? sharedExtras(pasted).map((extra) => ({ name: extra.name, detail: extra.detail, cents: extra.cents, byQuantity: Boolean(extra.unit), unit: extra.unit }))
      : [];
  const addOnSource = base ? priced.filter((item) => item !== base) : listExtras;
  const addOns: ImportedAddOn[] = addOnSource.length
    ? addOnSource
        .map((item) => {
          const prefix = base ? input.addOnIdPrefix : (input.sharedAddOnIdPrefix ?? input.addOnIdPrefix);
          const stem = `${prefix ?? "imported_addon"}_${slugOf(item.name)}`;
          let id = stem;
          for (let n = 2; addOnIds.has(id); n += 1) id = `${stem}_${n}`;
          addOnIds.add(id);
          return {
            id,
            name: item.name,
            description: item.detail,
            unitPriceCents: item.cents ?? 0,
            taxable: true,
            allowQuantity: item.byQuantity,
            unitLabel: normalizeUnitLabel(item.unit),
            active: true,
          };
        })
    : [];
  // What the package itself says, without its extras' lines. A draft
  // description that walks through the extras too is the list again, not
  // the package.
  // "Full Planning 6,500" is the name and the price again, not a description.
  const draftDescription = text(content.description);
  const ownDescription =
    ownSection &&
    (!draftDescription || draftDescription.replace(/[\d,.$\s]/g, "").toLowerCase() === input.name.replace(/\s/g, "").toLowerCase())
      ? ownSection
      : draftDescription;
  const packageDescription =
    base &&
    addOns.some((addOn) =>
      ownDescription.toLowerCase().includes(addOn.name.toLowerCase()),
    )
      ? ""
      : ownDescription;
  const packageText = base
    ? [packageDescription, ...inclusions].filter(Boolean).join("\n")
    : source;

  const draftedPriceCents = Math.round(
    base
      ? (base.cents ?? 0)
      : statedPriceCents !== null
        ? statedPriceCents
        : // A vendor's list of more lines than a package keeps as extras is
          // priced from its first priced line, written however the AI wrote it.
          (priced[0]?.cents ?? firstItemPriceCents),
  );
  // The AI sometimes lists a package's inclusions as its line items and
  // writes its price nowhere: three packages of a pasted list came out at $0
  // on studio-cue.com (2026-10-24). The price is on the package's own line in
  // the list the studio gave ("Essential - $3,200"), so it's read from there.
  const basePriceCents =
    draftedPriceCents > 0 ? draftedPriceCents : (headingPriceCents(pasted, input.name) ?? draftedPriceCents);
  const coverage = source.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)/i);
  /**
   * Coverage, per role.
   *
   * This regex has always read `videographers?` and then thrown the answer
   * away, because the only field to put it in was named after photographers.
   * A price list reading "Two Videographers for a full day" imported as one
   * photographer. Now every mention is matched and bucketed by the role it
   * names, and the highest count for a role wins — a list often states the
   * same role twice, once in a summary and once in a line item.
   */
  const roles = tradeRoles(trade);
  // Within one line, and never the tail of a price: "$3,200" on the line
  // above "one photographer" read as 200 photographers, capped at 50
  // (studio-cue.com, 2026-10-24).
  const crewPattern = new RegExp(
    String.raw`(?<![\d,.$])\b(\d+|one|two|three|four|five|six)[^\S\r\n]+((?:[a-z]+[^\S\r\n]+){0,2})(${roles
      .map((role) => ROLE_WORDS[role])
      .join("|")})\b`,
    "gi",
  );
  const counts = new Map<CoverageRole, number>();
  for (const match of packageText.matchAll(crewPattern)) {
    const value = (match[1] ?? "").toLowerCase();
    const count = Number(value) || wordsToNumber[value] || 0;
    if (count < 1) continue;
    // "Up to 6 guests per stylist", "8 faces per artist": a ratio, not a
    // crew of six. It read as six stylists, on the quote and in the offers.
    if (vendor && RATIO_WORD.test(match[2] ?? "")) continue;
    const word = match[3] ?? "";
    const role =
      roles.find((candidate) =>
        new RegExp(`^(?:${ROLE_WORDS[candidate]})$`, "i").test(word),
      ) ?? roles[0];
    if (!role) continue;
    counts.set(role, Math.max(counts.get(role) ?? 0, Math.min(50, count)));
  }
  const includedCoverage = counts.size
    ? normaliseCoverage([...counts].map(([role, count]) => ({ role, count })))
    : // Nothing stated: one of the studio's own crew — one photographer, as
      // this has always assumed, or a hair studio's one stylist — rather
      // than importing a package that sends nobody.
      normaliseCoverage([{ role: roles[0] ?? "photographer", count: 1 }]);
  const includedPhotographers = legacyPhotographerCount(includedCoverage);
  /**
   * Hours. A photographer's import has always assumed one hour when the list
   * names none. A vendor's names hours only when it means them, so none
   * stated is none written: Jess Styles Bridal's quote read "1 hair stylist,
   * 1 hour" from a list that never mentioned hours (2026-10-10). Zero is
   * unstated: the agreement, the quote and the package lists skip it.
   */
  const vendorHours = Number((ownSection || packageText).match(VENDOR_HOURS)?.[1]);
  const includedCoverageMinutes = vendor
    ? vendorHours > 0 && vendorHours <= 24
      ? Math.round(vendorHours * 60)
      : 0
    : Math.max(1, Math.round(Number(coverage?.[1] ?? 1) * 60));
  const extractedCurrency = text(content.currency).toUpperCase();
  const currency = /^[A-Z]{3}$/.test(extractedCurrency)
    ? extractedCurrency
    : "USD";
  const written =
    packageDescription ||
    (base ? inclusions.join(". ") : details.join(". ")).slice(0, 3000);
  const fallback = `${input.name} imported from an approved studio source.`;
  // A package's description is ten characters or more (createPackage, the
  // package schema). A vendor's base line can be shorter — "Updo" — so it is
  // named for the package: "Bridal hair: Updo".
  const named =
    written && written.toLowerCase() !== input.name.trim().toLowerCase()
      ? `${input.name}: ${written}`
      : "";
  const description = vendor
    ? ([written, named].find((candidate) => candidate.length >= 10) ?? fallback)
    : written || fallback;

  return {
    name: input.name,
    description,
    eventTypeId: text(content.eventTypeId) || "wedding",
    eventTypeLabel: text(content.eventTypeLabel) || "Wedding",
    basePriceCents,
    currency,
    retainerRule: importedRetainerRule(
      content,
      vendor ? { sourceText: text(input.sourceText), listed } : null,
      text(input.sourceText),
    ),
    includedCoverageMinutes,
    includedCoverage,
    includedPhotographers,
    includedDeliverables: base
      ? inclusions.slice(0, 40)
      : ownSection
        ? ownSection.split(/[:;,]\s+|\.\s+/).map((part) => part.trim()).filter((part) => part.length > 2).slice(0, 40)
        : details.length
          ? details.slice(0, 40)
          : [description],
    // A planner's tier, from the package's name (planning-scope.ts): the
    // checklist and when the Final details form goes out both follow it.
    ...(trade === "planner" && planningScopeFromName(input.name) ? { planningScope: planningScopeFromName(input.name) } : {}),
    includedTravelArea: text(content.travelArea),
    addOns,
    taxRateBasisPoints: 0,
    terms:
      text(content.terms) ||
      "See the studio’s approved booking agreement for complete terms and conditions.",
    active: true,
    publicVisible: false,
    displayOrder: input.displayOrder,
    internalNotes:
      "Imported from an approved StudioCue AI import. Confirm any package details that were not present in the source before publishing publicly.",
  };
}

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
