import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ACTION_AREA_LABELS, actionAreas, describeAction, isSystemNoise } from "../features/console/studio-actions.ts";
import { buildTimeline } from "../features/console/timeline.ts";

/**
 * Conor, 2026-10-28: "can we get more info for each account to see what their
 * actions are and more details about them if they've input it". A studio's
 * Console record now reads its profile, what it built, its business and its
 * people's actions (functions/src/console/studio-profile.ts), and says each
 * action in words.
 */

const read = (path: string) => readFileSync(path, "utf8");

test("every action the functions record reads as a sentence, in an area", () => {
  // Every literal audit action under functions/src.
  const actions = execSync(`grep -rhoE 'action: "[a-z_]+\\.[a-z_.]+"' functions/src --include='*.ts'`, { encoding: "utf8" })
    .split("\n")
    .map((line) => line.replace(/^action: "/, "").replace(/"$/, ""))
    .filter(Boolean);
  assert.ok(actions.length > 100, "found the action catalog");
  for (const action of new Set(actions)) {
    const { label, area } = describeAction(action);
    assert.ok(label.length > 3, action);
    assert.ok(ACTION_AREA_LABELS[area], `${action} has an area`);
    assert.doesNotMatch(label, /[._]/, `${action} reads as words: ${label}`);
  }
  assert.deepEqual(describeAction("proposal.created"), { label: "Sent a proposal", area: "booking" });
  assert.deepEqual(describeAction("package.created"), { label: "Created a package", area: "setup" });
  // Unknown codes still read, in the area their prefix names.
  assert.deepEqual(describeAction("invoice.something_new"), { label: "Invoice something new", area: "billing" });
});

test("areas count only the last 30 days, busiest first", () => {
  const since = "2026-10-01T00:00:00.000Z";
  const areas = actionAreas(
    [
      { action: "package.created", at: "2026-10-20T00:00:00.000Z" },
      { action: "package.updated", at: "2026-10-21T00:00:00.000Z" },
      { action: "proposal.created", at: "2026-10-22T00:00:00.000Z" },
      { action: "proposal.created", at: "2026-09-01T00:00:00.000Z" },
    ],
    since,
  );
  assert.deepEqual(areas, [
    { area: "setup", count: 2 },
    { area: "booking", count: 1 },
  ]);
});

test("Recent shows what the studio did, not the email worker", () => {
  assert.equal(isSystemNoise("communication.provider_accepted"), true);
  assert.equal(isSystemNoise("lifecycle.gallery_delivered"), false);
  const entries = buildTimeline({
    product: [
      { id: "p1", occurredAt: "2026-10-28T10:00:00.000Z", name: "communication.provider_accepted" },
      { id: "p2", occurredAt: "2026-10-28T11:00:00.000Z", name: "lifecycle.gallery_delivered" },
    ],
    audit: [{ id: "a1", timestamp: "2026-10-28T12:00:00.000Z", action: "package.created", actorType: "user" }],
  } as never);
  const titles = entries.map((entry: { title: string }) => entry.title);
  assert.ok(!titles.some((title: string) => /provider accepted/i.test(title)));
  assert.ok(titles.includes("Created a package"));
  assert.ok(titles.some((title: string) => /gallery delivered/i.test(title)));
});

test("the studio record reads the profile through a read-only Console handler", () => {
  const handlers = read("functions/src/console/handlers/studios.ts");
  const block = handlers.slice(handlers.indexOf("studioProfile: consoleHandler({"));
  assert.match(block.slice(0, 500), /capability: "console\.read"/);
  assert.match(block.slice(0, 500), /audit: null/);
  const loader = read("functions/src/console/studio-profile.ts");
  // Tenant-scoped, every query.
  for (const match of loader.matchAll(/byTenant\("([a-zA-Z]+)"\)/g)) assert.ok(match[1]);
  assert.doesNotMatch(loader, /db\.collection\("(?!x)[a-zA-Z]+"\)\.(get|where\("(?!tenantId))/);
  // Never client contact details or message bodies: it doesn't read those
  // collections at all.
  assert.doesNotMatch(loader, /byTenant\("(contacts|messages|conversations)"\)/);
  assert.doesNotMatch(loader, /get\("(body|phone|bodyPreview)"\)/);
  const record = read("components/console/pages/studio-record.tsx");
  assert.match(record, /<StudioProfilePanels tenantId=\{tenantId\} \/>/);
});

test("consultation hours read as days and times", async () => {
  const { hoursSummary } = await import("../components/console/studio-profile.tsx");
  assert.equal(
    hoursSummary([
      { day: "tue", startMinute: 540, endMinute: 1020 },
      { day: "mon", startMinute: 540, endMinute: 1020 },
      { day: "sat", startMinute: 600, endMinute: 840 },
    ]),
    "Mon, Tue 9am–5pm · Sat 10am–2pm",
  );
  assert.equal(hoursSummary([{ day: "wed", startMinute: 570, endMinute: 750 }]), "Wed 9:30am–12:30pm");
});
