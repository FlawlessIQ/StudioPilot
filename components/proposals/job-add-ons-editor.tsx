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


/** Starting points for a one-off extra; the studio names and prices it. */
const COMMON_EXTRAS = [
  "Engagement shoot",
  "Photo booth",
  "Boudoir session",
  "Extra hour of coverage",
  "Second shooter",
  "Rehearsal dinner",
  "Parent albums",
] as const;

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
  const [writing, setWriting] = useState(false);
  const [customError, setCustomError] = useState<string | null>(null);

  const options: Array<Row & { suggested: boolean }> = [
    ...suggested.map((row) => ({ ...row, suggested: true }) as Row & { suggested: boolean }),
    ...library
      .filter((row) => !suggested.some((item) => item.id === row.id))
      .map((row) => ({ ...row, suggested: false }) as Row & { suggested: boolean }),
  ].filter((row) => !lines.some((line) => line.addOnId === row.id));
  const total = lines.reduce((sum, line) => sum + line.unitPriceCents * line.quantity, 0);
  // Only an extra sold by the unit (hours, prints) — or a one-off written with
  // a count — has a quantity to change. Walked on prod: a "1" box sat beside
  // every extra, labelled nowhere.
  const definitionOf = (addOnId: string | null) =>
    addOnId ? [...suggested, ...library].find((row) => row.id === addOnId) : undefined;
  const quantityEditable = (line: JobAddOnLine) =>
    !line.addOnId || definitionOf(line.addOnId)?.allowQuantity === true || line.quantity > 1;

  const addCustom = () => {
    const cents = Math.round(Number(custom.price) * 100);
    if (custom.name.trim().length < 2) {
      setCustomError("Give the extra a name.");
      return;
    }
    if (!custom.price.trim() || !Number.isFinite(cents) || cents < 0) {
      setCustomError("Give it a price.");
      return;
    }
    setCustomError(null);
    setLines([
      ...lines,
      {
        addOnId: null,
        name: custom.name.trim(),
        unitPriceCents: cents,
        taxable: custom.taxable,
        quantity: Math.min(100, Math.max(1, Math.round(Number(custom.quantity) || 1))),
        saveToLibrary: custom.saveToLibrary,
      },
    ]);
    setCustom({ name: "", price: "", quantity: "1", taxable: true, saveToLibrary: false });
    setWriting(false);
  };

  return (
    <div className="job-add-ons">
      <div className="job-add-ons-head">
        <strong>Extras on {text(snapshot?.packageName, "this package")}</strong>
        {lines.length ? <small>{money(total, currency)} before tax</small> : null}
      </div>
      {lines.length ? (
        <ul className="job-add-ons-list">
          {lines.map((line, index) => (
            <li key={`${line.addOnId ?? "custom"}-${index}`}>
              <div className="job-add-ons-line">
                <span>{line.name}</span>
                <small>
                  {money(line.unitPriceCents, currency)}
                  {quantityEditable(line) ? " each" : ""}
                  {line.taxable ? "" : " · no tax"}
                  {line.addOnId ? "" : line.saveToLibrary ? " · saved to your library" : " · this job only"}
                </small>
              </div>
              {quantityEditable(line) ? (
                <label className="job-add-ons-qty">
                  <span>Qty</span>
                  <input
                    max={100}
                    min={1}
                    onChange={(event) =>
                      setLines(
                        lines.map((item, at) =>
                          at === index
                            ? { ...item, quantity: Math.min(100, Math.max(1, Math.round(Number(event.target.value) || 1))) }
                            : item,
                        ),
                      )
                    }
                    type="number"
                    value={line.quantity}
                  />
                </label>
              ) : null}
              <strong className="job-add-ons-line-total">{money(line.unitPriceCents * line.quantity, currency)}</strong>
              <button
                aria-label={`Remove ${line.name}`}
                className="button button-quiet button-sm job-add-ons-remove"
                onClick={() => setLines(lines.filter((_, at) => at !== index))}
                type="button"
              >
                <X aria-hidden="true" size={15} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="job-add-ons-empty">No extras on this package yet.</p>
      )}
      <div className="job-add-ons-add">
        {options.length ? (
          <label className="job-add-ons-field job-add-ons-grow">
            <span>Add from your library</span>
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
        {!writing ? (
          <button className="button button-light button-sm" onClick={() => setWriting(true)} type="button">
            <Plus aria-hidden="true" size={14} /> Write one for this couple
          </button>
        ) : null}
      </div>
      {writing ? (
        <div className="job-add-ons-custom">
          {/* The extras studios add most, one tap to start from. */}
          <div className="job-add-ons-ideas" role="group" aria-label="Common extras">
            {COMMON_EXTRAS.map((idea) => (
              <button
                className="button button-light button-sm"
                key={idea}
                onClick={() => setCustom({ ...custom, name: idea })}
                type="button"
              >
                {idea}
              </button>
            ))}
          </div>
          <label className="job-add-ons-field job-add-ons-grow">
            <span>What it is</span>
            <input
              autoFocus
              maxLength={120}
              onChange={(event) => setCustom({ ...custom, name: event.target.value })}
              placeholder="Engagement shoot"
              value={custom.name}
            />
          </label>
          <label className="job-add-ons-field">
            <span>Price ({currency})</span>
            <input
              inputMode="decimal"
              min="0"
              onChange={(event) => setCustom({ ...custom, price: event.target.value })}
              step="0.01"
              type="number"
              value={custom.price}
            />
          </label>
          <label className="job-add-ons-field job-add-ons-narrow">
            <span>How many</span>
            <input
              max={100}
              min={1}
              onChange={(event) => setCustom({ ...custom, quantity: event.target.value })}
              type="number"
              value={custom.quantity}
            />
          </label>
          <div className="job-add-ons-options">
            <label className="form-checkbox">
              <input
                checked={custom.taxable}
                onChange={(event) => setCustom({ ...custom, taxable: event.target.checked })}
                type="checkbox"
              />
              <span>Charge tax on it</span>
            </label>
            <label className="form-checkbox">
              <input
                checked={custom.saveToLibrary}
                onChange={(event) => setCustom({ ...custom, saveToLibrary: event.target.checked })}
                type="checkbox"
              />
              <span>Keep it in my library for next time</span>
            </label>
          </div>
          {customError ? (
            <p className="form-error" role="alert">
              {customError}
            </p>
          ) : null}
          <div className="job-add-ons-actions">
            <button className="button button-light button-sm" onClick={addCustom} type="button">
              <Plus aria-hidden="true" size={14} /> Add to this package
            </button>
            <button
              className="button button-quiet button-sm"
              onClick={() => {
                setWriting(false);
                setCustomError(null);
              }}
              type="button"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      <div className="job-add-ons-actions job-add-ons-footer">
        <button className="button button-dark" disabled={busy} onClick={() => onSave(lines)} type="button">
          {busy ? <LoaderCircle className="spin" size={14} /> : null}
          Save extras
        </button>
        <button className="button button-quiet" disabled={busy} onClick={onCancel} type="button">
          Cancel
        </button>
      </div>
    </div>
  );
}
