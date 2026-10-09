"use client";

import Link from "next/link";
import { useTenantDocuments } from "@/components/live/tenant-records";
import { InfoHint } from "@/components/ui/info-hint";
import { normalizeUnitLabel } from "@/features/packages/unit-label";

type Row = Record<string, unknown> & { id: string };
const text = (value: unknown) => (typeof value === "string" ? value : "");

function money(cents: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD" }).format(cents / 100);
}

/**
 * Which library add-ons a package suggests (H2). The package form sent
 * `addOns: []` whatever the studio wanted, so no package could offer one.
 * The server copies each chosen add-on onto the package, so a later library
 * edit never moves a price a couple has already seen.
 */
export function PackageAddOnPicker({
  value,
  onChange,
  currency,
}: {
  value: readonly string[];
  onChange: (next: string[]) => void;
  currency: string;
}) {
  const { records, loading } = useTenantDocuments("addOns");
  const library = ((records ?? []) as Row[])
    .filter((row) => !row.archivedAt)
    .sort((a, b) => text(a.name).localeCompare(text(b.name)));
  const chosen = new Set(value);

  return (
    <fieldset className="form-span package-add-on-picker">
      <legend>
        Add-ons this package suggests <InfoHint term="add-on" />
      </legend>
      {loading && !records ? <p className="field-hint">Loading your add-ons…</p> : null}
      {!loading && library.length === 0 ? (
        <p className="field-hint">
          None in your library yet. <Link href="/studio/library/add-ons">Add your extras</Link> — an engagement
          session, an extra hour — and they can be suggested here.
        </p>
      ) : null}
      {library.map((row) => (
        <label className="form-checkbox" key={row.id}>
          <input
            checked={chosen.has(row.id)}
            onChange={(event) =>
              onChange(
                event.target.checked ? [...value, row.id] : value.filter((id) => id !== row.id),
              )
            }
            type="checkbox"
          />
          <span>
            {text(row.name)} · {money(Number(row.unitPriceCents ?? 0), currency)}
            {row.allowQuantity ? (normalizeUnitLabel(row.unitLabel) ? ` per ${normalizeUnitLabel(row.unitLabel)}` : " each") : ""}
          </span>
        </label>
      ))}
    </fieldset>
  );
}
