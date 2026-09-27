/**
 * The hover tooltip for an icon-only control.
 *
 * Icon buttons across the app carry an `aria-label` for screen readers but no
 * `title`, so a mouse user hovering one learned nothing — the Team page's
 * suspend button, the Jobs table's open arrows, the calendar's month
 * arrows (docs/ui-audit-2026-09-27.md). This decides the tooltip; the
 * `IconButtonTitles` component applies it across the page.
 *
 * Returns null when the element needs nothing: it has visible text, already
 * has its own title, or has no name to show.
 */
export function iconButtonTitle(element: {
  visibleText: string;
  ariaLabel: string | null;
  title: string | null;
  /** The title was set by us earlier (so it may follow a changed label). */
  titleIsOurs: boolean;
}): string | null {
  if (element.visibleText.trim()) return null;
  const label = element.ariaLabel?.trim();
  if (!label) return null;
  if (element.title && !element.titleIsOurs) return null;
  return element.title === label ? null : label;
}
