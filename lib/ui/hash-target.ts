"use client";

import { useEffect } from "react";

/**
 * In-page jumps on screens whose sections render after their data arrives.
 *
 * Gabe, 2026-10-05: Today's "Review reply" opens the job at #prepared, but the
 * prepared tray renders only once the job's records load, so the browser's own
 * jump found nothing and the page sat at the top. Pressing the job's "Review
 * reply" — the same address — then did nothing either, and it took a second
 * press to get there.
 */

/** Scroll to `id`'s element, if it is on the page. Returns whether it was. */
export function scrollToId(id: string): boolean {
  const target = id ? document.getElementById(id) : null;
  if (!target) return false;
  target.scrollIntoView({ behavior: "smooth", block: "start" });
  return true;
}

/**
 * For a link's onClick: when `href` is this page plus a hash, jump there now
 * and keep the address in step. Returns true when it handled the click (the
 * caller then prevents the navigation).
 */
export function jumpIfSamePage(href: string): boolean {
  if (typeof window === "undefined") return false;
  const url = new URL(href, window.location.href);
  if (url.origin !== window.location.origin || url.pathname !== window.location.pathname || !url.hash) {
    return false;
  }
  if (!scrollToId(decodeURIComponent(url.hash.slice(1)))) return false;
  if (window.location.hash !== url.hash) window.history.pushState(window.history.state, "", url.hash);
  return true;
}

/**
 * Honor the address's #hash once its target exists: on arrival and on every
 * hash change, wait (up to `timeoutMs`) for the element to render, then jump.
 */
export function useHashTarget(timeoutMs = 8000) {
  useEffect(() => {
    let observer: MutationObserver | null = null;
    let timer: number | null = null;
    const stop = () => {
      observer?.disconnect();
      observer = null;
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
    };
    let settle: number | null = null;
    // Sections above can still be filling in when the target first appears,
    // pushing it back down; one more jump after they settle.
    const land = (id: string) => {
      if (settle !== null) window.clearTimeout(settle);
      settle = window.setTimeout(() => scrollToId(id), 700);
    };
    const follow = () => {
      stop();
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (!id) return;
      if (scrollToId(id)) return land(id);
      observer = new MutationObserver(() => {
        if (!scrollToId(id)) return;
        stop();
        land(id);
      });
      observer.observe(document.body, { childList: true, subtree: true });
      timer = window.setTimeout(stop, timeoutMs);
    };
    follow();
    window.addEventListener("hashchange", follow);
    return () => {
      stop();
      if (settle !== null) window.clearTimeout(settle);
      window.removeEventListener("hashchange", follow);
    };
  }, [timeoutMs]);
}
