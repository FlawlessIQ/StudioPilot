import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { undatedPaymentDue } from "@/features/contracts/document";
import { teamEmailWarning } from "@/lib/crm/command-client";

/**
 * Seven small things the production walk of contract signing turned up
 * (2026-09-25). Each is small; each would have been noticed by a studio or a
 * couple before we did.
 */

test("an undated payment reads the same on the proposal, its PDF and the contract", () => {
  assert.equal(undatedPaymentDue("Retainer"), "On signing");
  assert.equal(undatedPaymentDue("Booking fee"), "On signing");
  assert.equal(undatedPaymentDue("Deposit"), "On signing");
  assert.equal(undatedPaymentDue("Final balance"), "As agreed");
  const proposalPage = readFileSync("components/proposals/studio-proposal-workspace.tsx", "utf8");
  assert.match(proposalPage, /undatedPaymentDue\(text\(payment\.label\)\)/);
  const pdf = readFileSync("cloud-run/pdf/main.py", "utf8");
  assert.match(pdf, /item\.due_date or undated_payment_due\(item\.label\)/);
});

test("nothing tells a studio a signing vendor's agreement is authoritative", () => {
  for (const file of [
    "components/proposals/studio-proposal-workspace.tsx",
    "components/proposals/live-proposal-preview.tsx",
    "cloud-run/pdf/main.py",
  ]) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /signature-provider agreement/, file);
    assert.doesNotMatch(source, /completed Docusign agreement/, file);
  }
});

test("an imported agreement is titled with its own name, never the starter's", () => {
  const editor = readFileSync("components/contracts/agreement-editor.tsx", "utf8");
  assert.match(editor, /setTitle\(draft\.title \?\? draft\.name\)/);
});

test("the studio's signature is not pre-filled with the studio's name", () => {
  const step = readFileSync("components/contracts/native-contract-step.tsx", "utf8");
  assert.match(step, /looksLikeAPerson/);
  assert.match(step, /workspace\.tenantName\.trim\(\)\.toLowerCase\(\)/);
});

test("a prepared contract is never labelled 'Not created'", () => {
  const workspace = readFileSync("components/booking/project-booking-workspace.tsx", "utf8");
  const badge = workspace.slice(workspace.indexOf("? nativeActive"), workspace.indexOf('"Not created"\n'));
  assert.match(badge, /"Not sent yet"/);
});

test("a client's name keeps its own line on a phone", () => {
  const css = readFileSync("app/globals.css", "utf8");
  assert.match(css, /\.ds-root \.ds-people-copy \{\s*flex: 1 1 calc\(100% - 52px\);/);
  assert.doesNotMatch(css, /\.ds-root \.ds-people-copy \{\s*flex: 1 1 0;/);
});

test("a client given a team or crew member's email is told at the save", () => {
  assert.match(teamEmailWarning({ emailBelongsToTeamRole: "subcontractor" }) ?? "", /one of your crew/);
  assert.match(teamEmailWarning({ emailBelongsToTeamRole: "studio_owner" }) ?? "", /studio owner/);
  assert.equal(teamEmailWarning({}), null);
  const commands = readFileSync("functions/src/crm/commands.ts", "utf8");
  assert.match(commands, /teamRoleForEmail\(db, command\.tenantId, inputEmail\)/);
  for (const form of [
    "components/clients/client-record-actions.tsx",
    "components/crm/create-contact-form.tsx",
    "components/crm/create-project-form.tsx",
  ]) {
    assert.match(readFileSync(form, "utf8"), /teamEmailWarning\(/, form);
  }
});
