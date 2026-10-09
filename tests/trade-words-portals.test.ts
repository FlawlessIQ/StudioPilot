import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { portalEmptyNotice, type PortalEmptyArea } from "@/features/client/portal-day";
import { portalPastNotice, type PortalArea } from "@/features/client/portal-stage";
import { clientAreaItems } from "@/features/client/portal-navigation";
import { tradeProfile, tradeVocab } from "@/features/trades/trades";
import type { ClientNavigation } from "@/server/client/portal-experience";

/**
 * Photographer words out of what a DJ's, a makeup artist's and a hair
 * stylist's clients and crew read: the client portal, the crew portal and
 * the public client pages (the couple's inquiry link, the scheduling page,
 * invitations, the shared run of show).
 *
 * A photographer's words stay exactly as they were; a vendor's come from
 * features/trades. The pure pieces are called for every trade; the screens
 * are read as source, because they render inside the workspace.
 */

const read = (path: string) => readFileSync(path, "utf8");
const VENDORS = ["dj", "makeup", "hair"] as const;
const PHOTO_WORDS =
  /\b(photos?|photograph\w*|galler(?:y|ies)|shoots?|shooting|shot lists?|albums?|coverage|deliverables?|second shooters?|sneak peeks?|editing|edited)\b/i;
const EMPTY_AREAS: PortalEmptyArea[] = ["payments", "documents", "delivery", "reviews"];
const PAST_AREAS: PortalArea[] = ["proposal", "contract", "questionnaire", "schedule", "delivery", "reviews"];

test("a photographer's empty portal pages read as before", () => {
  for (const trade of [undefined, "photographer"]) {
    assert.match(portalEmptyNotice("documents", false, trade).detail, /schedule and gallery link are kept here/);
    assert.equal(portalEmptyNotice("delivery", false, trade).title, "Your photos will be here after the day");
    assert.match(portalEmptyNotice("delivery", true, trade).title, /being worked on/);
    assert.equal(
      portalEmptyNotice("reviews", true, trade).detail,
      "Once your photos are delivered, your studio may invite you to share your experience here.",
    );
  }
});

test("a vendor's client is never told about photos or a gallery on an empty page", () => {
  for (const trade of VENDORS) {
    for (const area of EMPTY_AREAS) {
      for (const passed of [false, true]) {
        const notice = portalEmptyNotice(area, passed, trade);
        assert.doesNotMatch(`${notice.title} ${notice.detail}`, PHOTO_WORDS, `${trade} ${area} passed=${passed}`);
      }
    }
    // Still one sentence per page, and the day still changes it (tests/portal-day.test.ts).
    for (const passed of [false, true]) {
      const details = EMPTY_AREAS.map((area) => portalEmptyNotice(area, passed, trade).detail);
      const titles = EMPTY_AREAS.map((area) => portalEmptyNotice(area, passed, trade).title);
      assert.equal(new Set(details).size, EMPTY_AREAS.length, `${trade} details passed=${passed}`);
      assert.equal(new Set(titles).size, EMPTY_AREAS.length, `${trade} titles passed=${passed}`);
    }
    for (const area of EMPTY_AREAS)
      assert.notEqual(portalEmptyNotice(area, false, trade).detail, portalEmptyNotice(area, true, trade).detail);
  }
});

test("a past moment names the studio's own offer, and a vendor's delivery has no photos", () => {
  assert.equal(portalPastNotice("proposal").title, "No proposal is held here");
  assert.equal(portalPastNotice("proposal", "photographer").title, "No proposal is held here");
  assert.equal(portalPastNotice("proposal", "dj").title, "No proposal is held here");
  assert.equal(portalPastNotice("proposal", "makeup").title, "No quote is held here");
  assert.equal(portalPastNotice("proposal", "hair").title, "No quote is held here");
  assert.match(portalPastNotice("delivery").detail, /Your photos were shared another way/);
  for (const trade of VENDORS)
    for (const area of PAST_AREAS) {
      const notice = portalPastNotice(area, trade);
      assert.doesNotMatch(`${notice.title} ${notice.detail}`, PHOTO_WORDS, `${trade} ${area}`);
      assert.doesNotMatch(notice.detail, /will appear|still preparing|may appear/, `${trade} ${area}`);
    }
});

test("only a studio that delivers puts photos and film in the client's plan", () => {
  // The server reports delivery from the job's state alone: a DJ's client at
  // "review requested" is past the delivery index.
  const nav: ClientNavigation = {
    proposal: true,
    package: false,
    contract: true,
    payments: true,
    questionnaire: true,
    schedule: true,
    files: false,
    delivery: true,
    reviews: true,
  };
  for (const trade of [undefined, "photographer"]) {
    const items = clientAreaItems(nav, tradeVocab(trade).proposal, tradeProfile(trade).delivery);
    assert.ok(items.some((item) => item.label === "Your photos and film"), String(trade));
    assert.ok(items.some((item) => item.label === "Your proposal"), String(trade));
  }
  assert.ok(clientAreaItems(nav).some((item) => item.href === "/client/delivery"), "the default still delivers");
  for (const trade of VENDORS) {
    const items = clientAreaItems(nav, tradeVocab(trade).proposal, tradeProfile(trade).delivery);
    assert.ok(!items.some((item) => item.href === "/client/delivery"), trade);
    assert.ok(items.some((item) => item.href === "/client/reviews"), trade);
    for (const item of items) assert.doesNotMatch(item.label, PHOTO_WORDS, `${trade} ${item.label}`);
  }
  assert.ok(
    clientAreaItems(nav, tradeVocab("makeup").proposal, false).some((item) => item.label === "Your quote"),
  );
  const plan = read("components/client/kit/client-plan.tsx");
  assert.match(plan, /tradeProfile\(workspace\.tenantTrade\)\.delivery,/);
});

test("the client portal's screens take the studio's trade", () => {
  // Empty states pass the trade to the notices above.
  const empty = read("components/client/kit/empty-moment.tsx");
  assert.match(empty, /portalPastNotice\(area as PortalArea, trade\)/);
  assert.match(empty, /portalEmptyNotice\(area as PortalEmptyArea, true, trade\)/);
  // A makeup artist's client accepts a quote, and is sent an updated quote.
  const proposal = read("components/client/kit/client-proposal.tsx");
  assert.match(proposal, /`\$\{offerWord\} accepted!`/);
  assert.match(proposal, /\{offerWord\}\{" "\}unavailable/);
  assert.doesNotMatch(proposal, /"Proposal accepted!"|> Proposal unavailable/);
  assert.match(proposal, /proposalErrorMessage\(code, offer\)/);
  const views = read("components/client/live-client-views.tsx");
  assert.match(views, /offer = "proposal",/);
  assert.match(views, /`This \$\{offer\} has expired\. Message your studio for an updated version\.`/);
  const addPackage = read("components/client/kit/client-add-package.tsx");
  assert.doesNotMatch(addPackage, /updated proposal/);
  assert.match(addPackage, /const offer = tradeVocab\(workspace\.tenantTrade\)\.proposal\.toLowerCase\(\);/);
  assert.match(read("components/client/kit/client-package.tsx"), /your studio prepares your \$\{tradeVocab\(workspace\.tenantTrade\)\.proposal\.toLowerCase\(\)\} from it/);
  // Who leads on the day is drawn as their trade, and nothing is "delivered" after a DJ's night.
  const event = read("components/client/kit/client-event.tsx");
  assert.match(event, /photographer: Camera, dj: Music, makeup: Brush, hair: Scissors/);
  assert.match(event, /"Ask your studio who covered your day"\s*: "Ask your studio who was with you on the day"/);
  assert.match(event, /Your agreement, payments and timeline stay in Files\./);
});

test("the crew portal and the crew directory say what a vendor's crew do", () => {
  // trade-field.tsx: "Shoots" only for a photographer's crew.
  const field = read("components/crew/trade-field.tsx");
  assert.match(field, /const shoots = profile\.family === "photo";/);
  assert.match(field, /\{shoots \? "Shoots" : "Works as"\}/);
  const create = read("components/crew/create-crew-profile-form.tsx");
  assert.match(create, /"The kind of event they shoot\. What they hold is Shoots, below\."/);
  assert.match(create, /`The kind of event they \$\{tradeVocab\(trade\)\.verb\}\. Their role goes under Works as, below\.`/);
  const edit = read("components/crew/crew-record-actions.tsx");
  assert.match(edit, /photo \? "Second shooter, lighting" : "Parties, corporate events"/);
  assert.match(edit, /`The kind of event they \$\{tradeVocab\(trade\)\.verb\}\.`/);
  const me = read("components/crew/kit/crew-me.tsx");
  assert.match(me, /family === "photo" \? "You shoot" : "You work as"/);
  assert.match(me, /`The kind of event you \$\{tradeVocab\(workspace\.tenantTrade\)\.verb\}, like parties or corporate events\.`/);
  assert.match(read("components/crew/client-brief.tsx"), /"Read before you shoot" : "Read before you start"/);
  assert.match(read("components/crew/kit/crew-job.tsx"), /You never see the client’s contract or invoices\./);
  const plan = read("components/crew/crew-cascade-workspace.tsx");
  assert.match(plan, /Built from the package’s \{coverage\}\{" "\}when the job booked/);
  assert.match(plan, /Change the \{coverage\}\{" "\}on the package/);
  assert.match(plan, /coverageRoles\.includes\("videographer"\) \? \(\s*<option value="video">Video<\/option>/);
  // The words each trade's crew read.
  for (const trade of VENDORS) {
    const words = tradeVocab(trade);
    assert.doesNotMatch(`The kind of event they ${words.verb}.`, PHOTO_WORDS, trade);
    assert.doesNotMatch(`Change the ${words.coverage.toLowerCase()} on the package`, PHOTO_WORDS, trade);
  }
  assert.equal(tradeVocab("photographer").coverage.toLowerCase(), "coverage");
});

test("the public pages name the studio's call and offer, or nothing", () => {
  const couple = read("components/inquiries/couple-inquiry-page.tsx");
  assert.match(couple, /const tradeWords = tradeVocab\(preview\?\.trade\);/);
  assert.match(couple, /heading: `your \$\{offer\} is ready`/);
  assert.match(couple, /will send your \$\{offer\} by email/);
  assert.match(couple, /: `Your \$\{callName\}`;/);
  // Before the preview loads nobody knows the trade: the studio, not "your photographer".
  assert.match(couple, /const studio = preview\?\.studioName \?\? "your studio";/);
  assert.match(couple, /name: preview\?\.studioName \?\? "Your studio",/);
  // What those read, per trade: a DJ's vibe call, a makeup artist's quote.
  assert.equal(tradeVocab("dj").consultation.toLowerCase(), "vibe call");
  assert.equal(tradeVocab(undefined).consultation.toLowerCase(), "consultation");
  for (const trade of ["makeup", "hair"]) {
    assert.equal(tradeVocab(trade).proposal.toLowerCase(), "quote", trade);
    // No call to book: the server's offersConsultation is false for them.
    assert.equal(tradeProfile(trade).consultation, false, trade);
  }
  const scheduler = read("components/booking/public-consultation-scheduler.tsx");
  assert.match(scheduler, /name: preview\?\.studioName \?\? "Your studio",/);
  assert.match(scheduler, /preview\.callName \?\? \(finalCall \? "Final details call" : "Consultation"\)/);
  assert.match(scheduler, /const chooseTime = callWord \? `Choose a \$\{callWord\} time` : "Choose a time";/);
  assert.doesNotMatch(read("app/i/[token]/page.tsx"), /photographer|pick a time to talk/);
  assert.doesNotMatch(read("app/schedule/consultation/page.tsx"), /description: ".*photography/);
  assert.doesNotMatch(read("app/auth/client-invite/page.tsx"), /description: ".*photography/);
  assert.doesNotMatch(read("app/auth/crew-invite/page.tsx"), /description: ".*photography/);
  assert.match(read("app/inquiry/page.tsx"), /title: "Inquiry",/);
  assert.match(read("app/share/[token]/page.tsx"), /&rsquo;s \{service\}\{" "\}plan/);
  assert.equal(tradeVocab("dj").service, "music");
  assert.match(
    read("app/api/auth/pending-invitations/route.ts"),
    /\? "A photography studio"\s*: `A \$\{tradeVocab\(tenants\[index\]\?\.get\("trade"\)\)\.business\}`/,
  );
  const invitation = read("features/auth/accept-client-invitation.tsx");
  assert.match(invitation, /"Your proposal, agreement, plans and photos, in one place\."/);
  assert.match(invitation, /`Your \$\{tradeVocab\(trade\)\.proposal\.toLowerCase\(\)\}, agreement and plans, in one place\.`/);
});

test("what the portal route writes back to a vendor studio is in its words", () => {
  const route = read("app/api/client/portal/route.ts");
  assert.match(route, /async function studioTrade\(tenantId: string\): Promise<Trade>/);
  assert.match(route, /photo \? "Prepare and send the photography agreement" : "Prepare and send the agreement"/);
  assert.match(route, /photo \? "Client photography project" : "Client project"/);
  assert.match(route, /nextAction: `Prepare \$\{offer\}`,/);
  assert.match(route, /`Approve it on Today and they get a revised \$\{offer\} to accept\.`/);
  assert.match(route, /`Review requested \$\{offer\} changes`/);
  assert.match(route, /"Photography package" : "Package"/);
});
