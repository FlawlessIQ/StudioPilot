/**
 * Container inset audit.
 *
 * Finds content sitting flush against a container's edge. `.panel` and
 * `.ds-card` declare background, border and radius but **no padding**, so every
 * usage has to supply its own inset — and wherever one doesn't, text and
 * controls touch the border.
 *
 * Reports two distinct faults:
 *   flush   a text-bearing or interactive descendant within `min` px of the
 *           container's padding edge
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
    // the container's content box in viewport coords
    const box = {
      left: cr.left + border.left + pad.left,
      right: cr.right - border.right - pad.right,
      top: cr.top + border.top + pad.top,
      bottom: cr.bottom - border.bottom - pad.bottom,
    };

    const label =
      (container.className || container.tagName).toString().trim().slice(0, 60);

    let worst = null;
    const bleeders = [];

    for (const el of container.querySelectorAll("*")) {
      if (!isVisible(el)) continue;
      // skip descendants that live inside a *nested* audited container
      if (el.closest(containerSelector) !== container) continue;
      const r = el.getBoundingClientRect();

      // a divider: very short, spans the full width
      const isRule =
        r.height <= 2 &&
        r.width >= (box.right - box.left) - 1 &&
        r.width > 40;
      if (isRule && (pad.left > 2 || pad.right > 2)) {
        bleeders.push(String(el.className || el.tagName).slice(0, 40));
        continue;
      }

      if (!hasOwnText(el) && !interactive(el)) continue;

      const gaps = {
        left: r.left - box.left,
        right: box.right - r.right,
        top: r.top - box.top,
        bottom: box.bottom - r.bottom,
      };
      for (const side of ["left", "right", "top", "bottom"]) {
        const gap = gaps[side];
        if (gap < min && gap > -400) {
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
