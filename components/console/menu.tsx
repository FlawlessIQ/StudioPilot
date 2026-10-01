"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, MoreHorizontal } from "lucide-react";

/**
 * An action menu: a button that opens a list of commands. Arrow keys move,
 * Esc and a click outside close. Items that need a role the viewer lacks are
 * left out by the caller, not shown disabled, unless `disabledReason` explains.
 */
export type MenuItem =
  | { kind?: "item"; label: string; hint?: string; onSelect: () => void; danger?: boolean; disabled?: boolean; disabledReason?: string }
  | { kind: "separator" };

export function ActionMenu({
  items,
  label = "More",
  iconOnly = false,
  align = "right",
}: {
  items: MenuItem[];
  label?: string;
  iconOnly?: boolean;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const menuId = useId();
  // No leading, trailing or doubled separators once callers leave items out.
  const visible: MenuItem[] = [];
  for (const item of items) {
    if (item.kind === "separator" && (!visible.length || visible.at(-1)?.kind === "separator")) continue;
    visible.push(item);
  }
  while (visible.at(-1)?.kind === "separator") visible.pop();

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    wrap.current?.querySelector<HTMLButtonElement>(".cx-menu-item:not(:disabled)")?.focus();
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!items.some((item) => item.kind !== "separator")) return null;

  return (
    <div className="cx-menu-wrap" onClick={(event) => event.stopPropagation()} ref={wrap}>
      <button
        aria-controls={open ? menuId : undefined}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={iconOnly ? label : undefined}
        className="cx-btn"
        data-icon={iconOnly ? "true" : undefined}
        data-size={iconOnly ? "sm" : undefined}
        data-variant={iconOnly ? "ghost" : undefined}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        {iconOnly ? <MoreHorizontal size={15} /> : (
          <>
            {label}
            <ChevronDown size={13} />
          </>
        )}
      </button>
      {open ? (
        <div
          className="cx-menu"
          data-align={align === "left" ? "left" : undefined}
          id={menuId}
          onKeyDown={(event) => {
            if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
            event.preventDefault();
            const buttons = [...(wrap.current?.querySelectorAll<HTMLButtonElement>(".cx-menu-item:not(:disabled)") ?? [])];
            const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
            const next = event.key === "ArrowDown" ? (at + 1) % buttons.length : (at - 1 + buttons.length) % buttons.length;
            buttons[next]?.focus();
          }}
          role="menu"
        >
          {visible.map((item, index) =>
            item.kind === "separator" ? (
              <hr className="cx-menu-sep" key={`sep-${index}`} />
            ) : (
              <button
                className="cx-menu-item"
                data-tone={item.danger ? "danger" : undefined}
                disabled={item.disabled}
                key={item.label}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
                role="menuitem"
                title={item.disabled ? item.disabledReason : undefined}
                type="button"
              >
                <span>{item.label}</span>
                {item.hint ? <span className="cx-menu-hint">{item.hint}</span> : null}
              </button>
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}
