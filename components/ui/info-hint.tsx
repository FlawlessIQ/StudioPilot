"use client";

import { cloneElement, useCallback, useEffect, useId, useRef } from "react";
import { Info } from "lucide-react";
import { glossaryTerm } from "@/features/help/glossary";
import { useWorkspace } from "@/features/auth/workspace-context";
import { openHowTo } from "@/components/help/how-to-events";

/**
 * A small ⓘ that explains a word or a field in place, on hover or tap.
 *
 * The first version revealed itself with CSS `:hover`/`:focus-within`. On an
 * iPhone a tapped button takes no focus, so it never opened there; and it was
 * absolutely positioned inside its panel, so any `overflow: hidden` card or
 * sheet cut it off. This one is a manual popover in the top layer — nothing
 * can clip it — opened by a click or tap, by keyboard focus, or (with a
 * mouse only) by hovering.
 *
 * Two forms:
 *   <InfoHint term="booking-gate" />           a word from features/help/glossary.ts
 *   <InfoHint label="Retainer %">…</InfoHint>   a one-off note about a field
 * A glossary word always reads the same everywhere; a field note is written
 * where it is used. Keep either to a sentence or two.
 */
export function InfoHint(
  props: { term: string; label?: never; children?: never } | { label: string; children: React.ReactNode; term?: never },
) {
  // A glossary word in the studio's own trade: a DJ's ⓘ on "coverage" was
  // a photographer's (2026-10-09).
  const { tenantTrade } = useWorkspace();
  const glossary = props.term ? glossaryTerm(props.term, tenantTrade) : undefined;
  const name = glossary?.term ?? props.label ?? "";
  const body = glossary?.hint ?? props.children;
  const learnMore = glossary?.explainer;

  const { triggerRef, popRef, handlers, popHandlers, popId } = useHintPopover();

  if (!body) return null;
  return (
    <span className="info-hint">
      <button
        aria-controls={popId}
        aria-label={`What does “${name}” mean?`}
        className="info-hint-trigger"
        ref={triggerRef as React.RefObject<HTMLButtonElement | null>}
        type="button"
        {...handlers}
      >
        <Info aria-hidden="true" />
      </button>
      <span className="info-hint-pop" id={popId} popover="manual" ref={popRef} role="tooltip" {...popHandlers}>
        {body}
        {learnMore ? (
          <a
            className="info-hint-more"
            href={`/how-to/${learnMore}`}
            onClick={(event) => {
              if (openHowTo(learnMore)) event.preventDefault();
            }}
          >
            Learn more
          </a>
        ) : null}
      </span>
    </span>
  );
}

/**
 * What happens when a consequential button is pressed, shown while it is
 * hovered or focused and announced as its description. Desktop only by
 * nature — a phone cannot hover — so it is never the only place a thing is
 * explained.
 */
export function ActionHint({
  hint,
  children,
}: {
  hint: string;
  children: React.ReactElement<{ "aria-describedby"?: string }>;
}) {
  const { triggerRef, popRef, popId, hoverHandlers, popHandlers } = useHintPopover();
  return (
    <span className="action-hint" ref={triggerRef} {...hoverHandlers}>
      {cloneElement(children, { "aria-describedby": popId })}
      <span className="info-hint-pop is-action" id={popId} popover="manual" ref={popRef} role="tooltip" {...popHandlers}>
        {hint}
      </span>
    </span>
  );
}

const OPEN_DELAY = 140;
const CLOSE_DELAY = 120;
const GAP = 8;
const EDGE = 12;

function useHintPopover() {
  const popId = `hint-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const triggerRef = useRef<HTMLElement | null>(null);
  const popRef = useRef<HTMLElement | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const pinned = useRef(false);

  const place = useCallback(() => {
    const trigger = triggerRef.current;
    const pop = popRef.current;
    if (!trigger || !pop) return;
    const anchor = trigger.getBoundingClientRect();
    const box = pop.getBoundingClientRect();
    const width = window.innerWidth;
    let left = anchor.left + anchor.width / 2 - box.width / 2;
    left = Math.max(EDGE, Math.min(left, width - box.width - EDGE));
    // Above the trigger when there is room, else below it.
    const above = anchor.top - box.height - GAP;
    const top = above >= EDGE ? above : anchor.bottom + GAP;
    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(top)}px`;
  }, []);

  const isOpen = () => popRef.current?.matches(":popover-open") ?? false;
  const show = useCallback(() => {
    const pop = popRef.current;
    if (!pop || isOpen()) return;
    try {
      pop.showPopover();
    } catch {
      return; // detached, or the browser has no popover support
    }
    place();
  }, [place]);
  const hide = useCallback(() => {
    pinned.current = false;
    if (isOpen()) popRef.current?.hidePopover();
  }, []);
  const later = (fn: () => void, delay: number) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(fn, delay);
  };

  // While open: close on Escape, on a press anywhere else, and on scroll
  // (a fixed bubble would otherwise float away from its word).
  useEffect(() => {
    const pop = popRef.current;
    if (!pop) return;
    const onToggle = (event: Event) => {
      if ((event as ToggleEvent).newState !== "open") return;
      const onKey = (key: KeyboardEvent) => {
        if (key.key === "Escape") hide();
      };
      const onPress = (press: PointerEvent) => {
        const target = press.target as Node;
        if (!pop.contains(target) && !triggerRef.current?.contains(target)) hide();
      };
      const onScroll = () => hide();
      document.addEventListener("keydown", onKey);
      document.addEventListener("pointerdown", onPress, true);
      window.addEventListener("scroll", onScroll, { capture: true, passive: true });
      window.addEventListener("resize", onScroll);
      const cleanup = () => {
        document.removeEventListener("keydown", onKey);
        document.removeEventListener("pointerdown", onPress, true);
        window.removeEventListener("scroll", onScroll, true);
        window.removeEventListener("resize", onScroll);
        pop.removeEventListener("toggle", onClose);
      };
      const onClose = (closing: Event) => {
        if ((closing as ToggleEvent).newState === "closed") cleanup();
      };
      pop.addEventListener("toggle", onClose);
    };
    pop.addEventListener("toggle", onToggle);
    return () => {
      pop.removeEventListener("toggle", onToggle);
      window.clearTimeout(timer.current);
    };
  }, [hide]);

  const hoverHandlers = {
    onPointerEnter: (event: React.PointerEvent) => {
      if (event.pointerType === "mouse") later(show, OPEN_DELAY);
    },
    onPointerLeave: (event: React.PointerEvent) => {
      if (event.pointerType === "mouse" && !pinned.current) later(hide, CLOSE_DELAY);
    },
    onFocus: (event: React.FocusEvent<HTMLElement>) => {
      if (event.target.matches(":focus-visible")) show();
    },
    onBlur: (event: React.FocusEvent<HTMLElement>) => {
      if (!popRef.current?.contains(event.relatedTarget as Node)) hide();
    },
  };

  const handlers = {
    ...hoverHandlers,
    // A click or tap pins it open (or closes a pinned one). Hovering opened
    // it already for a mouse, so the click pins rather than toggling it shut.
    onClick: () => {
      window.clearTimeout(timer.current);
      if (isOpen() && pinned.current) {
        hide();
        return;
      }
      show();
      pinned.current = true;
    },
  };

  // Moving from the word into the bubble (to reach "Learn more") keeps it open.
  const popHandlers = {
    onPointerEnter: () => window.clearTimeout(timer.current),
    onPointerLeave: (event: React.PointerEvent) => {
      if (event.pointerType === "mouse" && !pinned.current) later(hide, CLOSE_DELAY);
    },
  };

  return { popId, triggerRef, popRef, handlers, hoverHandlers, popHandlers };
}
