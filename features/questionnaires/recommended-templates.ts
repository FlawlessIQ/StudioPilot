/**
 * StudioCue's recommended wedding forms — GR Productions' own, ready to use.
 *
 * Gabe (2026-10-02): "wedding forms, as detailed as possible… cover 99.9% of
 * weddings." Offered to every studio as a recommendation: a studio without
 * forms of its own uses them as they are, and any studio makes a copy and
 * adjusts it ("they can make a copy and adjust like you have now"). A copy is
 * an ordinary template in the studio's library; these stay as they are.
 *
 * Two forms, two moments:
 *   - the event details form goes with a new inquiry (Questionnaires → "Send
 *     with new wedding inquiries"). Locations and times allow "TBD" — Gabe:
 *     "in initial details we can offer a TBD option" — and land in Schedule A
 *     of the agreement (contracts/event-details.ts) as "To be confirmed";
 *   - the final schedule is the planning form, six months out by default
 *     (Settings → Planning timeline). It asks the same questions with the
 *     same wording, so the couple's earlier answers fill it in
 *     (functions/src/planning/job-facts.ts matches by question), then the
 *     family names and the day in order, with Gabe's rules as notes and as
 *     suggested times. Everything it asks about where and when locks four
 *     weeks before (planning/details-lock.ts) — which is why every step of
 *     the day says "time": the lock and Schedule A sort by the wording.
 *
 * Ids line up with what already reads answers: `getting-ready`,
 * `ceremony-time`, `reception-time`, `first-look-time`, `dinner-time`,
 * `cake-cutting-time`, `coverageStartTime` and `coverageEndTime` are the ids
 * the run-of-show generator looks for (components/planning/ai-schedule-generator.tsx).
 */

import type { SuggestedFrom } from "./field-extras";

export type RecommendedField = {
  id: string;
  label: string;
  type: string;
  required: boolean;
  locked: boolean;
  internalOnly: boolean;
  options: string[];
  conditionalOn: { fieldId: string; equals: unknown } | null;
  /** A note under the question. */
  help?: string;
  /** The couple may answer "TBD" (field-extras.ts). */
  allowTbd?: boolean;
  /** A time suggested from another answer (field-extras.ts). */
  suggestedFrom?: SuggestedFrom;
};

export type RecommendedSection = { id: string; title: string; fields: RecommendedField[] };

export type RecommendedQuestionnaire = {
  /** Stable: a studio's copy carries it as `recommendedId`. */
  id: string;
  name: string;
  /** What it's for, on the card. */
  summary: string;
  /** Where a studio puts it to work, on the card. */
  useIt: string;
  eventTypeId: string;
  dueDaysBeforeEvent: number;
  reminderDaysBeforeDue: number[];
  sections: RecommendedSection[];
};

type Extras = { help?: string; allowTbd?: boolean; suggestedFrom?: SuggestedFrom };

const field = (id: string, label: string, type: string, required: boolean, extras: Extras = {}): RecommendedField => ({
  id,
  label,
  type,
  required,
  locked: false,
  internalOnly: false,
  options: [],
  conditionalOn: null,
  ...extras,
});

/**
 * The event details, in Gabe's order. `tbd` is whether "TBD" is offered: yes
 * at the inquiry, no on the final schedule, which exists to settle them.
 */
function eventDetailSections(tbd: boolean): RecommendedSection[] {
  const where = (id: string, label: string, required = true, help?: string) =>
    field(id, label, "address", required, { allowTbd: tbd, ...(help ? { help } : {}) });
  const when = (id: string, label: string, required = true, help?: string) =>
    field(id, label, "time", required, { allowTbd: tbd, ...(help ? { help } : {}) });
  return [
    {
      id: "bride",
      title: "The bride",
      fields: [
        field("event-date", "Event date", "date", true),
        field("bride-name", "Bride's name", "text", true),
        field("bride-email", "Bride's email", "email", true),
        field("bride-phone", "Bride's phone", "phone", true),
        where("getting-ready", "Bridal prep location"),
        when("bridal-prep-start", "Bridal prep start time"),
        when("bridal-prep-end", "Bridal prep end time"),
      ],
    },
    {
      id: "groom",
      title: "The groom",
      fields: [
        field("groom-name", "Groom's name", "text", true),
        field("groom-phone", "Groom's phone", "phone", true),
        field("groom-email", "Groom's email", "email", true),
        where("groom-prep-location", "Groom prep location"),
      ],
    },
    {
      id: "ceremony-reception",
      title: "Ceremony and reception",
      fields: [
        where("ceremony-location", "Ceremony location"),
        when("ceremony-time", "Ceremony start time"),
        when("ceremony-end-time", "Ceremony end time"),
        when("cocktail-hour-time", "Cocktail start time"),
        when("cocktail-end-time", "Cocktail end time"),
        where("reception-location", "Reception location"),
        when("reception-time", "Reception start time"),
        when("reception-end-time", "Reception end time"),
        field("guest-count", "Number of invited guests", "text", true, { allowTbd: tbd }),
      ],
    },
    {
      id: "coverage",
      title: "Photo and video coverage",
      fields: [
        when("coverageStartTime", "Photo 1 / Video 1 start time", true, "When your main photographer and videographer start."),
        when("coverageEndTime", "Photo 1 / Video 1 end time"),
        when("photo-2-start-time", "Photo 2 / Video 2 start time", false, "Your second photographer and videographer, if your package includes them."),
        when("photo-2-end-time", "Photo 2 / Video 2 end time", false),
      ],
    },
  ];
}

/** One step of the day: a time, Gabe's note, and the time it follows if there's a rule. */
const step = (id: string, label: string, help: string, suggestedFrom?: SuggestedFrom) =>
  field(id, label, "time", false, { help, ...(suggestedFrom ? { suggestedFrom } : {}) });

const DAY_IN_ORDER: RecommendedSection = {
  id: "day-in-order",
  title: "Your day, in order",
  fields: [
    step(
      "details-with-bride-time",
      "Details with the bride — time",
      "30 minutes before prep time ends. Please have the dress on a special hanger, and the shoes, flowers, rings and invitations ready when we get there.",
      { fieldId: "bridal-prep-end", minutes: -30 },
    ),
    step("touch-ups-time", "Touch-ups and robe or PJ shot — time", "At the end of prep time.", { fieldId: "bridal-prep-end", minutes: 0 }),
    step("bride-in-dress-time", "Bride in dress — time", "Allow 30 minutes."),
    step("groom-start-time", "Groom starting time", "All groomsmen should have their pants and shirts on."),
    step("first-look-time", "First look and couple portraits outside — time", "Allow 45 minutes."),
    step(
      "family-photos-time",
      "Bridal party and family pictures — time",
      "Allow 45 minutes. Make sure everyone in the families and the bridal party knows the start time. Everyone in the immediate families should be there and ready 15 minutes before.",
    ),
    step("hide-time", "Hide the bride and groom — time", "30 minutes before the ceremony.", { fieldId: "ceremony-time", minutes: -30 }),
    step("ceremony-run-time", "Ceremony — time", "Your ceremony start time.", { fieldId: "ceremony-time", minutes: 0 }),
    step("cocktail-run-time", "Cocktail hour — time", "Your cocktail start time.", { fieldId: "cocktail-hour-time", minutes: 0 }),
    step(
      "entrances-time",
      "Entrances, first dance, parent dances and speeches — time",
      "These should be the first hour of the reception.",
      { fieldId: "reception-time", minutes: 0 },
    ),
    step("dinner-time", "Dinner — time", "Check with your venue."),
    step("cake-cutting-time", "Cake cutting — time", "No later than 30 minutes before coverage ends."),
    step(
      "night-pictures-time",
      "Night pictures, dessert and dancing — time",
      "The last 30 minutes of coverage, when photo and video finish.",
      { fieldId: "coverageEndTime", minutes: -30 },
    ),
  ],
};

const FAMILY: RecommendedSection = {
  id: "family",
  title: "Family",
  fields: [
    field("bride-family-names", "Bride's family names", "long_text", false, {
      help: "Parents, grandparents and siblings — the names we call for family pictures.",
    }),
    field("groom-family-names", "Groom's family names", "long_text", false, {
      help: "Parents, grandparents and siblings — the names we call for family pictures.",
    }),
  ],
};

export function recommendedQuestionnaires(): RecommendedQuestionnaire[] {
  return [
    {
      id: "wedding-event-details",
      name: "Event details form",
      summary:
        "Locations, times, contacts and guest count, with a TBD option for anything not decided yet. What they give goes into Schedule A of the agreement.",
      useIt: "Send it with new wedding inquiries.",
      eventTypeId: "wedding",
      // Wanted before the agreement goes, which is months out.
      dueDaysBeforeEvent: 180,
      reminderDaysBeforeDue: [14, 3],
      sections: eventDetailSections(true),
    },
    {
      id: "wedding-final-schedule",
      name: "Final schedule",
      summary:
        "Their event details again (filled in from what they already gave), family names, and the day in order with suggested times.",
      useIt: "Use it as your planning form, sent six months before.",
      eventTypeId: "wedding",
      // In before the details lock four weeks out, with a week to read it.
      dueDaysBeforeEvent: 35,
      reminderDaysBeforeDue: [14, 3],
      sections: [...eventDetailSections(false), FAMILY, DAY_IN_ORDER],
    },
  ];
}

/** How many questions a form asks. */
export function recommendedFieldCount(template: RecommendedQuestionnaire): number {
  return template.sections.reduce((total, section) => total + section.fields.length, 0);
}
