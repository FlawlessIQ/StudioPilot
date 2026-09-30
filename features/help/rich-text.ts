/**
 * The only markup explainers use: **bold** for a UI label, spelled as the
 * screen spells it. Kept this small on purpose — anything richer belongs in
 * a component, not in help copy.
 */

export type RichSegment = { text: string; bold: boolean };

export function richSegments(text: string): RichSegment[] {
  return text
    .split(/(\*\*[^*]+\*\*)/)
    .filter(Boolean)
    .map((part) =>
      part.startsWith("**") && part.endsWith("**")
        ? { text: part.slice(2, -2), bold: true }
        : { text: part, bold: false },
    );
}

/** The UI labels a piece of help copy names. */
export function boldLabels(text: string): string[] {
  return richSegments(text)
    .filter((segment) => segment.bold)
    .map((segment) => segment.text);
}

export function plainText(text: string): string {
  return text.replace(/\*\*([^*]+)\*\*/g, "$1");
}
