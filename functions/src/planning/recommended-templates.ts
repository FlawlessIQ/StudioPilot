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
 * One of the event details form's own questions, as it asks it, for a form
 * that folds it in. Same id and same words, so an earlier answer fills it in
 * (functions/src/planning/job-facts.ts matches by question), Schedule A and
 * the details lock read it as they always have (contracts/event-details.ts),
 * and the day's plan finds it by id.
 */
function eventDetailField(id: string, change: Partial<RecommendedField> = {}): RecommendedField {
  const found = eventDetailSections(false)
    .flatMap((section) => section.fields)
    .find((candidate) => candidate.id === id);
  if (!found) throw new Error(`No event details question ${id}`);
  return { ...found, ...change };
}

/**
 * A DJ's music and moments planner (docs/vendor-journeys.md, from Check
 * Cherry's study of 765 real DJ questionnaires and DJ planning forms).
 *
 * The songs for each moment, the names the DJ says on the microphone with
 * how to say them, the order of the toasts, and the dance floor. The phonetic
 * names are the point: a mispronounced name is a DJ's signature failure.
 * Ids match the moments of the run of show (features/schedules/mc-script.ts),
 * so the songs and announcements land on the right lines of the MC script.
 *
 * It is the couple's one form (trades.ts `journey.oneForm`; Conor,
 * 2026-10-09), so it opens with the few things the event details form asked
 * that the night is laid out from (features/schedules/night-plan.ts): where
 * the ceremony and the reception are, and when they start and end. The venue
 * coordinator below is the contact on the night.
 */
const MUSIC_PLANNER: RecommendedSection[] = [
  {
    id: "where-and-when",
    title: "Where and when",
    fields: [
      eventDetailField("ceremony-location", {
        required: false,
        help: "Skip the ceremony questions if we're not playing your ceremony.",
      }),
      eventDetailField("ceremony-time", { required: false }),
      eventDetailField("reception-location"),
      eventDetailField("reception-time"),
      eventDetailField("reception-end-time", { help: "When the music stops." }),
    ],
  },
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
 *
 * It is the client's one form (trades.ts `journey.oneForm`), so it carries
 * what the event details form asked that the morning needs: where, the
 * ready-by time, and someone to call on the morning.
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
      field("day-of-contact", "Your day-of contact — name and phone", "text", false, {
        help: "Who we call on the morning if it isn't you: a bridesmaid, your mom or your planner.",
      }),
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
 * A hair stylist's party line asks about hair alone. The shared one's "hair,
 * makeup or both" and its lashes and sensitive skin read as if the studio did
 * makeup too (Priya Shah, Jess Styles Bridal, 2026-10-10). A line naming no
 * service is the studio's own (party-list.ts), so a hair client never has to
 * write "hair".
 */
const HAIR_PARTY: RecommendedSection = {
  ...PARTY_LIST[1]!,
  fields: [
    field("party-list", "Everyone getting ready with us, one person per line", "repeating_group", true, {
      help: "Name — who they are — anything we should know about their hair. For example: \"Priya Shah — bride — veil, clip-in extensions\", \"Meera — mother of the bride — short hair, a soft blowout\", \"Diya — flower girl — a simple braid\".",
    }),
  ],
};

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

/**
 * A wedding planner's Final details (docs/planner-journey-plan.md, N6): what
 * a month-of couple hands over when the work starts, and what a full or
 * partial planner's couple confirms. Getting ready, the ceremony order, the
 * people to call, the décor they're bringing, the venue's rules, the
 * rehearsal and the final guest count — and their vendors, one per line,
 * filled in from the vendor team (planning/vendor-section.ts). Vendors they
 * add join the team when they send it back.
 *
 * Ids line up with what already reads answers: `getting-ready`,
 * `ceremony-time` and `reception-time` (the run-of-show generator), and
 * `vendor-team` (the vendor section). Due four weeks out; locks two weeks
 * out, when the guest count is final (trades.ts `planning`).
 */
const PLANNER_FINAL_DETAILS: RecommendedSection[] = [
  {
    id: "getting-ready-and-ceremony",
    title: "Getting ready and the ceremony",
    fields: [
      field("getting-ready", "Where you're each getting ready", "long_text", true, {
        help: "Both of you, with the address and a room number if you have one.",
      }),
      field("ceremony-location", "Ceremony location", "address", true),
      field("ceremony-time", "Ceremony start time", "time", true),
      field("processional", "The ceremony order: who walks in, in order", "long_text", false, {
        help: "Officiant, wedding party, ring bearer, flower girl, parents. One per line is easiest.",
      }),
      field("reception-location", "Reception location", "address", true, {
        help: "Leave it the same as the ceremony if it's one place.",
      }),
      field("reception-time", "Reception start time", "time", true),
    ],
  },
  {
    id: "key-people",
    title: "Key people",
    fields: [
      field("key-people", "Key people and their cell numbers, one per line", "long_text", true, {
        help: "Parents, the wedding party, whoever holds the rings and the license, and who we call on the day if it isn't you.",
      }),
    ],
  },
  {
    id: "decor-and-venue",
    title: "Your décor and the venue",
    fields: [
      field("decor-bringing", "Décor and items you're bringing", "long_text", false, {
        help: "Signs, guest book, card box, favors, photos, anything personal. Who drops them off, and when.",
      }),
      field("venue-rules", "The venue's rules", "long_text", false, {
        help: "Candles, confetti, sparklers, load-in and end times, anything their coordinator told you.",
      }),
      field("after-the-day", "Who takes things home at the end of the night", "text", false),
    ],
  },
  {
    id: "rehearsal",
    title: "The rehearsal",
    fields: [
      field("rehearsal-date-time", "Rehearsal day and time", "text", true, {
        help: "Usually the day before, at the ceremony location.",
      }),
      field("rehearsal-attendees", "Who's coming to the rehearsal", "long_text", false, {
        help: "Everyone in the ceremony: the wedding party, readers, parents, the officiant.",
      }),
    ],
  },
  {
    id: "guests",
    title: "Guests",
    fields: [field("guest-count", "Final guest count", "text", true, { help: "Your best number now. We'll confirm it two weeks out." })],
  },
  {
    id: "vendors",
    title: "Your vendors",
    fields: [
      field("vendor-team", "Your vendors, one per line", "repeating_group", false, {
        help: "What they do — company — contact, phone or email — when they arrive. For example: \"Florist — Petal & Stem — Rosa, 908 555 0117 — arriving 1:30 PM\". The ones we already have are filled in: correct anything that's changed, and add anyone missing.",
      }),
    ],
  },
];

/**
 * A bar or bat mitzvah's details (docs/mitzvah-journey-plan-2026-10-14.md,
 * Phase 3). The parents fill it in about their child. Three places, often on
 * different days: the portrait session at the synagogue, the service (often on
 * Shabbat, often closed to cameras), and the party, which is the event date
 * and the day plan's anchor (mitzvah-plan.ts). The ids are the ones the day
 * plan, Schedule A (event-details.ts) and the crew brief read.
 */
function mitzvahDetailSections(tbd: boolean): RecommendedSection[] {
  const where = (id: string, label: string, required = true, help?: string) =>
    field(id, label, "address", required, { allowTbd: tbd, ...(help ? { help } : {}) });
  const when = (id: string, label: string, required = true, help?: string) =>
    field(id, label, "time", required, { allowTbd: tbd, ...(help ? { help } : {}) });
  return [
    {
      id: "family",
      title: "Your family",
      fields: [
        field("event-date", "Party date", "date", true),
        field("parent-names", "Parents' names", "text", true),
        field("parent-email", "Parent's email", "email", true),
        field("parent-phone", "Parent's phone", "phone", true),
        field("billing-address", "Home address (for billing)", "address", false, {
          help: "Street, city, state and ZIP. Where your invoices are addressed.",
        }),
        field("honoree-name", "Who we're celebrating (first name)", "text", true),
        field("honoree-pronunciation", "How to say their name", "text", false, {
          help: "As it sounds, if it's easy to get wrong. The crew and the MC read this.",
        }),
      ],
    },
    {
      id: "service",
      title: "The service",
      fields: [
        where("synagogue", "Synagogue", true, "Name and address."),
        when("service-time", "Service start time"),
        {
          ...field("service-photo-rules", "The synagogue's photography rules for the service", "radio", true, {
            help: "Many congregations allow no cameras during the service, especially on Shabbat. Ask the office if you're not sure.",
          }),
          options: ["No photography during the service", "Portraits only, before or after", "Photography allowed", "Not sure yet"],
        },
        field("portrait-session-date", "Portrait session date", "date", false, {
          help: "Torah and family portraits at the synagogue, often at the final rehearsal or a weekday service.",
        }),
        field("portrait-session-time", "Portrait session start time", "time", false),
      ],
    },
    {
      id: "party",
      title: "The party",
      fields: [
        where("party-location", "Party location"),
        when("party-start-time", "Party start time", true, "When the cocktail hour and the kids' room open."),
        when("party-end-time", "Party end time"),
        field("guest-count", "Number of invited guests", "text", true, { allowTbd: tbd }),
        field("kids-count", "How many of them are kids", "text", false, { allowTbd: tbd }),
        {
          ...field("kids-room", "Is there a separate kids' room?", "radio", false),
          options: ["Yes", "No", "Not sure yet"],
        },
      ],
    },
    {
      id: "coverage",
      title: "Photo and video coverage",
      fields: [
        when("coverageStartTime", "Photo 1 / Video 1 start time", true, "When your main photographer and videographer start."),
        when("coverageEndTime", "Photo 1 / Video 1 end time"),
        when("photo-2-start-time", "Photo 2 / Video 2 start time", false, "Your second photographer and videographer, if your package includes them. They cover the kids' room."),
        when("photo-2-end-time", "Photo 2 / Video 2 end time", false),
      ],
    },
  ];
}

const MITZVAH_FAMILY: RecommendedSection = {
  id: "family-names",
  title: "Family and the candles",
  fields: [
    field("family-names", "Family names for portraits", "long_text", false, {
      help: "Parents, grandparents and siblings — the names we call for family pictures.",
    }),
    field("candle-lighting-list", "The candle lighting, in order", "long_text", false, {
      help: "One candle per line: who lights it. For example: \"In memory — Grandpa Saul\", \"Grandparents — Ruth and Mel\". We photograph every one, and your DJ calls them up.",
    }),
  ],
};

const MITZVAH_EVENING: RecommendedSection = {
  id: "day-in-order",
  title: "Your party, in order",
  fields: [
    step("family-portraits-time", "Family portraits at the party venue — time", "Allow 45 minutes before the party starts. Everyone in the family photos should be there and ready 15 minutes before.", {
      fieldId: "party-start-time",
      minutes: -75,
    }),
    step("grand-entrance-time", "Grand entrance — time", "Usually an hour into the party.", { fieldId: "party-start-time", minutes: 60 }),
    step("hora-time", "Hora — time", "Straight after the entrance, with the chair lift.", { fieldId: "party-start-time", minutes: 65 }),
    step("blessings-time", "Blessings over the challah and wine — time", "Who says each one goes on the shot list."),
    step("speeches-time", "Parents' speech and toast — time", "Before dinner, or between the candles."),
    step("dinner-time", "Dinner — time", "Check with your venue."),
    step("candle-lighting-time", "Candle lighting — time", "Allow 30 minutes for 13 or 14 candles."),
    step("montage-time", "Montage — time", "If there is one."),
    step("dancing-time", "Dancing and games — time", "After the candles and the montage."),
    step("cake-time", "Cake — time", "No later than 45 minutes before coverage ends.", { fieldId: "coverageEndTime", minutes: -45 }),
    step("last-dance-time", "Last dance — time", "The last song of the night."),
  ],
};

/** A mitzvah's shot list: the wedding's ids, so it reaches the crew the same way, with the candles first. */
const MITZVAH_SHOT_LIST: RecommendedSection[] = [
  {
    id: "groups",
    title: "Family and group pictures",
    fields: [
      field("must-have-groups", "Family and group pictures, in the order to call them", "long_text", false, {
        help: "One group per line. For example: \"Sam with both sets of grandparents\", \"Sam with the cousins\", \"The whole family\".",
      }),
      field("candle-lighting-list", "The candle lighting, in order", "long_text", false, {
        help: "Who lights each candle, one per line. We photograph every candle.",
      }),
    ],
  },
  {
    id: "must-take",
    title: "Must-take pictures",
    fields: [
      field("must-have-shots", "Pictures you don't want us to miss", "long_text", false, {
        help: "The hora, a speech, friends from school, anything that matters most to you.",
      }),
      field("people-to-capture", "People we should be sure to photograph", "long_text", false, {
        help: "Who they are and how we'll recognize them. For example: \"Great-aunt Ruth, blue dress, table 4\".",
      }),
      field("details-to-capture", "Details to capture", "long_text", false, {
        help: "The tallit, the kippot, the sign-in board, the centerpieces, the favors.",
      }),
    ],
  },
  {
    id: "care",
    title: "Good to know",
    fields: [
      field("no-photo-list", "Anyone who must not be photographed or filmed", "long_text", false, {
        help: "Including any child whose parents haven't agreed to photos.",
      }),
      field("sensitivities", "Anything we should handle carefully", "long_text", false, {
        help: "Separated parents, someone unwell, a recent loss. Only your crew see this.",
      }),
    ],
  },
];

/**
 * The other trades' mitzvah forms (docs/mitzvah-journey-plan-2026-10-14.md,
 * Phase 4), on the same ids the mitzvah day plan (mitzvah-plan.ts), the MC
 * script (mc-script.ts) and the chair plan read: `party-location`,
 * `party-start-time`, `entrance-names`, `candle-lighting-list`, `party-list`.
 */
const mitzvahParty = (endHelp: string): RecommendedSection => ({
  id: "where-and-when",
  title: "Where and when",
  fields: [
    field("party-location", "Party location", "address", true),
    field("party-start-time", "Party start time", "time", true, { help: "When the cocktail hour and the kids' room open." }),
    field("party-end-time", "Party end time", "time", true, { help: endHelp }),
  ],
});

/** A DJ's mitzvah night: the entrance, the hora, the blessings, the candles with a song each, the montage, the games. */
const MITZVAH_MUSIC_PLANNER: RecommendedSection[] = [
  mitzvahParty("When the music stops."),
  {
    id: "entrances",
    title: "Grand entrance",
    fields: [
      field("grand-entrance-song", "Grand entrance song", "text", false),
      field("entrance-names", "Who we introduce, in order, and how to say each name", "long_text", true, {
        help: "One per line, as you'd like them said. For example: \"The Cohen family\", \"Grandparents Ruth and Mel\", \"And our bar mitzvah, Sam!\".",
      }),
    ],
  },
  {
    id: "hora",
    title: "The hora",
    fields: [
      field("hora-songs", "Hora songs", "long_text", false, { help: "Hava Nagila, or anything you'd like instead or after it." }),
      field("chair-lift", "Who goes up in the chair, in order", "long_text", false, {
        help: "Usually your child first, then the parents. Grandparents too, if they'd like.",
      }),
    ],
  },
  {
    id: "blessings-and-speeches",
    title: "Blessings and speeches",
    fields: [
      field("blessings", "Who says the blessings over the challah and the wine", "long_text", false),
      field("toast-order", "Speeches and toasts, in order", "long_text", false),
    ],
  },
  {
    id: "candles",
    title: "The candle lighting",
    fields: [
      field("candle-lighting-list", "The candle lighting, in order", "long_text", true, {
        help: "One candle per line: who lights it, how to introduce them, and their song. For example: \"In memory — Grandpa Saul — 'Somewhere Over the Rainbow'\". Usually 13 or 14 candles.",
      }),
    ],
  },
  {
    id: "montage-and-games",
    title: "The montage and the games",
    fields: [
      field("montage-file", "The montage: how we'll get it, and how long it runs", "text", false, {
        help: "A link to the video file, or who's sending it. We'll play it after the candles unless you'd rather another time.",
      }),
      field("games", "Games and dancers for the kids", "long_text", false, {
        help: "Anything planned: a dance-off, kids against adults, motivational dancers, prizes.",
      }),
    ],
  },
  {
    id: "dance-floor",
    title: "The dance floor",
    fields: [
      field("cake-cutting-song", "Cake", "text", false, { help: "A song for the cake, if you'd like one." }),
      field("last-dance-song", "Last dance", "text", false),
      field("must-play", "Must-play songs", "long_text", false),
      field("do-not-play", "Do-not-play songs", "long_text", false),
      field("genres", "Genres you love, and any you don't", "long_text", false),
      choice("guest-requests", "Guest requests", ["Yes, take requests", "Only if they fit the night", "No requests"]),
      choice("explicit-lyrics", "Explicit lyrics", ["Clean versions only", "Fine for the adults later on", "Anything goes"]),
    ],
  },
  {
    id: "on-the-day",
    title: "On the day",
    fields: [
      field("microphones", "Who needs a microphone", "long_text", false, {
        help: "A clip-on microphone for your child's speech, handhelds for the parents and the blessings.",
      }),
      field("venue-coordinator", "Venue coordinator — name and phone", "text", false),
      field("load-in-notes", "Load-in, parking and power at your venue", "long_text", false),
    ],
  },
];

/** Who's getting ready, for a mitzvah family: the same field as a wedding's, with the family's examples. */
const mitzvahPartyList = (help: string): RecommendedSection => ({
  id: "your-party",
  title: "Your family",
  fields: [field("party-list", "Everyone getting ready with us, one person per line", "repeating_group", true, { help })],
});

const MITZVAH_HELP: Record<string, string> = {
  "ready-by-time": "Usually when the family portraits start, or when you leave for the service.",
  "day-of-contact": "Who we call on the day if it isn't you: a grandparent, a friend or your planner.",
};

const MITZVAH_BEFORE_PARTY: RecommendedSection = {
  ...PARTY_LIST[0]!,
  id: "the-morning",
  title: "Before the party",
  fields: PARTY_LIST[0]!.fields.map((entry) => (MITZVAH_HELP[entry.id] ? { ...entry, help: MITZVAH_HELP[entry.id] } : entry)),
};

/** A mitzvah's hair, without a veil. */
const MITZVAH_HAIR_DETAILS: RecommendedSection = {
  ...HAIR_DETAILS,
  fields: HAIR_DETAILS.fields.filter((entry) => entry.id !== "veil"),
};

/** A planner's mitzvah: the service and the portraits, the party, the people, the candles, the décor, the vendors. */
const MITZVAH_PLANNER_FINAL_DETAILS: RecommendedSection[] = [
  {
    id: "service-and-party",
    title: "The service and the party",
    fields: [
      field("synagogue", "Synagogue", "address", true),
      field("service-time", "Service start time", "time", true),
      field("portrait-session-date", "Portrait session date", "date", false),
      field("party-location", "Party location", "address", true),
      field("party-start-time", "Party start time", "time", true),
      field("party-end-time", "Party end time", "time", false),
    ],
  },
  {
    id: "key-people",
    title: "Key people",
    fields: [
      field("key-people", "The people we should know on the day", "long_text", true, {
        help: "Grandparents, the rabbi or cantor, anyone giving a blessing or a speech, and who we call if we can't reach you.",
      }),
      field("candle-lighting-list", "The candle lighting, in order", "long_text", false, {
        help: "One candle per line: who lights it. We line them up, and your DJ calls them.",
      }),
    ],
  },
  ...PLANNER_FINAL_DETAILS.filter((section) => section.id === "decor-and-venue"),
  {
    id: "guests",
    title: "Guests",
    fields: [
      field("guest-count", "Final guest count", "text", true),
      field("kids-count", "How many of them are kids", "text", false),
    ],
  },
  ...PLANNER_FINAL_DETAILS.filter((section) => section.id === "vendors"),
];

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
    // Bar and bat mitzvahs (docs/mitzvah-journey-plan-2026-10-14.md, Phase 3):
    // a photographer's three, copied in when a studio first offers the kind
    // (crm `setInquiryForm`), never at signup (`recommendedFor`).
    {
      id: "mitzvah-details",
      name: "Mitzvah details",
      summary:
        "The family, who you're celebrating, the synagogue and its photography rules, the portrait session, the party and coverage, with a TBD option for anything not decided yet. What they give goes into Schedule A.",
      useIt: "Send it with new bar and bat mitzvah inquiries.",
      eventTypeId: "mitzvah",
      trades: ["photographer"],
      dueDaysBeforeEvent: 120,
      reminderDaysBeforeDue: [14, 3],
      sections: mitzvahDetailSections(true),
    },
    {
      id: "mitzvah-final-schedule",
      name: "Mitzvah final schedule",
      summary:
        "Their details again (filled in from what they already gave), family names, the candle lighting in order, and the party in order with suggested times.",
      useIt: "Your mitzvah planning form: it goes out three months before.",
      eventTypeId: "mitzvah",
      trades: ["photographer"],
      dueDaysBeforeEvent: 35,
      reminderDaysBeforeDue: [14, 3],
      sections: [...mitzvahDetailSections(false), MITZVAH_FAMILY, MITZVAH_EVENING],
    },
    {
      id: "mitzvah-shot-list",
      name: "Mitzvah shot list",
      summary:
        "Family groups in the order to call them, the candle lighting, must-take moments, people to find, and anyone to avoid. Your crew see it on their day sheet.",
      useIt: "It goes out with the mitzvah planning form.",
      eventTypeId: "mitzvah",
      trades: ["photographer"],
      dueDaysBeforeEvent: 7,
      reminderDaysBeforeDue: [14, 3],
      sections: MITZVAH_SHOT_LIST,
    },
    {
      id: "mitzvah-music-planner",
      name: "Mitzvah music & MC planner",
      summary:
        "Where and when, the entrance names and how to say them, the hora and the chair lift, the blessings and speeches, the candle lighting with a song for each candle, the montage, the games and the dance floor. Your run of show is laid out from it.",
      useIt: "Your mitzvah planning form: it goes out when they book.",
      eventTypeId: "mitzvah",
      trades: ["dj"],
      dueDaysBeforeEvent: 14,
      reminderDaysBeforeDue: [14, 3],
      sections: MITZVAH_MUSIC_PLANNER,
    },
    {
      id: "mitzvah-makeup-party-list",
      name: "Mitzvah party list",
      summary: "When everyone needs to be ready, where, and everyone in the family getting makeup.",
      useIt: "Your mitzvah planning form: it goes out when they book.",
      eventTypeId: "mitzvah",
      trades: ["makeup"],
      dueDaysBeforeEvent: 21,
      reminderDaysBeforeDue: [14, 3],
      sections: [
        MITZVAH_BEFORE_PARTY,
        mitzvahPartyList(
          "Name — who they are — hair, makeup or both — anything we should know. For example: \"Rachel Cohen — mom — makeup — lashes\", \"Lily — the bat mitzvah — light makeup\", \"Grandma Ruth — grandmother — makeup\".",
        ),
        MAKEUP_SKIN,
        PARTY_LIST[2]!,
      ],
    },
    {
      id: "mitzvah-hair-party-list",
      name: "Mitzvah party list",
      summary: "When everyone needs to be ready, where, and everyone in the family getting their hair done.",
      useIt: "Your mitzvah planning form: it goes out when they book.",
      eventTypeId: "mitzvah",
      trades: ["hair"],
      dueDaysBeforeEvent: 21,
      reminderDaysBeforeDue: [14, 3],
      sections: [
        MITZVAH_BEFORE_PARTY,
        mitzvahPartyList(
          "Name — who they are — anything we should know. For example: \"Rachel Cohen — mom — blowout\", \"Lily — the bat mitzvah — half up, with flowers\", \"Grandma Ruth — grandmother — set and style\".",
        ),
        MITZVAH_HAIR_DETAILS,
        PARTY_LIST[2]!,
      ],
    },
    {
      id: "mitzvah-planner-final-details",
      name: "Mitzvah final details",
      summary:
        "The service and the party, the people to know, the candle lighting, what the family is bringing and the venue's rules, the final count, and every vendor.",
      useIt: "Your mitzvah planning form.",
      eventTypeId: "mitzvah",
      trades: ["planner"],
      dueDaysBeforeEvent: 28,
      reminderDaysBeforeDue: [14, 3],
      sections: MITZVAH_PLANNER_FINAL_DETAILS,
    },
    {
      id: "dj-music-planner",
      name: "Music & moments planner",
      summary:
        "Where and when, the songs for every moment, the names you'll say on the mic with how to say them, the toast order, and the dance floor: must-plays, do-not-plays and requests. Your run of show is laid out from it.",
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
      sections: [PARTY_LIST[0]!, HAIR_PARTY, HAIR_DETAILS, PARTY_LIST[2]!],
    },
    {
      id: "planner-final-details",
      name: "Final details",
      summary:
        "Getting ready, the ceremony order, key people, the décor they're bringing, the venue's rules, the rehearsal, the final guest count, and their vendors, filled in from your vendor team.",
      useIt: "Your planning form: it goes out three months before (eight weeks for month-of), and locks two weeks before.",
      eventTypeId: "wedding",
      trades: ["planner"],
      // Due four weeks out (docs/planner-journey-plan.md, journey row 6).
      dueDaysBeforeEvent: 28,
      reminderDaysBeforeDue: [14, 3],
      sections: PLANNER_FINAL_DETAILS,
    },
  ];
}

/**
 * The event details form's sections only a photographer's couple is asked:
 * when Photo 1 / Video 1 and Photo 2 / Video 2 start and finish. A DJ's,
 * makeup artist's or hair stylist's couple answers the rest of the same form;
 * their times come from the planner or the party list.
 */
const CAMERA_SECTIONS: ReadonlySet<string> = new Set(["coverage"]);
const CAMERA_TRADES: readonly string[] = ["photographer"];

/**
 * The trades whose client fills in one form — the party list, the music
 * planner — and nothing else (trades.ts `journey.oneForm`; Conor, 2026-10-09:
 * a vendor's journey "should be easier and less burdensome"). Restated here
 * so this module keeps no imports, which is what lets the functions copy be
 * compared as text; tests/vendor-phase2-planning.test.ts checks it against
 * the trade profiles.
 */
export const ONE_FORM_TRADES: readonly string[] = ["dj", "makeup", "hair"];

/**
 * Trades whose couple fills in their own planning form and is never sent the
 * event details form at the inquiry: the one-form trades, and a planner,
 * whose inquiry asks what she prices on and whose Final details asks the
 * rest, weeks before.
 */
const OWN_FORM_TRADES: readonly string[] = [...ONE_FORM_TRADES, "planner"];

const EVENT_DETAILS_ID = "wedding-event-details";

/**
 * Every recommended form a studio of this trade can look through and copy,
 * on the questionnaire library. A one-form trade's library still offers the
 * event details form, as something to copy if they want it; it is not one
 * they start with (`recommendedFor`).
 */
export function recommendedLibraryFor(trade: string): RecommendedQuestionnaire[] {
  return recommendedQuestionnaires()
    .filter((form) => !form.trades || form.trades.includes(trade))
    .map((form) =>
      CAMERA_TRADES.includes(trade)
        ? form
        : { ...form, sections: form.sections.filter((section) => !CAMERA_SECTIONS.has(section.id)) },
    )
    .map((form) =>
      form.id === EVENT_DETAILS_ID && OWN_FORM_TRADES.includes(trade)
        ? { ...form, useIt: "Optional: your planning form already asks where and when. Copy it if you'd like more from new inquiries." }
        : form,
    );
}

/**
 * The recommended forms a studio of this trade starts with, switched on
 * (saas/onboarding.ts). A photographer's three. A one-form trade's own form
 * alone: the event details form it was also given asked the same where and
 * when again, a second form for a client who should fill in one.
 */
export function recommendedFor(
  trade: string,
  /**
   * Which kinds' forms: a wedding's at signup, as ever; another kind's when
   * the studio first offers it (crm `setInquiryForm`, `OFFERED_KIND_FORMS`).
   */
  kinds: readonly string[] = SIGNUP_KINDS,
): RecommendedQuestionnaire[] {
  return recommendedLibraryFor(trade).filter(
    (form) => kinds.includes(form.eventTypeId) && !(form.id === EVENT_DETAILS_ID && OWN_FORM_TRADES.includes(trade)),
  );
}

/** The kind whose forms a studio starts with. */
const SIGNUP_KINDS: readonly string[] = ["wedding"];

/**
 * Kinds whose recommended forms are copied in the first time a studio offers
 * the kind on its inquiry form: a mitzvah's details, final schedule and shot
 * list.
 */
export const OFFERED_KIND_FORMS: readonly string[] = ["mitzvah"];

/** How many questions a form asks. */
export function recommendedFieldCount(template: RecommendedQuestionnaire): number {
  return template.sections.reduce((total, section) => total + section.fields.length, 0);
}
