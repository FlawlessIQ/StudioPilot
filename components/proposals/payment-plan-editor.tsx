"use client";

import { useMemo } from "react";
import {
  MAX_INSTALLMENTS,
  installmentLabel,
  paymentPlanSchedule,
  scheduleInstallments,
  type PlanError,
  type PlanInstallmentInput,
  type PlanLine,
} from "@/features/billing/payment-plan";
import { friendlyError } from "@/lib/ai/friendly-error";
import { formatCentsAsNeeded } from "@/lib/format/money";

/**
 * The payment plan on one offer (features/billing/payment-plan.ts): how many
 * installments sit between the deposit and the final balance, and — when the
 * studio wants — each one's date and amount.
 *
 * Until the studio edits a line the plan follows the offer: its installments
 * are spread evenly between booking and the final balance's date, in even
 * shares of what is left after the deposit, and move when either does. An
 * edited line keeps what the studio typed; "Spread evenly" goes back.
 * The server builds the schedule again from what is sent and refuses lines
 * that don't fit, in the same words shown here.
 */

/** The studio's own lines: a date each, and dollars ("" is an even share). */
export type PlanDraftLine = { dueDate: string; amount: string };

export type PlanDraft = {
  /** Installments asked for; 0 is no plan. */
  count: number;
  /** Lines the studio edited; null follows the offer. */
  lines: PlanDraftLine[] | null;
};

export const NO_PLAN: PlanDraft = { count: 0, lines: null };

/** A saved schedule as the editor holds it: its installments, as the studio last set them. */
export function planDraftFromSchedule(schedule: unknown): PlanDraft {
  const installments = scheduleInstallments(schedule);
  if (!installments.length) return NO_PLAN;
  return {
    count: installments.length,
    lines: installments.map((line) => ({
      dueDate: line.dueDate ?? "",
      amount: (line.amountCents / 100).toFixed(2),
    })),
  };
}

const centsOf = (amount: string): number | null => {
  const trimmed = amount.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? Math.round(value * 100) : Number.NaN;
};

export type PlanInputs = {
  totalCents: number;
  retainerCents: number;
  retainerDueDate: string;
  finalDueDate: string;
  today: string;
};

/** What the plan builds to, the same arithmetic the server runs. */
export function planPreview(draft: PlanDraft, inputs: PlanInputs) {
  const installments: number | PlanInstallmentInput[] =
    draft.count === 0
      ? 0
      : draft.lines
        ? draft.lines.map((line) => ({ dueDate: line.dueDate || null, amountCents: centsOf(line.amount) }))
        : draft.count;
  return paymentPlanSchedule({
    totalCents: inputs.totalCents,
    retainerCents: inputs.retainerCents,
    retainerDueDate: inputs.retainerDueDate || null,
    finalDueDate: inputs.finalDueDate || null,
    today: inputs.today,
    installments,
  });
}

/**
 * What goes to the server (proposals.ts `paymentPlan`): null for none, else
 * each installment's date and amount — blank amounts while the plan follows
 * the offer, so the server's even split is the one kept.
 */
export function planCommandInput(
  draft: PlanDraft,
  inputs: PlanInputs,
): { installments: Array<{ dueDate: string; amountCents: number | null }> } | null {
  if (draft.count === 0) return null;
  if (draft.lines) {
    return {
      installments: draft.lines.map((line) => ({
        dueDate: line.dueDate,
        amountCents: centsOf(line.amount),
      })),
    };
  }
  const built = planPreview(draft, inputs);
  if (!built.ok || built.installments === 0) return null;
  return {
    installments: built.lines
      .filter((line) => line.kind === "installment")
      .map((line) => ({ dueDate: line.dueDate ?? "", amountCents: null })),
  };
}

export function PaymentPlanEditor({
  value,
  onChange,
  inputs,
  depositWord,
  disabled = false,
}: {
  value: PlanDraft;
  onChange: (next: PlanDraft) => void;
  inputs: PlanInputs;
  /** The trade's word: "Retainer" or "Deposit". */
  depositWord: string;
  disabled?: boolean;
}) {
  const built = useMemo(() => planPreview(value, inputs), [value, inputs]);
  // The lines on screen: the studio's own, or the plan as it follows the offer.
  const followed: PlanLine[] = built.ok ? built.lines.filter((line) => line.kind === "installment") : [];
  const rows: PlanDraftLine[] =
    value.lines ??
    followed.map((line) => ({ dueDate: line.dueDate ?? "", amount: (line.amountCents / 100).toFixed(2) }));
  const deposit = built.ok ? built.lines[0] : null;
  const final = built.ok ? built.lines[built.lines.length - 1] : null;
  const shares = built.ok ? built.lines.filter((line) => line.kind === "installment") : [];
  const errorText = !built.ok ? friendlyError(new Error(built.error as PlanError), "These installments don't fit.") : null;

  function edit(index: number, patch: Partial<PlanDraftLine>) {
    const next = rows.map((line, at) => (at === index ? { ...line, ...patch } : line));
    // The lines on screen are the plan now: as many as fitted, if fewer were asked for.
    onChange({ count: next.length, lines: next });
  }

  return (
    <div className="payment-plan-editor">
      <label className="proposal-field">
        <span>Payment plan</span>
        <select
          disabled={disabled}
          onChange={(event) => onChange({ count: Number(event.target.value), lines: null })}
          value={value.count}
        >
          <option value={0}>{`No plan: ${depositWord.toLowerCase()} and final balance`}</option>
          {Array.from({ length: MAX_INSTALLMENTS }, (_, index) => index + 1).map((count) => (
            <option key={count} value={count}>
              {count === 1 ? "1 installment" : `${count} installments`}
            </option>
          ))}
        </select>
        <small>
          {`Installments between the ${depositWord.toLowerCase()} and the final balance. Each is billed two weeks before it's due.`}
        </small>
      </label>
      {value.count > 0 ? (
        <>
          <ol className="payment-plan-lines" aria-label="Payment plan">
            <li className="payment-plan-line is-fixed">
              <span className="payment-plan-name">{depositWord}</span>
              <span className="payment-plan-when">{inputs.retainerDueDate ? shortDate(inputs.retainerDueDate) : "On signing"}</span>
              <span className="payment-plan-amount">{deposit ? formatCentsAsNeeded(deposit.amountCents) : "—"}</span>
            </li>
            {rows.map((line, index) => (
              <li className="payment-plan-line" key={index}>
                <span className="payment-plan-name">{installmentLabel(index + 1)}</span>
                <label className="payment-plan-when">
                  <span className="sr-only">{`${installmentLabel(index + 1)} due`}</span>
                  <input
                    disabled={disabled}
                    onChange={(event) => edit(index, { dueDate: event.target.value })}
                    type="date"
                    value={line.dueDate}
                  />
                </label>
                <label className="payment-plan-amount">
                  <span className="sr-only">{`${installmentLabel(index + 1)} amount`}</span>
                  <input
                    disabled={disabled}
                    inputMode="decimal"
                    min="0"
                    onChange={(event) => edit(index, { amount: event.target.value })}
                    placeholder={shares[index] ? (shares[index]!.amountCents / 100).toFixed(2) : "Even share"}
                    step="0.01"
                    type="number"
                    value={line.amount}
                  />
                </label>
              </li>
            ))}
            <li className="payment-plan-line is-fixed">
              <span className="payment-plan-name">Final balance</span>
              <span className="payment-plan-when">{inputs.finalDueDate ? shortDate(inputs.finalDueDate) : "Date to set"}</span>
              <span className="payment-plan-amount">{final ? formatCentsAsNeeded(final.amountCents) : "—"}</span>
            </li>
          </ol>
          {errorText ? (
            <p className="proposal-command-error" role="alert">
              {errorText}
            </p>
          ) : built.ok && built.collapsed && !value.lines ? (
            <p className="payment-plan-note">
              {built.installments
                ? `Only ${built.installments} ${built.installments === 1 ? "installment fits" : "installments fit"} two weeks apart before the final balance.`
                : "There isn't time for installments before the final balance: it stays the deposit and the final balance."}
            </p>
          ) : (
            <p className="payment-plan-note">
              {value.lines
                ? "Your own dates and amounts. The final balance takes what's left."
                : "Spread evenly; the remainder goes on the final balance. Change any line to set it yourself."}
            </p>
          )}
          {value.lines ? (
            <button
              className="button button-light"
              disabled={disabled}
              onClick={() => onChange({ count: value.count, lines: null })}
              type="button"
            >
              Spread evenly
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function shortDate(day: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(day);
  if (!match) return day;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
