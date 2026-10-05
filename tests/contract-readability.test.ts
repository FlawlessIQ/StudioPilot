import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { boldLeadingLabel } from "@/features/contracts/document";
import { boldLeadingLabel as functionsBoldLeadingLabel } from "../functions/src/contracts/document";

/**
 * GR's agreement read as one long sentence in the couple's portal (Gabe,
 * 2026-10-05): the clauses were separate paragraphs, but the portal's margin
 * reset collapsed them, and their labels were plain text.
 */

test("a clause's own label is bold, in both copies", () => {
  for (const bold of [boldLeadingLabel, functionsBoldLeadingLabel]) {
    // GR's clauses, as stored in their agreement.
    assert.equal(
      bold("Booking Fee: An $1000 retainer, per crew member, is required."),
      "**Booking Fee:** An $1000 retainer, per crew member, is required.",
    );
    assert.equal(bold("Payment & Prices:  No images will be given."), "**Payment & Prices:** No images will be given.");
    assert.equal(bold("Limitation of Liability:  In the unlikely event"), "**Limitation of Liability:** In the unlikely event");
  }
});

test("ordinary sentences, times and studio bolding are left alone", () => {
  for (const text of [
    "It is mutually agreed that the following terms form part of this Contract.",
    "This agreement is between {{studio.legal_name}} and {{client.names}}.",
    "**Already bold:** the studio wrote it this way.",
    "Ceremony at 10:30 in the garden.",
    "Six words is too many for a label: so this stays.",
    "lowercase start: not a label",
  ]) {
    assert.equal(boldLeadingLabel(text), text, text);
  }
});

test("the agreement's spacing out-ranks the portal's margin reset", () => {
  // `.kit :where(h1, h2, h3, p, ul, ol, figure)` is one class of specificity
  // and loads after contracts.css. A rule that is one class too ties and
  // loses; each needs a `.contract-document` scoped selector.
  const css = readFileSync("app/contracts.css", "utf8");
  for (const name of ["contract-document-title", "contract-heading", "contract-subheading", "contract-paragraph", "contract-group-title", "contract-list"]) {
    assert.match(css, new RegExp(`\\.contract-document \\.${name}[\\s,{]`), `.${name} has no rule scoped above the kit reset`);
  }
  const kit = readFileSync("app/kit.css", "utf8");
  assert.match(kit, /\.kit :where\(h1, h2, h3, p, ul, ol, figure\)/, "the reset this guards against moved; re-check the agreement in the portal");
});
