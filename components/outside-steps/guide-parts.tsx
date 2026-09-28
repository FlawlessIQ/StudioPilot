"use client";

import { useState, type ReactNode } from "react";
import { Check, Copy, ExternalLink, Info } from "lucide-react";

/**
 * The pieces every "do this in another app" guide is built from: a click path
 * as chips, a tip, an open-link and a copy button, and text with the other
 * app's own labels in bold. Shared by inquiry capture
 * (components/intake/lead-capture-setup.tsx) and the outside-step guides
 * (components/outside-steps/outside-step-card.tsx), so every guide reads and
 * behaves the same.
 */

/** A click path in someone else's app, as chips: Settings › Mail › Rules. */
export function Path({ steps }: { steps: string[] }) {
  return (
    <ol className="capture-path">
      {steps.map((step) => (
        <li key={step}>
          <span>{step}</span>
        </li>
      ))}
    </ol>
  );
}

export function Tip({ children }: { children: ReactNode }) {
  return (
    <p className="capture-tip">
      <Info aria-hidden="true" size={14} />
      <span>{children}</span>
    </p>
  );
}

export function OpenLink({ href, label }: { href: string; label: string }) {
  return (
    <a className="button button-light button-sm" href={href} rel="noreferrer" target="_blank">
      {label} <ExternalLink size={12} />
    </a>
  );
}

export function Copyable({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="button button-light button-sm"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2000);
        });
      }}
      type="button"
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
      {copied ? "Copied" : label}
    </button>
  );
}

/** The thing to paste, big enough to read and one tap to copy. */
export function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*)/).map((part, index) =>
        part.startsWith("**") && part.endsWith("**") ? (
          <strong key={index}>{part.slice(2, -2)}</strong>
        ) : (
          part
        ),
      )}
    </>
  );
}
