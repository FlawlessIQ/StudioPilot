import { eventDetailCategory } from "../contracts/event-details";

/**
 * Which of a couple's answers lock four weeks before, and which stay theirs.
 *
 * GR Productions (2026-10-02): lock the final details four weeks before;
 * couples can still update little things. What locks is what moves the day —
 * where it happens and when: getting ready, ceremony, reception, photo
 * locations, times. Guest count, phone numbers, family groups, notes stay the
 * couple's to change. After the lock a change to a locked answer is a request
 * the studio accepts (no charge for schedule changes, per GR).
 *
 * Sorted by the same reading of the question as Schedule A
 * (contracts/event-details.ts), so what the agreement lists is what locks.
 *
 * Pure. Duplicated at functions/src/planning/details-lock.ts (relative
 * imports end in the .js suffix there); the test fails on drift.
 */

const LOCKING = new Set(["getting_ready", "ceremony", "reception", "photo_locations", "times"]);

/** Whether an answer to this question locks with the final details. */
export function locksWithDetails(field: { label?: unknown; id?: unknown; type?: unknown }): boolean {
  const type = String(field.type ?? "");
  if (["file", "information", "acknowledgement", "checkbox", "repeating_group"].includes(type)) return false;
  const category = eventDetailCategory(String(field.label ?? field.id ?? ""));
  return Boolean(category && LOCKING.has(category));
}

/** The ids of a form's questions that lock. */
export function lockingFieldIds(sections: unknown): Set<string> {
  const ids = new Set<string>();
  for (const section of Array.isArray(sections) ? sections : []) {
    const fields = (section as { fields?: unknown })?.fields;
    for (const field of Array.isArray(fields) ? fields : []) {
      const row = field as { id?: unknown; label?: unknown; type?: unknown; internalOnly?: unknown };
      if (typeof row.id === "string" && row.id && row.internalOnly !== true && locksWithDetails(row)) ids.add(row.id);
    }
  }
  return ids;
}
