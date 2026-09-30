/**
 * What a package includes, as the bullet points a proposal shows.
 *
 * Studios write a package's description as one paragraph of sentences — GR
 * Productions' Gold Photo Package is eight of them in a row — and a proposal
 * printed it as a block, under only the first package (2026-09-30). A studio
 * that puts one item per line gets those lines; a paragraph is split at its
 * sentences. Mirror of features/packages/inclusions.ts (functions/ has no "@/features"); compared
 * below the header by tests/package-inclusions.test.ts.
 */

export type PackageDetail = { snapshotId: string; packageName: string; items: string[] };

const BULLET = /^\s*(?:[-*•·–—]|\d+[.)])\s+/;

export function packageInclusionItems(description: unknown): string[] {
  // ".." between clauses ("coverage each.. Drone included..") is a full stop.
  const text =
    typeof description === "string"
      ? description.replace(/\r\n?/g, "\n").replace(/[ \t]*\.{2,}[ \t]*/g, ". ").trim()
      : "";
  if (!text) return [];
  const lines = text
    .split("\n")
    .map((line) => line.replace(BULLET, "").trim())
    .filter(Boolean);
  const pieces =
    lines.length > 1
      ? lines
      : // One paragraph: a new item starts after a full stop, before a capital
        // or a digit. "9.5" and "1–1.5" have no space after the point.
        text.split(/(?<=[.!?])\s+(?=[A-Z0-9“"(])/).map((piece) => piece.trim());
  return pieces
    .map((piece) => piece.replace(/\.$/, "").trim())
    .filter(Boolean)
    .slice(0, 40)
    .map((piece) => piece.slice(0, 300));
}

/** Each package on a proposal with its bullets, in the proposal's order. */
export function packageDetails(
  snapshots: readonly { id: string; data: Record<string, unknown> }[],
): PackageDetail[] {
  return snapshots.map(({ id, data }) => ({
    snapshotId: id,
    packageName: typeof data.packageName === "string" && data.packageName ? data.packageName : "Package",
    items: packageInclusionItems(data.description),
  }));
}

/** The bullets for a line on the proposal, matched by package name. */
export function detailsForLine(details: unknown, lineDescription: unknown): string[] {
  if (!Array.isArray(details) || typeof lineDescription !== "string") return [];
  const match = details.find(
    (entry) => entry && typeof entry === "object" && (entry as PackageDetail).packageName === lineDescription,
  ) as PackageDetail | undefined;
  return Array.isArray(match?.items) ? match.items.map(String) : [];
}
