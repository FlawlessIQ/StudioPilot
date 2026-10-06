import { clockMinutes, clockOf, minutesClock, spokenClock, wallClockToIso } from "./day-clock";

/**
 * The wedding day, laid out from what the couple told the studio.
 *
 * GR Productions (2026-10-06): the schedule screen was "too strict" for a day
 * that is different every wedding. How a photographer actually builds one:
 * "The photographer or videographer put in their recommendations based upon
 * ceremony times. The milestones include details, touch-ups, PJ robe shot,
 * bride in dress, and then it depends on what type of day they're having —
 * do they go to the church venue? Or first look ceremony all at one?"
 *
 * So the ceremony is the anchor, and each milestone is placed from, in order:
 *   1. the couple's own time for it on their Final Schedule form;
 *   2. the studio's timing rule for it (Studio → timing rules, e.g. GR's
 *      "First Look: 195 minutes before the ceremony, 45 minutes");
 *   3. the usual timing, from GR's own final schedule sheet (details 30
 *      minutes before prep ends, hide 30 before the ceremony, first look and
 *      family photos 45 minutes each, night pictures the last 30 of coverage).
 * The type of day comes from the form too: a ceremony somewhere other than
 * the reception is a church day; a first look is asked for. Nothing is
 * chosen by the studio up front.
 *
 * A block runs until the next one starts; the last one ends with coverage.
 * Pure: no I/O, no clock, no randomness.
 */

export type DayRule = {
  id: string;
  name: string;
  anchor: string;
  offsetMinutes: number;
  durationMinutes: number;
  active?: boolean;
};

export type MilestoneKey =
  | "arrive"
  | "details"
  | "touchups"
  | "dress"
  | "groom"
  | "first_look"
  | "family"
  | "hide"
  | "leave_for_ceremony"
  | "ceremony"
  | "leave_for_reception"
  | "cocktail"
  | "couple_portraits"
  | "entrances"
  | "dinner"
  | "cake"
  | "night";

export type PlanSource = "form" | "rule" | "usual" | "coverage";

export type PlanRow = {
  key: MilestoneKey | `rule:${string}`;
  title: string;
  /** "HH:MM" on the event day. */
  time: string;
  /** "HH:MM" when the block has its own end (the couple gave one); otherwise it runs to the next. */
  end: string | null;
  where: string | null;
  source: PlanSource;
  /** In the studio's words: "From their form", "Your timing: First Look". */
  sourceLabel: string;
  /** The couple answered "TBD": placed where it usually goes, and says so. */
  tbd: boolean;
  /** Travel rows carry their minutes for the crew sheet. */
  travelMinutes: number;
  /**
   * Who covers it, when a second team is booked: the first team stays with
   * the bride, the second takes the groom, and after the second team's hours
   * the first carries on alone (GR's run of show, 2026-10-06). "all" when
   * there is one team, or for what everyone covers.
   */
  team: Team;
};

export type Team = "first" | "second" | "all";

export type DayPlan = {
  /** Ceremony somewhere other than the reception. */
  churchDay: boolean;
  firstLook: boolean;
  rows: PlanRow[];
  /** Coverage, "HH:MM"; null until there is a ceremony time to place it from. */
  coverageStart: string | null;
  coverageEnd: string | null;
  /** What the studio should know about how it was built, plainly. */
  notes: string[];
};

const TITLES: Record<MilestoneKey, string> = {
  arrive: "Photo and video arrive",
  details: "Details with the bride",
  touchups: "Touch-ups and robe or PJ shot",
  dress: "Bride in dress",
  groom: "Groom getting ready",
  first_look: "First look and couple portraits",
  family: "Bridal party and family photos",
  hide: "Hide the couple",
  leave_for_ceremony: "Travel to the ceremony",
  ceremony: "Ceremony",
  leave_for_reception: "Travel to the reception",
  cocktail: "Cocktail hour",
  couple_portraits: "Couple portraits",
  entrances: "Entrances, first dance, parent dances and speeches",
  dinner: "Dinner",
  cake: "Cake cutting",
  night: "Night pictures, dessert and dancing",
};

/** The couple's own time for a milestone, by the question ids the forms use. */
const ANSWER_KEYS: Partial<Record<MilestoneKey, readonly string[]>> = {
  arrive: ["coverageStartTime", "coverage-start-time", "coverageStartsAt", "photographyStartTime"],
  details: ["details-with-bride-time"],
  touchups: ["touch-ups-time"],
  dress: ["bride-in-dress-time"],
  groom: ["groom-start-time"],
  first_look: ["first-look-time", "firstLookTime"],
  family: ["family-photos-time"],
  hide: ["hide-time"],
  ceremony: ["ceremony-time", "ceremony-run-time", "ceremonyTime"],
  cocktail: ["cocktail-hour-time", "cocktail-run-time", "cocktail-hour", "cocktail-time", "cocktailTime"],
  entrances: ["entrances-time", "reception-time", "receptionTime"],
  dinner: ["dinner-time", "dinnerTime"],
  cake: ["cake-cutting-time", "cake-cutting", "cakeCuttingTime"],
  night: ["night-pictures-time"],
};
const SECOND_TEAM_START_KEYS = ["photo-2-start-time", "photo2StartTime", "second-team-start-time"];
const SECOND_TEAM_END_KEYS = ["photo-2-end-time", "photo2EndTime", "second-team-end-time"];
const COVERAGE_END_KEYS = ["coverageEndTime", "coverage-end-time", "end-time", "coverageEndsAt", "photographyEndTime"];
const PREP_END_KEYS = ["bridal-prep-end"];
const CEREMONY_END_KEYS = ["ceremony-end-time"];
const COCKTAIL_END_KEYS = ["cocktail-end-time"];
const FIRST_LOOK_KEYS = ["first-look", "firstLook"];
const PLACE_KEYS = {
  bride: ["getting-ready", "gettingReadyLocation", "getting-ready-location", "bride-getting-ready"],
  groom: ["groom-prep-location", "groom-getting-ready"],
  ceremony: ["ceremony-location", "ceremony-address", "ceremonyLocation"],
  reception: ["reception-location", "reception-address", "receptionLocation", "venue-address"],
};

/** Which milestone a studio's rule is about, from its name. Order matters: "First look and couple portraits". */
const RULE_MATCHERS: Array<[RegExp, MilestoneKey | "coverage_end"]> = [
  [/coverage end|end of coverage|photo(graphy)? ends?|coverage ends?/, "coverage_end"],
  [/coverage start|start of coverage|arriv/, "arrive"],
  [/first look/, "first_look"],
  [/famil|bridal party|formals/, "family"],
  [/hide/, "hide"],
  [/touch|robe|pj/, "touchups"],
  [/detail/, "details"],
  [/dress/, "dress"],
  [/groom/, "groom"],
  [/travel.*ceremon|leave.*ceremon/, "leave_for_ceremony"],
  [/travel.*recep|leave.*recep/, "leave_for_reception"],
  [/ceremon/, "ceremony"],
  [/cocktail/, "cocktail"],
  [/couple|portrait/, "couple_portraits"],
  [/entrance|first dance|speech|introduc/, "entrances"],
  [/dinner/, "dinner"],
  [/cake/, "cake"],
  [/night|sparkler|exit/, "night"],
];

/** "Cocktail_hour_start", "ceremony start", "Ceremony" → the anchor names the plan knows. */
function anchorKey(anchor: string): string {
  const key = anchor.trim().toLowerCase().replace(/[^a-z]+/g, "_").replace(/^_|_$/g, "");
  if (key === "ceremony") return "ceremony_start";
  if (key === "reception") return "reception_start";
  if (key === "cocktail" || key === "cocktail_hour") return "cocktail_hour_start";
  return key;
}

const norm = (value: unknown) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const words = (value: unknown) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function answerFor(answers: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const direct = answers[key];
    if (typeof direct === "string" && direct.trim()) return direct.trim();
    const target = norm(key);
    const loose = Object.entries(answers).find(([candidate]) => norm(candidate) === target)?.[1];
    if (typeof loose === "string" && loose.trim()) return loose.trim();
  }
  return "";
}

const isTbdAnswer = (value: string) => /^\s*(tbd|tbc|to be (decided|determined|confirmed))\s*$/i.test(value);

/** A clock the couple gave: "16:30", "4:30 PM", or an ISO time on the day. */
function clockAnswer(value: string): string | null {
  const iso = /T(\d{2}:\d{2})/.exec(value);
  return iso ? iso[1]! : clockOf(value);
}

export function ruleTarget(name: string): MilestoneKey | "coverage_end" | null {
  const text = words(name);
  return RULE_MATCHERS.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}

export function planDay(input: {
  answers: Record<string, unknown>;
  rules?: readonly DayRule[];
  /** Hours on the booking, in minutes, for where coverage ends when nobody said. */
  coverageMinutes?: number | null;
  /** The job's own venue, when the form names none. */
  venue?: string | null;
  /** A second photo/video team is booked: the groom gets them, and the day runs in two tracks. */
  secondTeam?: boolean;
}): DayPlan {
  const answers = input.answers;
  const rules = (input.rules ?? []).filter((rule) => rule.active !== false);
  const notes: string[] = [];
  const place = (keys: readonly string[]) => answerFor(answers, keys) || null;
  const bridePlace = place(PLACE_KEYS.bride);
  const groomPlace = place(PLACE_KEYS.groom);
  const ceremonyPlace = place(PLACE_KEYS.ceremony) ?? input.venue ?? null;
  const receptionPlace = place(PLACE_KEYS.reception) ?? input.venue ?? null;
  const churchDay = Boolean(
    place(PLACE_KEYS.ceremony) && place(PLACE_KEYS.reception) && words(place(PLACE_KEYS.ceremony)) !== words(place(PLACE_KEYS.reception)),
  );
  const firstLookAnswer = words(answerFor(answers, FIRST_LOOK_KEYS));
  // A time given, even "TBD", means there is one.
  const firstLookTime = answerFor(answers, ANSWER_KEYS.first_look!);
  // Asked, or a time given; when nobody said, a one-venue day has one and a church day does not.
  const firstLook = firstLookAnswer.startsWith("yes") || Boolean(firstLookTime)
    ? true
    : firstLookAnswer.startsWith("no")
      ? false
      : !churchDay;

  const ceremonyAnswer = answerFor(answers, ANSWER_KEYS.ceremony!);
  const ceremony = clockAnswer(ceremonyAnswer);
  if (!ceremony) {
    return {
      churchDay,
      firstLook,
      rows: [],
      coverageStart: null,
      coverageEnd: null,
      notes: ["There's no ceremony time yet. The day is laid out from it once the couple gives one."],
    };
  }
  const C = clockMinutes(ceremony);

  const ruleFor = (key: MilestoneKey | "coverage_end") => rules.find((rule) => ruleTarget(rule.name) === key) ?? null;
  const ceremonyRule = ruleFor("ceremony");
  const ceremonyEnd = clockAnswer(answerFor(answers, CEREMONY_END_KEYS));
  const ceremonyLength = ceremonyEnd && clockMinutes(ceremonyEnd) > C
    ? clockMinutes(ceremonyEnd) - C
    : ceremonyRule?.durationMinutes && ceremonyRule.durationMinutes > 0
      ? ceremonyRule.durationMinutes
      : 30;
  const TRAVEL = 30;

  type Placed = { minutes: number; source: PlanSource; label: string; tbd: boolean };
  const anchors: Record<string, number | null> = {
    ceremony_start: C,
    ceremony_end: C + ceremonyLength,
    reception_start: null,
    cocktail_hour_start: null,
    cocktail_start: null,
    coverage_start: null,
    coverage_end: null,
  };
  /** Where a rule puts its milestone, if its anchor is known yet. */
  const byRule = (rule: DayRule | null): Placed | null => {
    if (!rule) return null;
    const anchor = anchors[anchorKey(rule.anchor)];
    if (anchor === null || anchor === undefined) return null;
    return { minutes: anchor + rule.offsetMinutes, source: "rule", label: `Your timing: ${rule.name.trim()}`, tbd: false };
  };
  const byAnswer = (key: MilestoneKey): Placed | "tbd" | null => {
    const keys = ANSWER_KEYS[key];
    if (!keys) return null;
    const value = answerFor(answers, keys);
    if (!value) return null;
    if (isTbdAnswer(value)) return "tbd";
    const clock = clockAnswer(value);
    return clock ? { minutes: clockMinutes(clock), source: "form", label: "From their form", tbd: false } : null;
  };
  const usual = (minutes: number): Placed => ({ minutes, source: "usual", label: "Usual timing — change it", tbd: false });
  const placed = new Map<MilestoneKey, Placed>();
  placed.set("ceremony", { minutes: C, source: "form", label: "From their form", tbd: false });
  const lengthOf = (key: MilestoneKey, usualMinutes: number) => {
    const rule = ruleFor(key);
    return rule && rule.durationMinutes > 0 ? rule.durationMinutes : usualMinutes;
  };
  const LENGTH: Partial<Record<MilestoneKey, number>> = {
    details: 30, touchups: 15, dress: 30, first_look: 45, family: 45, hide: 30,
    leave_for_ceremony: TRAVEL, leave_for_reception: TRAVEL, cocktail: 60, couple_portraits: 30,
  };
  const length = (key: MilestoneKey) => lengthOf(key, LENGTH[key] ?? 30);

  // Fixed first: what the couple said, the studio's rules, the couple's prep end.
  const prepEnd = clockAnswer(answerFor(answers, PREP_END_KEYS));
  const fixed = (key: MilestoneKey): Placed | "tbd" | null => {
    const answered = byAnswer(key);
    if (answered && answered !== "tbd") return answered;
    const ruled = byRule(ruleFor(key));
    if (ruled) return answered === "tbd" ? { ...ruled, tbd: true, label: "Their form: TBD" } : ruled;
    if (prepEnd && (key === "details" || key === "touchups" || key === "dress")) {
      const P = clockMinutes(prepEnd);
      const at: Placed = { minutes: key === "details" ? P - 30 : key === "touchups" ? P : P + 15, source: "form", label: "From their prep time", tbd: false };
      return answered === "tbd" ? { ...at, tbd: true } : at;
    }
    return answered;
  };
  const usualOrTbd = (minutes: number, tbd: boolean): Placed =>
    tbd ? { ...usual(minutes), tbd: true, label: "Their form: TBD" } : usual(minutes);

  /**
   * Before the ceremony, counted back from it: each milestone the studio
   * hasn't fixed ends where the next one begins. One that is fixed resets the
   * count, so GR's first look at 3h15 out pulls the bride's milestones before
   * it rather than on top of it. A milestone fixed after the ceremony (GR's
   * family photos at +75) simply isn't part of this run.
   */
  const beforeChain: MilestoneKey[] = churchDay
    ? firstLook ? ["details", "touchups", "dress", "first_look", "leave_for_ceremony"] : ["details", "touchups", "dress", "leave_for_ceremony"]
    : firstLook ? ["details", "touchups", "dress", "first_look", "family", "hide"] : ["details", "touchups", "dress", "hide"];
  let cursor = C;
  for (const key of [...beforeChain].reverse()) {
    const pinned = fixed(key);
    if (pinned && pinned !== "tbd") {
      placed.set(key, pinned);
      if (pinned.minutes < cursor) cursor = pinned.minutes;
      continue;
    }
    cursor -= length(key);
    placed.set(key, usualOrTbd(cursor, pinned === "tbd"));
  }
  // The groom only when the couple gave a time: no rule of GR's says when.
  const groom = fixed("groom");
  if (groom && groom !== "tbd") placed.set("groom", groom);
  // A second team starts with the groom, from their own start time if the couple gave one.
  const secondStart = clockAnswer(answerFor(answers, SECOND_TEAM_START_KEYS));
  if (input.secondTeam && !placed.has("groom")) {
    const at = secondStart ?? minutesClock(placed.get("touchups")?.minutes ?? placed.get("details")?.minutes ?? C - 120);
    if (at) placed.set("groom", { minutes: clockMinutes(at), source: secondStart ? "form" : "usual", label: secondStart ? "Their second team's start" : "Usual timing — change it", tbd: false });
  }

  /**
   * After the ceremony, forward. A church day: family photos at the church,
   * the drive, then cocktails with couple portraits. One venue: cocktails
   * straight after, with family and couple photos during them.
   */
  let after = C + ceremonyLength;
  const forward = (key: MilestoneKey, advance: boolean): Placed => {
    const pinned = fixed(key);
    const at = pinned && pinned !== "tbd" ? pinned : usualOrTbd(after, pinned === "tbd");
    placed.set(key, at);
    if (advance) after = Math.max(after, at.minutes + length(key));
    return at;
  };
  if (churchDay) {
    if (!placed.has("family")) forward("family", true);
    forward("leave_for_reception", true);
  }
  const cocktail = forward("cocktail", false);
  anchors.cocktail_hour_start = cocktail.minutes;
  anchors.cocktail_start = cocktail.minutes;
  after = cocktail.minutes;
  // A first-look day had family photos before the ceremony, unless the studio moved them after.
  if (!churchDay && !placed.has("family") && !firstLook) forward("family", true);
  if (!firstLook) forward("couple_portraits", true);
  after = Math.max(after, cocktail.minutes + length("cocktail"));
  const reception = forward("entrances", false);
  anchors.reception_start = reception.minutes;
  // A rule anchored to the cocktail hour or reception, now that both are known.
  for (const key of ["family", "couple_portraits"] as const) {
    if (byAnswer(key) || (key === "couple_portraits" && firstLook)) continue;
    const ruled = byRule(ruleFor(key));
    if (ruled) placed.set(key, ruled);
  }

  // Coverage: the couple's times, the studio's rule, else the first thing on the day.
  const earliest = Math.min(...[...placed.values()].map((at) => at.minutes));
  const arrivePinned = fixed("arrive");
  const arrive: Placed = arrivePinned && arrivePinned !== "tbd"
    ? arrivePinned
    : { minutes: earliest, source: "coverage", label: "Coverage starts with the first thing on the day", tbd: false };
  anchors.coverage_start = arrive.minutes;
  placed.set("arrive", arrive);
  const endAnswer = clockAnswer(answerFor(answers, COVERAGE_END_KEYS));
  const endRule = byRule(ruleFor("coverage_end"));
  const bookedMinutes = input.coverageMinutes && input.coverageMinutes > 0 ? input.coverageMinutes : null;
  const end = endAnswer
    ? clockMinutes(endAnswer)
    : endRule && endRule.minutes > arrive.minutes && endRule.minutes !== arrive.minutes
      ? endRule.minutes
      : bookedMinutes
        ? arrive.minutes + bookedMinutes
        : reception.minutes + 240;
  anchors.coverage_end = end;
  if (!endAnswer && !bookedMinutes) notes.push("No coverage hours on the booking: the day ends four hours after the reception starts.");

  // The evening, from the reception and the end of coverage.
  const dinner = fixed("dinner");
  const dinnerAt: Placed = dinner && dinner !== "tbd" ? dinner : usualOrTbd(reception.minutes + 60, dinner === "tbd");
  placed.set("dinner", dinnerAt);
  const night = fixed("night");
  const nightAt: Placed = night && night !== "tbd" ? night : usualOrTbd(Math.max(end - 30, dinnerAt.minutes + 45), night === "tbd");
  placed.set("night", nightAt);
  const cake = fixed("cake");
  const cakeAt: Placed = cake && cake !== "tbd"
    ? cake
    : usualOrTbd(Math.min(Math.max(end - 60, dinnerAt.minutes + 30), nightAt.minutes - 15), cake === "tbd");
  placed.set("cake", cakeAt);

  const hhmm = (minutes: number) => { const clock = minutesClock(minutes); return clock ? spokenClock(clock) : ""; };
  if (end < reception.minutes + 60) {
    notes.push(`Coverage ends at ${hhmm(end)}, an hour or less into the reception (${hhmm(reception.minutes)}). Check the hours booked.`);
  }
  const early = [...placed.entries()].filter(([key, at]) => key !== "arrive" && at.minutes < arrive.minutes);
  if (early.length) {
    notes.push(`${early.map(([key]) => TITLES[key]).join(", ")} ${early.length === 1 ? "is" : "are"} before coverage starts (${hhmm(arrive.minutes)}).`);
  }
  if (churchDay) notes.push("Travel between the church and the reception is a 30-minute guess. Change it to the real drive.");

  const whereFor: Record<MilestoneKey, string | null> = {
    arrive: bridePlace ?? ceremonyPlace,
    details: bridePlace,
    touchups: bridePlace,
    dress: bridePlace,
    groom: groomPlace,
    first_look: churchDay ? bridePlace : ceremonyPlace,
    family: ceremonyPlace,
    hide: ceremonyPlace,
    leave_for_ceremony: ceremonyPlace,
    ceremony: ceremonyPlace,
    leave_for_reception: receptionPlace,
    cocktail: receptionPlace,
    couple_portraits: churchDay ? receptionPlace : ceremonyPlace,
    entrances: receptionPlace,
    dinner: receptionPlace,
    cake: receptionPlace,
    night: receptionPlace,
  };
  const cocktailEnd = clockAnswer(answerFor(answers, COCKTAIL_END_KEYS));
  // Cocktail hour keeps its hour: family and couple photos happen during it.
  const cocktailStart = placed.get("cocktail")?.minutes;
  const ownEnd: Partial<Record<MilestoneKey, string | null>> = {
    ceremony: ceremonyEnd,
    cocktail: cocktailEnd ?? (cocktailStart === undefined ? null : minutesClock(Math.min(cocktailStart + length("cocktail"), placed.get("entrances")?.minutes ?? Infinity))),
  };

  // Two tracks when a second team is booked; after their hours, the first team alone.
  const secondEnd = clockAnswer(answerFor(answers, SECOND_TEAM_END_KEYS));
  const teamFor = (key: MilestoneKey | null, minutes: number): Team => {
    if (!input.secondTeam) return "all";
    if (key === "groom") return "second";
    if (key === "arrive" || key === "details" || key === "touchups" || key === "dress") return "first";
    if (secondEnd && minutes >= clockMinutes(secondEnd)) return "first";
    return "all";
  };

  const order = Object.keys(TITLES) as MilestoneKey[];
  const rows: PlanRow[] = [];
  for (const key of order) {
    const at = placed.get(key);
    const clock = at ? minutesClock(at.minutes) : null;
    if (!at || !clock) continue;
    rows.push({
      key,
      title: TITLES[key],
      time: clock,
      end: ownEnd[key] ?? null,
      where: whereFor[key],
      source: at.source,
      sourceLabel: at.label,
      tbd: at.tbd,
      travelMinutes: key === "leave_for_ceremony" || key === "leave_for_reception" ? TRAVEL : 0,
      team: teamFor(key, at.minutes),
    });
  }
  // The studio's own moments that are none of the above ("Sunset portraits").
  for (const rule of rules) {
    if (ruleTarget(rule.name)) continue;
    const at = byRule(rule);
    const clock = at ? minutesClock(at.minutes) : null;
    if (!clock) continue;
    rows.push({
      key: `rule:${rule.id}`,
      title: rule.name.trim(),
      time: clock,
      end: null,
      where: receptionPlace,
      source: "rule",
      sourceLabel: `Your timing: ${rule.name.trim()}`,
      tbd: false,
      travelMinutes: 0,
      team: teamFor(null, at!.minutes),
    });
  }
  rows.sort((left, right) => clockMinutes(left.time) - clockMinutes(right.time) || order.indexOf(left.key as MilestoneKey) - order.indexOf(right.key as MilestoneKey));
  /**
   * A block runs to the next one — unless that would stretch it across free
   * time. A first look at 12:45 with nothing until the hide at 3:30 is a
   * 45-minute first look and a gap, not a three-hour one.
   */
  const usualLength = (row: PlanRow): number => {
    if (row.key.startsWith("rule:")) return rules.find((rule) => `rule:${rule.id}` === row.key)?.durationMinutes ?? 0;
    const key = row.key as MilestoneKey;
    if (key === "arrive") return 0;
    if (key === "ceremony") return ceremonyLength;
    if (key === "entrances" || key === "dinner" || key === "groom") return 60;
    if (key === "cake") return 15;
    if (key === "night") return 30;
    return length(key);
  };
  const sameTrack = (left: Team, right: Team) => left === "all" || right === "all" || left === right;
  rows.forEach((row, index) => {
    const next = rows.slice(index + 1).find((later) => sameTrack(row.team, later.team) && later.time > row.time);
    const natural = usualLength(row);
    if (row.end || !next || natural <= 0) return;
    const start = clockMinutes(row.time);
    if (clockMinutes(next.time) - start >= natural + 30) row.end = minutesClock(start + natural);
  });
  // A line both teams are on ends when the second team leaves, so it can say they conclude there.
  if (input.secondTeam && secondEnd) {
    const leave = clockMinutes(secondEnd);
    rows.forEach((row, index) => {
      if (row.team !== "all" || row.end || clockMinutes(row.time) >= leave) return;
      const next = rows.slice(index + 1).find((later) => sameTrack(row.team, later.team) && later.time > row.time);
      if (next && clockMinutes(next.time) > leave) row.end = secondEnd;
    });
  }
  const startClock = minutesClock(arrive.minutes);
  const endClock = minutesClock(Math.min(end, 24 * 60 - 1));
  return { churchDay, firstLook, rows, coverageStart: startClock, coverageEnd: endClock, notes };
}

/** The tail every view shows on a line whose time isn't settled. */
export const TBD_SUFFIX = " — time TBD";
export const titleIsTbd = (title: string) => title.endsWith(TBD_SUFFIX);
export const withTbdTitle = (title: string, tbd: boolean) => {
  const bare = titleIsTbd(title) ? title.slice(0, -TBD_SUFFIX.length) : title;
  return tbd ? `${bare}${TBD_SUFFIX}` : bare;
};

const SOURCE_TYPE: Record<PlanSource, "questionnaire_answer" | "timing_rule" | "assumption" | "project_fact"> = {
  form: "questionnaire_answer",
  rule: "timing_rule",
  usual: "assumption",
  coverage: "project_fact",
};

export type PlannedItem = {
  id: string;
  startAt: string;
  endAt: string;
  title: string;
  description: string;
  location: string | null;
  address: string | null;
  travelMinutes: number;
  crewIds: string[];
  photographerIds: string[];
  participants: string[];
  vendorContactIds: string[];
  equipment: string[];
  notes: string | null;
  visibility: "shared";
  blockingIssues: string[];
  sourceReferences: Array<{ type: (typeof SOURCE_TYPE)[PlanSource]; sourceId: string; label: string }>;
};

/**
 * The plan as schedule items on the event's day, in its own zone. Each block
 * ends where the next starts unless it has its own end; the last ends with
 * coverage.
 */
export function planItems(
  plan: DayPlan,
  input: {
    eventDate: string;
    timeZone: string;
    idFor: (index: number) => string;
    /** Crew profile ids on each team (crew-labels.ts: P1/V1 first, P2/V2 second). */
    teams?: { first: readonly string[]; second: readonly string[] };
  },
): PlannedItem[] {
  const at = (clock: string) => wallClockToIso(input.eventDate, clock, input.timeZone);
  const coverageEnd = plan.coverageEnd ? at(plan.coverageEnd) : null;
  const pinned = new Set<string>();
  // Everyone is no tag at all: a line the whole crew covers names nobody.
  const crewFor = (team: Team): string[] => (team === "all" || !input.teams ? [] : [...input.teams[team]]);
  const items: PlannedItem[] = plan.rows.flatMap((row, index) => {
    const startAt = at(row.time);
    if (!startAt) return [];
    const id = input.idFor(index);
    const ownEnd = row.end ? at(row.end) : null;
    if (ownEnd) pinned.add(id);
    return [{
      id,
      startAt,
      endAt: ownEnd ?? startAt,
      title: withTbdTitle(row.title, row.tbd),
      description: "",
      location: row.where,
      address: null,
      travelMinutes: row.travelMinutes,
      crewIds: crewFor(row.team),
      photographerIds: crewFor(row.team),
      participants: [],
      vendorContactIds: [],
      equipment: [],
      notes: null,
      visibility: "shared" as const,
      blockingIssues: [],
      sourceReferences: [{ type: SOURCE_TYPE[row.source], sourceId: `day_plan_${row.key}`, label: row.sourceLabel }],
    }];
  });
  return flowEnds(items, pinned, coverageEnd);
}

/**
 * Ends that follow the day: each block runs until the next one starts, the
 * last until coverage ends. A block whose end the studio set (`pinned`) keeps
 * it. A block that would end at or before it starts gets half an hour.
 * Returned in the order given, so a row doesn't jump while its time is typed.
 */
export function flowEnds<T extends { id: string; startAt: string; endAt: string; crewIds?: readonly string[] | unknown }>(
  items: readonly T[],
  pinned: ReadonlySet<string>,
  coverageEndIso: string | null,
): T[] {
  const ends = flowingEnds(items, coverageEndIso);
  return items.map((item) => {
    const start = Date.parse(item.startAt);
    if (pinned.has(item.id) && Date.parse(item.endAt) > start) return item;
    const endAt = ends.get(item.id) ?? item.endAt;
    return endAt === item.endAt ? item : { ...item, endAt };
  });
}

type Tracked = { id: string; startAt: string; crewIds?: readonly string[] | unknown; photographerIds?: unknown };
const crewOf = (item: Tracked): string[] => {
  const list = Array.isArray(item.crewIds) ? item.crewIds : Array.isArray(item.photographerIds) ? item.photographerIds : [];
  return list.filter((id): id is string => typeof id === "string" && id.length > 0);
};
/**
 * Whether two lines are on the same track: they share someone, or either is
 * everyone's (no crew named). The groom with the second team at 1:00 runs on
 * past the bride's 1:00 touch-ups with the first.
 */
export function sameTrack(left: Tracked, right: Tracked): boolean {
  const a = crewOf(left);
  const b = crewOf(right);
  return !a.length || !b.length || a.some((id) => b.includes(id));
}

/** Where each block would end if it ran to the next one on its track (or to coverage end). */
function flowingEnds(items: ReadonlyArray<Tracked>, coverageEndIso: string | null): Map<string, string> {
  const sorted = [...items].sort((left, right) => Date.parse(left.startAt) - Date.parse(right.startAt));
  const ends = new Map<string, string>();
  sorted.forEach((item, index) => {
    const start = Date.parse(item.startAt);
    const next = sorted.slice(index + 1).find((later) => Date.parse(later.startAt) > start && sameTrack(item, later));
    const candidate = next ? Date.parse(next.startAt) : coverageEndIso ? Date.parse(coverageEndIso) : Number.NaN;
    const end = Number.isFinite(candidate) && candidate > start ? candidate : start + 30 * 60_000;
    if (Number.isFinite(start)) ends.set(item.id, new Date(end).toISOString());
  });
  return ends;
}

/**
 * The blocks whose end someone chose: anything that doesn't end where the
 * day would end it. Read off a saved version, so opening it to change one
 * time keeps every deliberate gap.
 */
export function pinnedEnds(items: ReadonlyArray<Tracked & { endAt: string }>, coverageEndIso: string | null): Set<string> {
  const ends = flowingEnds(items, coverageEndIso);
  return new Set(
    items
      .filter((item) => {
        const flowing = ends.get(item.id);
        return flowing !== undefined && Date.parse(flowing) !== Date.parse(item.endAt);
      })
      .map((item) => item.id),
  );
}
