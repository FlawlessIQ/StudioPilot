/* eslint-disable @typescript-eslint/ban-ts-comment -- see the next line. */
// @ts-nocheck -- UAT fixtures for scripts/uat/kind-walk.mts, run through tsx. Not part of the app.
/**
 * What a job kind's emulator walk (scripts/uat/kind-walk.mts --kind <id>)
 * sends and expects, one entry per kind: the inquiry, the honoree, the job's
 * name, each trade's form and Schedule B wording, the words the client must
 * never read, and each trade's plan checks. The walk itself holds no
 * kind-specific value; a new kind is a new entry here
 * (docs/new-job-kinds-execution-plan-2026-10-15.md Phase 0, step 5).
 */
import { planBuiltNight } from "../../features/schedules/built-day.ts";
import { fillMcScript, mcScriptLine } from "../../features/schedules/mc-script.ts";
import { planChairs } from "../../features/schedules/chair-plan.ts";
import { parsePartyList } from "../../features/schedules/party-list.ts";
import { djMomentsFor } from "../../features/schedules/night-plan.ts";

export type Trade = "dj" | "makeup" | "hair" | "planner";

/** What a trade's plan check gets from the walk. */
export type PlanContext = {
  trade: Trade;
  /** The form's answers as stored after the client sent it. */
  stored: Record<string, unknown>;
  /** The kind's `journeyProfile(kind).dayPlan`. */
  dayPlan: string | null;
  record: (step: string, ok: boolean, detail: string) => boolean;
  note: (step: string, detail: string) => void;
  hit: (pattern: RegExp, text: string) => string;
  /** The planner's checklist tasks on the job (planning_<projectId>_<key>). */
  checklist: () => Promise<{ keys: string[]; tasks: Array<Record<string, unknown>> }>;
  fixture: KindFixture;
};

export type TradeFixture = {
  studioName: string;
  /** The recommended form this trade's studio gets for the kind (its `recommendedId`). */
  form: string;
  /** Schedule B's wording for this trade (features/contracts/event-details.ts); null for a kind with no agreement. */
  scheduleB: RegExp[] | null;
  /** What the client writes on the trade's form; required fields left out are filled generically. */
  answers: Record<string, unknown>;
  /** The trade's own plan from the form. */
  plan: (ctx: PlanContext) => Promise<void> | void;
};

export type KindFixture = {
  kind: string;
  /** The word for the kind in step names and test emails ("mitzvah"). */
  word: string;
  /** The inquiry form's event type for the kind. */
  eventType: { id: string; label: string };
  client: { firstName: string; lastName: string };
  /** The honoree, for a kind with `journeyProfile(kind).honoree`. */
  honoree: { name: string; variantField: "mitzvahType" | "occasionVariant" | null; variant: string | null } | null;
  /** The partner's name on the inquiry, for a kind with `journeyProfile(kind).partner`. */
  partnerName?: string;
  /** The job's name after the inquiry (functions/src/intake/convert.ts). */
  jobName: string;
  /** `vocab(kind, job).yourEvent`. */
  yourEvent: string;
  /** How the agreement, the portal and the emails name the event ("bar mitzvah"). */
  eventPhrase: string;
  /** venue/guests undefined for a kind whose inquiry asks for neither (dayFieldsForKind). */
  inquiry: { message: string; city: string; venue?: string; guests?: number };
  package: { name: string; description: string; deliverables: string[] };
  /** The agreement's schedule headings; null for a kind with no agreement (journeyProfile(kind).agreement false). */
  scheduleA: string | null;
  scheduleB: string | null;
  /** What Schedule A must say, as [step, pattern] pairs (a kind's own parts). */
  scheduleAChecks?: Array<[string, RegExp]>;
  /** Recommended-form ids that must never reach a job of this kind. */
  foreignForms: RegExp;
  /** Days out the job is moved to so the form date has passed (the profile's `detailsFormDaysBefore` less a few). */
  formDueDaysOut: number;
  /** A generic place/answer for a required free-text form field. */
  fillerText: string;
  /** Words the client must never read. */
  forbidden: RegExp;
  /** "couple": noted on emails, failed on the planner's task titles. */
  coupleWord: RegExp;
  trades: Partial<Record<Trade, TradeFixture>>;
};

/** The wedding words a mitzvah family must never read. */
const WEDDING_WORDS = /\b(weddings?|brides?|bridal|grooms?|ceremony|bridesmaids?)\b/i;
const COUPLE_WORD = /\bcouples?\b/i;

/** The DJ's night plan and MC script for a mitzvah. */
function mitzvahNight({ stored, dayPlan, record, note, hit }: PlanContext) {
  const night = planBuiltNight(dayPlan, { answers: stored, coverageMinutes: 270, venue: "The Grand Ballroom" });
  const titles = night.rows.map((row) => `${row.time} ${row.title}`);
  record("5. planBuiltNight(mitzvah) starts at the party (18:30 cocktail hour), no crew/portraits/service lines",
    night.rows[0]?.time === "18:30" && !night.rows.some((row) => /Photo and video|portraits|^Service$/i.test(row.title)),
    titles.join(" · "));
  record("5. the night has the hora, the blessings, the candles and the montage",
    ["Hora", "Blessings over the challah and wine", "Candle lighting", "Montage"].every((title) => night.rows.some((row) => row.title === title)),
    night.notes.join(" ") || "no notes");
  record("5. the night's notes never say photo/crew", !/photo|crew sheet|portrait/i.test(night.notes.join(" ")), hit(/photo|crew sheet|portrait/i, night.notes.join(" ")));
  const { items, filled } = fillMcScript(night.rows.map((row) => ({ ...row, mc: null })), stored);
  const line = (title: RegExp) => mcScriptLine(items.find((item) => title.test(item.title))?.mc) ?? "";
  record("5. MC script: entrance names on the grand entrance", /And our bar mitzvah, Sam!/.test(line(/grand entrance/i)), line(/grand entrance/i) || "empty");
  record("5. MC script: hora songs + the chair lift", /Hava Nagila/.test(line(/hora/i)) && /Sam first/.test(line(/hora/i)), line(/hora/i) || "empty");
  record("5. MC script: blessings on the challah line", /motzi/.test(line(/challah/i)), line(/challah/i) || "empty");
  record("5. MC script: toast order on the parents' speech", /Rachel and David/.test(line(/speech/i)), line(/speech/i) || "empty");
  record("5. MC script: the candle-lighting list with its songs", /Somewhere Over the Rainbow/.test(line(/candle/i)) && /Sunrise, Sunset/.test(line(/candle/i)), line(/candle/i).slice(0, 160) || "empty");
  record("5. MC script: the montage", /Dropbox/.test(line(/montage/i)), line(/montage/i) || "empty");
  note("5. MC script filled", `${filled} lines: ${items.filter((item) => item.mc).map((item) => item.title).join(", ")}`);
}

/** A makeup or hair party list and its chairs for a mitzvah. */
function mitzvahChairs({ trade, stored, record, note }: PlanContext) {
  const service = trade as "makeup" | "hair";
  const people = parsePartyList(stored["party-list"], service);
  const rachel = people.find((person) => person.name === "Rachel Cohen");
  const lily = people.find((person) => person.name === "Lily");
  record("5. party list read: Rachel is a mother", rachel?.role === "mother", JSON.stringify(people));
  record("5. party list read: Lily (the honoree) is recognized as the honoree, not a bridesmaid/'party'", lily ? lily.role !== "party" : false, `Lily role ${lily?.role}, services ${lily?.services?.join("+")}, notes ${lily?.notes}`);
  const plan = planChairs({ people, service, readyBy: "17:30", earliestStart: "12:00", artists: 1 });
  if (service === "hair") {
    note("5. hair with the brief's makeup-only list", `${plan.slots.length} chairs: ${plan.notes.join(" ")} (the list asks for makeup, so a hair studio has nobody — expected)`);
    // The hair form's own examples: what a family following the help text writes.
    const own = parsePartyList("Rachel Cohen — mom — blowout\nLily — the bat mitzvah — half up, with flowers\nGrandma Ruth — grandmother — set and style", "hair");
    const ownPlan = planChairs({ people: own, service: "hair", readyBy: "17:30", earliestStart: "12:00", artists: 1 });
    record("5. hair: the form's own example list gives three chairs", ownPlan.slots.length === 3, ownPlan.slots.map((slot) => `${slot.start} ${slot.name} (${slot.role})`).join(", "));
  } else {
    record(`5. planChairs lays out the ${service} chairs`, plan.slots.length === 2 && plan.fits, `${plan.slots.map((slot) => `${slot.start}-${slot.end} ${slot.name} (${slot.role})`).join(", ") || "no slots"} ${plan.notes.join(" ")}`);
  }
}

/** The planner's checklist for a full-planning mitzvah (functions/src/planning/planning-checklist-sync.ts). */
async function mitzvahChecklist({ record, hit, checklist, fixture }: PlanContext) {
  const { keys, tasks } = await checklist();
  record("5. planner: a full-planning mitzvah gets its checklist", tasks.length > 0, `${tasks.length} tasks: ${keys.join(", ")}`);
  const excluded = ["marriage_license", "officiant"];
  record("5. planner: no marriage license, no officiant", !excluded.some((key) => keys.includes(key)), keys.filter((key) => excluded.includes(key)).join(", ") || "none");
  record("5. planner: the candle-lighting list is on it", keys.includes("candle_lighting"), keys.includes("candle_lighting") ? tasks.find((task) => String(task.id).endsWith("candle_lighting"))?.title : "missing");
  const titles = tasks.map((task) => task.title).join(" | ");
  record("5. planner: no wedding words or 'couple' in the task titles", !fixture.forbidden.test(titles) && !fixture.coupleWord.test(titles), hit(new RegExp(`${fixture.forbidden.source}|${fixture.coupleWord.source}`, "i"), titles));
}

const MITZVAH_PARTY_LIST = {
  "ready-by-time": "17:30", "earliest-start-time": "12:00", "getting-ready": "The Cohen home, 4 Oak Rd",
  "party-list": "Rachel Cohen — mom — makeup\nLily — the bat mitzvah — light makeup",
};

/**
 * The words a quinceañera family must never read: a wedding's (and its veil,
 * officiant and marriage — but not "dress": a quince has one), "couple" other
 * than "a couple of", and a mitzvah's.
 */
const QUINCE_WORDS = /\b(weddings?|brides?|bridal|grooms?|ceremony|bridesmaids?|veils?|officiants?|marriage|(?<!\ba )couples?(?! of\b)|(?:bar|bat|b'?nai) mitzvahs?|hora|synagogue|candle[- ]lighting|challah|rabbi)\b/i;

/** The DJ's night plan and MC script for a quinceañera. */
function quinceNight({ stored, dayPlan, record, note, hit }: PlanContext) {
  const night = planBuiltNight(dayPlan, { answers: stored, coverageMinutes: 270, venue: "Salón Las Palmas" });
  const titles = night.rows.map((row) => `${row.time} ${row.title}`);
  record("5. planBuiltNight(quince) starts at the reception (18:30 cocktail hour), no crew/portraits/Mass lines",
    night.rows[0]?.time === "18:30" && !night.rows.some((row) => /Photo and video|portraits|^Mass\b/i.test(row.title)),
    titles.join(" · "));
  const wanted = [/grand entrance/i, /changing of the shoes/i, /crowning/i, /last doll/i, /waltz/i, /toast/i, /surprise dance/i];
  const missing = wanted.filter((pattern) => !night.rows.some((row) => pattern.test(row.title)));
  record("5. the night has the entrance, the shoes, the crowning, the last doll, the waltz, the toast and the surprise dance",
    missing.length === 0, missing.length ? `missing ${missing.join(", ")}` : night.notes.join(" ") || "all there");
  const order = wanted.map((pattern) => night.rows.findIndex((row) => pattern.test(row.title)));
  record("5. ...in that order", order.every((at, index) => at >= 0 && (index === 0 || at > order[index - 1]!)), order.join(","));
  record("5. the night's notes never say photo/crew", !/photo|crew sheet|portrait/i.test(night.notes.join(" ")), hit(/photo|crew sheet|portrait/i, night.notes.join(" ")));
  const { items, filled } = fillMcScript(night.rows.map((row) => ({ ...row, mc: null })), stored);
  const line = (title: RegExp) => mcScriptLine(items.find((item) => title.test(item.title))?.mc) ?? "";
  record("5. MC script: entrance names on the grand entrance", /And our quinceañera, Sofia!/.test(line(/grand entrance/i)), line(/grand entrance/i) || "empty");
  record("5. MC script: the shoes song", /Tacones Rojos/.test(line(/shoes/i)), line(/shoes/i) || "empty");
  record("5. MC script: the crowning song", /Quinceañera.*Thalía/.test(line(/crowning/i)), line(/crowning/i) || "empty");
  record("5. MC script: the last doll song", /Mi Muñeca/.test(line(/last doll/i)), line(/last doll/i) || "empty");
  record("5. MC script: the waltz song", /Chayanne/.test(line(/waltz/i)), line(/waltz/i) || "empty");
  record("5. MC script: toast order on the toast", /Padrino Luis/.test(line(/toast/i)), line(/toast/i) || "empty");
  record("5. MC script: the surprise-dance announcement", /choreographer/.test(line(/surprise dance/i)), line(/surprise dance/i) || "empty");
  const all = items.map((item) => mcScriptLine(item.mc) ?? "").join(" ");
  if (!/Vals de las Flores/.test(all)) note("5. MC script: the court's waltz song", `court-waltz-song ("${stored["court-waltz-song"]}") is on no line — the night has one waltz row and mc-script RULES map only waltz-song`);
  note("5. MC script filled", `${filled} lines: ${items.filter((item) => item.mc).map((item) => item.title).join(", ")}`);
}

/** A makeup or hair party list and its chairs for a quinceañera. */
function quinceChairs({ trade, stored, record }: PlanContext) {
  const service = trade as "makeup" | "hair";
  const people = parsePartyList(stored["party-list"], service);
  const role = (name: string) => people.find((person) => person.name === name)?.role;
  record("5. party list read: Sofia (the quinceañera) is the honoree, Maria a mother, Ana (dama) the party",
    role("Sofia") === "bride" && role("Maria Garcia") === "mother" && role("Ana Ruiz") === "party",
    people.map((person) => `${person.name}: ${person.role} ${person.services.join("+")}`).join(", "));
  const plan = planChairs({ people, service, readyBy: "16:00", earliestStart: "11:00", artists: 1 });
  const slots = plan.slots.map((slot) => `${slot.start}-${slot.end} ${slot.name} (${slot.role})`).join(", ") || "no slots";
  record(`5. planChairs lays out the ${service} chairs`, plan.slots.length === 3 && plan.fits, `${slots} ${plan.notes.join(" ")}`);
  // chair-plan.ts: the honoree sits in the middle of her chair, never last, so a late morning never rushes her.
  const at = plan.slots.findIndex((slot) => slot.name === "Sofia");
  record("5. Sofia is never last in the chair (chair-plan.ts: the middle)", at >= 0 && at < plan.slots.length - 1, slots);
}

/** The planner's checklist for a full-planning quinceañera. */
async function quinceChecklist({ record, hit, checklist, fixture }: PlanContext) {
  const { keys, tasks } = await checklist();
  record("5. planner: a full-planning quinceañera gets its checklist", tasks.length > 0, `${tasks.length} tasks: ${keys.join(", ")}`);
  const excluded = ["marriage_license", "officiant", "candle_lighting"];
  record("5. planner: no marriage license, no officiant, no candle lighting", !excluded.some((key) => keys.includes(key)), keys.filter((key) => excluded.includes(key)).join(", ") || "none");
  const wanted = ["church_date", "court", "choreographer", "padrinos", "traditions", "surprise_dance"];
  record("5. planner: the Mass, the court, the choreographer, the padrinos, the traditions, the surprise dance", wanted.every((key) => keys.includes(key)), `missing: ${wanted.filter((key) => !keys.includes(key)).join(", ") || "none"}`);
  const titles = tasks.map((task) => task.title).join(" | ");
  record("5. planner: no wedding/mitzvah words or 'couple' in the task titles", !fixture.forbidden.test(titles) && !fixture.coupleWord.test(titles), hit(new RegExp(`${fixture.forbidden.source}|${fixture.coupleWord.source}`, "i"), titles));
}

const QUINCE_BEFORE_ANSWERS = { "ready-by-time": "16:00", "earliest-start-time": "11:00", "getting-ready": "The Garcia home, 22 Palm Ave" };

/**
 * The words a Sweet 16 family must never read: a wedding's (with its veil,
 * officiant and marriage), "couple" other than "a couple of", and the other
 * honoree kinds' — a mitzvah's and a quinceañera's (its Mass, court and
 * padrinos). Candle lighting is a Sweet 16's own.
 */
const SWEET16_WORDS = /\b(weddings?|brides?|bridal|grooms?|ceremony|ceremonies|bridesmaids?|veils?|officiants?|marriage|(?<!\ba )couples?(?! of\b)|(?:bar|bat|b'?nai) mitzvahs?|mitzvahs?|synagogue|hora|rabbi|challah|quincea[ñn]eras?|quinces?|damas?|chambel[aá]n(?:es)?|padrinos?|madrinas?|mass)\b/i;

/** The DJ's night plan and MC script for a Sweet 16. */
function sweet16Night({ stored, dayPlan, record, note, hit }: PlanContext) {
  const night = planBuiltNight(dayPlan, { answers: stored, coverageMinutes: 270, venue: "The Glasshouse" });
  const titles = night.rows.map((row) => `${row.time} ${row.title}`);
  record("5. planBuiltNight(sweet16) starts at the party (18:30 guests arrive), no crew/portraits lines",
    night.rows[0]?.time === "18:30" && !night.rows.some((row) => /Photo and video|portraits/i.test(row.title)),
    titles.join(" · "));
  const wanted = [/grand entrance/i, /candle lighting/i, /parent dance/i, /toast/i, /dancing and games/i];
  const missing = wanted.filter((pattern) => !night.rows.some((row) => pattern.test(row.title)));
  record("5. the night has the entrance, the candle lighting, the parent dance, the toast, and dancing and games",
    missing.length === 0, missing.length ? `missing ${missing.join(", ")}` : night.notes.join(" ") || "all there");
  const order = wanted.map((pattern) => night.rows.findIndex((row) => pattern.test(row.title)));
  record("5. ...in that order", order.every((at, index) => at >= 0 && (index === 0 || at > order[index - 1]!)), order.join(","));
  record("5. the night's notes never say photo/crew", !/photo|crew sheet|portrait/i.test(night.notes.join(" ")), hit(/photo|crew sheet|portrait/i, night.notes.join(" ")));
  const { items, filled } = fillMcScript(night.rows.map((row) => ({ ...row, mc: null })), stored);
  const line = (title: RegExp) => mcScriptLine(items.find((item) => title.test(item.title))?.mc) ?? "";
  record("5. MC script: entrance names on the grand entrance", /And our birthday girl, Emma!/.test(line(/grand entrance/i)), line(/grand entrance/i) || "empty");
  record("5. MC script: the candle-lighting list with its songs", /My Girl/.test(line(/candle/i)) && /Grandma Rose/.test(line(/candle/i)), line(/candle/i).slice(0, 160) || "empty");
  record("5. MC script: the parent-dance song", /Isn't She Lovely/.test(line(/parent dance/i)), line(/parent dance/i) || "empty");
  record("5. MC script: toast order on the toast", /Mark, then Grandma Rose/.test(line(/toast/i)), line(/toast/i) || "empty");
  record("5. MC script: the games on dancing and games", /trivia/.test(line(/games/i)), line(/games/i) || "empty");
  note("5. MC script filled", `${filled} lines: ${items.filter((item) => item.mc).map((item) => item.title).join(", ")}`);
}

/** A makeup or hair party list and its chairs for a Sweet 16. */
function sweet16Chairs({ trade, stored, record }: PlanContext) {
  const service = trade as "makeup" | "hair";
  const people = parsePartyList(stored["party-list"], service);
  const role = (name: string) => people.find((person) => person.name === name)?.role;
  record("5. party list read: Emma (the birthday girl) is the honoree, Lisa a mother, Zoe (friend) the party",
    role("Emma") === "bride" && role("Lisa Carter") === "mother" && role("Zoe") === "party",
    people.map((person) => `${person.name}: ${person.role} ${person.services.join("+")}`).join(", "));
  const plan = planChairs({ people, service, readyBy: "17:30", earliestStart: "12:00", artists: 1 });
  const slots = plan.slots.map((slot) => `${slot.start}-${slot.end} ${slot.name} (${slot.role})`).join(", ") || "no slots";
  record(`5. planChairs lays out the ${service} chairs`, plan.slots.length === 3 && plan.fits, `${slots} ${plan.notes.join(" ")}`);
  const at = plan.slots.findIndex((slot) => slot.name === "Emma");
  record("5. Emma is never last in the chair (chair-plan.ts: the middle)", at >= 0 && at < plan.slots.length - 1, slots);
}

/** The planner's checklist for a full-planning Sweet 16. */
async function sweet16Checklist({ record, hit, checklist, fixture }: PlanContext) {
  const { keys, tasks } = await checklist();
  record("5. planner: a full-planning Sweet 16 gets its checklist", tasks.length > 0, `${tasks.length} tasks: ${keys.join(", ")}`);
  const excluded = ["marriage_license", "officiant", "church_date"];
  record("5. planner: no marriage license, no officiant, no church date", !excluded.some((key) => keys.includes(key)), keys.filter((key) => excluded.includes(key)).join(", ") || "none");
  const wanted = ["venue", "theme", "candle_lighting"];
  record("5. planner: the venue, the theme and the candle lighting", wanted.every((key) => keys.includes(key)), `missing: ${wanted.filter((key) => !keys.includes(key)).join(", ") || "none"}`);
  const titles = tasks.map((task) => task.title).join(" | ");
  record("5. planner: no wedding/mitzvah/quinceañera words or 'couple' in the task titles", !fixture.forbidden.test(titles) && !fixture.coupleWord.test(titles), hit(new RegExp(`${fixture.forbidden.source}|${fixture.coupleWord.source}`, "i"), titles));
}

const SWEET16_BEFORE_ANSWERS = { "ready-by-time": "17:30", "earliest-start-time": "12:00", "getting-ready": "The Carter home, 8 Maple Ave, Summit NJ" };

/**
 * The words a First Communion / Confirmation / Baptism family must never
 * read: a wedding's (not "veil" or "ceremony" — a communion has both),
 * "couple" other than "a couple of", and the other honoree kinds'.
 */
const SACRAMENT_WORDS = /\b(weddings?|brides?|bridal|grooms?|bridesmaids?|fianc[ée]e?s?|officiants?|marriage|(?<!\ba )couples?(?! of\b)|(?:bar|bat|b'?nai) mitzvahs?|mitzvahs?|synagogue|quincea[ñn]eras?|sweet 16|athletes?)\b/i;

/** A hair party list and its chairs for a first communion. */
function sacramentChairs({ trade, stored, record }: PlanContext) {
  const service = trade as "makeup" | "hair";
  const people = parsePartyList(stored["party-list"], service);
  const role = (name: string) => people.find((person) => person.name === name)?.role;
  record("5. party list read: Lily (first communion) is the honoree, Maria a mother",
    role("Lily") === "bride" && role("Maria Lopez") === "mother",
    people.map((person) => `${person.name}: ${person.role} ${person.services.join("+")} ${person.notes ?? ""}`).join(", "));
  const plan = planChairs({ people, service, readyBy: "09:00", earliestStart: "07:00", artists: 1 });
  const slots = plan.slots.map((slot) => `${slot.start}-${slot.end} ${slot.name} (${slot.role})`).join(", ") || "no slots";
  record(`5. planChairs lays out the ${service} chairs`, plan.slots.length === 2 && plan.fits, `${slots} ${plan.notes.join(" ")}`);
}

/**
 * The words a prom family must never read: a wedding's (with its veil,
 * ceremony, officiant and marriage), "couple" other than "a couple of", and
 * the other honoree kinds'.
 */
const PROM_WORDS = /\b(weddings?|brides?|bridal|grooms?|bridesmaids?|fianc[ée]e?s?|officiants?|marriage|ceremony|ceremonies|veils?|(?<!\ba )couples?(?! of\b)|(?:bar|bat|b'?nai) mitzvahs?|mitzvahs?|synagogue|quincea[ñn]eras?|sweet 16|athletes?|communions?)\b/i;

/** A makeup or hair party list and its chairs for prom. */
function promChairs({ trade, stored, record }: PlanContext) {
  const service = trade as "makeup" | "hair";
  const people = parsePartyList(stored["party-list"], service);
  const role = (name: string) => people.find((person) => person.name === name)?.role;
  record("5. party list read: Ava (the student) is the honoree, Mia (friend) the party",
    role("Ava") === "bride" && role("Mia") === "party",
    people.map((person) => `${person.name}: ${person.role} ${person.services.join("+")} ${person.notes ?? ""}`).join(", "));
  const plan = planChairs({ people, service, readyBy: "17:00", earliestStart: "13:00", artists: 1 });
  const slots = plan.slots.map((slot) => `${slot.start}-${slot.end} ${slot.name} (${slot.role})`).join(", ") || "no slots";
  record(`5. planChairs lays out the ${service} chairs`, plan.slots.length === 2 && plan.fits, `${slots} ${plan.notes.join(" ")}`);
  const at = plan.slots.findIndex((slot) => slot.name === "Ava");
  record("5. Ava is never last in the chair (chair-plan.ts: the middle)", at >= 0 && at < plan.slots.length - 1, slots);
}

const PROM_BEFORE_ANSWERS = { "ready-by-time": "17:00", "earliest-start-time": "13:00", "getting-ready": "The Park home, 5 Birch Ln, Ridgewood NJ" };

/**
 * The words a renewing couple must never read: a wedding's (with its
 * fiancé(e), veil and marriage license) and the other kinds'. "Couple" and
 * "ceremony" are theirs: a renewing couple may have one.
 */
const VOW_WORDS = /\b(weddings?|brides?|bridal|grooms?|bridesmaids?|fianc[ée]e?s?|marriage licen[cs]es?|veils?|(?:bar|bat|b'?nai) mitzvahs?|mitzvahs?|quincea[ñn]eras?|sweet 16|proms?)\b/i;

/** The DJ's MC script for a vow renewal, over its own moments (night-plan.ts DJ_MOMENTS_BY_KIND.vow_renewal). */
function vowNight({ stored, record, note }: PlanContext) {
  const moments = djMomentsFor("vow_renewal");
  const { items, filled } = fillMcScript(moments.map((moment) => ({ title: moment.title, mc: null })), stored);
  const line = (title: RegExp) => mcScriptLine(items.find((item) => title.test(item.title))?.mc) ?? "";
  record("5. djMomentsFor(vow_renewal) is its own night (entrance, vows, toasts, anniversary dance)",
    ["Grand entrance", "Vow renewal", "Toasts", "Anniversary dance"].every((title) => moments.some((moment) => moment.title === title)) && !moments.some((moment) => /bouquet|garter|first dance/i.test(moment.title)),
    moments.map((moment) => moment.title).join(" · "));
  record("5. MC script: the entrance names and song", /Linda and Tom Reyes/.test(line(/grand entrance/i)) && /September/.test(line(/grand entrance/i)), line(/grand entrance/i) || "empty");
  record("5. MC script: the vows' song", /At Last/.test(line(/vow renewal/i)), line(/vow renewal/i) || "empty");
  record("5. MC script: the toasts", /Sophie, then Tom's brother Mark/.test(line(/toasts/i)), line(/toasts/i) || "empty");
  record("5. MC script: the anniversary dance", /Can't Help Falling in Love/.test(line(/anniversary dance/i)), line(/anniversary dance/i) || "empty");
  note("5. MC script filled", `${filled} lines: ${items.filter((item) => item.mc).map((item) => `${item.title} [${mcScriptLine(item.mc)}]`).join(", ")}`);
}

/** A makeup or hair party list and its chairs for a vow renewal. */
function vowChairs({ trade, stored, record }: PlanContext) {
  const service = trade as "makeup" | "hair";
  const people = parsePartyList(stored["party-list"], service);
  const role = (name: string) => people.find((person) => person.name === name)?.role;
  const read = people.map((person) => `${person.name}: ${person.role} ${person.services.join("+")} ${person.notes ?? ""}`).join(", ");
  record("5. party list read: Linda and Sophie both there", Boolean(role("Linda Reyes")) && Boolean(role("Sophie")), read);
  record("5. party list read: Linda (celebrating) is the one celebrated, not 'party'", role("Linda Reyes") === "bride", read);
  record("5. party list read: Sophie (daughter) is a child", role("Sophie") === "child", read);
  const plan = planChairs({ people, service, readyBy: "16:00", earliestStart: "12:00", artists: 1 });
  const slots = plan.slots.map((slot) => `${slot.start}-${slot.end} ${slot.name} (${slot.role})`).join(", ") || "no slots";
  record(`5. planChairs lays out the ${service} chairs`, plan.slots.length === 2 && plan.fits, `${slots} ${plan.notes.join(" ")}`);
}

/** The planner's checklist for a full-planning vow renewal: the wedding's, less the marriage license. */
async function vowChecklist({ record, hit, checklist, fixture }: PlanContext) {
  const { keys, tasks } = await checklist();
  record("5. planner: a full-planning vow renewal gets its checklist", tasks.length > 0, `${tasks.length} tasks: ${keys.join(", ")}`);
  record("5. planner: no marriage license", !keys.includes("marriage_license"), keys.includes("marriage_license") ? "marriage_license" : "none");
  const titles = tasks.map((task) => task.title).join(" | ");
  record("5. planner: no wedding words in the task titles", !fixture.forbidden.test(titles), hit(fixture.forbidden, titles));
}

const VOW_BEFORE_ANSWERS = { "ready-by-time": "16:00", "earliest-start-time": "12:00", "getting-ready": "The Reyes home, 8 Shore Rd, Cape May NJ" };

export const KIND_FIXTURES: Record<string, KindFixture> = {
  mitzvah: {
    kind: "mitzvah",
    word: "mitzvah",
    eventType: { id: "mitzvah", label: "Bar or bat mitzvah" },
    client: { firstName: "Rachel", lastName: "Cohen" },
    honoree: { name: "Sam", variantField: "mitzvahType", variant: "bar" },
    jobName: "Sam Cohen's bar mitzvah",
    yourEvent: "Sam's bar mitzvah",
    eventPhrase: "bar mitzvah",
    inquiry: { message: "Sam's bar mitzvah party after the Saturday service.", city: "Montclair, NJ", venue: "The Grand Ballroom", guests: 120 },
    package: { name: "Mitzvah package", description: "Everything for the party.", deliverables: ["The party"] },
    scheduleA: "Schedule A — Mitzvah details",
    scheduleB: "Schedule B — Bar and bat mitzvah terms",
    foreignForms: /^(wedding|dj-|makeup-|hair-|planner-)/,
    // journeyProfile("mitzvah").detailsFormDaysBefore is 90.
    formDueDaysOut: 85,
    fillerText: "Temple Beth Shalom, 12 Elm St, Montclair NJ",
    forbidden: WEDDING_WORDS,
    coupleWord: COUPLE_WORD,
    trades: {
      dj: {
        studioName: "Hora Beats DJs",
        form: "mitzvah-music-planner",
        scheduleB: [/music, sound and announcements/, /explicit lyrics/],
        answers: {
          "party-location": "The Grand Ballroom, 1 Park Ave, Montclair NJ",
          "party-start-time": "18:30",
          "party-end-time": "23:00",
          "entrance-names": "The Cohen family\nGrandparents Ruth and Mel\nAnd our bar mitzvah, Sam! (SAM, rhymes with ham)",
          "hora-songs": "Hava Nagila, then Siman Tov",
          "chair-lift": "Sam first, then Rachel and David, then Grandpa Mel",
          "candle-lighting-list": "1. In memory — Grandpa Saul — 'Somewhere Over the Rainbow'\n2. Grandparents Ruth and Mel — 'Sunrise, Sunset'\n13. Sam's friends — 'Happy'",
          blessings: "Grandpa Mel says the motzi; Uncle Josh the kiddush",
          "toast-order": "Rachel and David, then Sam's sister Lily",
          "montage-file": "Dropbox link from David, 8 minutes",
        },
        plan: mitzvahNight,
      },
      makeup: {
        studioName: "Glow by Dana",
        form: "mitzvah-makeup-party-list",
        scheduleB: [/its dress and timing/, /parent or guardian present/],
        answers: MITZVAH_PARTY_LIST,
        plan: mitzvahChairs,
      },
      hair: {
        studioName: "Shear Simcha Hair",
        form: "mitzvah-hair-party-list",
        scheduleB: [/its dress and timing/, /parent or guardian present/],
        answers: MITZVAH_PARTY_LIST,
        plan: mitzvahChairs,
      },
      planner: {
        studioName: "Mazel Events",
        form: "mitzvah-planner-final-details",
        scheduleB: [/the service, the rehearsal and the portraits/, /does not provide childcare/],
        answers: {
          synagogue: "Temple Beth Shalom, 12 Elm St, Montclair NJ", "service-time": "10:00", "party-location": "The Grand Ballroom", "party-start-time": "18:30",
          "key-people": "Rabbi Stern; Grandparents Ruth and Mel", "candle-lighting-list": "Grandpa Saul (in memory)\nRuth and Mel", "guest-count": "120",
        },
        plan: mitzvahChecklist,
      },
    },
  },
  quince: {
    kind: "quince",
    word: "quince",
    eventType: { id: "quince", label: "Quinceañera" },
    client: { firstName: "Maria", lastName: "Garcia" },
    honoree: { name: "Sofia", variantField: null, variant: null },
    jobName: "Sofia Garcia's quinceañera",
    yourEvent: "Sofia's quinceañera",
    eventPhrase: "quinceañera",
    inquiry: { message: "Sofia's quinceañera: Mass at St. Mary's, then the reception.", city: "Elizabeth, NJ", venue: "Salón Las Palmas", guests: 180 },
    package: { name: "Quinceañera package", description: "Everything for the Mass and the reception.", deliverables: ["The reception"] },
    scheduleA: "Schedule A — Quinceañera details",
    scheduleB: "Schedule B — Quinceañera terms",
    foreignForms: /^(wedding|mitzvah|dj-|makeup-|hair-|planner-)/,
    // journeyProfile("quince").detailsFormDaysBefore is 90.
    formDueDaysOut: 85,
    fillerText: "St. Mary's Church, 9 Broad St, Elizabeth NJ",
    forbidden: QUINCE_WORDS,
    coupleWord: COUPLE_WORD,
    trades: {
      dj: {
        studioName: "Fiesta Sound DJs",
        form: "quince-music-planner",
        scheduleB: [/music, sound and announcements/, /explicit lyrics/],
        answers: {
          "reception-location": "Salón Las Palmas, 300 Morris Ave, Elizabeth NJ",
          "reception-start-time": "18:30",
          "reception-end-time": "23:30",
          "entrance-names": "Her parents, Maria and José Garcia\nDama Ana Ruiz and Chambelán Diego Ortiz\nAnd our quinceañera, Sofia!",
          "shoes-song": "Tacones Rojos",
          "crowning-song": "Quinceañera by Thalía — her madrina places the tiara",
          "last-doll-song": "Mi Muñeca — from her padrinos",
          "waltz-song": "Tiempo de Vals by Chayanne",
          "court-waltz-song": "Vals de las Flores",
          "toast-order": "Padrino Luis, then José",
          "surprise-dance": "The choreographer sends the mix; 6 minutes",
        },
        plan: quinceNight,
      },
      makeup: {
        studioName: "Bella Glam Makeup",
        form: "quince-makeup-party-list",
        scheduleB: [/where and when it may work, and the Mass's timing/, /parent or guardian present/],
        answers: { ...QUINCE_BEFORE_ANSWERS, "party-list": "Sofia — the quinceañera — full glam — lashes\nMaria Garcia — mom — makeup\nAna Ruiz — dama — makeup" },
        plan: quinceChairs,
      },
      hair: {
        studioName: "Corona Hair Studio",
        form: "quince-hair-party-list",
        scheduleB: [/where and when it may work, and the Mass's timing/, /parent or guardian present/],
        answers: { ...QUINCE_BEFORE_ANSWERS, "party-list": "Sofia — the quinceañera — updo for the tiara\nMaria Garcia — mom — blowout\nAna Ruiz — dama — curls" },
        plan: quinceChairs,
      },
      planner: {
        studioName: "Quince Dreams Events",
        form: "quince-planner-final-details",
        scheduleB: [/the Mass, any rehearsal and the portraits/, /does not provide childcare/],
        answers: {
          church: "St. Mary's Church, 9 Broad St, Elizabeth NJ", "mass-time": "14:00",
          "reception-location": "Salón Las Palmas, 300 Morris Ave, Elizabeth NJ", "reception-start-time": "18:30", "reception-end-time": "23:30",
          "key-people": "Padrinos Luis and Carmen; Father Ramos; choreographer Diego",
          "court-names": "Ana Ruiz and Diego Ortiz\nLucia Perez and Mateo Diaz",
          padrinos: "Luis and Carmen — the tiara; Tía Rosa — the last doll",
          traditions: "Tiara, heels, last doll, toast glasses, Bible and rosary",
          "guest-count": "180",
        },
        plan: quinceChecklist,
      },
    },
  },
  sweet16: {
    kind: "sweet16",
    word: "sweet16",
    eventType: { id: "sweet16", label: "Sweet 16" },
    client: { firstName: "Lisa", lastName: "Carter" },
    honoree: { name: "Emma", variantField: null, variant: null },
    jobName: "Emma Carter's Sweet 16",
    yourEvent: "Emma's Sweet 16",
    eventPhrase: "Sweet 16",
    inquiry: { message: "Emma's Sweet 16 party at The Glasshouse.", city: "Summit, NJ", venue: "The Glasshouse", guests: 100 },
    package: { name: "Sweet 16 package", description: "Everything for the party.", deliverables: ["The party"] },
    scheduleA: "Schedule A — Sweet 16 details",
    scheduleB: "Schedule B — Sweet 16 terms",
    foreignForms: /^(wedding|mitzvah|quince|dj-|makeup-|hair-|planner-)/,
    // journeyProfile("sweet16").detailsFormDaysBefore is 60.
    formDueDaysOut: 55,
    fillerText: "The Glasshouse, 5 Main St, Summit NJ",
    forbidden: SWEET16_WORDS,
    coupleWord: COUPLE_WORD,
    trades: {
      dj: {
        studioName: "Sixteen Candles DJs",
        form: "sweet16-music-planner",
        scheduleB: [/music suited to their ages/, /explicit lyrics/],
        answers: {
          "party-location": "The Glasshouse, 5 Main St, Summit NJ",
          "party-start-time": "18:30",
          "party-end-time": "23:00",
          "entrance-names": "Her parents, Lisa and Mark\nAnd our birthday girl, Emma!",
          "candle-lighting-list": "1. Mom and Dad — 'My Girl'\n2. Grandma Rose — 'Lean on Me'\n16. My best friends — 'Firework'",
          "parent-dance-songs": "Isn't She Lovely",
          "toast-order": "Mark, then Grandma Rose",
          games: "A dance-off, then trivia about the birthday girl",
        },
        plan: sweet16Night,
      },
      makeup: {
        studioName: "Glow Up Makeup",
        form: "sweet16-makeup-party-list",
        scheduleB: [/parent or guardian present/, /suited to their age/],
        answers: { ...SWEET16_BEFORE_ANSWERS, "party-list": "Emma — the birthday girl — full glam — lashes\nLisa Carter — mom — makeup\nZoe — friend — light makeup" },
        plan: sweet16Chairs,
      },
      hair: {
        studioName: "Sixteen Strands Hair",
        form: "sweet16-hair-party-list",
        scheduleB: [/parent or guardian present/, /suited to their age/],
        answers: { ...SWEET16_BEFORE_ANSWERS, "party-list": "Emma — the birthday girl — curls, half up\nLisa Carter — mom — blowout\nZoe — friend — braid" },
        plan: sweet16Chairs,
      },
      planner: {
        studioName: "Sweet Moments Events",
        form: "sweet16-planner-final-details",
        scheduleB: [/supervising them/, /does not provide childcare/],
        answers: {
          "party-location": "The Glasshouse, 5 Main St, Summit NJ", "party-start-time": "18:30", "party-end-time": "23:00",
          "key-people": "Grandma Rose; Mark gives the toast; Aunt Jen if we can't reach Lisa",
          "candle-lighting-list": "Mom and Dad\nGrandma Rose\nMy best friends",
          "guest-count": "100",
        },
        plan: sweet16Checklist,
      },
    },
  },
  // Phase 3: the first kind whose variant is the generic `occasionVariant`, and
  // the first walked with no agreement (paid in full to book). Hair only here;
  // the photographer's walk is separate.
  sacrament: {
    kind: "sacrament",
    word: "sacrament",
    eventType: { id: "sacrament", label: "First Communion" },
    client: { firstName: "Maria", lastName: "Lopez" },
    honoree: { name: "Lily", variantField: "occasionVariant", variant: "first_communion" },
    jobName: "Lily Lopez's first communion",
    yourEvent: "Lily's first communion",
    eventPhrase: "first communion",
    inquiry: { message: "Lily's first communion at St. Joseph's, then lunch at home.", city: "Paterson, NJ", venue: "St. Joseph's Church", guests: 40 },
    package: { name: "First Communion hair", description: "Hair for the morning of the Mass.", deliverables: ["Hair for the morning"] },
    scheduleA: null,
    scheduleB: null,
    foreignForms: /^(wedding|mitzvah|quince|sweet16|dj-|makeup-|hair-|planner-)/,
    // journeyProfile("sacrament").detailsFormDaysBefore is 14.
    formDueDaysOut: 10,
    fillerText: "St. Joseph's Church, 40 Grand St, Paterson NJ",
    forbidden: SACRAMENT_WORDS,
    coupleWord: COUPLE_WORD,
    trades: {
      hair: {
        studioName: "Little Blessings Hair",
        form: "sacrament-hair-party-list",
        scheduleB: null,
        answers: {
          "ready-by-time": "09:00", "earliest-start-time": "07:00", "getting-ready": "The Lopez home, 12 Oak St, Paterson NJ",
          "party-list": "Lily — first communion — curls, with her veil\nMaria Lopez — mom — blowout",
        },
        plan: sacramentChairs,
      },
    },
  },
  // Phase 4: getting ready for prom. An honoree with no variant, no agreement,
  // paid in full; the inquiry asks for no venue and no guest count. Makeup and
  // hair here; the photographer's prom details + shot list are not walked.
  prom: {
    kind: "prom",
    word: "prom",
    eventType: { id: "prom", label: "Prom" },
    client: { firstName: "Kim", lastName: "Park" },
    honoree: { name: "Ava", variantField: null, variant: null },
    jobName: "Ava Park's prom",
    yourEvent: "Ava's prom",
    eventPhrase: "prom",
    inquiry: { message: "Ava's getting ready for prom at home with her friend Mia.", city: "Ridgewood, NJ", venue: undefined, guests: undefined },
    package: { name: "Prom glam", description: "Getting ready at home before prom.", deliverables: ["Getting ready for prom"] },
    scheduleA: null,
    scheduleB: null,
    foreignForms: /^(wedding|mitzvah|quince|sweet16|sacrament|dj-|makeup-|hair-|planner-)/,
    // journeyProfile("prom").detailsFormDaysBefore is 14.
    formDueDaysOut: 10,
    fillerText: "The Park home, 5 Birch Ln, Ridgewood NJ",
    forbidden: PROM_WORDS,
    coupleWord: COUPLE_WORD,
    trades: {
      makeup: {
        studioName: "Prom Glow Makeup",
        form: "prom-makeup-party-list",
        scheduleB: null,
        answers: { ...PROM_BEFORE_ANSWERS, "party-list": "Ava — the student — soft glam — lashes\nMia — friend — natural makeup" },
        plan: promChairs,
      },
      hair: {
        studioName: "Prom Night Hair",
        form: "prom-hair-party-list",
        scheduleB: null,
        answers: { ...PROM_BEFORE_ANSWERS, "party-list": "Ava — the student — loose curls\nMia — friend — sleek updo" },
        plan: promChairs,
      },
    },
  },
  // Phase 5: a couple renewing their vows (or an anniversary party, the
  // other variant, read from the type's label). An agreement and a deposit,
  // the details form 90 days out, Schedule A with optional vows and a
  // required reception, and no Schedule B. The photographer's walk is separate.
  vow_renewal: {
    kind: "vow_renewal",
    word: "vow_renewal",
    eventType: { id: "vow_renewal", label: "Vow renewal" },
    client: { firstName: "Linda", lastName: "Reyes" },
    honoree: null,
    partnerName: "Tom Reyes",
    // convert.ts names a non-honoree job "<displayName> <eventTypeLabel>".
    jobName: "Linda Reyes Vow renewal",
    yourEvent: "your vow renewal",
    eventPhrase: "vow renewal",
    inquiry: { message: "Renewing our vows for our 25th anniversary, then dinner and dancing.", city: "Cape May, NJ", venue: "The Willow Inn", guests: 80 },
    package: { name: "Vow renewal package", description: "The vows and the celebration after.", deliverables: ["The celebration"] },
    scheduleA: "Schedule A — Celebration details",
    scheduleB: null,
    scheduleAChecks: [["the venue is under Reception", /Reception[^\n]*\n?[^\n]*The Willow Inn/]],
    foreignForms: /^(wedding|mitzvah|quince|sweet16|sacrament|prom|dj-|makeup-|hair-|planner-)/,
    // journeyProfile("vow_renewal").detailsFormDaysBefore is 90.
    formDueDaysOut: 85,
    fillerText: "The Willow Inn, 20 Beach Ave, Cape May NJ",
    forbidden: VOW_WORDS,
    coupleWord: COUPLE_WORD,
    trades: {
      dj: {
        studioName: "Silver Song DJs",
        form: "vow_renewal-music-planner",
        scheduleB: null,
        answers: {
          "reception-location": "The Willow Inn, 20 Beach Ave, Cape May NJ",
          "reception-start-time": "18:00",
          "reception-end-time": "23:00",
          "entrance-names": "Celebrating 25 years, Linda and Tom Reyes!",
          "grand-entrance-song": "September",
          "entrance-song": "At Last",
          "first-dance-song": "Can't Help Falling in Love",
          "toast-order": "Sophie, then Tom's brother Mark",
        },
        plan: vowNight,
      },
      makeup: {
        studioName: "Silver Glow Makeup",
        form: "vow_renewal-makeup-party-list",
        scheduleB: null,
        answers: { ...VOW_BEFORE_ANSWERS, "party-list": "Linda Reyes — celebrating — makeup — lashes\nSophie — daughter — makeup" },
        plan: vowChairs,
      },
      hair: {
        studioName: "Second Vows Hair",
        form: "vow_renewal-hair-party-list",
        scheduleB: null,
        answers: { ...VOW_BEFORE_ANSWERS, "party-list": "Linda Reyes — celebrating — soft waves\nSophie — daughter — blowout" },
        plan: vowChairs,
      },
      planner: {
        studioName: "Anniversary Affairs Events",
        form: "vow_renewal-planner-final-details",
        scheduleB: null,
        answers: {
          "ceremony-location": "The Willow Inn garden, Cape May NJ", "ceremony-start-time": "17:00",
          "reception-location": "The Willow Inn, 20 Beach Ave, Cape May NJ", "reception-start-time": "18:00", "reception-end-time": "23:00",
          "key-people": "Our daughter Sophie; Pastor Ellis leads the vows; Mark gives a toast",
          "guest-count": "80",
        },
        plan: vowChecklist,
      },
    },
  },
};
