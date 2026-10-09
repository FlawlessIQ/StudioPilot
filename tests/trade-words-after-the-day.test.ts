import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { TRADES, tradeMoves, tradeProfile, tradeVocab } from "@/features/trades/trades";

/**
 * Group F of the trade-words sweep (2026-10-09): after the day.
 *
 * Only a photographer delivers anything after the day (trades.ts), so the
 * delivery page, the post-production checklist, the release form and the
 * client's "your photos" page are photographer-only — and a DJ, makeup artist
 * or hair stylist who reaches one by a typed URL, an old link or a Cue card
 * gets a plain "nothing to deliver" instead. Reviews and closing apply to
 * everyone, so they read in the studio's own terms. A photographer's screens
 * read exactly as before.
 *
 * The screens read the trade from the workspace, which a test cannot set, so
 * most of this reads the source: what renders for whom, and what each
 * vendor-only branch says.
 */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const PHOTO_WORDS =
  /\b(photos?|photograph(?:s|y|ers?|ing)?|galler(?:y|ies)|shoots?|shooting|shot lists?|albums?|coverage|deliverables?|second shooters?|sneak peeks?|images?|editing|retouching|post-production|cards)\b/i;

/**
 * What a person can read in the source between two markers: string literals,
 * template text and JSX text, never comments or identifiers.
 */
function visibleText(path: string, from: string, to?: string): string {
  const source = read(path);
  const start = source.indexOf(from);
  assert.notEqual(start, -1, `${path}: ${from}`);
  const end = to ? source.indexOf(to, start + from.length) : source.length;
  assert.notEqual(end, -1, `${path}: ${to}`);
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const parts: string[] = [];
  const visit = (node: ts.Node) => {
    if (node.getStart(file) >= start && node.getEnd() <= end) {
      if (ts.isImportDeclaration(node)) return;
      if (ts.isJsxAttribute(node) && ["className", "href", "key"].includes(node.name.getText(file))) return;
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) parts.push(node.text);
      else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) parts.push(node.text);
      else if (ts.isJsxText(node)) parts.push(node.getText(file));
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return parts.join(" ");
}

/** `inner` sits inside the `open`…`close` block of `path`. */
function inside(path: string, open: string, inner: string, close: string) {
  const source = read(path);
  const at = source.indexOf(open);
  const within = source.indexOf(inner, at);
  const shut = source.indexOf(close, at);
  assert.ok(at !== -1 && within !== -1 && shut !== -1, `${path}: ${open} / ${inner} / ${close}`);
  assert.ok(at < within && within < shut, `${path}: "${inner}" is outside ${open}`);
}

test("only a photographer delivers, and every other trade closes from the day", () => {
  for (const trade of TRADES) {
    const delivers = trade === "photographer";
    assert.equal(tradeProfile(trade).delivery, delivers, trade);
    // The no-delivery closeout offers the close the state machine allows.
    assert.equal(tradeMoves(trade, "EVENT_COMPLETE").includes("CLOSED"), !delivers, trade);
    // The "nothing to deliver" panel's eyebrow.
    assert.equal(tradeVocab(trade).afterPhase, delivers ? "Delivery" : "Afterwards", trade);
  }
  assert.equal(tradeProfile(undefined).delivery, true, "a studio from before trades still delivers");
});

test("the gate renders its children only for a studio that delivers", () => {
  const gate = read("components/post-event/nothing-delivered.tsx");
  assert.match(gate, /return tradeProfile\(useWorkspace\(\)\.tenantTrade\)\.delivery;/);
  assert.match(gate, /if \(delivers\) return <>\{children\}<\/>;/);
  assert.doesNotMatch(visibleText("components/post-event/nothing-delivered.tsx", '"use client"'), PHOTO_WORDS);
});

test("the delivery and post-production pages are a photographer's, whole", () => {
  for (const words of ["Gallery handoff", "Send photos or a film", "Delivery records", "<DeliveryCloseoutWorkspace"]) {
    inside("app/studio/delivery/page.tsx", "<DeliveryOnly page projectId={project}>", words, "</DeliveryOnly>");
  }
  for (const words of ['title="Post-production"', "<PostProductionChecklist"]) {
    inside("app/studio/post-production/page.tsx", "<DeliveryOnly page projectId={project}>", words, "</DeliveryOnly>");
  }
  assert.match(
    read("app/studio/post-production/[id]/page.tsx"),
    /<DeliveryOnly><LiveRecordDetail id=\{id\} kind="post-production"\/><\/DeliveryOnly>/,
  );
  // Photographer copy unchanged.
  assert.match(read("app/studio/delivery/page.tsx"), /The one\s+step StudioCue requires/);
});

test("Cue's delivery cards mount the gated form and checklist, not the bare ones", () => {
  const form = read("components/post-event/delivery-form.tsx");
  assert.match(
    form,
    /export function DeliveryForm\(\{ projectId \}: \{ projectId\?: string \}\) \{\s*return \(\s*<DeliveryOnly projectId=\{projectId\}>\s*<DeliveryReleaseForm projectId=\{projectId\} \/>/,
  );
  const checklist = read("components/post-event/post-production-checklist.tsx");
  assert.match(checklist, /<DeliveryOnly projectId=\{projectId\}>\s*<PostProductionSteps onChanged=\{onChanged\} projectId=\{projectId\} \/>/);
});

test("a vendor's job never runs the photographer's closeout reconciler", () => {
  const path = "components/post-event/delivery-closeout-workspace.tsx";
  const panel = read(path);
  // The reconcile-on-arrival stops before it sends anything.
  const effect = panel.slice(panel.indexOf("useEffect(() => {"), panel.indexOf('sendPostEventCommand("prepareCloseout"'));
  assert.match(effect, /if \(!delivers\) return;/);
  // And the panel answers before the album and the gallery are mentioned.
  const early = panel.indexOf("if (!delivers) return <NothingDeliveredCloseout projectId={projectId} />;");
  assert.notEqual(early, -1);
  assert.ok(early < panel.indexOf("Album milestones"));
  assert.ok(early < panel.indexOf("The agreement, balance, gallery, album, review ask, crew and insurance all check out."));
  // It closes the way the job page does, and asks the reconciler nothing.
  const vendor = panel.slice(panel.indexOf("function NothingDeliveredCloseout"));
  assert.doesNotMatch(vendor, /sendPostEventCommand|prepareCloseout|closeProject|<InfoHint term="closeout"/);
  assert.match(vendor, /runCrmCommand\("transitionProject", \{[\s\S]*?targetState: "CLOSED"/);
  assert.match(vendor, /onClick=\{\(\) => setConfirming\(true\)\}/);
  const words = visibleText(path, "function NothingDeliveredCloseout");
  assert.doesNotMatch(words, PHOTO_WORDS);
  assert.doesNotMatch(words, /\b(couples?|weddings?)\b/i);
  // A photographer's closeout is untouched.
  assert.match(panel, /Closing stops anything still due to the couple/);
  assert.match(panel, /<InfoHint term="closeout" \/>/);
});

test("a vendor's client is never promised photos", () => {
  const delivery = "components/client/kit/client-delivery.tsx";
  const source = read(delivery);
  const vendorBranch = "if (!deliverables.length && !album && !tradeProfile(workspace.tenantTrade).delivery)";
  assert.ok(source.indexOf(vendorBranch) !== -1);
  assert.ok(source.indexOf(vendorBranch) < source.indexOf('<Main label="Your photos">'));
  assert.doesNotMatch(visibleText(delivery, vendorBranch, "if (!deliverables.length && !album)\n"), PHOTO_WORDS);
  // A photographer's couple still waits on their photos.
  assert.match(source, /upcoming="Your photos \(and film, if it’s part of your package\) will be here the moment they’re ready\. You’ll get an email too\."/);

  const reviews = "components/client/kit/client-reviews.tsx";
  const page = read(reviews);
  const gate = "tradeProfile(workspace.tenantTrade).delivery || reviews.loading || reviews.error ?";
  assert.ok(page.indexOf(gate) !== -1);
  assert.ok(page.indexOf(gate) < page.indexOf('upcoming="Nothing to do here yet. Enjoy your photos."'));
  const vendor = visibleText(reviews, 'upcoming="Nothing to do here yet. Enjoy your photos."', "<PoweredBy />");
  assert.doesNotMatch(vendor.replace("Nothing to do here yet. Enjoy your photos.", ""), PHOTO_WORDS);
});

test("review requests describe what a vendor's asks follow: the day, not a delivery", () => {
  const path = "components/reviews/studio-reviews-page.tsx";
  const page = read(path);
  assert.match(page, /delivers\s*\?\s*"Delivery-linked requests that stop only after explicit client or studio confirmation\."/);
  const vendor = page.slice(page.indexOf('"Delivery-linked'), page.indexOf("projectId={projectId}"));
  assert.match(vendor, /: "Requests after the day that stop only after explicit client or studio confirmation\."/);
  assert.doesNotMatch(vendor.replace(/"Delivery-linked[^"]*"/, ""), /deliver/i);
  assert.match(read("app/studio/reviews/page.tsx"), /<StudioReviewsPage projectId=\{project\} \/>/);
});
