import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { OPERATOR_FOOTER, renderEmailTemplate } from "../functions/src/communications/email-templates.ts";
import { todayInbox } from "@/features/today/inbox";

/**
 * Conor, 2026-10-13: every email showed FlawlessIQ's office address, because
 * 12 of 13 studios had none set. A studio's mail to its clients, crew and
 * vendors is transactional: it shows the studio's own address, or none.
 * StudioCue's own mail keeps the operator's (CAN-SPAM).
 */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const brand = { studioName: "GR Productions", productName: "StudioCue", accentColor: "#35664a", logoUrl: null, contactEmail: null };
const render = (key: string, postalAddress: string | null) =>
  renderEmailTemplate({ key, brand: { ...brand, postalAddress }, recipientName: "Maya", projectName: "Maya & Theo", values: { actionUrl: "https://studio-cue.com/x" } });

test("a studio's email carries its own address, or none — never StudioCue's", () => {
  const own = render("proposal_sent", "14 Elm St, Morristown NJ 07960");
  assert.match(own.html, /14 Elm St, Morristown NJ 07960/);
  assert.match(own.text, /14 Elm St, Morristown NJ 07960/);
  const none = render("proposal_sent", null);
  assert.doesNotMatch(none.html, /Green Village|FlawlessIQ/);
  assert.doesNotMatch(none.text, /Green Village|FlawlessIQ/);
});

test("StudioCue's own mail keeps the operator's address", () => {
  // StudioCue's own mail is sent as StudioCue (operations/jobs.ts).
  const platform = renderEmailTemplate({ key: "platform_vendor_invite", brand: { ...brand, studioName: "StudioCue" }, recipientName: "Maya", projectName: null, values: { actionUrl: "https://studio-cue.com/x" } });
  assert.ok(platform.text.includes(OPERATOR_FOOTER));
});

test("the studio's invoice address stands in when Email branding has none", () => {
  const jobs = read("functions/src/operations/jobs.ts");
  assert.match(jobs, /db\.doc\(`billingSettings\/\$\{tenantId\}`\)\.get\(\)/);
  assert.match(jobs, /emailBranding\.postalAddress,\s*billingSettings\?\.exists && billingSettings\.get\("tenantId"\) === tenantId \? billingSettings\.get\("businessAddress"\) : null,/);
});

test("Today asks for an address once there's work, and stops once it's set", () => {
  const base = { now: "2026-10-13T12:00:00.000Z", projects: [{ id: "p1", name: "Maya & Theo", state: "BOOKED", eventDate: "2027-06-12" }] };
  const ask = (emailFooterAddress: string | null | undefined, projects = base.projects) =>
    (todayInbox({ ...base, projects, emailFooterAddress } as never) as unknown as { fyi: Array<{ id: string; action: { href?: string } }> }).fyi.find((item) => item.id === "setup-business-address");
  assert.equal(ask(null)?.action.href, "/studio/settings/email-branding");
  assert.equal(ask("14 Elm St"), undefined);
  assert.equal(ask(undefined), undefined, "not before it's known");
  assert.equal(ask(null, []), undefined, "not for a studio with no work yet");
});

test("no studio-facing screen shows StudioCue's own address as an example", () => {
  for (const path of ["components/settings/email-branding.tsx", "features/contracts/document.ts", "features/contracts/sample.ts"]) {
    assert.doesNotMatch(read(path), /Green Village/, path);
  }
});
