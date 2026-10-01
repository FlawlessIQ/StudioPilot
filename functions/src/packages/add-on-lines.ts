/**
 * The extras on one package, as a package snapshot keeps them — the line
 * shape setJobAddOns writes (../crm/commands.ts) — resolved from what the
 * studio sent. Pure.
 *
 * Written for a booking change (../contracts/amendments.ts), where the
 * package was already signed for, so one rule matters more than it does
 * before signing: an extra the couple already agreed to keeps the price it was
 * agreed at. Editing the library entry since must not move it.
 */

export type AddOnLineInput = {
  /** A library or package add-on (or one already on the snapshot); null for a one-off. */
  addOnId: string | null;
  name?: string;
  unitPriceCents?: number;
  taxable?: boolean;
  quantity: number;
};

export type AddOnLine = {
  addOnId: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
  taxable: boolean;
};

type Row = Record<string, unknown>;

const isRow = (value: unknown): value is Row => typeof value === "object" && value !== null && !Array.isArray(value);
const cents = (value: unknown) => {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : 0;
};

/** The extras a snapshot carries, read defensively. */
export function snapshotAddOnLines(snapshot: unknown): AddOnLine[] {
  const list = isRow(snapshot) && Array.isArray(snapshot.addOns) ? snapshot.addOns : [];
  return list.filter(isRow).map((line) => {
    const quantity = Math.max(1, Math.trunc(Number(line.quantity ?? 1)) || 1);
    const unitPriceCents = cents(line.unitPriceCents);
    return {
      addOnId: typeof line.addOnId === "string" && line.addOnId ? line.addOnId : "",
      name: typeof line.name === "string" && line.name ? line.name : "Extra",
      quantity,
      unitPriceCents,
      lineTotalCents: typeof line.lineTotalCents === "number" ? cents(line.lineTotalCents) : unitPriceCents * quantity,
      taxable: line.taxable !== false,
    };
  });
}

/** A one-off extra's id, as setJobAddOns writes them. */
export const isCustomAddOnId = (id: string) => id.startsWith("custom_");

/**
 * The lines, each priced from (first match wins):
 * 1. the extra as already agreed on this package (`agreed`, by id) — its
 *    agreed name, price and tax;
 * 2. the package's own suggestions;
 * 3. the studio's library (`library`: only live entries of this studio);
 * or, for a one-off, what the studio wrote. A one-off identical to one already
 * agreed keeps that one's id, so an unchanged list reads as unchanged.
 * Throws ADD_ON_NOT_FOUND / CUSTOM_ADD_ON_INCOMPLETE, as setJobAddOns does.
 */
export function resolveAddOnLines(
  inputs: readonly AddOnLineInput[],
  sources: {
    agreed: readonly AddOnLine[];
    suggested: readonly Row[];
    library: ReadonlyMap<string, Row>;
    newCustomId: () => string;
  },
): AddOnLine[] {
  return inputs.map((item) => {
    const quantity = Math.min(100, Math.max(1, Math.trunc(item.quantity) || 1));
    if (item.addOnId) {
      const agreed = sources.agreed.find((line) => line.addOnId === item.addOnId);
      if (agreed)
        return {
          addOnId: agreed.addOnId,
          name: agreed.name,
          quantity,
          unitPriceCents: agreed.unitPriceCents,
          lineTotalCents: agreed.unitPriceCents * quantity,
          taxable: agreed.taxable,
        };
      const definition =
        sources.suggested.find((row) => row.id === item.addOnId && row.active !== false) ??
        sources.library.get(item.addOnId);
      if (!definition) throw new Error("ADD_ON_NOT_FOUND");
      const unitPriceCents = cents(definition.unitPriceCents);
      return {
        addOnId: item.addOnId,
        name: typeof definition.name === "string" && definition.name ? definition.name : "Extra",
        quantity,
        unitPriceCents,
        lineTotalCents: unitPriceCents * quantity,
        taxable: definition.taxable !== false,
      };
    }
    const name = item.name?.trim() ?? "";
    if (name.length < 2 || item.unitPriceCents === undefined) throw new Error("CUSTOM_ADD_ON_INCOMPLETE");
    const unitPriceCents = cents(item.unitPriceCents);
    const taxable = item.taxable ?? true;
    const same = sources.agreed.find(
      (line) =>
        isCustomAddOnId(line.addOnId) &&
        line.name === name &&
        line.unitPriceCents === unitPriceCents &&
        line.taxable === taxable,
    );
    return {
      addOnId: same?.addOnId ?? sources.newCustomId(),
      name,
      quantity,
      unitPriceCents,
      lineTotalCents: unitPriceCents * quantity,
      taxable,
    };
  });
}

const lineKey = (line: AddOnLine) =>
  [line.addOnId, line.name, line.unitPriceCents, line.quantity, line.taxable ? "t" : "f"].join("|");

/** Whether two lists of extras are the same extras, in any order. */
export function sameAddOnLines(a: readonly AddOnLine[], b: readonly AddOnLine[]): boolean {
  if (a.length !== b.length) return false;
  const left = a.map(lineKey).sort();
  const right = b.map(lineKey).sort();
  return left.every((key, index) => key === right[index]);
}
