"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { handoffHeadline, handoffWhen, type HandoffItem } from "@/features/today/handoff";

/**
 * The morning handoff: one line from Cue at the top of Today.
 *
 * "Since yesterday, Cue handled 7 things. 4 need you." Collapsed by default
 * and a single row on a phone; opening it lists what went out, newest first.
 * The "need you" figure is Today's own count of the queue below, passed in.
 */
export function CueHandoff({ items, needYou }: { items: HandoffItem[]; needYou: number }) {
  const [open, setOpen] = useState(false);
  if (!items.length) return null;
  const now = new Date();
  return (
    <section className={`today-handoff${open ? " is-open" : ""}`} aria-label="What Cue handled">
      <button
        aria-expanded={open}
        className="today-handoff-toggle"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <span className="today-handoff-line">{handoffHeadline(items.length, needYou)}</span>
        <span className="today-handoff-line-short">
          {handoffHeadline(items.length, needYou, { short: true })}
        </span>
        <ChevronDown aria-hidden="true" className="today-handoff-chevron" size={16} />
      </button>
      {open ? (
        <ol className="today-handoff-list">
          {items.map((item) => (
            <li key={item.id}>
              {item.href ? (
                <Link href={item.href}>{item.line}</Link>
              ) : (
                <span>{item.line}</span>
              )}
              <time dateTime={item.at}>{handoffWhen(item.at, now)}</time>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
