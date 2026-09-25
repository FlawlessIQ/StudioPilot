import type { ContractSources } from "@/features/contracts/document";

/**
 * Stand-in job details for the agreement editor's preview, so a studio sees
 * its wording with real-looking values in place. Never written to a contract.
 */
export function sampleContractSources(studioName: string, today: string): ContractSources {
  return {
    client: { names: "Emma Hart & James Cole", email: "emma@example.com" },
    event: {
      name: "Emma & James's wedding",
      type: "Wedding",
      date: "2027-06-12",
      venue: "Wildflower Barn",
    },
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
    studio: { name: studioName || "Your studio", legalName: null },
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
