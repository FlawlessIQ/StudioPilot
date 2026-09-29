import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/**
 * Every class a component names should be styled somewhere.
 *
 * Editing a job and adding its second client shipped with `ghost-button`,
 * `record-edit-form` and `primary-button` — names no stylesheet defines — so
 * both opened as bare browser defaults: native grey buttons, an icon stacked
 * above its label, and every field's label running into the field across the
 * title line (docs/ui-audit-2026-09-27.md). Six more had the same cause.
 *
 * This lists the static class names in app/, components/ and features/ that
 * no rule in app/*.css mentions. The ones below are known and harmless:
 * modifiers and state tokens (`is-`, `tone-`, `open`), prefixes completed
 * at runtime, and names only used as hooks. A new name that is not styled
 * fails here. Style it — usually by reusing an existing class such as
 * `button button-light` or `record-sheet` — or, if it truly is a modifier,
 * add it to the list.
 */
const KNOWN_UNSTYLED = new Set([
  "ai-queue-rationale",
  "antialiased",
  "archived",
  "ask",
  "assign",
  "assumption",
  "attention",
  "avatar-",
  "band-",
  "booking-contract-manual-hint",
  "branding-logo-preview",
  "client-auth-assurance",
  "client-milestone-",
  "client-portal-loading",
  "client-proposal-result-success",
  "completed",
  "converted",
  "create",
  "crew-client-brief-day",
  "crew-event-day",
  "crew-past-divider",
  "document-viewer",
  "ds-",
  "ds-tabbar-more",
  "ds-user-signout",
  "error",
  "existing",
  "from-",
  "inline",
  "integration-notice-",
  "is-",
  "is-included",
  "is-medium",
  "is-outstanding",
  "lane-",
  "lead-date-clash",
  "link",
  "live-record-",
  "lost",
  "mode-note",
  "mode-task",
  "new",
  "not_required",
  "note",
  "notes",
  "open",
  "plan-card-",
  "post-production-pending",
  "prepare",
  "proposal-delivery-recipient",
  "proposal-discount-field",
  "proposal-pdf-state-",
  "proposal-record-acceptance",
  "prospects",
  "provider-",
  "queued",
  "ready",
  "receipts",
  "record-attestation-caveat",
  "report-metric-projects",
  "required",
  "review",
  "story-copy",
  "subscription-period",
  "task",
  "timeline-authority-actions",
  "tone-",
  "transcript",
  "vendor-share-status-",
  "wide",
  "workflow-create-form",
]);

function files(dir: string, ext: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path, ext);
    return path.endsWith(ext) ? [path] : [];
  });
}

function definedClasses(): Set<string> {
  const css = readdirSync("app")
    .filter((name) => name.endsWith(".css"))
    .map((name) => readFileSync(join("app", name), "utf8"))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  return new Set([...css.matchAll(/\.(-?[_a-zA-Z][-_a-zA-Z0-9]*)/g)].map((match) => match[1]));
}

function usedClasses(): Map<string, string> {
  const used = new Map<string, string>();
  const sources = ["app", "components", "features"].flatMap((dir) => files(dir, ".tsx"));
  for (const file of sources) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\}|\{([^}]*)\})/g)) {
      let text = match[1] ?? match[2] ?? "";
      if (match[3]) text = [...match[3].matchAll(/"([^"]*)"/g)].map((part) => part[1]).join(" ");
      text = text.replace(/\$\{[^}]*\}/g, " ");
      for (const token of text.split(/\s+/)) {
        if (/^[a-z][-a-z0-9_]*$/.test(token) && !used.has(token)) {
          const line = source.slice(0, match.index).split("\n").length;
          used.set(token, `${file}:${line}`);
        }
      }
    }
  }
  return used;
}

test("every class a component uses is styled, or known to be a modifier", () => {
  const defined = definedClasses();
  const unstyled = [...usedClasses()]
    .filter(([name]) => !defined.has(name) && !KNOWN_UNSTYLED.has(name))
    .map(([name, where]) => `${name} (${where})`);
  assert.deepEqual(unstyled, [], `Classes with no CSS:\n${unstyled.join("\n")}`);
});
