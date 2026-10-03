"use client";

import { useRef, useState } from "react";
import { PhoneShot } from "@/components/marketing/screen-shot";
import type { ScreenName } from "@/features/marketing/screens";

/**
 * Two to five real phone screens side by side, slightly staggered, each with
 * a line under it: what the couple or the crew sees, as stills
 * (docs/marketing-visuals-plan-2026-10-03.md §3). On a phone they become a
 * row you swipe — one screen and the edge of the next — with dots that follow
 * along. The dots only show where you are; the swipe is the control.
 */
export function PhoneScreens({
  label,
  screens,
}: {
  /** Names the group for screen readers: "The couple's portal, on a phone". */
  label: string;
  screens: Array<{ screen: ScreenName; caption: string }>;
}) {
  const row = useRef<HTMLOListElement>(null);
  const [active, setActive] = useState(0);
  return (
    <div aria-label={label} className="mk-phones" role="group">
      <ol
        className="mk-phones-row"
        onScroll={() => {
          const element = row.current;
          if (!element) return;
          const items = [...element.children] as HTMLElement[];
          const left = element.scrollLeft + element.offsetLeft;
          let nearest = 0;
          items.forEach((item, index) => {
            if (Math.abs(item.offsetLeft - left) < Math.abs(items[nearest]!.offsetLeft - left)) nearest = index;
          });
          // The last screen can't scroll to the start; reaching the end is it.
          const atEnd = element.scrollLeft + element.clientWidth >= element.scrollWidth - 4;
          setActive(atEnd ? items.length - 1 : nearest);
        }}
        ref={row}
        style={{ ["--mk-phones" as string]: screens.length }}
      >
        {screens.map((item) => (
          <li key={item.screen}>
            <PhoneShot caption={item.caption} screen={item.screen} />
          </li>
        ))}
      </ol>
      <div aria-hidden="true" className="mk-phones-dots">
        {screens.map((item, index) => (
          <span data-active={index === active ? "true" : undefined} key={item.screen} />
        ))}
      </div>
    </div>
  );
}
