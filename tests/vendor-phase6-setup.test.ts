import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  askedSetupGaps,
  nextSetupStep,
  SETUP_ORDER,
  setupComplete,
  setupGaps,
  setupOrderFor,
  setupQuestionCount,
  type SetupGapKey,
  type SetupSignals,
  type SetupState,
} from "@/features/today/setup-gaps";
import { todayInbox } from "@/features/today/inbox";
import { studioTakesBookings, withInquiryLink } from "../functions/src/intake/inquiry-link";

/**
 * Simpler vendor journeys, Phase 6 (2026-10-09): a vendor studio sets up in
 * four questions, and its inquiry link doesn't wait for hours.
 *
 * A DJ, makeup artist or hair stylist is asked what she charges, when clients
 * can book her (a call, or a trial), how inquiries reach her and how clients
 * sign. The other three — what she does, her forms, insurance — are never
 * asked, never counted, never block a job and never reach Today. A makeup
 * artist's or hair stylist's link is for details and the quote, so it goes
 * out whether or not she has set hours. A photographer moves not at all.
 */

const read = (path: string) => readFileSync(path, "utf8");
const VENDORS = ["dj", "makeup", "hair"] as const;
const NOT_ASKED_OF_VENDORS: readonly SetupGapKey[] = ["work", "questionnaire", "insurance"];

/** A studio that has answered nothing, with every optional question open. */
const nothing: SetupState = {
  hasActivePackage: false,
  hasAgreementTemplate: false,
  hasQuestionnaireTemplate: false,
  hasConsultationAvailability: false,
  hasInquiryCapture: false,
  hasCoiSettings: false,
  hasChosenWork: false,
};
/** Work waiting on every gap there is. */
const busy: SetupSignals = {
  projectsNeedingPackage: ["Brooks"],
  projectsNeedingAgreement: ["Reyes"],
  projectsNeedingForm: ["Lane"],
  openInquiries: 3,
};
const quiet: SetupSignals = { projectsNeedingPackage: [], projectsNeedingAgreement: [], projectsNeedingForm: [], openInquiries: 0 };
/** The four a vendor answers: prices, hours, inquiries, signing. */
const fourAnswered: SetupState = {
  ...nothing,
  hasActivePackage: true,
  hasConsultationAvailability: true,
  hasInquiryCapture: true,
  hasAgreementTemplate: true,
};

const asked = (state: SetupState, signals: SetupSignals, trade?: string) =>
  askedSetupGaps(setupGaps(state, signals, trade), trade);

test("a vendor is asked four questions, in her order", () => {
  for (const trade of VENDORS) {
    assert.deepEqual(setupOrderFor(trade), ["packages", "availability", "inquiries", "agreement"], trade);
    assert.equal(setupQuestionCount(trade), "four", trade);
    const keys = asked(nothing, quiet, trade).map((gap) => gap.key);
    assert.deepEqual([...keys].sort(), ["agreement", "availability", "inquiries", "packages"], trade);
  }
});

test("what a vendor isn't asked never blocks, never nags, and is never 'Next'", () => {
  // The engine still describes every gap; the asked ones are what screens read.
  const everything = (trade: string) =>
    setupGaps({ ...nothing, hasQuestionnaireTemplate: false, hasDecidedInquiryForm: false }, busy, trade);
  // The same studio as a photographer: a booked job without a form blocks.
  const photo = todayInbox({ now: "2026-10-09T12:00:00.000Z", setupGaps: askedSetupGaps(everything("photographer")), journeys: [] });
  assert.ok(photo.act.some((item) => item.id === "setup-questionnaire"));
  for (const trade of VENDORS) {
    // Described by the engine, blocking and all…
    for (const key of NOT_ASKED_OF_VENDORS) assert.ok(everything(trade).some((gap) => gap.key === key), `${trade}: ${key}`);
    assert.ok(everything(trade).some((gap) => gap.key === "questionnaire" && gap.blocking), trade);
    // …and asked of nobody.
    const gaps = askedSetupGaps(everything(trade), trade);
    for (const key of NOT_ASKED_OF_VENDORS)
      assert.ok(!gaps.some((gap) => gap.key === key), `${trade}: ${key} reached a screen`);

    // Today's "Next:" walks her order, never a question she isn't asked.
    const order = setupOrderFor(trade);
    let open = gaps;
    while (open.length) {
      const next = nextSetupStep(open, trade);
      assert.ok(next && order.includes(next), `${trade}: next was ${next}`);
      open = open.filter((gap) => gap.key !== next);
    }
    // Even handed the photographer's gaps, Next stays inside her order.
    for (const key of NOT_ASKED_OF_VENDORS)
      assert.equal(nextSetupStep([{ key }], trade), null, `${trade}: Next pointed at ${key}`);

    // Today's act lane: a booked job missing its form is not her setup's problem.
    const inbox = todayInbox({ now: "2026-10-09T12:00:00.000Z", setupGaps: gaps, journeys: [], tenantTrade: trade });
    const ids = inbox.act.map((item) => item.id);
    for (const key of NOT_ASKED_OF_VENDORS) assert.ok(!ids.includes(`setup-${key}`), `${trade}: Today showed setup-${key}`);
  }
});

test("a new hair studio is ready to quote after four answers", () => {
  for (const trade of ["hair", "makeup", "dj"]) {
    // No forms, no insurance, nothing said about what she does: still done.
    const gaps = asked(fourAnswered, quiet, trade);
    assert.deepEqual(gaps, [], trade);
    assert.equal(setupComplete(fourAnswered, trade), true, trade);
    assert.equal(nextSetupStep(gaps, trade), null, trade);
    const order = setupOrderFor(trade);
    assert.equal(order.filter((key) => !gaps.some((gap) => gap.key === key)).length, order.length);
  }
  // Each of the four still counts.
  for (const missing of ["hasActivePackage", "hasConsultationAvailability", "hasAgreementTemplate"] as const)
    assert.equal(setupComplete({ ...fourAnswered, [missing]: false }, "hair"), false, missing);
  assert.equal(setupComplete({ ...fourAnswered, hasInquiryCapture: false }, "hair"), false);
});

test("a makeup artist's or hair stylist's missing trial hours never block an inquiry; a call still does", () => {
  for (const trade of ["makeup", "hair"]) {
    const hours = asked(nothing, busy, trade).find((gap) => gap.key === "availability");
    assert.equal(hours?.title, "Set your trial hours");
    assert.equal(hours?.blocking, false, trade);
    assert.doesNotMatch(hours?.detail ?? "", /waiting|link/, trade);
  }
  for (const trade of [undefined, "photographer", "dj"]) {
    const hours = asked(nothing, busy, trade).find((gap) => gap.key === "availability");
    assert.equal(hours?.blocking, true, String(trade));
    assert.match(hours?.detail ?? "", /3 inquiries are waiting/);
  }
});

test("a photographer's setup does not move", () => {
  assert.deepEqual(SETUP_ORDER, ["work", "inquiries", "availability", "packages", "agreement", "questionnaire", "insurance"]);
  for (const trade of [undefined, "photographer", "nonsense"]) {
    assert.equal(setupOrderFor(trade), SETUP_ORDER);
    assert.equal(setupQuestionCount(trade), "seven");
    // Every gap passes through, in the engine's own order.
    for (const signals of [quiet, busy]) {
      const all = setupGaps({ ...nothing, hasDecidedInquiryForm: false }, signals, trade);
      assert.deepEqual(askedSetupGaps(all, trade), all);
      assert.equal(nextSetupStep(all, trade), nextSetupStep(all));
    }
    // Forms still count towards "ready to take bookings".
    assert.equal(setupComplete({ ...fourAnswered, hasQuestionnaireTemplate: false }, trade), false);
    assert.equal(setupComplete({ ...fourAnswered, hasQuestionnaireTemplate: true }, trade), true);
  }
  assert.equal(nextSetupStep([{ key: "insurance" }, { key: "work" }]), "work");
});

// ── The inquiry link ────────────────────────────────────────────────────

type Row = Record<string, unknown>;

/** Just enough Firestore for the link: documents and a transaction. */
function fakeFirestore(seed: Record<string, Row>) {
  const store = new Map<string, Row>(Object.entries(seed).map(([path, row]) => [path, { ...row }]));
  const snapshot = (path: string) => {
    const data = store.get(path);
    return { id: path.split("/").pop() ?? "", exists: data !== undefined, get: (field: string) => data?.[field], data: () => data };
  };
  const reference = (path: string) => ({
    path,
    get: async () => snapshot(path),
    set: async (data: Row) => void store.set(path, { ...data }),
  });
  const db = {
    doc: reference,
    runTransaction: async <T>(work: (transaction: Record<string, unknown>) => Promise<T>) =>
      work({
        get: async (ref: { path: string }) => snapshot(ref.path),
        set: (ref: { path: string }, data: Row) => void store.set(ref.path, { ...data }),
      }),
  };
  return db as never;
}

const reply = "Hi Maya,\n\nThank you — June 12 is free.\n\nWarmly,\nAlder";
const studio = (trade: string, hours: boolean) =>
  fakeFirestore({
    "tenants/t1": { id: "t1", trade },
    "leads/l1": { id: "l1", tenantId: "t1", eventKind: "wedding" },
    ...(hours ? { "consultationSettings/t1": { tenantId: "t1" } } : {}),
  });
const now = "2026-10-09T15:00:00.000Z";

test("a makeup artist's or hair stylist's first reply carries the link with no hours set", async () => {
  for (const trade of ["makeup", "hair"]) {
    const db = studio(trade, false);
    assert.equal(await studioTakesBookings(db, "t1"), true, trade);
    const linked = await withInquiryLink(db, { tenantId: "t1", leadId: "l1", body: reply, now });
    assert.equal(linked.linked, true, trade);
    // Details and the price — no time to pick.
    assert.match(linked.body, /we'll send your price: https:\/\/.+\/i\/[\w-]{43}\n\nWarmly,\nAlder$/, trade);
    assert.doesNotMatch(linked.body, /pick a time/, trade);
  }
});

test("a photographer's and a DJ's link still waits for hours", async () => {
  for (const trade of ["photographer", "dj"]) {
    const without = studio(trade, false);
    assert.equal(await studioTakesBookings(without, "t1"), false, trade);
    assert.deepEqual(await withInquiryLink(without, { tenantId: "t1", leadId: "l1", body: reply, now }), { body: reply, linked: false }, trade);
    const withHours = studio(trade, true);
    assert.equal(await studioTakesBookings(withHours, "t1"), true, trade);
    const linked = await withInquiryLink(withHours, { tenantId: "t1", leadId: "l1", body: reply, now });
    assert.match(linked.body, /pick a time to talk/, trade);
  }
  // A studio with no trade on record is a photographer.
  const unknown = fakeFirestore({ "tenants/t1": { id: "t1" }, "leads/l1": { id: "l1", tenantId: "t1" } });
  assert.equal(await studioTakesBookings(unknown, "t1"), false);
});

test("the couple's page with no call fetches no times and promises none", () => {
  const page = read("components/inquiries/couple-inquiry-page.tsx");
  assert.match(page, /if \(step !== "time" \|\| !preview\?\.takesBookings \|\| preview\.offersConsultation === false\) return;/);
  assert.match(page, /preview\?\.booked \|\| !preview\?\.takesBookings \|\| noCall\s*\?\s*`Send to \$\{studio\}`/);
  // The thank-you a no-call client ends on is the quote, not a time.
  assert.match(page, /\{step === "time" && preview && noCall \? \(/);
  assert.match(page, /will send your \$\{offer\} by email/);
});

// ── The screens ──────────────────────────────────────────────────────────

test("setup, Help's checklist, Today and Settings read the studio's own order", () => {
  const conversation = read("components/setup/setup-conversation.tsx");
  assert.match(conversation, /return setupOrderFor\(trade\)\.map\(/);
  assert.match(conversation, /const ordered = orderedFor\(workspace\.tenantTrade\);/);
  assert.match(conversation, /\{answered\} of \{ordered\.length\}/);
  assert.match(conversation, /setupQuestionCount\(workspace\.tenantTrade\)/);
  const checklist = read("components/dashboard/setup-checklist.tsx");
  assert.match(checklist, /const order = setupOrderFor\(tenantTrade\);/);
  assert.match(checklist, /setupQuestionCount\(tenantTrade\)/);
  const hook = read("components/today/use-today-inbox.ts");
  assert.match(hook, /next: nextSetupStep\(setup\.gaps, workspace\.tenantTrade\)/);
  // One filter, in the hook every screen reads, so they can't disagree.
  const state = read("components/setup/use-setup-state.ts");
  assert.match(state, /const gaps = askedSetupGaps\(everything, workspace\.tenantTrade\);/);
  assert.match(state, /complete: setupComplete\(state, workspace\.tenantTrade\)/);
  // Settings names a vendor's four, and still has her insurance.
  const shell = read("components/settings/settings-shell.tsx");
  assert.match(shell, /"Packages, hours, inquiries and agreement"/);
  assert.match(shell, /Inquiries, hours, packages, agreement, details form and insurance/);
  assert.match(shell, /\{ kind: "section", key: "insurance", icon: ShieldCheck \}/);
});

test("a makeup artist's or hair stylist's prices question asks per person, from the extras she already has", () => {
  const conversation = read("components/setup/setup-conversation.tsx");
  assert.match(conversation, /tradeProfile\(trade\)\.perPersonPricing \? \{ why: PER_PERSON_WHY \}/);
  assert.match(conversation, /price everyone else getting ready per person/);
  // The Library's add-ons, which start from her trade's per-person examples.
  assert.match(conversation, /const PER_PERSON_PRICES = "\/studio\/library\/add-ons";/);
  assert.match(conversation, /tradeProfile\(workspace\.tenantTrade\)\.perPersonPricing \? \(/);
  assert.match(read("features/packages/extra-ideas.ts"), /\{ name: "Bridesmaid hair", description: "[^"]+", perUnit: "person" \}/);
});

test("insurance is opt-in for a vendor: off until she chooses, and findable in Settings", () => {
  const settings = read("components/settings/coi-settings.tsx");
  assert.match(settings, /const optIn = !setupOrderFor\(workspace\.tenantTrade\)\.includes\("insurance"\);/);
  assert.match(settings, /const dial = value<Dial>\("dial", optIn && !venueAsks \? "off" : "prepare"\);/);
  // A venue asking on one of her jobs is the opt-in: then it starts on Prepare.
  assert.match(settings, /project\.insuranceRequired === "required" && !project\.archivedAt/);
  assert.match(settings, /Off until you turn it on\./);
  for (const trade of VENDORS) assert.ok(!setupOrderFor(trade).includes("insurance"), trade);
  assert.ok(setupOrderFor("photographer").includes("insurance"));
});
