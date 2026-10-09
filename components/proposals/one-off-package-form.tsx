"use client";

import { useState } from "react";
import { LoaderCircle, Plus } from "lucide-react";
import { PAYMENT_SHAPE_LABELS, PAYMENT_SHAPES } from "@/features/job-kinds/job-kinds";
import {
  parseOneOffForm,
  type OneOffFormValues,
  type OneOffPackageInput,
} from "@/features/packages/one-off-form";
import { useWorkspace } from "@/features/auth/workspace-context";
import { COVERAGE_ROLES, coverageCount, coverageRoleLabel, resolveCoverage, type CoverageRole } from "@/features/packages/coverage";
import { tradeProfile, tradeVocab } from "@/features/trades/trades";

/** What a one-off might include, in each trade's own work: the textarea's example. */
const INCLUDED_EXAMPLE: Record<"photo" | "music" | "beauty", string> = {
  photo: "4 hours of coverage\nOnline gallery\n150 edited photos",
  music: "4 hours of music\nDance floor lighting\nMC",
  beauty: "Bridal look with lashes\nTwo more in the party\nTouch-up kit",
};

/**
 * The parser's refusals (one-off-form.ts) name a photographer's two counts.
 * A DJ, makeup artist or hair stylist has one count of their own role, so
 * those three sentences are said in it; anything else reads as written.
 */
function inTradeWords(message: string, role: CoverageRole): string {
  const many = coverageRoleLabel(role, 2);
  if (message === "Photographers and videographers are whole numbers, up to 50.")
    return `${many.charAt(0).toUpperCase()}${many.slice(1)} are a whole number, up to 50.`;
  if (message === "A package sends at least one photographer or videographer.")
    return `A package sends at least one ${coverageRoleLabel(role, 1)}.`;
  if (message === "Hours of coverage are between 0 and 24 — 8, or 7.5.") return "Hours are between 0 and 24 — 8, or 7.5.";
  return message;
}

/** "Photographers", "Hair stylists": a count's heading. */
function roleHeading(role: CoverageRole): string {
  const label = coverageRoleLabel(role, 2);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

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
  initial,
  record,
  forBookingChange = false,
}: {
  /**
   * The one-off being edited, as stored. `initial` reads a photographer's
   * counts from it; a vendor's own role (a hair stylist's) is read here.
   */
  record?: unknown;
  /**
   * Written inside "Change the booking" (components/booking/booking-amendment.tsx):
   * it is added by the change the couple signs, so there is nothing to ask
   * about where it goes, and it isn't offered to the Library.
   */
  forBookingChange?: boolean;
  /**
   * Editing a one-off already on the job (updateOneOffPackage): the form
   * opens filled in, and asks nothing about where it goes — it stays where
   * it is, and stays a one-off ("Save to my Library" is its own button).
   */
  initial?: OneOffFormValues;
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
  const editing = initial !== undefined;
  // The studio's trade (trades.ts): its words, and the roles its counts are.
  // A photographer's two counts are photographers and videographers; a DJ's,
  // makeup artist's or hair stylist's one count is their own role.
  const trade = useWorkspace().tenantTrade;
  const profile = tradeProfile(trade);
  const words = tradeVocab(trade);
  const photo = profile.family === "photo";
  const roles = profile.coverageRoles as readonly CoverageRole[];
  const firstRole = roles[0] ?? COVERAGE_ROLES[0]!;
  const offer = words.proposal.toLowerCase();
  const ownCount = record ? coverageCount(resolveCoverage(record), firstRole) : 0;
  const [values, setValues] = useState<OneOffFormValues>(
    (initial && !photo && !initial.photographers && ownCount > 0
      ? { ...initial, photographers: String(ownCount) }
      : initial) ?? {
      name: "",
      price: "",
      included: "",
      photographers: "",
      videographers: "",
      hours: "",
      mode: hasPackage ? initialMode : "replace",
      saveToLibrary: false,
    },
  );
  const [error, setError] = useState<string | null>(null);
  const [attemptKey] = useState(() => `${editing ? "one-off-edit" : "one-off"}-${crypto.randomUUID()}`);
  const set = <K extends keyof OneOffFormValues>(key: K, value: OneOffFormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }));
  const hours = defaultHours && defaultHours > 0 ? defaultHours : 8;

  const submit = () => {
    const parsed = parseOneOffForm(values);
    if (!parsed.ok) {
      setError(photo ? parsed.message : inTradeWords(parsed.message, firstRole));
      return;
    }
    setError(null);
    if (photo) {
      onSubmit(parsed.input, attemptKey);
      return;
    }
    // The parser writes a photographer's roles; a vendor's count is its own
    // role. Left blank on a new one-off it is one of them, said under the
    // field, rather than the server's photographer. Left blank on an edit it
    // is left as it is.
    const counted = (parsed.input.includedCoverage ?? [])
      .map((item) => ({ ...item, role: item.role === "videographer" ? roles[1] : firstRole }))
      .filter((item): item is typeof item & { role: CoverageRole } => item.role !== undefined);
    onSubmit(
      { ...parsed.input, includedCoverage: counted.length ? counted : editing ? undefined : [{ role: firstRole, count: 1 }] },
      attemptKey,
    );
  };

  return (
    <div
      className="one-off-package"
      role="group"
      aria-label={editing ? "Edit this one-off package" : "Write a one-off package"}
    >
      <div className="one-off-package-head">
        <strong>{editing ? "Edit this one-off package" : "Write a one-off package"}</strong>
        <small>
          {forBookingChange
            ? "Just for this couple, added by this change. They sign it with the rest of the change; the retainer they agreed stays as it is. Tax follows your usual packages."
            : editing
              ? `The ${offer} is priced again from these. Its extras and discount stay; a percentage deposit follows the new price.`
              : `Just for this job. It won't appear in your Library, on your client pages, or on anyone else's ${offer}. The deposit and tax follow your usual packages.`}
        </small>
      </div>
      <label className="one-off-package-field one-off-package-grow">
        <span>Package name</span>
        <input
          autoFocus
          maxLength={120}
          onChange={(event) => set("name", event.target.value)}
          placeholder="Half day — 4 hours"
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
          placeholder={INCLUDED_EXAMPLE[profile.family]}
          rows={4}
          value={values.included}
        />
        <small>{`One item per line — each one is a bullet on the ${offer}.`}</small>
      </label>
      <fieldset className="one-off-package-coverage">
        <legend>{`${words.coverage} (optional)`}</legend>
        <label className="one-off-package-field one-off-package-narrow">
          <span>{roleHeading(firstRole)}</span>
          <input
            inputMode="numeric"
            onChange={(event) => set("photographers", event.target.value)}
            placeholder="1"
            value={values.photographers}
          />
        </label>
        {roles[1] ? (
          <label className="one-off-package-field one-off-package-narrow">
            <span>{roleHeading(roles[1])}</span>
            <input
              inputMode="numeric"
              onChange={(event) => set("videographers", event.target.value)}
              placeholder="0"
              value={values.videographers}
            />
          </label>
        ) : null}
        <label className="one-off-package-field one-off-package-narrow">
          <span>Hours</span>
          <input
            inputMode="decimal"
            onChange={(event) => set("hours", event.target.value)}
            placeholder={String(hours)}
            value={values.hours}
          />
        </label>
        <small>{`Left blank: one ${coverageRoleLabel(firstRole, 1)} for ${hours} hours.`}</small>
      </fieldset>
      {hasPackage && !editing && !forBookingChange ? (
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
      {editing || forBookingChange ? null : (
        <label className="one-off-package-field one-off-package-wide">
          <span>How it&apos;s paid</span>
          <select
            onChange={(event) => set("paymentShape", event.target.value as OneOffFormValues["paymentShape"])}
            value={values.paymentShape ?? ""}
          >
            <option value="">As this kind of job usually is</option>
            {PAYMENT_SHAPES.map((shape) => (
              <option key={shape} value={shape}>
                {PAYMENT_SHAPE_LABELS[shape]}
              </option>
            ))}
          </select>
        </label>
      )}
      {editing || forBookingChange ? null : (
        <label className="form-checkbox one-off-package-wide">
          <input
            checked={values.saveToLibrary}
            onChange={(event) => set("saveToLibrary", event.target.checked)}
            type="checkbox"
          />
          <span>Also save to my Library — for other clients later. Clients only see it if you publish it.</span>
        </label>
      )}
      {error ? (
        <p className="form-error one-off-package-wide" role="alert">
          {error}
        </p>
      ) : null}
      <div className="one-off-package-actions">
        <button className="button button-dark" disabled={busy} onClick={submit} type="button">
          {busy ? <LoaderCircle className="spin" size={14} /> : <Plus aria-hidden="true" size={14} />}
          {editing
            ? "Save changes"
            : forBookingChange
              ? "Add it to the change"
              : !hasPackage
              ? "Lock this package"
              : values.mode === "add"
                ? "Add this package"
                : "Use this package"}
        </button>
        <button className="button button-quiet" disabled={busy} onClick={onCancel} type="button">
          Cancel
        </button>
      </div>
    </div>
  );
}
