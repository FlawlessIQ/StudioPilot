/**
 * A package written for one couple — the functions copy of
 * features/packages/one-off.ts, which explains the design and the defaults.
 * functions/ cannot import from features/, so everything below the marker is
 * kept identical and tests/one-off-package.test.ts compares the two.
 */
import { normaliseCoverage, type CoverageItem } from "./coverage.js";
import { DEFAULT_PROPOSAL_TERMS } from "../proposals/default-terms.js";
// ── mirrored below ──

export type OneOffRetainerRule =
  | { type: "fixed"; amountCents: number }
  | { type: "percentage"; basisPoints: number }
  | {
      type: "per_crew_member";
      amountPerCrewCents: number;
      billedRoles?: Array<"photographer" | "videographer">;
    };

/** No rule anywhere to copy: a quarter down, the common wedding deposit. */
export const ONE_OFF_FALLBACK_RETAINER: OneOffRetainerRule = { type: "percentage", basisPoints: 2500 };
/** Hours left blank and no main package to take them from: a wedding day. */
export const ONE_OFF_FALLBACK_COVERAGE_MINUTES = 480;
/** The most bullets a one-off carries, as the proposal's own cap. */
export const ONE_OFF_MAX_INCLUSIONS = 40;

type Row = Record<string, unknown>;

function isRow(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCents(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isBasisPoints(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 10000;
}

/** Whether a package was written for one job rather than kept in the library. */
export function isOneOffPackage(record: unknown): boolean {
  return isRow(record) && isRow(record.oneOff);
}

/** The job a one-off package was written for; null for a library package. */
export function oneOffProjectId(record: unknown): string | null {
  if (!isRow(record) || !isRow(record.oneOff)) return null;
  const projectId = record.oneOff.projectId;
  return typeof projectId === "string" && projectId ? projectId : null;
}

/**
 * Whether a package belongs in a list of the studio's packages to choose
 * from. A library package always does; a one-off only on the job it was
 * written for (so it can be swapped back after being swapped off), and
 * nowhere else — not another couple's picker, not the Library, not the
 * portal, not Cue. Every catalogue reader applies this.
 */
export function isCataloguePackage(record: unknown, options: { projectId?: string | null } = {}): boolean {
  if (!isRow(record)) return false;
  if (!isOneOffPackage(record)) return true;
  const projectId = options.projectId ?? null;
  return projectId !== null && oneOffProjectId(record) === projectId;
}

function retainerRuleOf(value: unknown): OneOffRetainerRule | null {
  if (!isRow(value)) return null;
  if (value.type === "fixed" && isCents(value.amountCents)) {
    return { type: "fixed", amountCents: value.amountCents };
  }
  if (value.type === "percentage" && isBasisPoints(value.basisPoints)) {
    return { type: "percentage", basisPoints: value.basisPoints };
  }
  if (value.type === "per_crew_member" && isCents(value.amountPerCrewCents)) {
    const roles = Array.isArray(value.billedRoles)
      ? value.billedRoles.filter(
          (role): role is "photographer" | "videographer" => role === "photographer" || role === "videographer",
        )
      : [];
    return {
      type: "per_crew_member",
      amountPerCrewCents: value.amountPerCrewCents,
      ...(roles.length ? { billedRoles: [...new Set(roles)] } : {}),
    };
  }
  return null;
}

/** The rule most of the studio's own catalogue packages use, if any. */
function commonCatalogueRule(catalogue: readonly unknown[]): OneOffRetainerRule | null {
  const counts = new Map<string, { rule: OneOffRetainerRule; count: number }>();
  for (const record of catalogue) {
    if (!isRow(record) || record.active !== true || !isCataloguePackage(record)) continue;
    const rule = retainerRuleOf(record.retainerRule);
    if (!rule) continue;
    const key = JSON.stringify(rule);
    const entry = counts.get(key);
    if (entry) entry.count += 1;
    else counts.set(key, { rule, count: 1 });
  }
  let best: { rule: OneOffRetainerRule; count: number } | null = null;
  // Ties go to the first seen, so the answer is stable for the same list.
  for (const entry of counts.values()) if (!best || entry.count > best.count) best = entry;
  return best?.rule ?? null;
}

/**
 * The retainer rule for a one-off, from what the studio already charges.
 * `mainPackage` is the library document behind the job's main package (if it
 * resolves); `mainSnapshot` is the main package as priced on this job.
 */
export function oneOffRetainerRule(input: {
  mode: "add" | "replace";
  mainPackage: unknown;
  mainSnapshot: unknown;
  catalogue: readonly unknown[];
}): OneOffRetainerRule {
  const hasMain = isRow(input.mainSnapshot);
  const mainRule = isRow(input.mainPackage) ? retainerRuleOf(input.mainPackage.retainerRule) : null;
  if (input.mode === "add" && hasMain) {
    // Beside a package already on the job: the same share, never the same
    // fixed or per-crew amount a second time.
    if (mainRule?.type === "percentage") return mainRule;
    const snapshot = input.mainSnapshot as Row;
    const total = Number(snapshot.totalCents);
    const retainer = Number(snapshot.retainerCents);
    if (Number.isFinite(total) && total > 0 && Number.isFinite(retainer) && retainer >= 0) {
      return {
        type: "percentage",
        basisPoints: Math.min(10000, Math.max(0, Math.round((retainer * 10000) / total))),
      };
    }
  }
  if (mainRule) return mainRule;
  return commonCatalogueRule(input.catalogue) ?? ONE_OFF_FALLBACK_RETAINER;
}

/** The tax rate for a one-off: the main package's, else the one the catalogue shares, else none. */
export function oneOffTaxRate(input: { mainPackage: unknown; catalogue: readonly unknown[] }): number {
  if (isRow(input.mainPackage) && isBasisPoints(input.mainPackage.taxRateBasisPoints)) {
    return input.mainPackage.taxRateBasisPoints;
  }
  const rates = new Set<number>();
  for (const record of input.catalogue) {
    if (!isRow(record) || record.active !== true || !isCataloguePackage(record)) continue;
    rates.add(isBasisPoints(record.taxRateBasisPoints) ? record.taxRateBasisPoints : 0);
  }
  return rates.size === 1 ? [...rates][0]! : 0;
}

/**
 * The terms a one-off carries. Taking the main package's place, it keeps that
 * package's written terms — the studio's own wording, already on this
 * proposal. Otherwise the default proposal wording.
 */
export function oneOffTerms(input: { mode: "add" | "replace"; mainTerms: unknown }): string {
  const written = typeof input.mainTerms === "string" ? input.mainTerms.trim() : "";
  return input.mode === "replace" && written.length >= 10 ? written.slice(0, 5000) : DEFAULT_PROPOSAL_TERMS;
}

/**
 * Who the one-off sends: what the studio said, else one of the studio's own
 * crew (trades.ts `coverageRoles[0]`) — a makeup artist's one-off defaulted
 * to a photographer (2026-10-09).
 */
export function oneOffCoverage(
  given: readonly CoverageItem[] | undefined,
  defaultRole: CoverageItem["role"] = "photographer",
): CoverageItem[] {
  const people = (given ?? []).filter((item) => Number.isInteger(item.count) && item.count > 0);
  return people.length ? normaliseCoverage(people) : [{ role: defaultRole, count: 1 }];
}

/** How long: what the studio said, else the main package's hours, else a wedding day. */
export function oneOffCoverageMinutes(given: number | undefined | null, mainMinutes: unknown): number {
  if (typeof given === "number" && Number.isInteger(given) && given > 0) return given;
  const main = Number(mainMinutes);
  return Number.isInteger(main) && main > 0 ? main : ONE_OFF_FALLBACK_COVERAGE_MINUTES;
}

const BULLET_PREFIX = /^\s*(?:[-*•·–—]|\d+[.)])\s+/;

/**
 * "What's included", one item per line, as the bullets the proposal shows.
 * A pasted list keeps its items; its bullet marks and blank lines go.
 */
export function oneOffInclusionLines(text: string | readonly string[]): string[] {
  const lines = typeof text === "string" ? text.replace(/\r\n?/g, "\n").split("\n") : [...text];
  return lines
    .map((line) => String(line).replace(BULLET_PREFIX, "").trim())
    .filter(Boolean)
    .slice(0, ONE_OFF_MAX_INCLUSIONS)
    .map((line) => line.slice(0, 300));
}

/**
 * The package's description: its lines, one per line, which is exactly the
 * shape `packageInclusionItems` turns back into the same bullets.
 */
export function oneOffDescription(lines: readonly string[]): string {
  return lines.join("\n").slice(0, 3000);
}
