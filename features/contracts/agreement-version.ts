/**
 * Whether a prepared contract was written from an agreement the studio has
 * since changed.
 *
 * A contract draft pins the agreement version it was prepared from, and the
 * send re-resolves against that pinned version — deliberately, so the text
 * signed is the text read. But a studio that edited its agreement after the
 * draft existed (one prepared automatically at acceptance, say) had no prompt
 * to update it, and the old wording went out. The server refuses that send
 * (functions/src/contracts/commands.ts, AGREEMENT_CHANGED_SINCE_PREPARED);
 * this is the same comparison, for the page to say so before the studio signs.
 *
 * No current version (no agreement set, or it was archived) is not a change:
 * the pinned version is still the studio's last word. Pure, no I/O.
 */
export function agreementChangedSincePrepared(
  pinnedVersionId: unknown,
  currentVersionId: unknown,
): boolean {
  if (typeof currentVersionId !== "string" || !currentVersionId) return false;
  if (typeof pinnedVersionId !== "string" || !pinnedVersionId) return false;
  return pinnedVersionId !== currentVersionId;
}
