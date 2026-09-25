import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/**
 * The way inquiries get in has to be findable by a studio that has none.
 *
 * Each studio has a private, HMAC-signed forwarding address —
 * `inquiries+<slug>.<sig>@<inbound domain>` — and anything forwarded to it
 * becomes a lead with the date checked and a reply drafted, exactly like a
 * website-form inquiry. It is live in production: MX points at SendGrid, both
 * secrets are provisioned, Vertex is configured with mock mode off.
 *
 * It was rendered in exactly one place: /studio/leads. That page has no entry
 * in the studio nav (Today, Cue, Jobs, Calendar, Messages, People, AI review,
 * Insights, Library, Studio settings, Help & guides), none in global search,
 * and the only links to it anywhere are two "Back to inquiries" back-links
 * *inside* a lead detail page. So the one route to the address was: open an
 * inquiry from Today, then back out into a list you had never visited.
 *
 * Which means a studio with **no inquiries yet** had no route at all — and that
 * is precisely the studio this exists for: the one whose inquiries are all
 * still sitting in Gmail.
 *
 * So the rule is reachability, not a list of call sites: the address must be
 * on at least one surface reachable with zero inquiries and zero jobs.
 */

const read = (path: string) => readFileSync(`${process.cwd()}/${path}`, "utf8");

/** Surfaces a studio can reach before a single inquiry has ever arrived. */
const COLD_START_SURFACES = [
  "components/today/today-inbox.tsx",       // Today — the landing page
  "components/setup/setup-conversation.tsx", // /studio/setup — linked from Today
  "components/settings/settings-shell.tsx",  // Studio settings — in the nav
];

test("the forwarding address is reachable with no inquiries and no jobs", () => {
  const reachable = COLD_START_SURFACES.filter((surface) =>
    /InquiryForwarding(Address|Settings)|LeadCaptureStart/.test(read(surface)),
  );
  assert.ok(
    reachable.length > 0,
    `No cold-start surface offers the inquiry forwarding address, so a studio with an empty Today cannot find it. Checked:\n${COLD_START_SURFACES.map((s) => `  ${s}`).join("\n")}`,
  );
});

/**
 * Specifically Today, because that is the only page a new studio is guaranteed
 * to see, and it must offer it on the condition that matters — no inquiry has
 * ever arrived, rather than none currently open. A studio that converted its
 * one inquiry still has a mailbox full of them.
 */
test("Today offers it while no inquiry has ever arrived", () => {
  const today = read("components/today/today-inbox.tsx");
  // The address, and the three ways to get inquiries to it — the website
  // form, the inbox, a forward by hand — each opening its setup sheet.
  assert.match(today, /LeadCaptureStart/);
  assert.match(
    today,
    /setup\.noInquiriesEver\s*\?\s*<LeadCaptureStart\s*\/>/,
    "Today must gate the address on noInquiriesEver, not on the open-inquiry count",
  );
  const hook = read("components/today/use-today-inbox.ts");
  assert.match(
    hook,
    /noInquiriesEver:\s*\(leads\.records \?\? \[\]\)\.length === 0/,
    "noInquiriesEver means no lead has ever existed, from any source",
  );
});

/** Settings is the surface that survives a studio already having inquiries. */
test("settings carries it as a findable, permanent home", () => {
  const shell = read("components/settings/settings-shell.tsx");
  assert.match(shell, /key: "forwarding"/);
  assert.match(shell, /forwarding: InquiryForwardingSettings/);
  assert.match(shell, /Inquiry capture/);
});

/**
 * And it must not quietly regress to living only on the inquiries list.
 * Source-level because the failure is a component that is rendered nowhere a
 * person goes — there is nothing to assert about a page nobody opens.
 */
function tsxFiles(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) out.push(...tsxFiles(path));
    else if (path.endsWith(".tsx") || path.endsWith(".ts")) out.push(path);
  }
  return out;
}

test("more than one surface renders it", () => {
  const rendering = ["components", "app"]
    .flatMap((root) => tsxFiles(`${process.cwd()}/${root}`))
    .filter((file) => !file.endsWith("inquiry-forwarding-address.tsx"))
    .filter((file) =>
      /<InquiryForwarding(Address|Settings)\s*\/>|<LeadCaptureStart\s*\/>|forwarding: InquiryForwardingSettings/.test(
        readFileSync(file, "utf8"),
      ),
    )
    .map((file) => file.replace(`${process.cwd()}/`, ""));
  assert.ok(
    rendering.length >= 3,
    `The forwarding address is rendered on ${rendering.length} surface(s); it needs at least three so losing one does not make it undiscoverable again:\n${rendering.map((f) => `  ${f}`).join("\n")}`,
  );
});
