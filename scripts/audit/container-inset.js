/**
 * Container inset audit.
 *
 * Finds content sitting flush against a container's edge. `.panel` and
 * `.ds-card` declare background, border and radius but **no padding**, so every
 * usage has to supply its own inset — and wherever one doesn't, text and
 * controls touch the border.
 *
 * Reports two distinct faults:
 *   flush   a text-bearing or interactive descendant whose content sits
 *           within `min` px of the container's border
 *   overflow a descendant running past the container's border
 *   bleed   a horizontal rule / divider running the container's full width
 *           while its siblings are inset (asymmetric inset)
 *
 * Run in the page via the browser tools; returns JSON.
 */
(function auditContainerInsets(options) {
  const min = (options && options.min) || 8;
  const containerSelector =
    ".panel, .ds-card, .ds-stat, .ds-ai, .ds-cal-panel, .ds-cal-grid-card, " +
    ".report-funnel, .project-lifecycle-cockpit, .communications-timeline, " +
    ".studio-attention-queue, .studio-handling, .crm-table-panel, .panel-state";

  const isVisible = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  };

  const hasOwnText = (el) =>
    [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);

  const interactive = (el) =>
    ["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA"].includes(el.tagName);

  const scrolledInside = (el, container) => {
    for (let node = el.parentElement; node && node !== container; node = node.parentElement) {
      const cs = getComputedStyle(node);
      if (/auto|scroll/.test(cs.overflowX) && node.scrollWidth > node.clientWidth + 4) return true;
      if (/auto|scroll/.test(cs.overflowY) && node.scrollHeight > node.clientHeight + 4) return true;
    }
    return false;
  };

  const findings = [];

  for (const container of document.querySelectorAll(containerSelector)) {
    if (!isVisible(container)) continue;
    const cs = getComputedStyle(container);
    const cr = container.getBoundingClientRect();
    const pad = {
      top: parseFloat(cs.paddingTop) || 0,
      right: parseFloat(cs.paddingRight) || 0,
      bottom: parseFloat(cs.paddingBottom) || 0,
      left: parseFloat(cs.paddingLeft) || 0,
    };
    const border = {
      top: parseFloat(cs.borderTopWidth) || 0,
      right: parseFloat(cs.borderRightWidth) || 0,
      bottom: parseFloat(cs.borderBottomWidth) || 0,
      left: parseFloat(cs.borderLeftWidth) || 0,
    };
    // The container's *padding* box — inside the border, before its own
    // padding. Measuring from the content box instead made every full-width
    // child of a correctly padded container report a 0px gap, which is
    // simply what a block child does; the resulting noise is why this was
    // never run over more than one page at a time. Measured from the
    // border, a padded container yields a gap equal to its padding and
    // passes, and only a container that supplies no inset — the actual
    // fault this looks for — reports content against its edge.
    const box = {
      left: cr.left + border.left,
      right: cr.right - border.right,
      top: cr.top + border.top,
      bottom: cr.bottom - border.bottom,
    };

    const label =
      (container.className || container.tagName).toString().trim().slice(0, 60);

    let worst = null;
    const bleeders = [];
    const overflows = [];

    for (const el of container.querySelectorAll("*")) {
      if (!isVisible(el)) continue;
      // skip descendants that live inside a *nested* audited container
      if (el.closest(containerSelector) !== container) continue;
      const r = el.getBoundingClientRect();

      // a divider: very short, spans the full width
      const isRule =
        r.height <= 2 &&
        r.width >= (box.right - box.left) - pad.left - pad.right - 1 &&
        r.width > 40;
      if (isRule && (pad.left > 2 || pad.right > 2)) {
        bleeders.push(String(el.className || el.tagName).slice(0, 40));
        continue;
      }

      if (!hasOwnText(el) && !interactive(el)) continue;
      // A descendant of a scroller is positioned by its scroll offset, not
      // by the card's inset. Chip strips and scrolling tables legitimately
      // place children far outside the container's box.
      if (scrolledInside(el, container)) continue;

      // Measure where the child's *content* starts, not its box. A list row
      // that deliberately spans the card and carries its own padding —
      // so the hover background reaches the edges while the text does not —
      // is a correct pattern, and counting its box as flush condemned every
      // table in the app.
      const es = getComputedStyle(el);
      const inset = (side) =>
        (parseFloat(es[`padding${side}`]) || 0) +
        (parseFloat(es[`border${side}Width`]) || 0);

      const gaps = {
        left: r.left + inset("Left") - box.left,
        right: box.right - (r.right - inset("Right")),
        top: r.top + inset("Top") - box.top,
        bottom: box.bottom - (r.bottom - inset("Bottom")),
      };
      for (const side of ["left", "right", "top", "bottom"]) {
        const gap = gaps[side];
        // A gap this far out of range is not a measurement — it is an
        // element inside a collapsed disclosure, or scrolled out of a
        // horizontally scrolling region. Reporting those as faults buried
        // the real ones.
        if (gap <= -400) continue;
        // Negative means the child runs past the container: an overflow,
        // which is a different fault from a missing inset.
        if (gap < 0) {
          overflows.push({
            side,
            gap: Math.round(gap),
            child: String(el.className || el.tagName).slice(0, 44),
            text: (el.textContent || "").trim().slice(0, 34),
          });
          continue;
        }
        if (gap < min) {
          if (!worst || gap < worst.gap) {
            worst = {
              gap: Math.round(gap),
              side,
              child: String(el.className || el.tagName).slice(0, 44),
              text: (el.textContent || "").trim().slice(0, 34),
            };
          }
        }
      }
    }

    if (worst) {
      findings.push({
        kind: "flush",
        container: label,
        pad: `${pad.top}/${pad.right}/${pad.bottom}/${pad.left}`,
        ...worst,
      });
    }
    if (overflows.length) {
      const worstOverflow = overflows.reduce((a, b) => (b.gap < a.gap ? b : a));
      findings.push({
        kind: "overflow",
        container: label,
        pad: `${pad.top}/${pad.right}/${pad.bottom}/${pad.left}`,
        ...worstOverflow,
      });
    }
    if (bleeders.length) {
      findings.push({
        kind: "bleed",
        container: label,
        pad: `${pad.top}/${pad.right}/${pad.bottom}/${pad.left}`,
        rules: bleeders.length,
        example: bleeders[0],
      });
    }
  }

  return { url: location.pathname, width: innerWidth, findings };
})({ min: 8 });
