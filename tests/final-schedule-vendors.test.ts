import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { vendorContactSheet } from "../features/vendors/team";
import { runOfShowDocument } from "../functions/src/planning/run-of-show-doc";
import { renderEmailTemplate } from "../functions/src/communications/email-templates";

/**
 * The final schedule needs the vendor team (docs/vendor-network-plan-2026-10-12.md,
 * Phase 2): the couple answers before confirming final details, every
 * vendor's link and the printed run of show carry who's working the day, and
 * a publish leads straight to sending each vendor their part.
 */

const read = (path: string) => readFileSync(path, "utf8");
const brand = { studioName: "GR Productions", productName: "StudioCue", accentColor: "#35664a", logoUrl: null, contactEmail: null };

test("the contact sheet: booked vendors someone can reach, never the money", () => {
  const rows = vendorContactSheet([
    { vendorId: "v1", category: "dj", company: "Night Owl", contactName: "Sam", status: "booked", phone: "555", arrivalTime: "15:00", costCents: 250000 },
    { vendorId: "v2", category: "florist", company: "Bloom", status: "booked", email: "hi@bloom.example", loadInTime: "11:00" },
    { vendorId: "v3", category: "caterer", company: "Feast", status: "considering", phone: "555" },
    { vendorId: "v4", category: "band", company: "No Way To Reach", status: "booked" },
  ]);
  assert.deepEqual(rows.map((row) => row.company), ["Night Owl", "Bloom"]);
  assert.equal(rows[0]!.arrival, "15:00");
  assert.equal(rows[1]!.arrival, "11:00");
  assert.ok(!JSON.stringify(rows).includes("250000"));
});

test("the printed run of show lists vendor contacts within the PDF service's limits", () => {
  const document = runOfShowDocument({
    items: [{ startAt: "2027-06-12T18:00:00Z", endAt: "2027-06-12T18:30:00Z", title: "Ceremony", location: null, notes: null, crewIds: [] }],
    timeZone: "America/New_York",
    version: 2,
    project: { name: "Avery & Sam" },
    contacts: [
      { company: "Night Owl", role: "DJ · Sam", phone: "555-010-0199", email: "" },
      { company: "Ghost", role: "Florist", phone: "", email: "" },
      { company: "x".repeat(300), role: "Band", phone: "", email: "band@example.com" },
    ],
  });
  assert.equal(document.contacts.length, 2);
  assert.equal(document.contacts[1]!.company.length, 200);
  // An older caller sends none and the page reads as it did.
  const plain = runOfShowDocument({ items: [], timeZone: "UTC", version: 1, project: {} });
  assert.deepEqual(plain.contacts, []);
  assert.match(read("cloud-run/pdf/run_of_show.py"), /contacts: list\[RunOfShowContact\] = Field\(default_factory=list, max_length=40\)/);
  assert.match(read("functions/src/operations/ai-pdf.ts"), /collection\("projectVendors"\)/);
});

test("the final details email says the vendor list is asked for, only when it is", () => {
  const values = { portalUrl: "https://studio-cue.com/client?final-details=1", eventKind: "wedding" };
  const asked = renderEmailTemplate({ key: "final_details_request", brand, recipientName: "Avery", projectName: "Avery & Sam", values: { ...values, vendorsNeeded: true } } as Parameters<typeof renderEmailTemplate>[0]);
  assert.match(asked.text, /who else is working your day/);
  const answered = renderEmailTemplate({ key: "final_details_request", brand, recipientName: "Avery", projectName: "Avery & Sam", values } as Parameters<typeof renderEmailTemplate>[0]);
  assert.doesNotMatch(answered.text, /who else is working your day/);
});

test("wired: confirming waits on the answer, the link shows the team, a publish opens the send", () => {
  const signoff = read("server/planning/final-details.ts");
  assert.match(signoff, /FINAL_DETAILS_VENDORS_NEEDED/);
  assert.match(signoff, /confirmedVendors: vendorTeam\.vendors/);
  assert.match(read("functions/src/planning/final-details.ts"), /vendorsNeeded/);
  assert.match(read("app/share/[token]/page.tsx"), /vendorContactSheet\(/);
  assert.match(read("components/planning/ai-schedule-generator.tsx"), /then: "send_to_vendors"/);
  assert.match(read("lib/projects/return-to-job.ts"), /\?vendors=send#vendor-team/);
  assert.match(read("components/vendors/vendor-team-panel.tsx"), /get\("vendors"\) === "send"/);
});

test("the publish warns about booked vendors with no email, and never about anyone else", async () => {
  const { noEmailPublishWarning } = await import("../features/vendors/team");
  assert.equal(noEmailPublishWarning([]), null);
  assert.equal(
    noEmailPublishWarning([
      { status: "booked", email: "dj@example.com" },
      { status: "needed", email: null },
      { status: "booked", email: null, archivedAt: "2026-10-01T00:00:00Z" },
    ]),
    null,
  );
  assert.match(noEmailPublishWarning([{ status: "booked", email: "" }]) ?? "", /^1 booked vendor has no email/);
  assert.match(noEmailPublishWarning([{ status: "booked", email: null }, { status: "booked", email: "petal" }]) ?? "", /^2 booked vendors/);
});
