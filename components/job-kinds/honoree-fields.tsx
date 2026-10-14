"use client";

import type { InputHTMLAttributes, SelectHTMLAttributes } from "react";
import { MITZVAH_TYPES, MITZVAH_TYPE_LABELS, journeyProfile } from "@/features/job-kinds/job-kinds";

/**
 * Who a job celebrates, when that isn't the client: a mitzvah's child
 * (job-kinds.ts `honoree`). The parents stay the client; these two fields
 * let every email and screen say "Sam's bat mitzvah".
 *
 * Shown only for a kind that has an honoree. The inputs are named
 * `honoreeName` and `mitzvahType`, so a plain form reads them from FormData;
 * a react-hook-form passes its own props instead.
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
  return (
    <>
      <label>
        <span>
          Who it&apos;s for <small>first name</small>
        </span>
        <input autoComplete="off" maxLength={80} name="honoreeName" placeholder="e.g. Sam" {...nameProps} />
      </label>
      <label>
        Which mitzvah
        <select name="mitzvahType" {...typeProps}>
          <option value="">Not sure yet</option>
          {MITZVAH_TYPES.map((type) => (
            <option key={type} value={type}>
              {MITZVAH_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}
