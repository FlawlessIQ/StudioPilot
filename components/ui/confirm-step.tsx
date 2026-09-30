"use client";

import type { ReactNode } from "react";
import { LoaderCircle } from "lucide-react";

/**
 * One confirm step in front of an act that reaches the couple or can't be
 * taken back (wave 3 safety sweep, 2026-09-30).
 *
 * Several buttons did something final on a single tap — emailed the couple a
 * gallery or a bill, revoked a link, removed a saved card, threw away drafts —
 * and said nothing first. Each now shows a short sentence saying what happens
 * and whether it can be undone, with the act and a way back side by side.
 * Inline rather than a modal, like the proposal "Discard / Withdraw" step and
 * "Not an inquiry": the sentence sits where the button was, so it is read in
 * the context the button was pressed in.
 *
 * The message is phrasing content (it renders inside a <p>). Button classes
 * are the caller's, because the surfaces use different button systems — the
 * Today cards, the AI queue's footer, the plain `button` family.
 */
export function ConfirmStep({
  children,
  confirmLabel,
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
  busy = false,
  danger = false,
  confirmType = "button",
  confirmClassName,
  cancelClassName = "button button-light",
  className,
  label = "Confirm",
}: {
  /** What happens, and whether it can be undone. */
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** Not needed when `confirmType` is "submit": the form's own submit runs. */
  onConfirm?: () => void;
  onCancel: () => void;
  busy?: boolean;
  danger?: boolean;
  /** "submit" when the step sits inside the form it confirms. */
  confirmType?: "button" | "submit";
  confirmClassName?: string;
  cancelClassName?: string;
  className?: string;
  /** The group's accessible name. */
  label?: string;
}) {
  return (
    <div className={className ? `confirm-step ${className}` : "confirm-step"} role="group" aria-label={label}>
      <p>{children}</p>
      <div className="confirm-step-actions">
        <button
          className={confirmClassName ?? (danger ? "button button-danger" : "button button-dark")}
          disabled={busy}
          onClick={confirmType === "button" ? onConfirm : undefined}
          type={confirmType}
        >
          {busy ? <LoaderCircle aria-hidden="true" className="spin" size={14} /> : null}
          {confirmLabel}
        </button>
        <button className={cancelClassName} disabled={busy} onClick={onCancel} type="button">
          {cancelLabel}
        </button>
      </div>
    </div>
  );
}
