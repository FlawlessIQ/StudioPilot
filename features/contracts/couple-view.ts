/**
 * Which agreement, and which booking change, the couple's portal shows. Pure.
 */

/** Any contract record: status, updatedAt, createdAt and amendedByContractId are read. */
type ContractLike = Record<string, unknown>;

const RETIRED = new Set(["voided", "superseded", "failed"]);

/**
 * The couple's agreement: the one that stands.
 *
 * This was "newest updatedAt", and the two writes that retire an agreement
 * stamp the same time on the old one and the new: recording a signature
 * supersedes the contract out for signature and creates the signed record in
 * one batch, and a signed booking change files the amended agreement while
 * marking the original amended. On a tie the old one could win, and a couple
 * whose studio had just recorded their signature read "Read it through, then
 * tap Review & sign". So: an agreement still standing beats a retired one, and
 * the latest amendment beats what it amended; time only breaks what's left.
 */
export function coupleContract<T extends ContractLike>(contracts: readonly T[]): T | undefined {
  const rank = (contract: T) =>
    RETIRED.has(String(contract.status ?? "")) ? 2 : contract.amendedByContractId ? 1 : 0;
  return [...contracts].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")) ||
      String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")),
  )[0];
}

/** How long a withdrawn booking change stays on the couple's agreement page. */
export const WITHDRAWN_CHANGE_SHOWN_DAYS = 30;

/**
 * Whether the couple still sees "the change was withdrawn". Not on their home
 * page (compact) — it's news, not a task — and not forever.
 */
export function withdrawnChangeShown(
  change: { status: string; withdrawnAt?: string | null },
  now: number,
  compact: boolean,
): boolean {
  if (change.status !== "cancelled" || compact) return false;
  const at = Date.parse(String(change.withdrawnAt ?? ""));
  return Number.isFinite(at) && now - at <= WITHDRAWN_CHANGE_SHOWN_DAYS * 86_400_000;
}
