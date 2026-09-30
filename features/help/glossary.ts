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
    hint: "One item on the readiness checklist. Most tick themselves when the record arrives; the judgement calls are yours.",
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
    hint: "What's left to pay after the retainer, billed ahead of the wedding. If the couple saved a card, it's charged automatically.",
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
    hint: "What a couple sees before they book: the package, any add-ons, the price and the payment plan. They accept it in their portal.",
  },
  {
    id: "agreement",
    term: "Agreement",
    audience: "studio",
    explainer: "contract-retainer",
    hint: "Your contract. The couple signs it online and the signed copy is kept with the job.",
  },
  {
    id: "consultation",
    term: "Consultation",
    audience: "studio",
    explainer: "inquiry",
    hint: "A call or meeting before a couple books. They choose a time from your availability.",
  },
  {
    id: "inquiry-link",
    term: "Inquiry link",
    audience: "studio",
    explainer: "inquiry",
    hint: "Your studio's inquiry form. Put it on your website or share it anywhere; every submission lands in Inquiries.",
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
    hint: "An inquiry that didn't book. If the couple writes again, it reopens by itself.",
  },
  {
    id: "run-of-show",
    term: "Run of show",
    audience: "studio",
    hint: "The wedding day's timeline. Crew see it on their day sheet, and you can share a read-only link with vendors.",
  },
  {
    id: "crew-offer",
    term: "Crew offer",
    audience: "studio",
    hint: "An invitation to a photographer to work a date. They accept or decline from their phone; if they decline, offer it to someone else.",
  },

  // ── Couple ────────────────────────────────────────────────────────────
  {
    id: "couple-retainer",
    term: "Retainer",
    audience: "couple",
    hint: "Your first payment. It holds your date, and it's due when you sign.",
  },
  {
    id: "couple-final-balance",
    term: "Final balance",
    audience: "couple",
    hint: "The rest of the price, due before the wedding. Your payments page shows the date.",
  },
  {
    id: "couple-journey",
    term: "Your journey",
    audience: "couple",
    explainer: "couple-tour",
    hint: "Every step from booking to your photos, in order. Each one ticks off as it's done.",
  },

  // ── Crew ──────────────────────────────────────────────────────────────
  {
    id: "crew-offer-crew",
    term: "Offer",
    audience: "crew",
    explainer: "crew-tour",
    hint: "A studio asking you to work a date. The details and the fee are in the offer; accept or decline.",
  },
  {
    id: "day-sheet",
    term: "Day sheet",
    audience: "crew",
    explainer: "crew-tour",
    hint: "Everything for the day: where to be and when, your role, who to call, and the running order.",
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
