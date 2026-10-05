import type { HelpAudience, HelpTerm } from "./types";

/**
 * StudioCue's vocabulary, defined once.
 *
 * Every ⓘ beside a word reads from here, so a word means the same thing on
 * every screen that uses it. A couple's or crew member's reading of a word
 * gets its own entry when it differs from the studio's: to a couple a
 * retainer is what holds their date, not evidence for the booking gate.
 */
export const GLOSSARY: readonly HelpTerm[] = [
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
    hint: "StudioCue's assistant. Ask it to do something and it prepares the work for you to approve.",
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
    hint: "A collection you sell at a set price: coverage, hours and what's included. Proposals are built from your packages.",
  },
  {
    id: "add-on",
    term: "Add-on",
    audience: "studio",
    explainer: "proposal",
    hint: "An extra on top of a package, like an album or an engagement session. It's priced on its own line.",
  },
  {
    id: "proposal",
    term: "Proposal",
    audience: "studio",
    explainer: "proposal",
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
    hint: "A call or meeting before a client books. They choose a time from your availability.",
  },
  {
    id: "inquiry-link",
    term: "Couple's inquiry link",
    audience: "studio",
    explainer: "inquiry",
    hint: "Each client's own link, added to your first reply once your consultation hours are set. They add details and pick a time to talk.",
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
    hint: "An invitation to a photographer to work a date. They accept or decline from their phone; if they decline, offer it to someone else.",
  },

  {
    id: "coverage",
    term: "Coverage",
    audience: "studio",
    explainer: "packages",
    hint: "Who you send and for how long: photographers, videographers and hours. It fills your contract and can set a per-crew retainer.",
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
    hint: "The last check before a job closes: contract, final balance, schedule, delivery, album, review request, crew and insurance all settled.",
  },
  {
    id: "studio-roles",
    term: "Roles",
    audience: "studio",
    explainer: "team",
    hint: "Admin: everything but plan and billing. Coordinator: runs assigned jobs, no money or settings. Photographer or videographer: sees the jobs they shoot.",
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
    hint: "Every step from booking to your photos, in order. Each one is checked off as it's done.",
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
];

const byId = new Map(GLOSSARY.map((term) => [term.id, term]));

export function glossaryTerm(id: string): HelpTerm | undefined {
  return byId.get(id);
}

export function glossaryFor(audience: HelpAudience): HelpTerm[] {
  return GLOSSARY.filter((term) => term.audience === audience).sort((a, b) =>
    a.term.localeCompare(b.term),
  );
}
