import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { createFormControl } from "react-hook-form";
import { inquiryFormDefaults } from "@/components/crm/lead-intake-form";

/**
 * The inquiry form is the first StudioCue screen a couple sees, and Gabe
 * found it slow and unresponsive on a phone (2026-09-28). The investigation is
 * docs/inquiry-form-performance-investigation-2026-09-28.md. These pin the
 * fixes that do not need a browser to prove.
 */

const root = process.cwd();
const source = (path: string) => readFileSync(join(root, path), "utf8");

function resolveImport(from: string, specifier: string): string | null {
  const base = specifier.startsWith("@/")
    ? join(root, specifier.slice(2))
    : specifier.startsWith(".")
      ? resolve(dirname(from), specifier)
      : null;
  if (!base) return null;
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ]) {
    if (existsSync(candidate) && candidate.match(/\.tsx?$/)) return candidate;
  }
  return null;
}

/** Every package a file pulls in at load time, following its own modules. */
function staticPackages(entry: string): Map<string, string> {
  const seen = new Set<string>();
  const packages = new Map<string, string>();
  const queue = [join(root, entry)];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const text = readFileSync(file, "utf8");
    // Static imports and re-exports only. `import type` erases, and a
    // dynamic `import()` is exactly how a heavy module is kept out.
    const pattern =
      /^\s*(?:import|export)\s+(?!type\b)(?:[^"';]*?\sfrom\s+)?["']([^"']+)["']/gm;
    for (const match of text.matchAll(pattern)) {
      const specifier = match[1]!;
      const local = resolveImport(file, specifier);
      if (local) queue.push(local);
      else if (!specifier.startsWith(".") && !specifier.startsWith("@/"))
        packages.set(specifier, file.slice(root.length + 1));
    }
  }
  return packages;
}

/**
 * Firebase is most of the page's 1.5 MB. The address field's lookup client
 * imported Auth, Firestore and App Check for a public lookup that uses none
 * of them, and the form imported App Check for a token it needs only on Send.
 */
test("nothing on the inquiry form loads Firebase before it is needed", () => {
  const packages = staticPackages("components/crm/lead-intake-form.tsx");
  const firebase = [...packages].filter(([name]) => name.startsWith("firebase"));
  assert.deepEqual(
    firebase,
    [],
    `statically imported: ${firebase.map(([name, file]) => `${name} (${file})`).join(", ")}`,
  );
  // And the walk really does reach the pieces it is guarding.
  assert.ok(packages.has("react-hook-form"));
});

test("the studio places route still gets Firebase, on demand", () => {
  const client = source("lib/places/client.ts");
  assert.match(client, /import\("@\/lib\/firebase\/client"\)/);
  assert.match(client, /import\("@\/lib\/firebase\/app-check"\)/);
});

/**
 * react-hook-form writes a registered field's default into its input when the
 * page hydrates. Every default was "", so anything typed while the script was
 * still loading was erased. A field with no default is read from its input.
 */
test("typing before the page is ready is kept", () => {
  const form = source("components/crm/lead-intake-form.tsx");
  const defaults = form.slice(
    form.indexOf("const inquiryFormDefaults"),
    form.indexOf("};", form.indexOf("const inquiryFormDefaults")),
  );
  for (const field of [
    "firstName",
    "lastName",
    "email",
    "phone",
    "eventDate",
    "city",
    "message",
    "consent",
    "honeypot",
    "eventType",
  ]) {
    assert.doesNotMatch(defaults, new RegExp(`\\b${field}:`), `${field} has a default`);
  }
});

test("App Check starts on the first field, not on Send", () => {
  const form = source("components/crm/lead-intake-form.tsx");
  assert.match(form, /onFocusCapture=\{prewarmAppCheck\}/);
  assert.match(form, /await import\("@\/lib\/firebase\/app-check"\)/);
});

test("the venue box does not re-render the form on every letter", () => {
  const form = source("components/crm/lead-intake-form.tsx");
  assert.match(form, /if \(!place \|\| place\.verified\) setVenue\(place\);/);
});

test("the inquiry page looks the studio up once, both queries together", () => {
  const page = source("app/inquiry/page.tsx");
  assert.match(page, /const studioForSlug = cache\(lookupStudio\);/);
  assert.match(page, /await Promise\.all\(\[/);
});

test("an address suggestion does not wait on three lookups in a row", () => {
  const route = source("app/api/public/places/route.ts");
  assert.match(route, /tenantBySlug = new Map/);
  // The limit answers from memory; the shared Firestore count runs off the
  // response path (it took 137–197 ms of every suggestion on production).
  assert.match(route, /const allowed = allowedNow\(id\);\s*countShared\(id\);/);
  assert.match(route, /void withinRateLimit\(id\)\.then/);
  assert.doesNotMatch(route, /await (Promise\.all\(\[[^\]]*)?withinRateLimit/);
  assert.match(route, /"server-timing"/);
  // A browser that's over the limit is told, once, and stops asking.
  const field = source("components/forms/address-field.tsx");
  assert.match(field, /caught\.message === "PLACES_429"\) setPaused\(true\)/);
  assert.match(field, /if \(live === false \|\| paused\) return;/);
});

/**
 * The same thing, run rather than read: register every field the form
 * registers, with the form's real defaults, against an input that already
 * holds what a couple typed before the script loaded. Registration is the
 * moment react-hook-form used to write "" over it.
 */
test("registering the form's fields keeps what was already typed", () => {
  const form = source("components/crm/lead-intake-form.tsx");
  const fields = [...form.matchAll(/register\("(\w+)"/g)].map((match) => match[1]!);
  assert.ok(fields.length >= 12, `found ${fields.length} registered fields`);

  class FakeElement {}
  const globals = globalThis as { HTMLElement?: unknown };
  const previous = globals.HTMLElement;
  globals.HTMLElement = FakeElement;
  try {
    const { control, register } = createFormControl({
      defaultValues: { ...inquiryFormDefaults, tenantSlug: "studio" },
    });
    const values = (control as unknown as { _formValues: Record<string, unknown> })._formValues;
    for (const name of fields) {
      const checkbox = name === "consent";
      const element = Object.assign(new FakeElement(), {
        name,
        type: checkbox ? "checkbox" : "text",
        value: checkbox ? "on" : `typed ${name}`,
        checked: checkbox,
        isConnected: true,
      });
      (register as (field: string) => { ref: (el: unknown) => void })(name).ref(element);
      if (checkbox) {
        assert.equal(element.checked, true, "consent was unticked");
        assert.equal(values[name], true);
      } else {
        assert.equal(element.value, `typed ${name}`, `${name} was cleared`);
      }
    }
  } finally {
    globals.HTMLElement = previous;
  }
});
