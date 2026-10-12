import { SCHEDULE_LABELS } from "@/features/job-kinds/job-kinds";
import { tradeVocab } from "@/features/trades/trades";

/**
 * A payment line's label, as a reader sees it.
 *
 * A proposal's payment schedule stores the system label "Retainer" for every
 * trade (job-kinds.ts `SCHEDULE_LABELS`), and readers match on it
 * (agreed-retainer.ts), so the stored line is never rewritten. A DJ's, makeup
 * artist's or hair stylist's client pays a deposit (trades.ts `deposit`), so
 * the word is swapped where it is shown: Jess Styles Bridal's approved quote
 * read "Retainer $327.00 On signing" (Priya Shah, 2026-10-10). A
 * photographer's, and every other line, reads exactly as stored.
 *
 * Display only. An agreement does not use this: its schedule tables are part
 * of its document hash, so the word is decided once, when the agreement is
 * written, and kept on its record (contracts/document.ts `depositLabel`,
 * agreementScheduleLabel). One written from 2026-10-12 for a vendor reads
 * "Deposit", the same as here — unless the studio's own terms say what
 * becomes of "the retainer" on a refund, cancellation or the like, which keeps
 * it "Retainer" (newAgreementDepositLabel); one written before keeps the
 * "Retainer" it was signed with, and a change to it is restated in that word.
 */
export function scheduleLineLabel(label: string, trade?: unknown): string {
  const word = tradeVocab(trade).deposit;
  if (label !== SCHEDULE_LABELS.retainer || word === "retainer") return label;
  return `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
}
