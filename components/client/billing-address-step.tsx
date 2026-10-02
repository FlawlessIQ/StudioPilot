"use client";

import { useCallback, useEffect, useState } from "react";
import { MapPin } from "lucide-react";
import { Button, Note } from "@/components/kit/kit";
import type { BillingAddress } from "@/features/contacts/schema";
import {
  billingAddressProblemCopy,
  formatBillingAddress,
  parseSigningBillingAddress,
  type BillingAddressRequirement,
  type SigningKind,
} from "@/features/contacts/billing-address-signing";
import { getSigningBillingAddressStep } from "@/lib/client/portal-client";

/**
 * The billing address, as the last thing before the signature.
 *
 * Asked only when the studio needs it (features/contacts/billing-address-
 * signing.ts decides; the server asks the same question again when the
 * signature arrives). One on file is shown with a tick — "This is my billing
 * address" — and a way to change it; none on file is typed once. Phone first:
 * one column, the keyboard each field wants, and the browser's own address
 * autofill.
 */

type Fields = {
  line1: string;
  line2: string;
  city: string;
  region: string;
  postalCode: string;
  /** Two letters, or "" while "Somewhere else" waits for a code. */
  country: string;
};

const COUNTRIES: Array<{ code: string; name: string }> = [
  { code: "US", name: "United States" },
  { code: "CA", name: "Canada" },
  { code: "GB", name: "United Kingdom" },
  { code: "IE", name: "Ireland" },
  { code: "AU", name: "Australia" },
  { code: "MX", name: "Mexico" },
];
const OTHER = "OTHER";

const blank: Fields = { line1: "", line2: "", city: "", region: "", postalCode: "", country: "US" };

function fieldsFrom(address: BillingAddress | null): Fields {
  if (!address) return blank;
  return {
    line1: address.line1,
    line2: address.line2 ?? "",
    city: address.city,
    region: address.region ?? "",
    postalCode: address.postalCode ?? "",
    country: address.country || "US",
  };
}

export type BillingAddressAnswer = { ok: true; address: BillingAddress | null } | { ok: false; message: string };

export type BillingAddressController = ReturnType<typeof useBillingAddressStep>;

/**
 * The step's state, held by the signing sheet. `answer()` is what the Sign
 * button sends: the address, null for nothing, or words for what is missing.
 */
export function useBillingAddressStep(input: {
  tenantId: string | null | undefined;
  projectId: string | null | undefined;
  kind: SigningKind;
  /** Load when the sheet opens, not on every page view. */
  active: boolean;
  /** Asked for outside a signature (the portal's billing-address card): what it says when nothing is typed. */
  missingMessage?: string;
}) {
  const [step, setStep] = useState<BillingAddressRequirement | null>(null);
  const [onFile, setOnFile] = useState<BillingAddress | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [fields, setFields] = useState<Fields>(blank);
  const [problem, setProblem] = useState<string | null>(null);
  const { tenantId, projectId, kind, active } = input;

  useEffect(() => {
    if (!active || loaded || !tenantId || !projectId) return;
    let live = true;
    void getSigningBillingAddressStep(tenantId, projectId, kind)
      .then((result) => {
        if (!live) return;
        setStep(result.step);
        setOnFile(result.onFile);
        setFields(fieldsFrom(result.onFile));
      })
      .catch(() => {
        // Nothing to ask is the safe reading of a failed look-up: if the
        // studio does need it, the signature is refused in words that say so.
        if (live) setStep("hidden");
      })
      .finally(() => live && setLoaded(true));
    return () => {
      live = false;
    };
  }, [active, kind, loaded, projectId, tenantId]);

  const answer = useCallback((): BillingAddressAnswer => {
    setProblem(null);
    if (!step || step === "hidden") return { ok: true, address: null };
    const fail = (message: string): BillingAddressAnswer => {
      setProblem(message);
      return { ok: false, message };
    };
    if (onFile && !editing) {
      if (confirmed) return { ok: true, address: onFile };
      return step === "required"
        ? fail("Tick “This is my billing address”, or change it.")
        : { ok: true, address: null };
    }
    const typed = [fields.line1, fields.line2, fields.city, fields.region, fields.postalCode].some((value) =>
      value.trim(),
    );
    if (!typed) {
      return step === "required"
        ? fail(input.missingMessage ?? "Add your billing address to sign.")
        : { ok: true, address: null };
    }
    const parsed = parseSigningBillingAddress({ ...fields, line2: fields.line2 || null });
    if (!parsed.ok) return fail(billingAddressProblemCopy[parsed.problem]);
    return { ok: true, address: parsed.address };
  }, [confirmed, editing, fields, input.missingMessage, onFile, step]);

  return {
    step,
    onFile,
    /** False while the sheet is still asking what to show. */
    ready: loaded || !active,
    editing,
    setEditing,
    confirmed,
    setConfirmed,
    adding,
    setAdding,
    fields,
    setFields,
    problem,
    answer,
  };
}

export function BillingAddressStep({ billing }: { billing: BillingAddressController }) {
  const { step, onFile, editing, confirmed, fields, problem, adding } = billing;
  if (!step || step === "hidden") return null;
  const required = step === "required";
  const set = (key: keyof Fields) => (event: { target: { value: string } }) =>
    billing.setFields({ ...fields, [key]: event.target.value });
  const known = COUNTRIES.some((country) => country.code === fields.country);
  const us = fields.country === "US";

  const heading = (
    <div className="kit-stack-tight">
      <h3 className="kit-subsection">{required ? "Your billing address" : "Add your billing address (optional)"}</h3>
      <p className="kit-caption">
        {required
          ? "Your studio needs it for your invoices — sales tax is worked out from it."
          : "Your studio uses it on your invoices."}
      </p>
    </div>
  );

  // On file: show it, tick to confirm, or change it.
  if (onFile && !editing) {
    return (
      <section aria-label="Billing address" className="kit-stack-tight">
        {heading}
        <Note icon={MapPin}>{formatBillingAddress(onFile)}</Note>
        <label className="kit-check">
          <input
            checked={confirmed}
            onChange={(event) => billing.setConfirmed(event.target.checked)}
            type="checkbox"
          />
          <span>This is my billing address</span>
        </label>
        <button
          className="kit-link-button"
          onClick={() => {
            billing.setConfirmed(false);
            billing.setEditing(true);
          }}
          type="button"
        >
          Change it
        </button>
        {problem ? (
          <p className="kit-error" role="alert">
            {problem}
          </p>
        ) : null}
      </section>
    );
  }

  // Optional and none on file: one tap to open, so the sheet stays short.
  if (!required && !onFile && !adding) {
    return (
      <section aria-label="Billing address" className="kit-stack-tight">
        {heading}
        <Button onClick={() => billing.setAdding(true)} size="compact" variant="secondary">
          Add billing address
        </Button>
      </section>
    );
  }

  return (
    <fieldset aria-label="Billing address" className="kit-stack-tight kit-fieldset">
      {heading}
      <label className="kit-field">
        <span className="kit-field-label">Street address</span>
        <input
          autoComplete="address-line1"
          className="kit-input"
          maxLength={200}
          onChange={set("line1")}
          value={fields.line1}
        />
      </label>
      <label className="kit-field">
        <span className="kit-field-label">Apt, suite or unit (optional)</span>
        <input
          autoComplete="address-line2"
          className="kit-input"
          maxLength={200}
          onChange={set("line2")}
          value={fields.line2}
        />
      </label>
      <label className="kit-field">
        <span className="kit-field-label">City</span>
        <input
          autoComplete="address-level2"
          className="kit-input"
          maxLength={120}
          onChange={set("city")}
          value={fields.city}
        />
      </label>
      <label className="kit-field">
        <span className="kit-field-label">{us ? "State" : "State, province or region (optional)"}</span>
        <input
          autoCapitalize={us ? "characters" : undefined}
          autoComplete="address-level1"
          className="kit-input"
          maxLength={80}
          onChange={set("region")}
          placeholder={us ? "NJ" : undefined}
          value={fields.region}
        />
      </label>
      <label className="kit-field">
        <span className="kit-field-label">{us ? "ZIP code" : "Postcode (optional)"}</span>
        <input
          autoComplete="postal-code"
          className="kit-input"
          inputMode={us ? "numeric" : undefined}
          maxLength={20}
          onChange={set("postalCode")}
          value={fields.postalCode}
        />
      </label>
      <label className="kit-field">
        <span className="kit-field-label">Country</span>
        <select
          autoComplete="country"
          className="kit-input"
          onChange={(event) =>
            billing.setFields({ ...fields, country: event.target.value === OTHER ? "" : event.target.value })
          }
          value={known ? fields.country : OTHER}
        >
          {COUNTRIES.map((country) => (
            <option key={country.code} value={country.code}>
              {country.name}
            </option>
          ))}
          <option value={OTHER}>Somewhere else</option>
        </select>
      </label>
      {!known ? (
        <label className="kit-field">
          <span className="kit-field-label">Country code — 2 letters, like FR</span>
          <input
            autoCapitalize="characters"
            className="kit-input"
            maxLength={2}
            onChange={(event) => billing.setFields({ ...fields, country: event.target.value.toUpperCase() })}
            value={fields.country}
          />
        </label>
      ) : null}
      {onFile ? (
        <button
          className="kit-link-button"
          onClick={() => {
            billing.setFields(fieldsFrom(onFile));
            billing.setEditing(false);
          }}
          type="button"
        >
          Keep the address on file
        </button>
      ) : null}
      {problem ? (
        <p className="kit-error" role="alert">
          {problem}
        </p>
      ) : null}
    </fieldset>
  );
}
