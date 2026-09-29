import tokens from "@/design/tokens.json";

/**
 * design/tokens.json as CSS custom properties, scoped to `.kit`.
 *
 * Pure so a test can compare it with the committed app/kit-tokens.css; the
 * file is written by `npx tsx scripts/generate-kit-tokens.ts`. The studio's
 * accent is not here: it is set per studio on the kit root
 * (features/design/studio-theme.ts), with the default as the fallback.
 */
export function kitTokensCss(): string {
  const lines: string[] = [];
  for (const [name, value] of Object.entries(tokens.color)) {
    lines.push(`  --kit-${name}: ${value};`);
  }
  lines.push(`  --kit-font-display: ${tokens.font.display};`);
  lines.push(`  --kit-font-ui: ${tokens.font.ui};`);
  for (const [name, style] of Object.entries(tokens.text)) {
    lines.push(`  --kit-text-${name}-size: ${style.size}px;`);
    lines.push(`  --kit-text-${name}-line: ${style.line};`);
    lines.push(`  --kit-text-${name}-weight: ${style.weight};`);
    lines.push(`  --kit-text-${name}-font: var(--kit-font-${style.font});`);
  }
  for (const [name, value] of Object.entries(tokens.space)) {
    lines.push(`  --kit-space-${name}: ${value}px;`);
  }
  for (const [name, value] of Object.entries(tokens.radius)) {
    lines.push(`  --kit-radius-${name}: ${value}px;`);
  }
  for (const [name, value] of Object.entries(tokens.size)) {
    lines.push(`  --kit-size-${name}: ${value}px;`);
  }
  for (const [name, value] of Object.entries(tokens.motion)) {
    lines.push(`  --kit-motion-${name}: ${value};`);
  }
  for (const [name, value] of Object.entries(tokens.shadow)) {
    lines.push(`  --kit-shadow-${name}: ${value};`);
  }
  return [
    "/* Generated from design/tokens.json by scripts/generate-kit-tokens.ts. Do not edit. */",
    ".kit {",
    ...lines,
    "  --kit-accent: var(--kit-accent-default);",
    "}",
    "",
  ].join("\n");
}
