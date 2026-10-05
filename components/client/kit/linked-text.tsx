"use client";

import { Fragment } from "react";

const URL_PATTERN = /(https?:\/\/[^\s<>"')\]]+[^\s<>"')\].,;:!?])/g;

/**
 * Text with its web addresses made tappable.
 *
 * A studio message reading "View schedule: https://…/client/schedule" showed
 * the address as plain text, so a couple on a phone had to copy it out of the
 * bubble (iPhone walk, 2026-10-05). Only http(s) addresses become links; the
 * rest stays text, escaped by React like any other.
 */
export function LinkedText({ value }: { value: string }) {
  const parts = value.split(URL_PATTERN);
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <a
            className="kit-bubble-link"
            href={part}
            key={index}
            rel="noopener noreferrer"
            target={sameSite(part) ? undefined : "_blank"}
          >
            {part}
          </a>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  );
}

function sameSite(href: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return new URL(href).origin === window.location.origin;
  } catch {
    return false;
  }
}
