"use client";

import { useState } from "react";
import { LoaderCircle, Plus } from "lucide-react";
import {
  parseOneOffForm,
  type OneOffFormValues,
  type OneOffPackageInput,
} from "@/features/packages/one-off-form";

/**
 * "Write a one-off package": a package for this couple only (GR Productions,
 * 2026-10-01 — "No ability for creating custom package"). The proposal's
 * Packages panel and the composer's package picker both open it.
 *
 * Inline rather than in a sheet, with its own state, so typing never remounts
 * a field and loses focus. It decides nothing: the values are read by
 * features/packages/one-off-form.ts and the server sets the retainer, tax and
 * terms from the studio's own packages (createOneOffPackage).
 */
export function OneOffPackageForm({
  currency,
  hasPackage,
  initialMode,
  defaultHours,
  busy,
  onSubmit,
  onCancel,
}: {
  currency: string;
  /** The job already has a package: ask whether this joins it or replaces it. */
  hasPackage: boolean;
  initialMode: "add" | "replace";
  /** What blank hours become: the main package's, else 8. */
  defaultHours: number | null;
  busy: boolean;
  /**
   * The same key on every try from this form, so a retry after the package
   * landed (and only the re-price failed) returns the first result instead
   * of writing a second package.
   */
  onSubmit: (input: OneOffPackageInput, idempotencyKey: string) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<OneOffFormValues>({
    name: "",
    price: "",
    included: "",
    photographers: "",
    videographers: "",
    hours: "",
    mode: hasPackage ? initialMode : "replace",
    saveToLibrary: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [attemptKey] = useState(() => `one-off-${crypto.randomUUID()}`);
  const set = <K extends keyof OneOffFormValues>(key: K, value: OneOffFormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }));
  const hours = defaultHours && defaultHours > 0 ? defaultHours : 8;

  const submit = () => {
    const parsed = parseOneOffForm(values);
    if (!parsed.ok) {
      setError(parsed.message);
      return;
    }
    setError(null);
    onSubmit(parsed.input, attemptKey);
  };

  return (
    <div className="one-off-package" role="group" aria-label="Write a one-off package">
      <div className="one-off-package-head">
        <strong>Write a one-off package</strong>
        <small>
          Just for this job. It won&apos;t appear in your Library, on your client pages, or on anyone else&apos;s
          proposal. The deposit and tax follow your usual packages.
        </small>
      </div>
      <label className="one-off-package-field one-off-package-grow">
        <span>Package name</span>
        <input
          autoFocus
          maxLength={120}
          onChange={(event) => set("name", event.target.value)}
          placeholder="Elopement — 4 hours"
          value={values.name}
        />
      </label>
      <label className="one-off-package-field">
        <span>Price ({currency})</span>
        <input
          inputMode="decimal"
          onChange={(event) => set("price", event.target.value)}
          placeholder="2500"
          value={values.price}
        />
      </label>
      <label className="one-off-package-field one-off-package-wide">
        <span>What&apos;s included</span>
        <textarea
          onChange={(event) => set("included", event.target.value)}
          placeholder={"4 hours of coverage\nOnline gallery\n150 edited photos"}
          rows={4}
          value={values.included}
        />
        <small>One item per line — each one is a bullet on the proposal.</small>
      </label>
      <fieldset className="one-off-package-coverage">
        <legend>Coverage (optional)</legend>
        <label className="one-off-package-field one-off-package-narrow">
          <span>Photographers</span>
          <input
            inputMode="numeric"
            onChange={(event) => set("photographers", event.target.value)}
            placeholder="1"
            value={values.photographers}
          />
        </label>
        <label className="one-off-package-field one-off-package-narrow">
          <span>Videographers</span>
          <input
            inputMode="numeric"
            onChange={(event) => set("videographers", event.target.value)}
            placeholder="0"
            value={values.videographers}
          />
        </label>
        <label className="one-off-package-field one-off-package-narrow">
          <span>Hours</span>
          <input
            inputMode="decimal"
            onChange={(event) => set("hours", event.target.value)}
            placeholder={String(hours)}
            value={values.hours}
          />
        </label>
        <small>Left blank: one photographer for {hours} hours.</small>
      </fieldset>
      {hasPackage ? (
        <fieldset className="one-off-package-mode">
          <legend>On this job</legend>
          <label className="form-checkbox">
            <input checked={values.mode === "add"} name="one-off-mode" onChange={() => set("mode", "add")} type="radio" />
            <span>Add it alongside what&apos;s there</span>
          </label>
          <label className="form-checkbox">
            <input
              checked={values.mode === "replace"}
              name="one-off-mode"
              onChange={() => set("mode", "replace")}
              type="radio"
            />
            <span>Use it instead of what&apos;s there</span>
          </label>
        </fieldset>
      ) : null}
      <label className="form-checkbox one-off-package-wide">
        <input
          checked={values.saveToLibrary}
          onChange={(event) => set("saveToLibrary", event.target.checked)}
          type="checkbox"
        />
        <span>Also save to my Library — for other couples later. Clients only see it if you publish it.</span>
      </label>
      {error ? (
        <p className="form-error one-off-package-wide" role="alert">
          {error}
        </p>
      ) : null}
      <div className="one-off-package-actions">
        <button className="button button-dark" disabled={busy} onClick={submit} type="button">
          {busy ? <LoaderCircle className="spin" size={14} /> : <Plus aria-hidden="true" size={14} />}
          {!hasPackage ? "Lock this package" : values.mode === "add" ? "Add this package" : "Use this package"}
        </button>
        <button className="button button-quiet" disabled={busy} onClick={onCancel} type="button">
          Cancel
        </button>
      </div>
    </div>
  );
}
