/**
 * The layout audit: what a person would call broken, measured in the page.
 *
 * Today's "Get your inquiries in" card shipped with its heading wrapped one
 * word per line and its sentence hidden under the buttons beside it
 * (2026-10-09). Every check here is one the eye makes at a glance and the
 * phone-width overflow guard could not: it only asked whether the page was
 * wider than the screen.
 *
 * - squeezed: text a column has crushed to about one word per line — in a
 *   box under 160px, or on a desk under ten of its own letters' height. A
 *   big heading on a phone wrapping two words a line is design, not damage;
 *   a table cell wraps by nature (the table scrolls instead).
 * - overlap: text with another element's text or a control drawn on top of it.
 * - clipped: text cut off sideways by a box that hides its overflow — Insights
 *   showed "$9,87" for $9,876 (2026-10-09). An ellipsis is a choice, and a
 *   scroll area can be scrolled; neither counts.
 * - overflow: the page itself wider than the window.
 *
 * Plain DOM, no imports: Playwright passes it to page.evaluate, and the same
 * source runs in a browser console for a walk on production.
 */
export type LayoutFinding = { kind: "squeezed" | "overlap" | "clipped" | "overflow"; where: string; detail: string };

export function auditLayout(): LayoutFinding[] {
  const findings: LayoutFinding[] = [];
  const name = (element: Element) => {
    const classes = typeof element.className === "string" ? element.className.trim().split(/\s+/).filter(Boolean).slice(0, 2) : [];
    const text = (element.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
    return `${element.tagName.toLowerCase()}${classes.length ? `.${classes.join(".")}` : ""}${text ? ` "${text}"` : ""}`;
  };
  const shown = (element: Element) => {
    // A closed <details> keeps its contents laid out but undrawn
    // (content-visibility), and getBoundingClientRect still measures them.
    const visible = (element as Element & { checkVisibility?: (options: object) => boolean }).checkVisibility;
    if (visible && !visible.call(element, { opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })) return false;
    for (let node: Element | null = element; node; node = node.parentElement) {
      const parent = node.parentElement;
      if (parent instanceof HTMLDetailsElement && !parent.open && node.tagName !== "SUMMARY") return false;
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
      // Visually hidden text (sr-only) is read, not seen.
      if (style.position === "absolute" && (style.clip === "rect(0px, 0px, 0px, 0px)" || style.clipPath === "inset(50%)")) return false;
    }
    return true;
  };
  // Fixed and sticky layers (the top bar, a sheet) sit over content by design.
  const layered = (element: Element) => {
    for (let node: Element | null = element; node; node = node.parentElement) {
      const position = getComputedStyle(node).position;
      if (position === "fixed" || position === "sticky") return true;
    }
    return false;
  };
  // What of a box is actually drawn: cut to every box that hides its
  // overflow, the element's own included (an ellipsis title measures as its
  // whole untruncated run). Null when nothing is left — a collapsed panel, a
  // scrolled-away row.
  const drawn = (element: Element, rect: DOMRect): DOMRect | null => {
    let { left, top, right, bottom } = rect;
    for (let node: Element | null = element; node && node !== document.body; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.overflowX === "visible" && style.overflowY === "visible") continue;
      const box = node.getBoundingClientRect();
      left = Math.max(left, box.left);
      right = Math.min(right, box.right);
      top = Math.max(top, box.top);
      bottom = Math.min(bottom, box.bottom);
      if (right - left <= 1 || bottom - top <= 1) return null;
    }
    return new DOMRect(left, top, right - left, bottom - top);
  };
  // The nearest box that hides sideways overflow without scrolling or an ellipsis.
  const cutBy = (element: Element, rect: DOMRect) => {
    if (getComputedStyle(element).textOverflow === "ellipsis") return null;
    for (let node = element.parentElement; node && node !== document.body; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.textOverflow === "ellipsis") return null;
      if (style.overflowX === "auto" || style.overflowX === "scroll") return null;
      if (style.overflowX !== "hidden" && style.overflowX !== "clip") continue;
      const box = node.getBoundingClientRect();
      return rect.right > box.right + 1 || rect.left < box.left - 1 ? node : null;
    }
    return null;
  };
  type Piece = { element: Element; rects: DOMRect[] };
  const texts: Piece[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set<Element>();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const value = node.textContent ?? "";
    const element = node.parentElement;
    if (!element || !value.trim() || ["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "OPTION"].includes(element.tagName)) continue;
    if (!shown(element) || layered(element)) continue;
    // A 1px box is the visually-hidden pattern (a honeypot, sr-only text).
    const own = element.getBoundingClientRect();
    if (own.width <= 2 || own.height <= 2) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    const raw = [...range.getClientRects()].filter((rect) => rect.width > 1 && rect.height > 1);
    const rects = raw.map((rect) => drawn(element, rect)).filter((rect): rect is DOMRect => rect !== null);
    if (!rects.length) continue;
    texts.push({ element, rects });
    const cutter = raw.map((rect) => cutBy(element, rect)).find(Boolean);
    if (cutter && !seen.has(element)) {
      seen.add(element);
      findings.push({ kind: "clipped", where: name(element), detail: `cut off by ${name(cutter).split(" ")[0]}` });
    }
    // Squeezed: three or more lines that hold about a word each.
    const words = value.trim().split(/\s+/).length;
    const lines = new Set(rects.map((rect) => Math.round(rect.top))).size;
    const fontSize = Number.parseFloat(getComputedStyle(element).fontSize) || 16;
    const narrow = own.width < 160 || (window.innerWidth >= 1024 && own.width < fontSize * 10);
    const cell = Boolean(element.closest("td, th"));
    if (!seen.has(element) && !cell && narrow && words >= 3 && lines >= 3 && words / lines <= 1.5) {
      seen.add(element);
      findings.push({ kind: "squeezed", where: name(element), detail: `${words} words on ${lines} lines, ${Math.round(element.getBoundingClientRect().width)}px wide` });
    }
  }
  const controls: Piece[] = [...document.querySelectorAll("button, a, input, select, textarea, [role=button]")]
    .filter((element) => shown(element) && !layered(element))
    // An inline link that wraps is two boxes, one per line, not the rectangle around both.
    .map((element) => ({
      element,
      rects: (getComputedStyle(element).display === "inline" ? [...element.getClientRects()] : [element.getBoundingClientRect()])
        .map((rect) => drawn(element, rect))
        .filter((rect): rect is DOMRect => rect !== null && rect.width > 2 && rect.height > 2),
    }))
    .filter((piece) => piece.rects.length > 0);
  const related = (a: Element, b: Element) => a === b || a.contains(b) || b.contains(a);
  const hit = (a: DOMRect, b: DOMRect) => {
    const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    return x > 2 && y > 2;
  };
  const reported = new Set<string>();
  for (const text of texts) {
    for (const other of [...texts, ...controls]) {
      if (related(text.element, other.element)) continue;
      if (!text.rects.some((rect) => other.rects.some((box) => hit(rect, box)))) continue;
      const key = [name(text.element), name(other.element)].sort().join(" × ");
      if (reported.has(key)) continue;
      reported.add(key);
      findings.push({ kind: "overlap", where: name(text.element), detail: `under ${name(other.element)}` });
    }
  }
  const page = document.documentElement;
  if (page.scrollWidth > page.clientWidth + 1) {
    findings.push({ kind: "overflow", where: "page", detail: `${page.scrollWidth}px wide in a ${page.clientWidth}px window` });
  }
  return findings;
}
