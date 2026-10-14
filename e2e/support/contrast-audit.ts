/**
 * The contrast audit: text a studio has to squint at, measured in the page.
 *
 * The laptop UI audit (2026-10-14) found the studio's most common text colour
 * was a cool grey at 4.5:1 on the near-white page, its brass eyebrows at
 * 4.08:1, and timestamps at 10.5px — nothing unreadable, nothing crisp. The
 * tokens were darkened once already (2026-10-02) and drifted back through
 * hardcoded greys, so this checks what is drawn, not what the tokens say.
 *
 * - contrast: text under WCAG AA against what is actually behind it — 4.5:1,
 *   or 3:1 for large text (24px, or 18.66px bold). Over a gradient the text
 *   must pass against every stop (Waiting on you's green header carried
 *   dark grey text the first version of this check skipped). Text over an
 *   image is skipped. Disabled controls are exempt, as WCAG exempts them.
 * - small: text under 12px, or under 11px when it is set in capitals (an
 *   eyebrow, a sidebar group name, a status badge): capitals stand as tall
 *   at 11px as lowercase does at 12, and those labels are part of the look.
 *
 * Plain DOM, no imports: Playwright passes it to page.evaluate, and the same
 * source runs in a browser console for a walk on production.
 */
export type ContrastFinding = { kind: "contrast" | "small"; where: string; detail: string };

export function auditContrast(): ContrastFinding[] {
  type Rgba = [number, number, number, number];
  const findings: ContrastFinding[] = [];
  const seen = new Set<string>();
  const parse = (value: string): Rgba | null => {
    const match = value.match(/rgba?\(([^)]+)\)/);
    if (!match) return null;
    const parts = match[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1];
  };
  const over = (top: Rgba, bottom: Rgba): Rgba => {
    const alpha = top[3] + bottom[3] * (1 - top[3]);
    if (alpha === 0) return [0, 0, 0, 0];
    const mix = (i: number) => (top[i] * top[3] + bottom[i] * bottom[3] * (1 - top[3])) / alpha;
    return [mix(0), mix(1), mix(2), alpha];
  };
  const luminance = ([r, g, b]: Rgba) => {
    const channel = (value: number) => {
      const c = value / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };
  const ratio = (a: Rgba, b: Rgba) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const hex = ([r, g, b]: Rgba) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
  const name = (element: Element) => {
    const classes = typeof element.className === "string" ? element.className.trim().split(/\s+/).filter(Boolean).slice(0, 2) : [];
    const text = (element.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
    return `${element.tagName.toLowerCase()}${classes.length ? `.${classes.join(".")}` : ""}${text ? ` "${text}"` : ""}`;
  };
  const shown = (element: Element) => {
    const visible = (element as Element & { checkVisibility?: (options: object) => boolean }).checkVisibility;
    if (visible && !visible.call(element, { opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })) return false;
    for (let node: Element | null = element; node; node = node.parentElement) {
      const parent = node.parentElement;
      if (parent instanceof HTMLDetailsElement && !parent.open && node.tagName !== "SUMMARY") return false;
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") return false;
      if (style.position === "absolute" && (style.clip === "rect(0px, 0px, 0px, 0px)" || style.clipPath === "inset(50%)")) return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  // A background-image's layers, top first, each as its colour stops.
  const imageLayers = (image: string): Rgba[][] => {
    const layers: string[] = [];
    let depth = 0;
    let start = 0;
    for (let index = 0; index < image.length; index += 1) {
      const char = image[index];
      if (char === "(") depth += 1;
      else if (char === ")") depth -= 1;
      else if (char === "," && depth === 0) {
        layers.push(image.slice(start, index));
        start = index + 1;
      }
    }
    layers.push(image.slice(start));
    return (
      layers
        // A radial glow lights one corner; text is set away from it, and
        // spreading it over the whole box reports text the eye reads fine.
        .filter((layer) => !/radial-gradient|conic-gradient/.test(layer))
        .map((layer) => (layer.match(/rgba?\([^)]+\)/g) ?? []).map(parse).filter((stop): stop is Rgba => stop !== null))
        .filter((stops) => stops.length > 0)
    );
  };
  // What is behind the text: every background down to the first opaque one,
  // composited — one colour, or one per gradient stop (the text must read
  // against each; Waiting on you's green header carried dark grey text the
  // first version of this check skipped). Null over an image.
  const behind = (element: Element): Rgba[] | null => {
    const layers: Rgba[][] = [];
    let opaque = false;
    for (let node: Element | null = element; node && !opaque; node = node.parentElement) {
      const style = getComputedStyle(node);
      const image = style.backgroundImage;
      if (image && image !== "none") {
        if (/url\(/.test(image)) return null;
        for (const stops of imageLayers(image)) {
          // A glow fading to transparent tints what is under it; only its
          // coloured stops count.
          const tinted = stops.filter((stop) => stop[3] > 0);
          if (!tinted.length) continue;
          layers.push(tinted);
          if (tinted.every((stop) => stop[3] >= 1) && tinted.length === stops.length) {
            opaque = true;
            break;
          }
        }
        if (opaque) break;
      }
      const color = parse(style.backgroundColor);
      if (color && color[3] > 0) {
        layers.push([color]);
        if (color[3] >= 1) opaque = true;
      }
    }
    let bases: Rgba[] = [[255, 255, 255, 1]];
    for (const layer of layers.reverse()) bases = layer.flatMap((top) => bases.map((base) => over(top, base)));
    return bases;
  };
  const opacity = (element: Element) => {
    let value = 1;
    for (let node: Element | null = element; node; node = node.parentElement) value *= Number(getComputedStyle(node).opacity);
    return value;
  };
  const disabled = (element: Element) => !!element.closest("[disabled], [aria-disabled='true'], fieldset:disabled");
  // A logotype is exempt (WCAG 1.4.3): the "Cue" of the StudioCue wordmark.
  const logo = (element: Element) => !!element.closest(".ds-brand-word, [data-logotype]");

  for (const element of Array.from(document.body.querySelectorAll("*"))) {
    if (["SCRIPT", "STYLE", "NOSCRIPT", "OPTION"].includes(element.tagName) || element.closest("svg")) continue;
    const ownText = Array.from(element.childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent ?? "")
      .join("")
      .trim();
    // Words, not a lone glyph (a "·" separator or a "×").
    if (!/[A-Za-z0-9]{2}/.test(ownText)) continue;
    if (!shown(element) || disabled(element) || logo(element)) continue;
    const style = getComputedStyle(element);
    const size = parseFloat(style.fontSize);
    const where = name(element);
    const floor = style.textTransform === "uppercase" ? 11 : 12;
    if (size + 0.01 < floor) {
      const key = `small|${where}`;
      if (!seen.has(key)) {
        seen.add(key);
        findings.push({ kind: "small", where, detail: `${size}px` });
      }
    }
    const backgrounds = behind(element);
    const color = parse(style.color);
    if (!backgrounds || !color) continue;
    const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
    const needed = large ? 3 : 4.5;
    let worst: { measured: number; ink: Rgba; background: Rgba } | null = null;
    for (const background of backgrounds) {
      const ink = over([color[0], color[1], color[2], color[3] * opacity(element)], background);
      const measured = ratio(ink, background);
      if (!worst || measured < worst.measured) worst = { measured, ink, background };
    }
    if (worst && worst.measured + 0.005 < needed) {
      const key = `contrast|${where}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({
        kind: "contrast",
        where,
        detail: `${worst.measured.toFixed(2)}:1 (${hex(worst.ink)} on ${hex(worst.background)}), needs ${needed}:1`,
      });
    }
  }
  return findings;
}
