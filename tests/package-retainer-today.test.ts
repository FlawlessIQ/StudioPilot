import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { packagesCountingNobody } from "@/features/packages/retainer-check";
import { todayInbox } from "@/features/today/inbox";

/**
 * A per-crew retainer that counts no one (GR's Gold Cinematic: two
 * videographers, "$1,000 per photographer") asked every couple for one
 * person's retainer, and only the Library row said so. Today and the
 * proposal now name it (2026-10-16).
 */
const gold = {
  id: "pkg-gold",
  name: "Gold Cinematic Package",
  active: true,
  includedCoverage: [{ role: "videographer", count: 2 }],
  retainerRule: { type: "per_crew_member", amountPerCrewCents: 100_000, billedRoles: ["photographer"] },
};
const fine = { ...gold, id: "pkg-photo", name: "Gold Photo Package", includedCoverage: [{ role: "photographer", count: 2 }] };

test("only a live catalogue package whose rule counts no one is named", () => {
  const found = packagesCountingNobody([gold, fine, { ...gold, id: "old", archivedAt: "2026-01-01" }, { ...gold, id: "off", active: false }]);
  assert.deepEqual(found.map((item) => item.id), ["pkg-gold"]);
  assert.match(found[0]!.problem, /no photographers — only videographers/);
});

test("Today asks the owner to fix it, in the trade's word", () => {
  const inbox = todayInbox({ now: "2026-10-16T12:00:00.000Z", tenantTrade: "photographer", packages: [gold, fine] } as never) as unknown as {
    act: Array<{ id: string; title: string; action: { kind: string; label?: string; href?: string } }>;
  };
  const card = inbox.act.find((item) => item.id === "package-retainer-pkg-gold");
  assert.ok(card);
  assert.equal(card.title, "Gold Cinematic Package asks for the wrong retainer");
  assert.equal(card.action.href, "/studio/packages/pkg-gold");
  assert.ok(!inbox.act.some((item) => item.id === "package-retainer-pkg-photo"));
});

test("the proposal says so on the package's own line", () => {
  assert.match(readFileSync("components/proposals/proposal-packages-panel.tsx", "utf8"), /packagesCountingNobody\(/);
  assert.match(readFileSync("components/today/use-today-inbox.ts", "utf8"), /useTenantDocuments\("packages", \{ enabled: ownerOperations \}\)/);
});
