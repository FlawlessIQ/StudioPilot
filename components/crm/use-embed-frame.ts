"use client";

import { useEffect, type RefObject } from "react";
import { EMBED_MESSAGE_TYPE } from "@/features/intake/website-embed";

/**
 * The inquiry form, framed in a studio's own page (`?embed=1`), tells that
 * page how tall it is and when to bring it into view.
 *
 * A frame can't size itself: the page around it sets the height. So each time
 * the form's height changes — a new step, an error, the thank-you — it posts
 * the height, and the snippet the studio pasted (features/intake/website-
 * embed.ts) resizes the frame. Moving to another step also asks the page to
 * scroll the frame's top into view, since the form's own scroll-to-top only
 * scrolls inside the frame.
 *
 * Only a height and a step go out; nothing a couple typed.
 */
export function useEmbedFrame(
  enabled: boolean,
  target: RefObject<HTMLElement | null>,
  step: string,
) {
  useEffect(() => {
    if (!enabled || window.parent === window) return;
    const element = target.current;
    if (!element) return;
    let last = 0;
    const post = () => {
      const height = Math.ceil(element.getBoundingClientRect().height);
      if (!height || height === last) return;
      last = height;
      window.parent.postMessage({ type: EMBED_MESSAGE_TYPE, height }, "*");
    };
    post();
    const observer = new ResizeObserver(post);
    observer.observe(element);
    return () => observer.disconnect();
  }, [enabled, target]);

  useEffect(() => {
    if (!enabled || window.parent === window || step === "0") return;
    window.parent.postMessage({ type: EMBED_MESSAGE_TYPE, scrollIntoView: true }, "*");
  }, [enabled, step]);
}
