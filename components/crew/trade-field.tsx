"use client";

import {
  COVERAGE_ROLES,
  coverageRoleLabel,
  type CoverageRole,
} from "@/features/packages/coverage";

/**
 * What this person actually shoots.
 *
 * The cascade used to answer "is this a videographer?" by looking for the word
 * inside `specialties`, which describes the *kind of event* — weddings,
 * corporate, sports. A video-led roster reads "Weddings, Events, Headshots"
 * and none of that says who holds a rig, so a videographer role was ranked by
 * substring luck. `trades` is the honest answer, and this is the only place a
 * studio or a crew member can give it.
 *
 * Checkboxes, not a select: plenty of people do both, and the reference studio
 * shoots both himself.
 *
 * Rendered with the same `<label>`-per-field shape as the forms around it, so
 * it inherits their grid without a stylesheet of its own.
 */
export function TradeField({
  className,
  hint = "Used to rank who to ask when a job needs one or the other.",
  value,
}: {
  className?: string;
  hint?: string;
  value?: readonly string[] | null;
}) {
  const selected = new Set((value ?? []).map(String));
  return (
    <fieldset className={className ? `crew-trade-field ${className}` : "crew-trade-field"}>
      <legend>Shoots</legend>
      <span className="crew-trade-options">
        {COVERAGE_ROLES.map((role) => (
          <label key={role}>
            <input
              defaultChecked={selected.has(role)}
              name="trades"
              type="checkbox"
              value={role}
            />
            {capitalise(coverageRoleLabel(role, 1))}
          </label>
        ))}
      </span>
      <p className="crew-trade-hint">{hint}</p>
    </fieldset>
  );
}

function capitalise(value: string): string {
  return value.slice(0, 1).toLocaleUpperCase() + value.slice(1);
}

/**
 * The checked trades, in display order, with anything unrecognised dropped.
 *
 * `FormData.getAll` returns every checked box, so no caller has to know that
 * the field is a checkbox group rather than one input.
 */
export function tradesFromForm(values: FormData): CoverageRole[] {
  const checked = new Set(values.getAll("trades").map(String));
  return COVERAGE_ROLES.filter((role) => checked.has(role));
}
