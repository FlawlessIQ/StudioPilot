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
 *
 * Mirrored at functions/src/planning/recommended-templates.ts, so a new studio
 * starts with them (saas/onboarding.ts); tests/preloaded-forms.test.ts fails on
 * drift.
 */

import type { SuggestedFrom } from "./field-extras.js";

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
  /**
   * The trades it's for (features/trades/trades.ts). Absent: every trade —
   * the event details form is anyone's. The final schedule and shot list are
   * a photographer's; the music planner a DJ's.
   */
  trades?: readonly string[];
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
        // Saved to the client when answered and none is on file
        // (functions/src/contacts/address-from-form.ts): QuickBooks taxes
        // from it, and signing shows it filled in. Optional. The final
        // schedule repeats it like every detail above, already filled in.
        field("billing-address", "Home address (for billing)", "address", false, {
          help: "Street, city, state and ZIP. Where your invoices are addressed.",
        }),
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

/**
 * The shot list: the pictures that matter most to them, in their words.
 *
 * GR Productions (2026-10-05): "must take photos" is its own form, due four
 * weeks out (the details lock), and the crew must have it. Gabe's own sample
 * hasn't arrived; this is the usual working-studio list, written so his
 * questions can replace these without changing how it travels. The ids are
 * the ones the crew brief knows (crew-brief.ts), so a submitted list reaches
 * the crew's day sheet — the groups in the order to call them, the people to
 * find, and, first, anyone to avoid.
 */
const SHOT_LIST: RecommendedSection[] = [
  {
    id: "groups",
    title: "Family and group pictures",
    fields: [
      field("must-have-groups", "Family and group pictures, in the order to call them", "long_text", false, {
        help: "One group per line, as you'd like them called. For example: \"Us with both sets of parents\", \"Grandparents\", \"Everyone from the bridal party\".",
      }),
    ],
  },
  {
    id: "must-take",
    title: "Must-take pictures",
    fields: [
      field("must-have-shots", "Pictures you don't want us to miss", "long_text", false, {
        help: "Moments, people together, anything that matters most to you.",
      }),
      field("people-to-capture", "People we should be sure to photograph", "long_text", false, {
        help: "Who they are and how we'll recognize them. For example: \"Grandma Rose, blue dress, front row\".",
      }),
      field("details-to-capture", "Details to capture", "long_text", false, {
        help: "Rings, heirlooms, something handmade, a note from family.",
      }),
    ],
  },
  {
    id: "care",
    title: "Good to know",
    fields: [
      field("no-photo-list", "Anyone who must not be photographed or filmed", "long_text", false),
      field("sensitivities", "Anything we should handle carefully", "long_text", false, {
        help: "Separated parents, someone unwell, a recent loss. Only your crew see this.",
      }),
    ],
  },
];

/** A radio question with its answers. */
const choice = (id: string, label: string, options: string[], extras: Extras = {}): RecommendedField => ({
  ...field(id, label, "radio", false, extras),
  options,
});

/**
 * A DJ's music and moments planner (docs/vendor-journeys.md, from Check
 * Cherry's study of 765 real DJ questionnaires and DJ planning forms).
 *
 * The songs for each moment, the names the DJ says on the microphone with
 * how to say them, the order of the toasts, and the dance floor. The phonetic
 * names are the point: a mispronounced name is a DJ's signature failure.
 * Ids match the moments of the run of show (features/schedules/mc-script.ts),
 * so the songs and announcements land on the right lines of the MC script.
 */
const MUSIC_PLANNER: RecommendedSection[] = [
  {
    id: "ceremony-music",
    title: "Ceremony music",
    fields: [
      field("prelude-music", "Music while guests arrive", "long_text", false, {
        help: "A playlist link, a few artists, or a feeling. Skip this if we're not playing your ceremony.",
      }),
      field("processional-song", "Processional — the wedding party walks in", "text", false, { help: "Song and artist, and the version if it matters." }),
      field("entrance-song", "Your entrance — the bride, or the two of you", "text", false),
      field("recessional-song", "Recessional — walking out married", "text", false),
      field("ceremony-mics", "Who speaks at the ceremony and needs a microphone", "long_text", false, {
        help: "The officiant, readers, anyone singing or playing.",
      }),
    ],
  },
  {
    id: "entrances",
    title: "Grand entrance",
    fields: [
      field("grand-entrance-song", "Grand entrance song", "text", false),
      field("entrance-names", "Who we introduce, in order, and how to say each name", "long_text", true, {
        help: "One per line, as you'd like it said, with how it sounds. For example: \"Maid of honor, Siobhan Murphy (shi-VAWN)\". End with how we introduce the two of you.",
      }),
    ],
  },
  {
    id: "key-moments",
    title: "Key moments",
    fields: [
      field("first-dance-song", "First dance", "text", false, { help: "Song and artist, and whether to fade early." }),
      field("parent-dance-songs", "Parent dances", "long_text", false, {
        help: "Who dances with whom, and the song for each.",
      }),
      field("toast-order", "Toasts and speeches, in order", "long_text", false, {
        help: "Who speaks, how to say their name, and how they know you.",
      }),
      field("cake-cutting-song", "Cake cutting", "text", false),
      choice("bouquet-garter", "Bouquet and garter toss", ["Both", "Bouquet only", "Garter only", "Neither"]),
      field("last-dance-song", "Last dance", "text", false),
      field("exit-plan", "Your exit or send-off", "text", false, { help: "Sparklers, bubbles, a song to walk out to." }),
    ],
  },
  {
    id: "dance-floor",
    title: "The dance floor",
    fields: [
      field("must-play", "Must-play songs", "long_text", false, { help: "Up to ten. These are the ones we'll make sure happen." }),
      field("do-not-play", "Do-not-play songs", "long_text", false, { help: "Anything you never want to hear, guaranteed." }),
      field("genres", "Genres you love, and any you don't", "long_text", false),
      choice("guest-requests", "Guest requests", ["Yes, take requests", "Only if they fit the night", "No requests"]),
      choice("explicit-lyrics", "Explicit lyrics", ["Clean versions only", "Fine after dinner", "Anything goes"]),
    ],
  },
  {
    id: "on-the-day",
    title: "On the day",
    fields: [
      field("venue-coordinator", "Venue coordinator — name and phone", "text", false),
      field("load-in-notes", "Load-in, parking and power at your venue", "long_text", false, {
        help: "Where we unload, any sound limit, and the time we can get in.",
      }),
    ],
  },
];

/**
 * A makeup or hair client's party list (docs/vendor-journeys.md, 3.3): who
 * is getting ready, what each wants, and the times the chair schedule is
 * worked back from. One person per line, because a form has no rows to add;
 * features/schedules/party-list.ts reads the lines.
 */
const PARTY_LIST: RecommendedSection[] = [
  {
    id: "the-morning",
    title: "The morning",
    fields: [
      field("ready-by-time", "When does everyone need to be ready?", "time", true, {
        help: "Usually when your photographer arrives for the dress or the first look. Ask them if you're not sure.",
      }),
      field("earliest-start-time", "The earliest we can start setting up", "time", false, {
        help: "When you can let us into the room.",
      }),
      field("getting-ready", "Where you're getting ready", "address", true),
      field("parking-notes", "Room number and parking", "text", false),
    ],
  },
  {
    id: "your-party",
    title: "Your party",
    fields: [
      field("party-list", "Everyone getting ready with us, one person per line", "repeating_group", true, {
        help: "Name — who they are — hair, makeup or both — anything we should know. For example: \"Maya Brooks — bride — hair and makeup — sensitive skin\", \"Jess Lee — bridesmaid — makeup — lashes\", \"Ava — flower girl — hair\".",
      }),
    ],
  },
  {
    id: "good-to-know",
    title: "Good to know",
    fields: [
      field("allergies-notes", "Allergies, sensitive skin or anything we should be careful with", "long_text", false),
      field("inspiration-links", "Links to inspiration photos", "long_text", false),
    ],
  },
];

/**
 * What a makeup artist asks the bride about her own skin (docs/vendor-journeys-plan.md,
 * Phase 4): the type and anything to be careful of decide the products, and
 * lashes are an extra she may want for her party too.
 */
const MAKEUP_SKIN: RecommendedSection = {
  id: "your-skin",
  title: "Your skin",
  fields: [
    choice("skin-type", "Your skin type", ["Dry", "Oily", "Combination", "Normal", "Sensitive", "Not sure"]),
    field("skin-notes", "Anything about your skin we should know", "long_text", false, {
      help: "Breakouts, rosacea, a recent facial, peel or treatment, or products that don't agree with you.",
    }),
    choice("lashes", "Would you like false lashes?", ["Yes, just me", "Yes, me and my party", "No lashes", "Not sure yet"], {
      help: "For anyone in your party who wants them, add \"lashes\" to their line above.",
    }),
  ],
};

/**
 * What a hair stylist asks the bride about her own hair (Phase 5): length and
 * texture decide the time in the chair, the style and the veil decide the
 * trial, and extensions take weeks to order.
 */
const HAIR_DETAILS: RecommendedSection = {
  id: "your-hair",
  title: "Your hair",
  fields: [
    choice("hair-length", "Your hair's length", ["Short", "Shoulder length", "Long", "Very long"]),
    choice("hair-texture", "Your hair's texture", ["Straight", "Wavy", "Curly", "Coily", "Fine", "Thick"]),
    choice("hair-style", "The style you have in mind", ["Updo", "Half up", "Down", "Not sure yet"]),
    choice("extensions", "Extensions", ["I have my own", "I'd like to buy them", "I'd like to rent them", "Please recommend", "No extensions"], {
      help: "Extensions take six to eight weeks to arrive, so we settle them at your trial.",
    }),
    choice("veil", "Will you wear a veil?", ["Yes", "No", "Not sure yet"], {
      help: "Bring it to your trial if you have it, so the style holds it.",
    }),
    field("accessories", "Hair accessories", "text", false, {
      help: "Combs, pins, a crown or flowers.",
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
      trades: ["photographer"],
      // In before the details lock four weeks out, with a week to read it.
      dueDaysBeforeEvent: 35,
      reminderDaysBeforeDue: [14, 3],
      sections: [...eventDetailSections(false), FAMILY, DAY_IN_ORDER],
    },
    {
      id: "wedding-shot-list",
      name: "Shot list",
      summary:
        "The pictures that matter most to them: family groups in the order to call them, must-take moments, people to find, and anyone to avoid. Your crew see it on their day sheet.",
      useIt: "Choose it as your shot list in Settings → Planning timeline, and it goes out with the planning form.",
      eventTypeId: "wedding",
      trades: ["photographer"],
      // A week before the day (Gabe, GR 2026-10-08): couples settle family
      // groups late, and the crew need it for the day sheet, not the lock.
      dueDaysBeforeEvent: 7,
      reminderDaysBeforeDue: [14, 3],
      sections: SHOT_LIST,
    },
    {
      id: "dj-music-planner",
      name: "Music & moments planner",
      summary:
        "The songs for every moment, the names you'll say on the mic with how to say them, the toast order, and the dance floor: must-plays, do-not-plays and requests.",
      useIt: "Your planning form: it goes out when they book, and locks ten days before.",
      eventTypeId: "wedding",
      trades: ["dj"],
      // In a month out, so the final planning call has it to go through.
      dueDaysBeforeEvent: 30,
      reminderDaysBeforeDue: [14, 3],
      sections: MUSIC_PLANNER,
    },
    {
      id: "makeup-party-list",
      name: "Party list",
      summary:
        "Everyone getting ready, what each wants, when they must be ready by, and the bride's skin and lashes. Your getting-ready schedule is laid out from it.",
      useIt: "Your planning form: it goes out when they book, and the headcount locks a month before.",
      eventTypeId: "wedding",
      trades: ["makeup"],
      // In before the headcount locks a month out, with a week to read it.
      dueDaysBeforeEvent: 37,
      reminderDaysBeforeDue: [14, 3],
      sections: [PARTY_LIST[0]!, PARTY_LIST[1]!, MAKEUP_SKIN, PARTY_LIST[2]!],
    },
    {
      id: "hair-party-list",
      name: "Party list",
      summary:
        "Everyone getting ready, what each wants, when they must be ready by, and the bride's hair, veil and extensions. Your getting-ready schedule is laid out from it.",
      useIt: "Your planning form: it goes out when they book, and the headcount locks a month before.",
      eventTypeId: "wedding",
      trades: ["hair"],
      dueDaysBeforeEvent: 37,
      reminderDaysBeforeDue: [14, 3],
      sections: [PARTY_LIST[0]!, PARTY_LIST[1]!, HAIR_DETAILS, PARTY_LIST[2]!],
    },
  ];
}

/** The recommended forms for a studio of this trade. */
export function recommendedFor(trade: string): RecommendedQuestionnaire[] {
  return recommendedQuestionnaires().filter((form) => !form.trades || form.trades.includes(trade));
}

/** How many questions a form asks. */
export function recommendedFieldCount(template: RecommendedQuestionnaire): number {
  return template.sections.reduce((total, section) => total + section.fields.length, 0);
}
