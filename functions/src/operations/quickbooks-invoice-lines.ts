/**
 * What a QuickBooks invoice says, line by line, the way the studio writes it.
 *
 * Every StudioCue invoice used to reach QuickBooks as one line: the word
 * "retainer" or "final", quantity 1, the whole amount. GR Productions — a
 * real studio, QuickBooks Online with QuickBooks Payments and US sales tax —
 * builds them by hand like this (2026-10-01):
 *
 *   Retainer invoice: "Retainer", quantity = crew booked, $1,000 each; then
 *   every package from the proposal at $0 — the taxable amount, carried
 *   so the final can be worked out from it.
 *
 *   Final invoice: every package at its full (taxable) price, the retainer
 *   taken off, and sales tax on the full package amount.
 *
 * Everything here is pure: no Firestore, no fetch. The worker in
 * provider-runtime.ts gathers the job's packages, calls these, and posts the
 * result. tests/quickbooks-invoice-lines.test.ts pins every rule below.
 *
 * Money is integer cents until the moment it becomes a QuickBooks dollar
 * figure, in `qbDollars`.
 */

/** How the company handles sales tax, read from its Preferences. */
export type QuickBooksTaxMode =
  /**
   * US company on Automated Sales Tax. Lines are marked TAX/NON and the tax
   * StudioCue agreed with the couple is sent as an override
   * (TxnTaxDetail.TotalTax), so QuickBooks records it as sales tax without
   * recomputing a different figure.
   */
  | "automated"
  /**
   * US company tracking sales tax the older (manual) way. Every line is NON
   * so QuickBooks adds nothing, and StudioCue's tax is its own line.
   */
  | "manual"
  /**
   * No sales tax in QuickBooks (or not a US company). No tax codes are sent
   * at all — exactly as before — and StudioCue's tax, if any, is its own line.
   * The invoice totals what it always did.
   */
  | "none";

export type InvoiceLineKind =
  | "retainer"
  | "package"
  | "add_on"
  | "discount"
  | "retainer_received"
  | "payments_received"
  | "sales_tax"
  | "amount";

export type InvoiceLine = {
  kind: InvoiceLineKind;
  /** Short label for the studio's screens: "Retainer", "Gold Photo Package". */
  title: string;
  /** The full description QuickBooks prints on the line. */
  description: string;
  quantity: number;
  unitPriceCents: number;
  /** quantity × unitPriceCents, always — QuickBooks refuses a line where it isn't. */
  amountCents: number;
  /** Counted towards sales tax. Never true for a retainer or a payment line. */
  taxable: boolean;
};

/** A package or extra as the couple agreed it (the proposal's line). */
export type JobPackageItem = {
  kind: "package" | "add_on";
  name: string;
  /** "2 photographers, 8 hours" — null when nothing is known. */
  summary: string | null;
  /** The proposal's bullets for this package. */
  inclusions: string[];
  quantity: number;
  unitPriceCents: number;
  amountCents: number;
  taxable: boolean;
};

/** One package's share of the retainer, and how it was worked out. */
export type RetainerPart = {
  packageName: string;
  retainerCents: number;
  /** Set when the package bills its retainer per crew member. */
  perCrew: { amountPerCrewCents: number; crew: number } | null;
};

export type BillingAddress = {
  line1: string;
  line2?: string | null;
  city: string;
  region?: string | null;
  postalCode?: string | null;
  country?: string | null;
};

export type QuickBooksContact = {
  firstName?: string | null;
  lastName?: string | null;
  displayName: string;
  email: string;
  phone?: string | null;
  billingAddress?: BillingAddress | null;
};

/** QuickBooks caps a line description at 4,000 characters. */
const DESCRIPTION_LIMIT = 4000;

const cents = (value: unknown): number => {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? Math.round(number) : 0;
};

const clean = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/** Cents to the dollar figure QuickBooks takes, without float dust. */
export function qbDollars(amountCents: number): number {
  return Math.round(amountCents) / 100;
}

const usd = (amountCents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amountCents / 100);

/** Mirrors billedCrewCount in features/packages/create-snapshot.ts. */
export function billedCrewCount(
  coverage: readonly { role: string; count: number }[],
  billedRoles: readonly string[] | undefined,
): number {
  const roles = billedRoles?.length ? billedRoles : ["photographer"];
  return Math.max(
    1,
    roles.reduce((sum, role) => sum + (coverage.find((item) => item.role === role)?.count ?? 0), 0),
  );
}

/** "8 hours", "1.5 hours", "45 minutes"; null for nothing. */
export function coverageHours(minutes: unknown): string | null {
  const value = Number(minutes);
  if (!Number.isFinite(value) || value <= 0) return null;
  if (value < 60) return `${Math.round(value)} minutes`;
  const hours = Math.round((value / 60) * 100) / 100;
  return `${hours} ${hours === 1 ? "hour" : "hours"}`;
}

/**
 * "Gold Photo Package — 2 photographers, 8 hours", then the proposal's
 * bullets, one per line. Reads like the proposal because it is the proposal.
 */
export function packageLineDescription(item: JobPackageItem): string {
  const quantity = item.kind === "add_on" && item.quantity > 1 ? ` × ${item.quantity}` : "";
  const head = `${item.name}${quantity}${item.summary ? ` — ${item.summary}` : ""}`;
  const bullets = item.inclusions.map((entry) => clean(entry)).filter(Boolean);
  const text = bullets.length ? `${head}\n${bullets.map((entry) => `• ${entry}`).join("\n")}` : head;
  return text.length > DESCRIPTION_LIMIT ? `${text.slice(0, DESCRIPTION_LIMIT - 1)}…` : text;
}

const sum = (lines: readonly { amountCents: number }[]) =>
  lines.reduce((total, line) => total + line.amountCents, 0);

function line(input: Omit<InvoiceLine, "amountCents"> & { amountCents?: number }): InvoiceLine {
  return { ...input, amountCents: input.amountCents ?? input.quantity * input.unitPriceCents };
}

/**
 * The retainer line(s).
 *
 * A per-crew retainer reads the way the studio writes it: quantity = crew
 * booked, rate = the per-crew amount ("2 × $1,000"). Packages that share a
 * per-crew rate are one line with the crew added up. Anything StudioCue
 * cannot show as parts that add up to the amount it bills — a retainer the
 * studio set by hand, a percentage, a figure capped at the package total —
 * is one line of the whole amount. The total is never in doubt.
 */
export function retainerLines(amountCents: number, parts: readonly RetainerPart[]): InvoiceLine[] {
  const amount = cents(amountCents);
  const live = parts.filter((part) => cents(part.retainerCents) > 0);
  const whole = [
    line({ kind: "retainer", title: "Retainer", description: "Retainer", quantity: 1, unitPriceCents: amount, taxable: false }),
  ];
  if (!live.length || sum(live.map((part) => ({ amountCents: cents(part.retainerCents) }))) !== amount) return whole;
  const perCrewRates = new Set(
    live.map((part) =>
      part.perCrew && part.perCrew.crew * part.perCrew.amountPerCrewCents === cents(part.retainerCents)
        ? part.perCrew.amountPerCrewCents
        : null,
    ),
  );
  // Every part per crew, at one rate: one line, crew added up.
  const onlyRate = perCrewRates.size === 1 ? [...perCrewRates][0] : null;
  if (typeof onlyRate === "number" && onlyRate > 0) {
    const crew = live.reduce((total, part) => total + (part.perCrew?.crew ?? 0), 0);
    return [
      line({
        kind: "retainer",
        title: "Retainer",
        description: `Retainer — ${usd(onlyRate)} per crew member`,
        quantity: crew,
        unitPriceCents: onlyRate,
        taxable: false,
      }),
    ];
  }
  if (live.length === 1) {
    return whole;
  }
  return live.map((part) => {
    const perCrew =
      part.perCrew && part.perCrew.crew * part.perCrew.amountPerCrewCents === cents(part.retainerCents)
        ? part.perCrew
        : null;
    return line({
      kind: "retainer",
      title: `Retainer — ${part.packageName}`,
      description: perCrew
        ? `Retainer — ${part.packageName} (${usd(perCrew.amountPerCrewCents)} per crew member)`
        : `Retainer — ${part.packageName}`,
      quantity: perCrew ? perCrew.crew : 1,
      unitPriceCents: perCrew ? perCrew.amountPerCrewCents : cents(part.retainerCents),
      taxable: false,
    });
  });
}

/**
 * The retainer invoice: the retainer, then every package and extra at $0.
 *
 * The $0 lines carry the proposal onto the invoice so the studio — and the
 * couple — can see what the retainer secures. They are marked taxable when
 * the job is taxed, as the studio marks them; at $0 that adds no tax.
 */
export function quickBooksRetainerLines(input: {
  amountCents: number;
  items: readonly JobPackageItem[];
  parts: readonly RetainerPart[];
  /** The agreed price carries sales tax. */
  taxApplies: boolean;
}): InvoiceLine[] {
  const lines = [
    ...retainerLines(input.amountCents, input.parts),
    ...input.items.map((item) =>
      line({
        kind: item.kind,
        title: item.name,
        description: packageLineDescription(item),
        quantity: 1,
        unitPriceCents: 0,
        taxable: input.taxApplies && item.taxable,
      }),
    ),
  ];
  // Cannot fail by construction; asserted so a later edit cannot make it.
  if (sum(lines) !== cents(input.amountCents)) {
    return retainerLines(input.amountCents, []);
  }
  return lines;
}

export type FinalLinesResult = {
  lines: InvoiceLine[];
  /** Sales tax this invoice charges, on the full package amount. */
  taxCents: number;
  /** False when the packages could not be itemised and one line stands in. */
  itemised: boolean;
};

/**
 * The final invoice: packages at full price, the retainer taken off, tax on
 * the full package amount.
 *
 *   packages (taxable) − discount − retainer received (non-taxable)
 *   − any later payments (non-taxable) + tax  =  the balance StudioCue bills
 *
 * `packageTotalCents` already includes the tax (features/pricing/package-price.ts),
 * so the package lines add up to `packageTotalCents − taxCents` and tax is
 * charged once, on top. When the agreed lines don't add up to that — an
 * amendment, a hand-set figure — one "Packages" line of the right amount
 * stands in, so the invoice total is never wrong.
 */
export function quickBooksFinalLines(input: {
  amountCents: number;
  packageTotalCents: number;
  taxCents: number;
  discountCents: number;
  items: readonly JobPackageItem[];
  /** The retainer actually paid; null when unknown (everything paid counts as one). */
  retainerPaidCents: number | null;
}): FinalLinesResult {
  const amount = cents(input.amountCents);
  const total = cents(input.packageTotalCents);
  const tax = Math.max(0, cents(input.taxCents));
  const preTax = total - tax;
  const credit = total - amount;
  const fallback: FinalLinesResult = {
    lines: [
      line({ kind: "amount", title: "Final balance", description: "Final balance", quantity: 1, unitPriceCents: amount, taxable: false }),
    ],
    taxCents: 0,
    itemised: false,
  };
  if (amount <= 0 || preTax < 0 || credit < 0) return fallback;
  const taxed = tax > 0;
  const discount = Math.max(0, cents(input.discountCents));
  const itemised =
    input.items.length > 0 && sum(input.items) - discount === preTax && input.items.every((item) => item.amountCents >= 0);
  const packageLines: InvoiceLine[] = itemised
    ? [
        ...input.items.map((item) =>
          line({
            kind: item.kind,
            title: item.name,
            description: packageLineDescription(item),
            quantity: item.quantity > 0 && item.amountCents === item.quantity * item.unitPriceCents ? item.quantity : 1,
            unitPriceCents:
              item.quantity > 0 && item.amountCents === item.quantity * item.unitPriceCents
                ? item.unitPriceCents
                : item.amountCents,
            taxable: taxed && item.taxable,
          }),
        ),
        ...(discount > 0
          ? [line({ kind: "discount" as const, title: "Discount", description: "Discount", quantity: 1, unitPriceCents: -discount, taxable: taxed })]
          : []),
      ]
    : [
        line({
          kind: "package",
          title: "Packages",
          description:
            input.items
              .filter((item) => item.kind === "package")
              .map((item) => item.name)
              .join(" + ") || "Packages",
          quantity: 1,
          unitPriceCents: preTax,
          taxable: taxed,
        }),
      ];
  const retainerReceived = Math.min(
    credit,
    input.retainerPaidCents === null ? credit : Math.max(0, cents(input.retainerPaidCents)),
  );
  const otherPayments = credit - retainerReceived;
  const lines = [
    ...packageLines,
    ...(retainerReceived > 0
      ? [line({ kind: "retainer_received" as const, title: "Retainer received", description: "Retainer received — thank you", quantity: 1, unitPriceCents: -retainerReceived, taxable: false })]
      : []),
    ...(otherPayments > 0
      ? [line({ kind: "payments_received" as const, title: "Payments received", description: "Payments received", quantity: 1, unitPriceCents: -otherPayments, taxable: false })]
      : []),
  ];
  if (sum(lines) + tax !== amount) return fallback;
  return { lines, taxCents: tax, itemised };
}

/**
 * The tax mode a company's Preferences call for.
 *
 * Only a US company (home currency USD, or none stated) gets tax codes: TAX
 * and NON are the US codes, and a global-model company would refuse them.
 * A preferences read that failed is "none": exactly what StudioCue sent
 * before tax modes existed. Whatever QuickBooks then makes of it, the
 * read-back (quickBooksAmountCheck) shows the studio if it billed a
 * different figure.
 */
export function quickBooksTaxMode(preferences: unknown): QuickBooksTaxMode {
  if (preferences === null || typeof preferences !== "object") return "none";
  const prefs = preferences as Record<string, unknown>;
  const currency = prefs.CurrencyPrefs as Record<string, unknown> | undefined;
  const home = currency?.HomeCurrency as Record<string, unknown> | undefined;
  const homeCurrency = clean(home?.value).toUpperCase();
  if (homeCurrency && homeCurrency !== "USD") return "none";
  const tax = (prefs.TaxPrefs ?? {}) as Record<string, unknown>;
  if (tax.UsingSalesTax !== true) return "none";
  return tax.PartnerTaxEnabled === true ? "automated" : "manual";
}

export type QuickBooksLinePayload = {
  Line: Record<string, unknown>[];
  TxnTaxDetail?: { TotalTax: number };
  /** What the invoice should total, StudioCue's figure. */
  expectedTotalCents: number;
};

/**
 * The invoice's `Line` (and tax detail) for QuickBooks.
 *
 *   automated: TAX on taxable lines, NON elsewhere; StudioCue's tax as an
 *     override. No tax agreed → every line NON, so QuickBooks adds none.
 *   manual:    every line NON; tax as its own non-taxable line.
 *   none:      no tax codes at all (as before); tax as its own line.
 */
export function quickBooksLinePayload(input: {
  lines: readonly InvoiceLine[];
  taxCents: number;
  mode: QuickBooksTaxMode;
  /**
   * The item each line is sold as: one item for every line, or a choice per
   * line (the StudioCue Retainer / Photography package items,
   * integrations/quickbooks-items.ts).
   */
  itemRef: { value: string; name?: string } | ((line: InvoiceLine) => { value: string; name?: string });
}): QuickBooksLinePayload {
  const tax = Math.max(0, cents(input.taxCents));
  const taxLine =
    input.mode !== "automated" && tax > 0
      ? [line({ kind: "sales_tax", title: "Sales tax", description: "Sales tax", quantity: 1, unitPriceCents: tax, taxable: false })]
      : [];
  const all = [...input.lines, ...taxLine];
  const code = (taxable: boolean) =>
    input.mode === "none"
      ? {}
      : { TaxCodeRef: { value: input.mode === "automated" && tax > 0 && taxable ? "TAX" : "NON" } };
  return {
    Line: all.map((entry) => ({
      Amount: qbDollars(entry.amountCents),
      DetailType: "SalesItemLineDetail",
      Description: entry.description,
      SalesItemLineDetail: {
        ItemRef: typeof input.itemRef === "function" ? input.itemRef(entry) : input.itemRef,
        Qty: entry.quantity,
        UnitPrice: qbDollars(entry.unitPriceCents),
        ...code(entry.taxable),
      },
    })),
    ...(input.mode === "automated" && tax > 0 ? { TxnTaxDetail: { TotalTax: qbDollars(tax) } } : {}),
    expectedTotalCents: sum(all) + (input.mode === "automated" ? tax : 0),
  };
}

export type AmountCheck = {
  matches: boolean;
  expectedCents: number;
  providerTotalCents: number;
  differenceCents: number;
};

/** Did QuickBooks bill what StudioCue expected? */
export function quickBooksAmountCheck(expectedCents: number, providerTotalCents: number): AmountCheck {
  const expected = cents(expectedCents);
  const provider = cents(providerTotalCents);
  return { matches: expected === provider, expectedCents: expected, providerTotalCents: provider, differenceCents: provider - expected };
}

/** Given and family names: the contact's own, else split from the display name. */
export function quickBooksCustomerNames(contact: QuickBooksContact): { given: string; family: string } {
  const first = clean(contact.firstName);
  const last = clean(contact.lastName);
  if (first || last) return { given: first.slice(0, 100), family: last.slice(0, 100) };
  const words = clean(contact.displayName).split(/\s+/).filter(Boolean);
  if (words.length < 2) return { given: (words[0] ?? "").slice(0, 100), family: "" };
  return { given: words.slice(0, -1).join(" ").slice(0, 100), family: words[words.length - 1]!.slice(0, 100) };
}

/** A QuickBooks BillAddr from a contact's billing address, or null. */
export function quickBooksBillAddr(address: BillingAddress | null | undefined): Record<string, string> | null {
  if (!address) return null;
  const line1 = clean(address.line1);
  const city = clean(address.city);
  if (!line1 || !city) return null;
  const out: Record<string, string> = { Line1: line1.slice(0, 500), City: city.slice(0, 255) };
  const line2 = clean(address.line2);
  if (line2) out.Line2 = line2.slice(0, 500);
  const region = clean(address.region);
  if (region) out.CountrySubDivisionCode = region.slice(0, 255);
  const postal = clean(address.postalCode);
  if (postal) out.PostalCode = postal.slice(0, 30);
  const country = clean(address.country);
  if (country) out.Country = country.slice(0, 255);
  return out;
}

/** The body for a new QuickBooks customer. */
export function quickBooksCustomerCreateBody(contact: QuickBooksContact, displayName: string): Record<string, unknown> {
  const names = quickBooksCustomerNames(contact);
  const phone = clean(contact.phone);
  const address = quickBooksBillAddr(contact.billingAddress);
  return {
    DisplayName: displayName,
    ...(names.given ? { GivenName: names.given } : {}),
    ...(names.family ? { FamilyName: names.family } : {}),
    PrimaryEmailAddr: { Address: contact.email },
    ...(phone ? { PrimaryPhone: { FreeFormNumber: phone } } : {}),
    ...(address ? { BillAddr: address } : {}),
  };
}

/**
 * Fill the blanks on a customer the studio already has — nothing else.
 *
 * QuickBooks is the studio's book; a name, phone or address they typed
 * there is theirs and StudioCue never overwrites it. Only a field that is
 * empty in QuickBooks and known to StudioCue is sent, as a sparse update.
 * The address goes in whole or not at all: half of ours on top of half of
 * theirs would be nobody's address. Null when there is nothing to fill.
 */
export function quickBooksCustomerSparseUpdate(
  existing: Record<string, unknown>,
  contact: QuickBooksContact,
): Record<string, unknown> | null {
  const id = clean(existing.Id);
  const syncToken = existing.SyncToken === undefined || existing.SyncToken === null ? "" : String(existing.SyncToken);
  if (!id || !syncToken) return null;
  const record = (value: unknown) =>
    typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const names = quickBooksCustomerNames(contact);
  const fills: Record<string, unknown> = {};
  if (!clean(existing.GivenName) && names.given) fills.GivenName = names.given;
  if (!clean(existing.FamilyName) && names.family) fills.FamilyName = names.family;
  if (!clean(record(existing.PrimaryEmailAddr).Address) && clean(contact.email))
    fills.PrimaryEmailAddr = { Address: clean(contact.email) };
  if (!clean(record(existing.PrimaryPhone).FreeFormNumber) && clean(contact.phone))
    fills.PrimaryPhone = { FreeFormNumber: clean(contact.phone) };
  const bill = record(existing.BillAddr);
  const hasAddress = ["Line1", "City", "PostalCode"].some((key) => clean(bill[key]));
  const address = quickBooksBillAddr(contact.billingAddress);
  if (!hasAddress && address) fills.BillAddr = address;
  if (!Object.keys(fills).length) return null;
  return { Id: id, SyncToken: syncToken, sparse: true, ...fills };
}
