"use client";

import type { InputHTMLAttributes, SelectHTMLAttributes } from "react";
import { journeyProfile, kindVariants, variantFieldFor, variantQuestion } from "@/features/job-kinds/job-kinds";

/**
 * Who a job celebrates, when that isn't the client: a mitzvah's child
 * (job-kinds.ts `honoree`). The parents stay the client; these fields let
 * every email and screen say "Sam's bat mitzvah".
 *
 * Shown only for a kind that has an honoree; the variant only for a kind
 * that has variants (job-kinds.ts `KIND_VARIANTS`). The inputs are named
 * `honoreeName` and the kind's own variant field (`mitzvahType`, or
 * `occasionVariant`), so a plain form reads them from FormData; a
 * react-hook-form passes its own props instead.
 */
export function HonoreeFields({
  kind,
  nameProps,
  typeProps,
}: {
  kind: unknown;
  nameProps?: InputHTMLAttributes<HTMLInputElement>;
  typeProps?: SelectHTMLAttributes<HTMLSelectElement>;
}) {
  if (!journeyProfile(kind).honoree) return null;
  const variants = kindVariants(kind);
  const field = variantFieldFor(kind);
  return (
    <>
      <label>
        <span>
          Who it&apos;s for <small>first name</small>
        </span>
        <input autoComplete="off" maxLength={80} name="honoreeName" placeholder="e.g. Sam" {...nameProps} />
      </label>
      {field && variants.length ? (
        <label>
          {variantQuestion(kind)}
          <select name={field} {...typeProps}>
            <option value="">Not sure yet</option>
            {variants.map((variant) => (
              <option key={variant.id} value={variant.id}>
                {variant.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </>
  );
}
