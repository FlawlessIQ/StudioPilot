import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { STUDIO_ACTIONS } from "../functions/src/ai/action-catalog";
import { EXPLAINERS } from "../features/help/explainers";

/**
 * Own invoicing, Phase 6: the product stops saying QuickBooks is the only way
 * to bill. Swept by claim, not by directory (memory: copy-outlives-the-change)
 * — these sentences said a studio needed QuickBooks to invoice, and must not
 * come back anywhere a person reads them. "QuickBooks" itself stays wherever
 * the screen is about QuickBooks (Integrations, the held-invoice review,
 * imports from QuickBooks, autopay).
 */

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "node_modules" ? [] : walk(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

/** Lines a person can read: not comments. */
function readableLines(file: string): string[] {
  return read(file)
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line));
}

const RETIRED_CLAIMS: ReadonlyArray<[RegExp, string]> = [
  [/The retainer invoice goes through QuickBooks, so connect it first/, "help: deposits need QuickBooks"],
  [/QuickBooks stays the record for your books/, "help: QuickBooks is the books"],
  [/See retainer and final invoice status synced from QuickBooks/, "Invoices page header"],
  [/QuickBooks references/, "Invoices page eyebrow"],
  [/Final QuickBooks balance settled/, "closeout requirement"],
  [/Only with QuickBooks connected\. Otherwise, record the payment yourself/, "journey: deposit"],
  [/Raises the final invoice through QuickBooks, due/, "journey: final"],
  [/StudioCue prepares the arithmetic; QuickBooks remains authoritative/, "Invoices: final review"],
  [/Checking \$\{offer\}, signing, and QuickBooks records/, "booking page loading"],
  [/Connect payments so \$\{who\} can pay the/, "Today: connect-payments nudge"],
  [/takes the \$\{needs\.paidInFull \? "payment" : "deposit"\} directly — by check, cash or bank transfer/, "portal: arrange the deposit"],
];

test("no screen, email or guide says a studio needs QuickBooks to bill", () => {
  const files = [...walk("components"), ...walk("features"), ...walk("app"), ...walk("lib"), "functions/src/communications/email-templates.ts"];
  const found: string[] = [];
  for (const file of files) {
    const lines = readableLines(file).join("\n");
    for (const [claim, where] of RETIRED_CLAIMS) if (claim.test(lines)) found.push(`${file}: ${where}`);
  }
  assert.deepEqual(found, []);
});

test("help explains billing yourself, on the page where it's set up", () => {
  const guide = EXPLAINERS.find((explainer) => explainer.id === "invoices-and-payments");
  assert.ok(guide, "a guide for Invoices and payments");
  assert.deepEqual(guide.routes, ["/studio/settings/invoices"]);
});

test("Cue can choose how a job is billed and send the studio's own invoice", () => {
  const ids = new Set(STUDIO_ACTIONS.map((action) => action.id));
  for (const id of ["send_invoice", "choose_job_billing", "send_final_balance"]) assert.ok(ids.has(id), id);
  assert.match(STUDIO_ACTIONS.find((action) => action.id === "send_final_balance")!.when, /studio's own invoice/);
  const registry = read("components/ai/actions/prepared-actions.tsx");
  assert.match(registry, /send_invoice: SendStudioInvoiceCard/);
  assert.match(registry, /choose_job_billing: ChooseJobBillingCard/);
  // Deleting records is never something Cue prepares.
  assert.ok(!ids.has("delete_invoice"));
});

test("setup asks how clients pay, until it's answered", () => {
  const setup = read("components/setup/setup-conversation.tsx");
  assert.match(setup, /<PaymentDetailsQuestion \/>/);
  const question = read("components/setup/payment-details-question.tsx");
  assert.match(question, /How do clients pay you\?/);
  assert.match(question, /if \(studioInvoicePaymentReady\(stored\) && !saved\) return null;/);
  // Saving keeps the rest of the invoice settings as they were.
  assert.match(question, /\.\.\.stored,\s*paymentInstructions:/);
});
