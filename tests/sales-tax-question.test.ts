import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Gabe, 2026-10-05: StudioCue knew his QuickBooks charges sales tax, but the
 * choice sat pre-selected and unsaved on a settings page, so his invoices went
 * out with $0 tax. The question is now asked where the studio already is.
 */
const card = readFileSync("components/integrations/sales-tax-question.tsx", "utf8");

test("saving the answer keeps the studio's other billing setting as it was", () => {
  assert.match(card, /holdRetainerForReview: status\.settings\.holdRetainerForReview/);
  assert.match(card, /salesTax: \{ mode, estimateRateBasisPoints: mode === "quickbooks" \? rateBasisPoints : null \}/);
});

test("QuickBooks is read only after the two cheap checks: connected, and nothing saved", () => {
  const savedCheck = card.indexOf('if (salesTax && "mode" in salesTax) return;');
  const connectedCheck = card.indexOf('connection.get("status") !== "connected"');
  const read = card.indexOf("await readQuickBooksSetup(tenantId)");
  assert.ok(savedCheck > 0 && connectedCheck > savedCheck && read > connectedCheck, "checks come before the QuickBooks read");
  assert.match(card, /next\.connected && !next\.settingsSaved && next\.company && next\.company\.salesTax !== "off"/);
  assert.match(card, /const owner = workspace\.role === "studio_owner" \|\| workspace\.role === "studio_admin";/);
});

test("asked on the QuickBooks page, at the end of setup, and on Today", () => {
  assert.match(readFileSync("components/integrations/quickbooks-settings.tsx", "utf8"), /<SalesTaxDecision onSaved=\{\(\) => void load\(\)\} status=\{status\} tenantId=\{tenantId\} \/>/);
  assert.match(readFileSync("components/setup/setup-conversation.tsx", "utf8"), /<SalesTaxQuestion \/>/);
  assert.match(readFileSync("components/today/today-inbox.tsx", "utf8"), /\{!loading \? <SalesTaxQuestion \/> : null\}/);
});
