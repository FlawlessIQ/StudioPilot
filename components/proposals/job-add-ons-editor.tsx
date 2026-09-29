"use client";

import { useState } from "react";
import { LoaderCircle, Plus, X } from "lucide-react";
import { useTenantDocuments } from "@/components/live/tenant-records";

type Row = Record<string, unknown> & { id: string };
const text = (value: unknown, fallback = ""): string => (typeof value === "string" && value ? value : fallback);

/** One extra on a package, as the setJobAddOns command takes it. */
export type JobAddOnLine = {
  addOnId: string | null;
  name: string;
  unitPriceCents: number;
  taxable: boolean;
  quantity: number;
  saveToLibrary?: boolean;
};

function money(cents: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD" }).format(cents / 100);
}

/**
 * The extras on one package on a job (H2 slice 3): what the package
 * suggests, anything in the library, or a one-off written for this couple —
 * "special family shots" — which can be kept in the library for next time.
 * Saving prices the package again; the proposal follows.
 */
export function JobAddOnsEditor({
  snapshot,
  suggested,
  currency,
  busy,
  onSave,
  onCancel,
}: {
  snapshot: Row | undefined;
  /** The package's own suggestions, shown first. */
  suggested: readonly Row[];
  currency: string;
  busy: boolean;
  onSave: (lines: JobAddOnLine[]) => void;
  onCancel: () => void;
}) {
  const library = ((useTenantDocuments("addOns").records ?? []) as Row[]).filter((row) => !row.archivedAt);
  const [lines, setLines] = useState<JobAddOnLine[]>(() =>
    (Array.isArray(snapshot?.addOns) ? (snapshot.addOns as Row[]) : []).map((line) => ({
      // A one-off kept on an earlier snapshot is carried as a one-off again.
      addOnId: text(line.addOnId).startsWith("custom_") ? null : text(line.addOnId) || null,
      name: text(line.name, "Extra"),
      unitPriceCents: Number(line.unitPriceCents ?? 0),
      taxable: line.taxable !== false,
      quantity: Math.max(1, Number(line.quantity ?? 1)),
    })),
  );
  const [custom, setCustom] = useState({ name: "", price: "", quantity: "1", taxable: true, saveToLibrary: false });

  const options: Array<Row & { suggested: boolean }> = [
    ...suggested.map((row) => ({ ...row, suggested: true }) as Row & { suggested: boolean }),
    ...library
      .filter((row) => !suggested.some((item) => item.id === row.id))
      .map((row) => ({ ...row, suggested: false }) as Row & { suggested: boolean }),
  ].filter((row) => !lines.some((line) => line.addOnId === row.id));
  const total = lines.reduce((sum, line) => sum + line.unitPriceCents * line.quantity, 0);

  const addCustom = () => {
    const cents = Math.round(Number(custom.price) * 100);
    if (custom.name.trim().length < 2 || !Number.isFinite(cents) || cents < 0) return;
    setLines([
      ...lines,
      {
        addOnId: null,
        name: custom.name.trim(),
        unitPriceCents: cents,
        taxable: custom.taxable,
        quantity: Math.max(1, Math.round(Number(custom.quantity) || 1)),
        saveToLibrary: custom.saveToLibrary,
      },
    ]);
    setCustom({ name: "", price: "", quantity: "1", taxable: true, saveToLibrary: false });
  };

  return (
    <div className="job-add-ons">
      <strong>Extras on {text(snapshot?.packageName, "this package")}</strong>
      {lines.length ? (
        <ul>
          {lines.map((line, index) => (
            <li key={`${line.addOnId ?? "custom"}-${index}`}>
              <span>
                {line.name}
                <small>
                  {money(line.unitPriceCents, currency)}
                  {line.taxable ? "" : " · no tax"}
                  {line.addOnId ? "" : line.saveToLibrary ? " · saved to your library" : " · this job only"}
                </small>
              </span>
              <input
                aria-label={`How many: ${line.name}`}
                className="job-add-ons-quantity"
                max={100}
                min={1}
                onChange={(event) =>
                  setLines(
                    lines.map((item, at) =>
                      at === index ? { ...item, quantity: Math.min(100, Math.max(1, Math.round(Number(event.target.value) || 1))) } : item,
                    ),
                  )
                }
                type="number"
                value={line.quantity}
              />
              <button
                aria-label={`Remove ${line.name}`}
                className="button button-quiet button-sm"
                onClick={() => setLines(lines.filter((_, at) => at !== index))}
                type="button"
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <small>No extras yet.</small>
      )}
      {options.length ? (
        <label>
          Add from your library
          <select
            onChange={(event) => {
              const option = options.find((row) => row.id === event.target.value);
              if (!option) return;
              setLines([
                ...lines,
                {
                  addOnId: option.id,
                  name: text(option.name, "Extra"),
                  unitPriceCents: Number(option.unitPriceCents ?? 0),
                  taxable: option.taxable !== false,
                  quantity: 1,
                },
              ]);
              event.target.value = "";
            }}
            value=""
          >
            <option value="">Choose an extra…</option>
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {text(option.name, "Extra")} · {money(Number(option.unitPriceCents ?? 0), currency)}
                {option.suggested ? " · suggested" : ""}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <fieldset className="job-add-ons-custom">
        <legend>Or write one for this couple</legend>
        <input
          aria-label="Extra's name"
          maxLength={120}
          onChange={(event) => setCustom({ ...custom, name: event.target.value })}
          placeholder="e.g. Special family shots"
          value={custom.name}
        />
        <input
          aria-label={`Price (${currency})`}
          inputMode="decimal"
          min="0"
          onChange={(event) => setCustom({ ...custom, price: event.target.value })}
          placeholder="Price"
          step="0.01"
          type="number"
          value={custom.price}
        />
        <input
          aria-label="How many"
          max={100}
          min={1}
          onChange={(event) => setCustom({ ...custom, quantity: event.target.value })}
          type="number"
          value={custom.quantity}
        />
        <label className="form-checkbox">
          <input
            checked={custom.taxable}
            onChange={(event) => setCustom({ ...custom, taxable: event.target.checked })}
            type="checkbox"
          />
          <span>Taxed</span>
        </label>
        <label className="form-checkbox">
          <input
            checked={custom.saveToLibrary}
            onChange={(event) => setCustom({ ...custom, saveToLibrary: event.target.checked })}
            type="checkbox"
          />
          <span>Keep it in my library</span>
        </label>
        <button className="button button-light button-sm" onClick={addCustom} type="button">
          <Plus size={14} /> Add
        </button>
      </fieldset>
      <footer>
        <small>Extras: {money(total, currency)} before tax</small>
        <button className="button button-dark" disabled={busy} onClick={() => onSave(lines)} type="button">
          {busy ? <LoaderCircle className="spin" size={14} /> : null}
          Save extras
        </button>
        <button className="button button-quiet" disabled={busy} onClick={onCancel} type="button">
          Cancel
        </button>
      </footer>
    </div>
  );
}
