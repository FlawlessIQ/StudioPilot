import { isJobKind, type JobKind } from "./job-kinds.js";

/**
 * The `eventTypeId` a job of this kind is filed under — the key workflow,
 * questionnaire and package templates are matched on.
 *
 * Every kind but wedding is its own key. A wedding keeps the key it came
 * with when a studio files weddings under its own default id; anything that
 * is not a kind (a lowercased label like "elopement") becomes "wedding", so
 * the wedding templates still match.
 */
export function templateKeyForKind(kind: JobKind, current: string): string {
  if (kind !== "wedding") return kind;
  const key = current.trim();
  if (!key || isJobKind(key)) return "wedding";
  return /wedding/i.test(key) ? key : "wedding";
}
