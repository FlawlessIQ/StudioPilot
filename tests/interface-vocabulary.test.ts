import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The interface stays in the photographer's vocabulary.
 *
 * The audit found `deterministic` in ten user-visible strings — including on
 * the sign-up page — alongside `cascade`, `hard gates` and a raw provider
 * envelope id shown like a reference number. Separately, four date formats
 * were live at once, one of them a bare ISO string attached to money.
 *
 * Phases 1 to 3 removed all of it. This is what keeps it removed: the words
 * and the formats are cheap to reintroduce one component at a time, and
 * nobody notices until someone walks the product again.
 *
 * It reads source, so it can only judge literals. That is enough — every
 * instance the audit found was a literal.
 */

const SURFACES = ["app", "components"];

/** Words that belong in the engine, the audit log and the API — not on screen. */
const BANNED = [
  { word: "deterministic", instead: "say what actually happens" },
  { word: "hard gate", instead: '"ruled out", or name the reason' },
  { word: "authority boundary", instead: "say what approving does" },
  { word: "operational truth", instead: "say what the panel shows" },
];

/** Files that legitimately discuss the engine rather than address the user. */
const EXEMPT = [
  join("app", "docs"),
  join("components", "ai", "structured-content-fields.tsx"),
];

function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === ".next") continue;
      found.push(...sourceFiles(full));
    } else if (entry.endsWith(".tsx")) {
      found.push(full);
    }
  }
  return found;
}

/** Strip comments so an explanation of the old wording is not a violation. */
function withoutComments(source: string): string {
  return source
    .replaceAll(/\/\*[\s\S]*?\*\//g, "")
    .replaceAll(/^\s*\/\/.*$/gm, "");
}

const files = SURFACES.flatMap((surface) => sourceFiles(surface)).filter(
  (path) => !EXEMPT.some((exempt) => path.startsWith(exempt)),
);

test("the engine's vocabulary stays out of the interface", () => {
  const offences: string[] = [];
  for (const path of files) {
    const source = withoutComments(readFileSync(path, "utf8"));
    for (const { word, instead } of BANNED) {
      // Variable and property names are fine; prose is not. Only flag the
      // word when it sits inside a string or as rendered text.
      const inCopy = new RegExp(
        `(["\`>][^"\`<>]{0,120})\\b${word}s?\\b`,
        "i",
      );
      if (inCopy.test(source)) offences.push(`${path}: "${word}" — ${instead}`);
    }
  }
  assert.deepEqual(
    offences,
    [],
    offences.length ? `Engine vocabulary on screen:\n  ${offences.join("\n  ")}` : "",
  );
});

test("dates on screen go through the shared formatter", () => {
  // A bare toLocaleDateString() produced "9/13/2026" in the domain-list
  // renderer — the fourth date format, and the widest single source of drift.
  const offences: string[] = [];
  for (const path of files) {
    const source = withoutComments(readFileSync(path, "utf8"));
    if (/toLocaleDateString\(\s*\)/.test(source))
      offences.push(`${path}: bare toLocaleDateString()`);
  }
  assert.deepEqual(
    offences,
    [],
    offences.length
      ? `Use lib/format/event-date.ts instead:\n  ${offences.join("\n  ")}`
      : "",
  );
});

test("money is never rendered as raw cents", () => {
  // "626500 cents balance" reached the job page. Money is stored in cents
  // and must always be formatted before it is shown.
  const offences: string[] = [];
  for (const path of [
    ...files,
    ...sourceFiles("features").filter((file) => file.endsWith(".ts")),
  ]) {
    const source = withoutComments(readFileSync(path, "utf8"));
    if (/\$\{[^}]*[Cc]ents[^}]*\}\s*cents\b/.test(source))
      offences.push(`${path}: renders a cents value with the word "cents"`);
  }
  assert.deepEqual(offences, [], offences.join("\n  "));
});

/**
 * Status enums are not reader-facing words.
 *
 * The walkthroughs kept turning this up in new places: a client shown
 * "review_required" on their gallery, a signer row reading "completed", a
 * crew cascade badge reading "exhausted". Each was fixed where it was found
 * and then reappeared one screen over, because nothing stopped it.
 *
 * Only `.status` and `.kind` are checked. `.role` and `.name` are free text
 * a studio typed ("Second photographer") and are correct rendered raw —
 * flagging those would make this noisy enough to be switched off, which is
 * worse than not having it.
 */
test("status and kind values go through a label before they are shown", () => {
  const offences: string[] = [];
  const patterns = [
    // The direct render: {text(x.status)} / {String(x.kind)}
    /\{\s*(?:String|text)\(\s*[A-Za-z_$][\w$.?]*\.(?:status|kind)\s*\)\s*\}/,
    // The codebase's own idiom for dressing an enum up as words. Swapping
    // underscores for spaces still shows the enum — "awaiting signature",
    // "review required" — and this caught nineteen instances the direct
    // pattern alone missed, seven of them on client-facing screens.
    /[A-Za-z_$][\w$.?]*\.(?:status|kind)[^;\n]{0,40}\.replaceAll\("_",\s*" "\)/,
  ];
  for (const path of files) {
    const source = withoutComments(readFileSync(path, "utf8"));
    for (const line of source.split("\n")) {
      if (patterns.some((pattern) => pattern.test(line)))
        offences.push(`${path}: ${line.trim().slice(0, 90)}`);
    }
  }
  assert.deepEqual(
    offences,
    [],
    offences.length
      ? "Use statusLabel() from features/format/status-label.ts:\n  " +
        offences.join("\n  ")
      : "",
  );
});
