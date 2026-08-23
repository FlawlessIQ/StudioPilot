"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/**
 * A panel over the page, for settings you want without leaving where you are.
 *
 * Availability is the case that prompted it: a photographer looking at
 * August wants to change their consultation hours and then keep looking at
 * August. Sending them to the settings page — which is what the button did,
 * to an anchor that did not exist, so they landed at the top and scrolled —
 * costs them their place and their train of thought for a two-field edit.
 *
 * Third dialog in the codebase, first one that is reusable. The search
 * palette and the import review each grew their own; this is deliberately
 * generic so the next one does not.
 */
export function SheetDialog({
  children,
  label,
  onClose,
  open,
}: {
  children: React.ReactNode;
  /** Names the dialog for screen readers and titles the header. */
  label: string;
  onClose: () => void;
  open: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const returnFocusTo = useRef<Element | null>(null);
  // Portalled, not rendered in place. Two reasons, and the first is not
  // cosmetic: a trigger can legitimately sit inside a paragraph — "set your
  // weekly hours" in a sentence — and a <section>/<form> nested in a <p> is
  // invalid HTML that React reports as a hydration error. The second is
  // that a dialog inside a scrolled or transformed ancestor gets clipped by
  // it. Both go away at the document root.

  useEffect(() => {
    if (!open) return;
    returnFocusTo.current = document.activeElement;
    // Focus moves into the dialog so the next Tab lands inside it rather
    // than continuing through the page behind.
    panel.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    // The page behind must not scroll under the panel.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      // Put focus back where it came from, so closing does not dump the
      // reader at the top of the document.
      (returnFocusTo.current as HTMLElement | null)?.focus?.();
    };
  }, [open, onClose]);

  // No mounted flag: `open` is driven by a click, so it is always false
  // during SSR and the document always exists by the time this renders.
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="sheet-backdrop">
      <button
        aria-label={`Close ${label}`}
        className="sheet-dismiss"
        onClick={onClose}
        type="button"
      />
      <div
        aria-label={label}
        aria-modal="true"
        className="sheet-dialog"
        ref={panel}
        role="dialog"
        tabIndex={-1}
      >
        <button
          aria-label="Close"
          className="sheet-close"
          onClick={onClose}
          type="button"
        >
          <X aria-hidden="true" size={17} />
        </button>
        {children}
      </div>
    </div>,
    document.body,
  );
}
