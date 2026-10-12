import Link from "next/link";
import { ArrowRight, CircleCheck } from "lucide-react";
import { vendorPlanCards } from "@/config/saas-plans";
import { CapabilityGrid, MarketingLayout } from "@/components/marketing/marketing-layout";
import type { Trade } from "@/features/trades/trades";
import { SITE_URL } from "@/lib/site";

/**
 * The DJ, makeup and hair landing pages (/dj, /makeup, /hair): vendor
 * journeys, Phase 6 (docs/vendor-journeys-plan.md).
 *
 * Every claim is something the trade's journey has shipped (the plan's
 * Status section): the DJ's Music & moments planner, MC script and "Lay out
 * the night"; the beauty trial, party list, "Lay out the morning" and kit
 * checklist; a hair stylist's extensions reminders and veil-first trial. No
 * testimonials, logos or customer counts — there are none yet to cite
 * (no-invented-testimonials). The vendor plan's price comes from
 * config/saas-plans.ts, so the page can't drift from what Checkout charges.
 *
 * Every signup link carries `?trade=` (and `plan=vendor`), which starts
 * "What do you do?" on the visitor's trade (features/trades/chosen-trade.ts).
 */

export type VendorTrade = Exclude<Trade, "photographer">;
export const VENDOR_TRADE_PAGES: Readonly<Record<VendorTrade, string>> = { dj: "/dj", makeup: "/makeup", hair: "/hair" };
const PAGE_NAMES: Readonly<Record<VendorTrade, string>> = { dj: "DJs", makeup: "Makeup artists", hair: "Hair stylists" };

export const vendorPlan = vendorPlanCards[0];

/** The signup for a vendor trade: its trade chosen, its plan remembered. */
export function vendorSignupHref(trade: VendorTrade): string {
  return `/auth/register?trade=${trade}&plan=${vendorPlan.key}`;
}

type Capability = Parameters<typeof CapabilityGrid>[0]["items"][number];

type TradePage = {
  eyebrow: string;
  title: string;
  description: string;
  /** For search engines: what the software is, for this trade. */
  category: string;
  capabilities: Capability[];
};

/** Booking is one link for every vendor trade (trades.ts `oneLinkBooking`). */
const bookedInOneLink = (offer: "proposal" | "quote", extra: string): Capability => ({
  title: "Booked in one link",
  text: `When they accept your ${offer}, StudioCue writes the agreement from it. Your client reads it, signs online in StudioCue and pays the deposit from the same link when your payments are connected, or you record the deposit yourself. The date books only on a signed agreement.`,
  points: ["Agreement written for you, signed online", "Deposit with the signature", extra],
});

const PAGES: Readonly<Record<VendorTrade, TradePage>> = {
  dj: {
    eyebrow: "For wedding DJs",
    title: "The night planned, and every name said right.",
    description:
      "StudioCue runs the office side of your DJ business: inquiries, proposals, agreements and deposits, and a Music & moments planner your couples fill in. Cue, your office manager, drafts each next step for you to approve, and the night is laid out from your couple's own answers.",
    category: "Booking and planning software for wedding DJs",
    capabilities: [
      {
        title: "Inquiry → vibe call",
        text: "Your inquiry form asks for the date, the venue, the hours of music and whether they want ceremony music. Cue drafts the reply in your voice. A vibe call is there when you want one, booked from your real hours, and never required before the proposal.",
        points: ["An inquiry form made for DJs", "Your reply drafted for you to send", "Vibe calls booked from your calendar"],
      },
      bookedInOneLink("proposal", "Load-in, power and sound limits in the agreement's details"),
      {
        title: "The Music & moments planner",
        text: "Sent when they book. Key songs and the versions they mean, ceremony music, entrances with how to say each name, the toast order, the last dance and the do-not-play list, in one form your couple fills in from their phone.",
        points: ["Progress saved as they go", "Reminders before it's due", "Locked ten days out, so your final planning call has the final answers"],
      },
      {
        title: "Lay out the night",
        text: "One tap builds the running order from their planner, with the song, what to say on the mic and how to say the names on each line: your MC script. Change any line, publish, and it's on the PDF and every DJ's day sheet.",
        points: ["Run of show and MC script in one", "A PDF and a day sheet for whoever plays", "Each publish a new version"],
      },
      {
        title: "Another DJ for the night",
        text: "Offer a second DJ the date, the rate and the call time in one tap. If they pass, the offer moves to the next person on your list without waiting on you.",
        points: ["Offers with the terms on them", "Moves on when someone passes", "Everyone sees only their own job"],
      },
      {
        title: "Paid, then done",
        text: "The final balance is due 14 days before the event, and Cue drafts the reminders for you to send. Nothing is delivered after the night, so the job closes without a chase.",
        points: ["Packages and extras to start from: ceremony sound, uplighting, an extra hour", "Reminders you approve", "No percentage taken from your payments"],
      },
    ],
  },
  makeup: {
    eyebrow: "For makeup artists",
    title: "Every chair on the morning, planned from one list.",
    description:
      "StudioCue runs the office side of your makeup business: quotes priced per person, the agreement and deposit, trials, and the party list that builds the morning. Cue, your office manager, drafts each next step for you to approve.",
    category: "Booking and scheduling software for bridal makeup artists",
    capabilities: [
      {
        title: "Inquiry → quote",
        text: "No sales call to book. Your inquiry form asks how many people, when they need to be ready and whether they want a trial, and the inquiry goes straight to a quote priced per person, like \"4 people × $120\".",
        points: ["An inquiry form made for beauty", "Quotes priced per person", "Bridal makeup packages and extras to start from"],
      },
      bookedInOneLink("quote", "A starter agreement for the party size, trials, allergies and no-shows"),
      {
        title: "The trial",
        text: "Invite the bride to book her makeup trial from your hours. Afterwards, note the look and the products on the job, and they go on the brief for the morning.",
        points: ["Trials booked from your calendar", "The look and products kept for the day", "Skin notes and lashes from the party list"],
      },
      {
        title: "Lay out the morning",
        text: "Your client lists everyone getting ready in the party list, one person per line, locked 30 days out. One tap gives everyone a chair, worked back from when they need to be ready, with the bride in the middle and never last.",
        points: ["Chairs built from the party list", "Says how many artists the morning needs", "Headcount can grow after the lock, not shrink"],
      },
      {
        title: "Ready the day before",
        text: "Your client gets a prep guide: a clean, moisturized face, a button-up top, and their inspiration with them. Your crew's reminder carries the kit checklist, the address and the schedule.",
        points: ["A prep guide in the week-before email", "Kit checklist for whoever is on the job", "Another artist offered in one tap"],
      },
      {
        title: "Paid on the morning",
        text: "Beauty is paid on the day, so the balance is billed four weeks ahead and due the morning of. Nothing is delivered after, so the job closes when you're done.",
        points: ["Deposit with the agreement", "Balance due the morning of", "No percentage taken from your payments"],
      },
    ],
  },
  hair: {
    eyebrow: "For hair stylists",
    title: "The morning planned, and the extensions ordered on time.",
    description:
      "StudioCue runs the office side of your hair business: quotes priced per person, the agreement and deposit, trials, extensions, and the party list that builds the morning. Cue, your office manager, drafts each next step for you to approve.",
    category: "Booking and scheduling software for bridal hair stylists",
    capabilities: [
      {
        title: "Inquiry → quote",
        text: "No sales call to book. Your inquiry form asks how many people, when they need to be ready and whether they want a trial, and the inquiry goes straight to a quote priced per person.",
        points: ["An inquiry form made for beauty", "Quotes priced per person", "Bridal hair packages and extras to start from"],
      },
      bookedInOneLink("quote", "A starter agreement for the party size, trials and no-shows"),
      {
        title: "A trial built around the veil",
        text: "The hair trial is best once the veil is chosen, and StudioCue says so on the job and in the invitation. Afterwards, note the look and the products, and they go on the brief for the morning.",
        points: ["Trials booked from your calendar", "Best once the veil is chosen", "The look and products kept for the day"],
      },
      {
        title: "Extensions, ordered on time",
        text: "Note the plan at the trial (their own, buying or renting) with the color match. Buying or renting adds a task to order them, due eight weeks out and on Today when it's time, and a rental gets one to collect them after.",
        points: ["Plan and color match on the job", "Order reminder eight weeks out", "Rentals collected after the day"],
      },
      {
        title: "Lay out the morning",
        text: "The party list asks each person's length, texture, style, extensions, veil and accessories, and locks 30 days out. One tap gives everyone a chair, worked back from when they need to be ready, with the bride in the middle and never last.",
        points: ["Chairs built from the party list", "Says how many stylists the morning needs", "Headcount can grow after the lock, not shrink"],
      },
      {
        title: "Ready the day before, paid on the morning",
        text: "Your client's prep guide asks for clean, completely dry hair, washed the night before, or there's a blow-dry fee. Your crew's reminder carries the kit checklist. The balance is due the morning of.",
        points: ["A prep guide in the week-before email", "Kit checklist for whoever is on the job", "No percentage taken from your payments"],
      },
    ],
  },
};

/** Structured data for a trade's page: StudioCue, for this trade, at the vendor plan's price. */
export function tradeSchema(trade: VendorTrade) {
  const page = PAGES[trade];
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "@id": `${SITE_URL}${VENDOR_TRADE_PAGES[trade]}#software`,
    name: `StudioCue for ${PAGE_NAMES[trade]}`,
    applicationCategory: "BusinessApplication",
    applicationSubCategory: page.category,
    operatingSystem: "Web, iOS, Android (browser)",
    url: `${SITE_URL}${VENDOR_TRADE_PAGES[trade]}`,
    description: page.description,
    publisher: { "@id": `${SITE_URL}/#organization` },
    offers: {
      "@type": "Offer",
      price: (vendorPlan.monthlyCents / 100).toFixed(2),
      priceCurrency: "USD",
      url: `${SITE_URL}/pricing`,
    },
  };
}

/** The vendor plan, as a card: on each trade's page and on /pricing. */
export function VendorPlanCard({ trade, featured = true }: { trade?: VendorTrade; featured?: boolean }) {
  return (
    <article className={`marketing-price-card ${featured ? "is-featured" : ""}`}>
      <div className="marketing-plan-heading">
        <span>
          <small>StudioCue for DJs, makeup and hair</small>
          <h3>{vendorPlan.name}</h3>
        </span>
      </div>
      <p>{vendorPlan.description}</p>
      <div className="marketing-plan-price">
        <strong>{vendorPlan.monthly}</strong>
        <span>/month</span>
      </div>
      <small className="marketing-annual-price">{vendorPlan.yearly}/year · two months free</small>
      <ul>
        <li><CircleCheck size={16} /> {vendorPlan.users}</li>
        <li><CircleCheck size={16} /> {vendorPlan.ai}</li>
        {vendorPlan.features.map((feature) => (
          <li key={feature}><CircleCheck size={16} /> {feature}</li>
        ))}
      </ul>
      <Link className={`button ${featured ? "button-dark" : "button-light"}`} href={trade ? vendorSignupHref(trade) : `/auth/register?plan=${vendorPlan.key}`}>
        Start with {vendorPlan.name} <ArrowRight size={16} />
      </Link>
    </article>
  );
}

/** Links to the three vendor pages, the current one left out. */
export function VendorTradeLinks({ except }: { except?: VendorTrade }) {
  return (
    <nav aria-label="StudioCue for vendors" className="mk-trade-links">
      {(Object.keys(VENDOR_TRADE_PAGES) as VendorTrade[])
        .filter((trade) => trade !== except)
        .map((trade) => (
          <Link className="journey-film-page-link" href={VENDOR_TRADE_PAGES[trade]} key={trade}>
            {`StudioCue for ${PAGE_NAMES[trade] === "DJs" ? "DJs" : PAGE_NAMES[trade].toLowerCase()}`} <ArrowRight aria-hidden="true" size={14} />
          </Link>
        ))}
    </nav>
  );
}

export function TradeLanding({ trade }: { trade: VendorTrade }) {
  const page = PAGES[trade];
  return (
    <MarketingLayout description={page.description} eyebrow={page.eyebrow} signupHref={vendorSignupHref(trade)} title={page.title}>
      <CapabilityGrid items={page.capabilities} />
      <section aria-labelledby="trade-price-title" className="mk-section mk-trade-price">
        <header className="mk-section-head">
          <span className="section-kicker">What it costs</span>
          <h2 id="trade-price-title">{`One plan, ${vendorPlan.monthly} a month.`}</h2>
          <p>
            Unlimited clients and jobs. A 14-day trial with a card, and nothing charged until it ends. StudioCue
            takes no percentage of your payments.
          </p>
        </header>
        <div className="marketing-pricing-grid">
          <VendorPlanCard trade={trade} />
        </div>
        <VendorTradeLinks except={trade} />
      </section>
      <script
        // Built from constants in this file, never user input.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(tradeSchema(trade)).replace(/</g, "\\u003c") }}
        type="application/ld+json"
      />
    </MarketingLayout>
  );
}
