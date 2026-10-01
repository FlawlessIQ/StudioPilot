/**
 * The "Write a one-off package" form, read into the `createOneOffPackage`
 * command (features/packages/one-off.ts has the why). Pure, so the proposal
 * Packages panel and the composer refuse the same things in the same words,
 * before anything is sent.
 */
import type { CoverageItem } from "@/features/packages/coverage";
import { oneOffInclusionLines } from "@/features/packages/one-off";

export type OneOffFormValues = {
  name: string;
  /** Dollars as typed: "2,500" or "$2500.00". */
  price: string;
  /** One item per line. */
  included: string;
  /** Blank means "leave it to the defaults". */
  photographers: string;
  videographers: string;
  hours: string;
  mode: "add" | "replace";
  saveToLibrary: boolean;
};

/** The command's input, less the job. */
export type OneOffPackageInput = {
  name: string;
  basePriceCents: number;
  included: string[];
  includedCoverage?: CoverageItem[];
  includedCoverageMinutes?: number;
  mode: "add" | "replace";
  saveToLibrary: boolean;
};

/**
 * Dollars as typed to integer cents. "$2,500" and "2500.5" are fine; a
 * negative, a word or nothing at all is null rather than NaN or zero.
 */
export function dollarsToCents(value: string): number | null {
  const cleaned = value.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{0,2})?$|^\.\d{1,2}$/.test(cleaned)) return null;
  const cents = Math.round(Number(cleaned) * 100);
  return Number.isSafeInteger(cents) && cents >= 0 ? cents : null;
}

function count(value: string): number | null | "bad" {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d+$/.test(trimmed)) return "bad";
  const number = Number(trimmed);
  return number <= 50 ? number : "bad";
}

export function parseOneOffForm(
  values: OneOffFormValues,
): { ok: true; input: OneOffPackageInput } | { ok: false; message: string } {
  const name = values.name.trim();
  if (name.length < 2) return { ok: false, message: "Give the package a name." };
  if (name.length > 120) return { ok: false, message: "Keep the name under 120 characters." };
  const basePriceCents = dollarsToCents(values.price);
  if (basePriceCents === null) return { ok: false, message: "Give it a price, in dollars — 2500 or 2,500.00." };
  const included = oneOffInclusionLines(values.included);
  if (!included.length) return { ok: false, message: "Say what's included — one item per line." };
  // The package's description is these lines, and a description says a
  // little more than a word or two.
  if (included.join("\n").length < 10) return { ok: false, message: "Say a little more about what's included." };
  const photographers = count(values.photographers);
  const videographers = count(values.videographers);
  if (photographers === "bad" || videographers === "bad") {
    return { ok: false, message: "Photographers and videographers are whole numbers, up to 50." };
  }
  let includedCoverage: CoverageItem[] | undefined;
  if (photographers !== null || videographers !== null) {
    includedCoverage = [
      ...(photographers ? [{ role: "photographer" as const, count: photographers }] : []),
      ...(videographers ? [{ role: "videographer" as const, count: videographers }] : []),
    ];
    if (!includedCoverage.length) {
      return { ok: false, message: "A package sends at least one photographer or videographer." };
    }
  }
  let includedCoverageMinutes: number | undefined;
  if (values.hours.trim()) {
    const hours = Number(values.hours.trim());
    if (!Number.isFinite(hours) || hours <= 0 || hours > 24) {
      return { ok: false, message: "Hours of coverage are between 0 and 24 — 8, or 7.5." };
    }
    includedCoverageMinutes = Math.max(1, Math.round(hours * 60));
  }
  return {
    ok: true,
    input: {
      name,
      basePriceCents,
      included,
      ...(includedCoverage ? { includedCoverage } : {}),
      ...(includedCoverageMinutes ? { includedCoverageMinutes } : {}),
      mode: values.mode,
      saveToLibrary: values.saveToLibrary,
    },
  };
}
