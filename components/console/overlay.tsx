"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "./ui";

/**
 * Drawers and dialogs. Esc closes, focus moves in on open and back on close,
 * the page behind doesn't scroll. On a phone a drawer is a full-screen sheet
 * and a dialog rises from the bottom (app/console.css).
 */

function useOverlay(open: boolean, onClose: () => void) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const focusTarget = panel.current?.querySelector<HTMLElement>("[data-autofocus], input, textarea, select, button:not([data-close])");
    (focusTarget ?? panel.current)?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
      if (event.key === "Tab" && panel.current) {
        const focusable = [...panel.current.querySelectorAll<HTMLElement>("a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])")];
        if (!focusable.length) return;
        const first = focusable[0]!;
        const last = focusable[focusable.length - 1]!;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey, true);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [open, onClose]);
  return panel;
}

export function Drawer({
  open,
  title,
  onClose,
  children,
  footer,
  wide = false,
}: {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const panel = useOverlay(open, onClose);
  const titleId = useId();
  if (!open) return null;
  return (
    <>
      <div aria-hidden className="cx-overlay" onClick={onClose} />
      <div aria-labelledby={titleId} aria-modal="true" className="cx-drawer" data-size={wide ? "wide" : undefined} ref={panel} role="dialog" tabIndex={-1}>
        <header className="cx-drawer-head">
          <h2 className="cx-drawer-title" id={titleId}>
            {title}
          </h2>
          <Button aria-label="Close" data-close icon onClick={onClose} variant="ghost">
            <X size={16} />
          </Button>
        </header>
        <div className="cx-drawer-body">{children}</div>
        {footer ? <footer className="cx-drawer-foot">{footer}</footer> : null}
      </div>
    </>
  );
}

export function Dialog({
  open,
  title,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const panel = useOverlay(open, onClose);
  const titleId = useId();
  if (!open) return null;
  return (
    <>
      <div aria-hidden className="cx-overlay" onClick={onClose} />
      <div aria-labelledby={titleId} aria-modal="true" className="cx-dialog" ref={panel} role="dialog" tabIndex={-1}>
        <header className="cx-dialog-head">
          <h2 className="cx-dialog-title" id={titleId}>
            {title}
          </h2>
          <Button aria-label="Close" data-close icon onClick={onClose} variant="ghost">
            <X size={16} />
          </Button>
        </header>
        <div className="cx-dialog-body">{children}</div>
        {footer ? <footer className="cx-dialog-foot">{footer}</footer> : null}
      </div>
    </>
  );
}

/**
 * The confirmation for anything that changes money, access or data: says what
 * will happen, takes a written reason for the audit log, and for the gravest
 * actions asks for the studio's name typed out.
 */
type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  onClose: () => void;
  onConfirm: (values: { reason: string; confirmName: string }) => void | Promise<void>;
  danger?: boolean;
  requireReason?: boolean;
  /** Show the reason box without requiring it (a note that's welcome, not owed). */
  reasonOptional?: boolean;
  reasonLabel?: string;
  reasonPlaceholder?: string;
  /** The name to type before the button unlocks. */
  confirmName?: string | null;
  busy?: boolean;
  children?: ReactNode;
};

/** Mounts fresh each time it opens, so a reason typed for one action never carries to the next. */
export function ConfirmDialog(props: ConfirmDialogProps) {
  return props.open ? <ConfirmBody {...props} /> : null;
}

function ConfirmBody({
  open,
  title,
  description,
  confirmLabel,
  onClose,
  onConfirm,
  danger = false,
  requireReason = true,
  reasonOptional = false,
  reasonLabel = "Reason (kept in the audit log)",
  reasonPlaceholder = "What prompted this?",
  confirmName,
  busy = false,
  children,
}: ConfirmDialogProps) {
  const [reason, setReason] = useState("");
  const [typed, setTyped] = useState("");
  const reasonId = useId();
  const nameId = useId();
  const reasonOk = !requireReason || reason.trim().length >= 10;
  const clean = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();
  const nameOk = !confirmName || clean(typed) === clean(confirmName);
  return (
    <Dialog
      footer={
        <>
          <Button onClick={onClose} variant="ghost">
            Cancel
          </Button>
          <Button
            busy={busy}
            disabled={!reasonOk || !nameOk}
            onClick={() => void onConfirm({ reason: reason.trim(), confirmName: typed.trim() })}
            variant={danger ? "danger-solid" : "primary"}
          >
            {confirmLabel}
          </Button>
        </>
      }
      onClose={onClose}
      open={open}
      title={title}
    >
      <div>{description}</div>
      {children}
      {requireReason || reasonOptional ? (
        <div className="cx-field">
          <label className="cx-label" htmlFor={reasonId}>
            {reasonLabel}
          </label>
          <textarea
            className="cx-textarea"
            id={reasonId}
            onChange={(event) => setReason(event.target.value)}
            placeholder={reasonPlaceholder}
            value={reason}
          />
          {requireReason ? (
            <span className="cx-hint">{reason.trim().length < 10 ? `At least 10 characters (${reason.trim().length}/10).` : "Saved with the change."}</span>
          ) : null}
        </div>
      ) : null}
      {confirmName ? (
        <div className="cx-field">
          <label className="cx-label" htmlFor={nameId}>
            Type <b>{confirmName}</b>{" "}to confirm
          </label>
          <input autoComplete="off" className="cx-input" id={nameId} onChange={(event) => setTyped(event.target.value)} value={typed} />
        </div>
      ) : null}
    </Dialog>
  );
}
