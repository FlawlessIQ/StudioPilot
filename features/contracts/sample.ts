import type { ContractSources } from "@/features/contracts/document";
import { eventDetailsFrom } from "@/features/contracts/event-details";

/**
 * Stand-in job details for the agreement editor's preview, so a studio sees
 * its wording with real-looking values in place. Never written to a contract.
 */
export function sampleContractSources(studioName: string, today: string, trade?: unknown): ContractSources {
  const studio = {
    name: studioName,
    legalName: null,
    address: "2 Green Village Rd, Suite 209, Madison NJ 07940",
    phone: "201.320.4296",
    email: "info@example.com",
    website: "www.example.com",
  };
  // A DJ's own preview: the reception and the ceremony sound, the room's
  // load-in and power, and the balance two weeks out.
  if (trade === "dj") {
    return {
      client: { names: "Maya Brooks & Sam Patel", email: "maya@example.com" },
      event: { name: "Maya & Sam's wedding", type: "Wedding", date: "2027-06-12", venue: "Hollow Oak Inn" },
      packages: [{ name: "Ceremony and reception", totalCents: 240_000 }],
      package: {
        name: "Ceremony and reception",
        coverage: "1 DJ, 6 hours",
        deliverables: ["Ceremony sound and microphones", "Cocktail hour music", "Reception sound and dance floor lighting", "MC", "Online music planner"],
      },
      pricing: { currency: "USD", totalCents: 240_000, retainerCents: 60_000 },
      paymentSchedule: [
        { label: "Retainer", amountCents: 60_000, dueDate: null },
        { label: "Final balance", amountCents: 180_000, dueDate: "2027-05-29" },
      ],
      formAnswers: [
        { question: "Ceremony start", answer: "4:00 PM" },
        { question: "Load-in time", answer: "2:30 PM" },
      ],
      eventDetails: eventDetailsFrom({
        eventType: "Wedding",
        eventKind: "wedding",
        date: "June 12, 2027",
        venue: "Hollow Oak Inn",
        coverage: "1 DJ, 6 hours",
        answers: [
          { question: "Ceremony location", answer: "The Orchard Lawn, Hollow Oak Inn" },
          { question: "Reception location", answer: "The Barn, Hollow Oak Inn" },
          { question: "Ceremony start", answer: "4:00 PM" },
          { question: "Reception times", answer: "5:30 PM – 11:00 PM" },
          { question: "Load-in and power", answer: "Side door by the kitchen; two 20-amp outlets behind the stage" },
          { question: "Expected guest count", answer: "140" },
        ],
        lockDaysBefore: 10,
        trade: "dj",
      }),
      studio,
      contractDate: today,
    };
  }
  // A makeup artist's or hair stylist's own preview: a bride and her party,
  // the morning's address and ready-by time, the balance paid on the day.
  if (trade === "makeup" || trade === "hair") {
    const makeup = trade === "makeup";
    return {
      client: { names: "Maya Brooks", email: "maya@example.com" },
      event: { name: "Maya's wedding", type: "Wedding", date: "2027-06-12", venue: "The Lodge" },
      packages: [{ name: makeup ? "Bridal makeup with trial" : "Bridal hair with trial", totalCents: 104_000 }],
      package: {
        name: makeup ? "Bridal makeup with trial" : "Bridal hair with trial",
        coverage: makeup ? "2 makeup artists" : "2 hair stylists",
        deliverables: makeup
          ? ["Makeup trial", "Bridal makeup with lashes", "Bridesmaid makeup — 5 people", "Touch-up kit"]
          : ["Hair trial", "Bridal hair with veil placement", "Bridesmaid hair — 5 people"],
      },
      pricing: { currency: "USD", totalCents: 104_000, retainerCents: 26_000 },
      paymentSchedule: [
        { label: "Retainer", amountCents: 26_000, dueDate: null },
        { label: "Final balance", amountCents: 78_000, dueDate: "2027-06-12" },
      ],
      formAnswers: [
        { question: "When does everyone need to be ready?", answer: "1:00 PM" },
        { question: "Where you're getting ready", answer: "The Lodge, 14 Mill Lane — bridal suite" },
      ],
      eventDetails: eventDetailsFrom({
        eventType: "Wedding",
        eventKind: "wedding",
        date: "June 12, 2027",
        venue: "The Lodge",
        coverage: makeup ? "2 makeup artists" : "2 hair stylists",
        answers: [
          { question: "Where you're getting ready", answer: "The Lodge, 14 Mill Lane — bridal suite" },
          { question: "The earliest we can start setting up", answer: "8:30 AM" },
          { question: "When does everyone need to be ready?", answer: "1:00 PM" },
          { question: "How many people need makeup, including you?", answer: "6" },
        ],
        lockDaysBefore: 30,
        trade: String(trade),
      }),
      studio,
      contractDate: today,
    };
  }
  return {
    client: { names: "Emma Hart & James Cole", email: "emma@example.com" },
    event: {
      name: "Emma & James's wedding",
      type: "Wedding",
      date: "2027-06-12",
      venue: "Wildflower Barn",
    },
    packages: [
      { name: "Signature Collection", totalCents: 499900 },
      { name: "Gold Cinematic Package", totalCents: 299900 },
    ],
    package: {
      name: "Full Day Collection",
      coverage: "2 photographers, 8 hours",
      deliverables: ["Online gallery of edited images", "10x10 heirloom album"],
    },
    pricing: { currency: "USD", totalCents: 640_000, retainerCents: 160_000 },
    paymentSchedule: [
      { label: "Retainer", amountCents: 160_000, dueDate: null },
      { label: "Final balance", amountCents: 480_000, dueDate: "2027-05-15" },
    ],
    formAnswers: [
    { question: "Ceremony start", answer: "3:00 PM" },
    { question: "Getting ready address", answer: "The Lodge, 14 Mill Lane" },
  ],
    // Schedule A, as a real agreement carries it at the end.
    eventDetails: eventDetailsFrom({
      eventType: "Wedding",
      date: "June 12, 2027",
      venue: "Harbor View Estate",
      coverage: "2 photographers, 8 hours",
      answers: [
        { question: "Getting ready address", answer: "The Lodge, 14 Mill Lane" },
        { question: "Ceremony location", answer: "St Mary's Church, 3 Church St" },
        { question: "Reception location", answer: "Harbor View Estate, 1 Harbor View Rd" },
        { question: "Ceremony start", answer: "3:00 PM" },
        { question: "Reception times", answer: "5:30 PM – 11:00 PM" },
        { question: "Expected guest count", answer: "140" },
      ],
    }),
  studio: {
      name: studioName,
      legalName: null,
      address: "2 Green Village Rd, Suite 209, Madison NJ 07940",
      phone: "201.320.4296",
      email: "info@example.com",
      website: "www.example.com",
    },
    contractDate: today,
  };
}

/**
 * Where a studio with no agreement of its own starts. It is scaffolding, not
 * legal terms: each section says what belongs there, and the studio replaces
 * it with its own wording.
 */
export const STARTER_AGREEMENT = `This agreement is between {{studio.legal_name}} ("the Studio") and {{client.names}} ("the Client") for {{event.type}} coverage on {{event.date}} at {{event.venue}}.

## 1. Services
The Studio will provide the {{package.name}}: {{package.coverage}}. Included:
{{package.deliverables}}

## 2. Fees and payment
The total fee is {{price.total}}. A retainer of {{price.retainer}} reserves the date, and the balance of {{price.balance}} is due as follows:
{{payment.schedule}}

## 3. Cancellation and rescheduling
[Replace with your own cancellation and rescheduling terms.]

## 4. Image use and copyright
[Replace with your own terms on copyright, usage and portfolio rights.]

## 5. Limitation of liability
[Replace with your own terms.]

This agreement was prepared on {{contract.date}}.
`;

/**
 * A makeup artist's or hair stylist's starting agreement
 * (docs/vendor-journeys-plan.md, Phase 4). Scaffolding like the one above:
 * each section names what a beauty booking's terms cover — the minimum, the
 * headcount that only grows after the lock, the room they need, early and
 * late fees, the trial, allergies, and the bride paying for anyone booked who
 * doesn't sit — and the studio writes its own wording.
 */
export const BEAUTY_STARTER_AGREEMENT = `This agreement is between {{studio.legal_name}} ("the Studio") and {{client.names}} ("the Client") for {{event.type}} services on {{event.date}} at {{event.venue}}.

## 1. Services
The Studio will provide the {{package.name}}: {{package.coverage}}. Included:
{{package.deliverables}}

## 2. Fees and payment
The total fee is {{price.total}}. A retainer of {{price.retainer}} reserves the date, and the balance of {{price.balance}} is due as follows:
{{payment.schedule}}

## 3. Minimum and party size
[Replace with your booking minimum (a number of people, or a total), and how the party size works: people can be added after the final headcount, but not taken off.]

## 4. The morning
[Replace with what you need on the day — a table and chair near a window, outlets, a quiet room — and your early-start and late-running fees.]

## 5. Trial
[Replace with your trial terms: what it costs, and whether the fee comes off the balance.]

## 6. Allergies and skin
[Replace with your terms on allergies, sensitive skin and patch tests.]

## 7. No-shows and cancellation
[Replace with your cancellation terms, and what is owed for anyone booked who doesn't sit for their appointment.]

## 8. Limitation of liability
[Replace with your own terms.]

This agreement was prepared on {{contract.date}}.
`;

/** The starting agreement and its title for a studio of this trade. */
export function starterAgreementFor(trade: unknown): { title: string; body: string } {
  if (trade === "makeup") return { title: "Makeup Services Agreement", body: BEAUTY_STARTER_AGREEMENT };
  if (trade === "hair") return { title: "Hair Services Agreement", body: BEAUTY_STARTER_AGREEMENT };
  if (trade === "dj") return { title: "DJ Services Agreement", body: STARTER_AGREEMENT.replace("## 4. Image use and copyright\n[Replace with your own terms on copyright, usage and portfolio rights.]", "## 4. Equipment and the venue\n[Replace with your own terms on power, load-in, the venue's sound limits and your equipment.]") };
  return { title: "Photography Services Agreement", body: STARTER_AGREEMENT };
}
