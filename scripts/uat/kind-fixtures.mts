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
  /** Schedule B's wording for this trade (features/contracts/event-details.ts). */
  scheduleB: RegExp[];
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
  /** The job's name after the inquiry (functions/src/intake/convert.ts). */
  jobName: string;
  /** `vocab(kind, job).yourEvent`. */
  yourEvent: string;
  /** How the agreement, the portal and the emails name the event ("bar mitzvah"). */
  eventPhrase: string;
  inquiry: { message: string; city: string; venue: string; guests: number };
  package: { name: string; description: string; deliverables: string[] };
  scheduleA: string;
  scheduleB: string;
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
};
