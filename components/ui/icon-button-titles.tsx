"use client";

import { useEffect } from "react";
import { iconButtonTitle } from "@/features/ui/icon-button-title";

const CONTROLS = "button[aria-label], a[aria-label], summary[aria-label], [role='button'][aria-label]";

function apply(element: Element) {
  if (!(element instanceof HTMLElement)) return;
  const next = iconButtonTitle({
    visibleText: element.innerText ?? "",
    ariaLabel: element.getAttribute("aria-label"),
    title: element.getAttribute("title"),
    titleIsOurs: element.dataset.autoTitle === "1",
  });
  if (next === null) return;
  element.setAttribute("title", next);
  element.dataset.autoTitle = "1";
}

/**
 * Gives every icon-only control a hover tooltip from its accessible name, now
 * and as the page changes. See features/ui/icon-button-title.ts for why.
 */
export function IconButtonTitles() {
  useEffect(() => {
    // The public inquiry form labels its own controls; a body-wide observer
    // there only costs a phone time on every keystroke (H5).
    if (/^\/inquiry(\/|$)/.test(window.location.pathname)) return;
    const sweep = (root: ParentNode) => {
      if (root instanceof Element && root.matches(CONTROLS)) apply(root);
      root.querySelectorAll(CONTROLS).forEach(apply);
    };
    sweep(document);
    let pending = false;
    const queued = new Set<ParentNode>();
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "attributes") queued.add(record.target as Element);
        record.addedNodes.forEach((node) => {
          if (node instanceof Element) queued.add(node);
        });
      }
      if (pending) return;
      pending = true;
      // Once per frame, not once per mutation: a list render adds hundreds.
      requestAnimationFrame(() => {
        pending = false;
        queued.forEach(sweep);
        queued.clear();
      });
    });
    observer.observe(document.body, {
      attributeFilter: ["aria-label"],
      attributes: true,
      childList: true,
      subtree: true,
    });
    return () => observer.disconnect();
  }, []);
  return null;
}
