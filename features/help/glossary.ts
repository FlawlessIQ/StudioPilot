import { helpTrade, inTradeWords, type HelpAudience, type HelpTerm, type HelpTermSource, type HelpTrade } from "./types";

/**
 * StudioCue's vocabulary, defined once.
 *
 * Every ⓘ beside a word reads from here, so a word means the same thing on
 * every screen that uses it. A couple's or crew member's reading of a word
 * gets its own entry when it differs from the studio's: to a couple a
 * retainer is what holds their date, not evidence for the booking gate.
 *
 * A word can read differently by trade (types.ts): a photographer's text is
 * the first branch, exactly as it was, and a DJ, a makeup artist or a hair
 * stylist reads the second, in their own words (features/trades/trades.ts).
 */

/** A photographer's own words, as written; every other trade has its own. */
const photographer = (t: HelpTrade) => t.has.family === "photo";

const WORDS: readonly HelpTermSource[] = [
  // ── Studio ────────────────────────────────────────────────────────────
  {
    id: "today",
    term: "Today",
    audience: "studio",
    explainer: "today",
    hint: "Your inbox: everything that needs a decision, ranked by what it costs to wait. If nothing is waiting, nothing is wrong.",
  },
  {
    id: "job",
    term: "Job",
    audience: "studio",
    explainer: "job-page",
    hint: "One client's whole story, from first inquiry to closeout, with everything about it in one place.",
  },
  {
    id: "inquiry",
    term: "Inquiry",
    audience: "studio",
    explainer: "inquiry",
    hint: "Someone asking about a date who hasn't booked yet. It stays in Inquiries until the booking is confirmed, then moves to Jobs.",
  },
  {
    id: "cue",
    term: "Cue",
    audience: "studio",
    hint: "Your studio's office manager. Ask Cue to do something and it prepares the work for you to approve.",
  },
  {
    id: "prepared",
    term: "Prepared",
    audience: "studio",
    explainer: "today",
    hint: "Work drafted and waiting for you: a reply, a reminder, a next step. Nothing is sent until you approve it, unless you've set that email to send automatically.",
  },
  {
    id: "readiness",
    term: "Readiness",
    audience: "studio",
    hint: "The checklist a booked job must clear before the event: contract signed, retainer paid, crew accepted, questionnaire complete, and so on.",
  },
  {
    id: "checkpoint",
    term: "Checkpoint",
    audience: "studio",
    hint: "One item on the readiness checklist. Most check themselves off when the record arrives; the judgment calls are yours.",
  },
  {
    id: "booking-gate",
    term: "Booking gate",
    audience: "studio",
    explainer: "contract-retainer",
    hint: "The check that turns a job Booked. It passes only on real evidence: a signed agreement and a paid retainer, verified or recorded by you. A waived retainer counts.",
  },
  {
    id: "retainer",
    term: "Retainer",
    audience: "studio",
    explainer: "contract-retainer",
    hint: "The payment that holds the date. With the signed agreement, it's what turns a job Booked.",
  },
  {
    id: "final-balance",
    term: "Final balance",
    audience: "studio",
    hint: "What's left after the retainer. It's billed 28 days before the event when it can be, or from Today; with autopay on, a saved card pays it.",
  },
  {
    id: "package",
    term: "Package",
    audience: "studio",
    explainer: "proposal",
    hint: (t) =>
      `A collection you sell at a set price: ${photographer(t) ? "coverage, hours" : "who you send, the hours"} and what's included. ${t.words.proposal}s are built from your packages.`,
  },
  {
    id: "add-on",
    term: "Add-on",
    audience: "studio",
    explainer: "proposal",
    hint: ({ has }) =>
      has.album
        ? "An extra on top of a package, like an album or an engagement session. It's priced on its own line."
        : `An extra on top of a package, like ${has.perPersonPricing ? "another person getting ready" : "an extra hour"}. It's priced on its own line.`,
  },
  {
    id: "proposal",
    term: "Proposal",
    audience: "studio",
    explainer: "proposal",
    // A makeup artist or hair stylist sends a quote (beauty-quote, below).
    offered: ({ words }) => words.proposal === "Proposal",
    hint: "What a client sees before they book: their packages, any add-ons, the price and the payment plan. They accept it in their portal.",
  },
  {
    id: "agreement",
    term: "Agreement",
    audience: "studio",
    explainer: "contract-retainer",
    hint: "Your contract. The client signs it online and the signed copy is kept with the job.",
  },
  {
    id: "consultation",
    term: "Consultation",
    audience: "studio",
    explainer: "inquiry",
    // A DJ's is the vibe call (below); a makeup artist or hair stylist has no
    // sales call at all, the trial does that job.
    offered: ({ words, has }) => has.consultation && words.consultation === "Consultation",
    hint: "A call or meeting before a client books. They choose a time from your availability.",
  },
  {
    id: "inquiry-link",
    term: "Couple's inquiry link",
    audience: "studio",
    explainer: "inquiry",
    hint: ({ words, has }) =>
      has.consultation
        ? `Each client's own link, added to your first reply once your ${words.consultation.toLowerCase()} hours are set. They add details and pick a time to talk.`
        : "Each client's own link, added to your first reply. They add their details there; there's no call to book first.",
  },
  {
    id: "forwarding-address",
    term: "Forwarding address",
    audience: "studio",
    explainer: "inquiry",
    hint: "A StudioCue email address. Forward inquiries from your own inbox to it and each one becomes an inquiry here.",
  },
  {
    id: "lost",
    term: "Lost",
    audience: "studio",
    explainer: "inquiry",
    hint: "An inquiry that didn't book. If the client writes again, it reopens by itself.",
  },
  {
    id: "run-of-show",
    term: "Run of show",
    audience: "studio",
    hint: "The day's timeline. Crew see it on their day sheet, and you can share a read-only link with vendors.",
  },
  {
    id: "crew-offer",
    term: "Crew offer",
    audience: "studio",
    hint: ({ words }) =>
      `An invitation to ${/^[aeiou]/i.test(words.member) ? "an" : "a"} ${words.member} to work a date. They accept or decline from their phone; if they decline, offer it to someone else.`,
  },

  {
    id: "coverage",
    term: ({ words }) => words.coverage,
    audience: "studio",
    explainer: "packages",
    hint: (t) =>
      photographer(t)
        ? "Who you send and for how long: photographers, videographers and hours. It fills your contract and can set a per-crew retainer."
        : `Who you send and for how long: your ${t.words.crew} and the hours. It fills your contract and can set a per-${t.words.member} retainer.`,
  },
  {
    id: "quiet-import",
    term: "Imported, and quiet",
    audience: "studio",
    explainer: "import-bookings",
    hint: "StudioCue sends this client no emails, invoices, reminders or charges until you bring them in. The portal invite is a separate, optional checkbox.",
  },
  {
    id: "booking-change",
    term: "Booking change",
    audience: "studio",
    explainer: "booking-change",
    hint: "A new date or package after the client has signed. They e-sign an amended agreement; until then their original stands, and payments carry over.",
  },
  {
    id: "autopay",
    term: "Autopay",
    audience: "studio",
    explainer: "final-balance",
    hint: "Clients save a card when they pay the retainer; the final balance then charges on its due date. Needs QuickBooks Payments.",
  },
  {
    id: "coi",
    term: "Certificate of insurance",
    audience: "studio",
    explainer: "coi",
    hint: "Proof of your liability cover, issued to a venue that asks for it. StudioCue requests it from your agent and sends it on once you approve.",
  },
  {
    id: "workflow",
    term: "Workflow",
    audience: "studio",
    explainer: "automations",
    hint: "The checkpoints and automatic emails every booked job of one type gets, dated back from its event.",
  },
  {
    id: "closeout",
    term: "Closeout",
    audience: "studio",
    explainer: "delivery",
    hint: ({ has }) =>
      has.delivery
        ? "The last check before a job closes: contract, final balance, schedule, delivery, album, review request, crew and insurance all settled."
        : "The last check before a job closes: contract, final balance, schedule, review request, crew and insurance all settled.",
  },
  {
    id: "studio-roles",
    term: "Roles",
    audience: "studio",
    explainer: "team",
    hint: (t) =>
      photographer(t)
        ? "Admin: everything but plan and billing. Coordinator: runs assigned jobs, no money or settings. Photographer or videographer: sees the jobs they shoot."
        : `Admin: everything but plan and billing. Coordinator: runs assigned jobs, no money or settings. Staff ${t.words.member}: sees the jobs they ${t.words.verb}.`,
  },

  // ── Couple ────────────────────────────────────────────────────────────
  {
    id: "couple-retainer",
    term: "Retainer",
    audience: "couple",
    hint: "Your first payment. It holds your date, and its invoice arrives after you sign.",
  },
  {
    id: "couple-final-balance",
    term: "Final balance",
    audience: "couple",
    hint: "The rest of the price, due before the event. Your payments page shows the date.",
  },
  {
    id: "couple-journey",
    term: "Your journey",
    audience: "couple",
    explainer: "couple-tour",
    hint: ({ has }) =>
      has.delivery
        ? "Every step from booking to your photos, in order. Each one is checked off as it's done."
        : "Every step from booking to the day and after, in order. Each one is checked off as it's done.",
  },

  {
    id: "couple-agreement",
    term: "Agreement",
    audience: "couple",
    explainer: "couple-sign",
    hint: "Your contract with your studio. Read it, then sign here with your typed name; a signed copy is emailed to you and kept on this page.",
  },
  {
    id: "couple-booking-change",
    term: "A change to your booking",
    audience: "couple",
    explainer: "couple-sign",
    hint: "Your studio changed your date or package after you signed. Signing updates your agreement; until you do, the original still stands.",
  },
  {
    id: "couple-autopay",
    term: "Paying automatically",
    audience: "couple",
    explainer: "couple-pay",
    hint: "Save a card and your final balance is charged on its due date, tried once more 3 days later if declined. Remove the card any time before.",
  },
  {
    id: "couple-timeline",
    term: "Your timeline",
    audience: "couple",
    explainer: "couple-day",
    hint: "Your day, hour by hour. Each update is a new version; approving one tells your studio and crew these times are right.",
  },

  // ── Crew ──────────────────────────────────────────────────────────────
  {
    id: "crew-offer-crew",
    term: "Offer",
    audience: "crew",
    explainer: "crew-offer-accept",
    hint: "A studio asking you to work a date. The details and the fee are in the offer; accept or decline.",
  },
  {
    id: "day-sheet",
    term: "Day sheet",
    audience: "crew",
    explainer: "crew-day",
    hint: "Everything for the day: where to be and when, your role, who to call, and the running order.",
  },
  {
    id: "call-time",
    term: "Call time",
    audience: "crew",
    explainer: "crew-day",
    hint: "When you're due to arrive at the job. Times are in the event's time zone.",
  },
  {
    id: "crew-checklist",
    term: "Checklist",
    audience: "crew",
    explainer: "crew-day",
    hint: "What the studio needs before the day: paperwork to send, gear to confirm, the run of show to read. Items are checked off when done or waived.",
  },
  {
    id: "crew-closeout",
    term: "Hours and expenses",
    audience: "crew",
    explainer: "crew-closeout",
    hint: "Your hours, expenses and file links for a job. The studio reviews them, then schedules your payment.",
  },
  // ── A DJ's words (docs/vendor-journeys.md) ─────────────────────────────
  {
    id: "vibe-call",
    term: "Vibe call",
    audience: "studio",
    trades: ["dj"],
    hint: "The call before you send a proposal: the crowd, the music they love, and how much talking on the mic they want.",
  },
  {
    id: "music-planner",
    term: "Music & moments planner",
    audience: "studio",
    trades: ["dj"],
    hint: "Your client's planning form: songs for every moment, who you introduce and how to say each name, toasts, and the dance floor.",
  },
  {
    id: "mc-script",
    term: "MC script",
    audience: "studio",
    trades: ["dj"],
    hint: "The song, what you say and how to say the names, on each line of the run of show. It prints on the PDF and your DJs' day sheet.",
  },
  {
    id: "final-planning-call",
    term: "Final planning call",
    audience: "studio",
    trades: ["dj"],
    hint: "Your client books it when their planner locks, ten days out, so you go through the script together about a week before.",
  },
  // ── A makeup artist's and hair stylist's words (docs/vendor-journeys.md) ──
  {
    id: "beauty-quote",
    term: "Quote",
    audience: "studio",
    trades: ["makeup", "hair"],
    hint: "What you send a new inquiry: your client's package plus everyone else at a price per person. There's no sales call first; the trial does that job.",
  },
  {
    id: "beauty-trial",
    term: "Trial",
    audience: "studio",
    trades: ["makeup", "hair"],
    hint: "Your client books it from the link on the job. Afterward, note the look and products on the trial card; they go on your crew's brief.",
  },
  {
    id: "party-list",
    term: "Party list",
    audience: "studio",
    trades: ["makeup", "hair"],
    hint: "Your client's planning form: everyone getting ready, one per line, with what each wants, the ready-by time and where. It goes out at booking.",
  },
  {
    id: "headcount-lock",
    term: "Headcount lock",
    audience: "studio",
    trades: ["makeup", "hair"],
    hint: "A month before, the party list locks. After that people can be added (a booking change they sign) but not taken off, as the agreement says.",
  },
  {
    id: "getting-ready-schedule",
    term: "Getting-ready schedule",
    audience: "studio",
    trades: ["makeup", "hair"],
    hint: "Lay out the morning builds it from the party list: each chair worked back from the ready-by time, and how many artists it needs.",
  },
  {
    id: "kit-checklist",
    term: "Kit checklist",
    audience: "studio",
    trades: ["makeup", "hair"],
    hint: "The day before: the address and parking, the schedule, and what to pack. It's on the job and in your crew's reminder.",
  },
  {
    id: "extensions-ordered",
    term: "Extensions ordered",
    audience: "studio",
    trades: ["hair"],
    hint: "Note the plan and color match on the trial card. Buying or renting adds a task due eight weeks out, and a rental gets one to collect them after.",
  },
];

/** A word in a trade's words, as every screen reads it. */
function inTrade(source: HelpTermSource, t: HelpTrade): HelpTerm {
  const word: HelpTerm = {
    id: source.id,
    term: inTradeWords(typeof source.term === "function" ? source.term(t) : source.term, t),
    audience: source.audience,
    hint: inTradeWords(typeof source.hint === "function" ? source.hint(t) : source.hint, t),
  };
  if (source.explainer) word.explainer = source.explainer;
  if (source.trades) word.trades = source.trades;
  return word;
}

/** Whether a trade has the word at all: one of its own, and something it has. */
function forTrade(source: HelpTermSource, trade: string | undefined, t: HelpTrade): boolean {
  if (source.trades && (trade === undefined || !source.trades.includes(trade))) return false;
  return source.offered ? source.offered(t) : true;
}

/** Every word, in a photographer's words (the website's glossary, and the tests). */
export const GLOSSARY: readonly HelpTerm[] = WORDS.map((source) => inTrade(source, helpTrade()));

const byId = new Map(WORDS.map((source) => [source.id, source]));

/**
 * A word by id. With a trade, in that trade's words, and undefined when the
 * trade doesn't have it; without one, a photographer's reading of any word,
 * as an ⓘ with no studio behind it has always read.
 */
export function glossaryTerm(id: string, trade?: string): HelpTerm | undefined {
  const source = byId.get(id);
  if (!source) return undefined;
  const t = helpTrade(trade);
  if (trade !== undefined && !forTrade(source, trade, t)) return undefined;
  return inTrade(source, t);
}

export function glossaryFor(audience: HelpAudience, trade?: string): HelpTerm[] {
  const t = helpTrade(trade);
  return WORDS.filter((source) => source.audience === audience && forTrade(source, trade, t))
    .map((source) => inTrade(source, t))
    .sort((a, b) => a.term.localeCompare(b.term));
}
