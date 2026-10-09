import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { combinedAgreementOn } from "@/features/contracts/rollout";
import { bookingSteps } from "@/features/client/booking-steps";
import { combinedAgreementEnabled } from "../functions/src/contracts/combined-commands";

/**
 * Simpler vendor journeys, Phase 1 (Conor, 2026-10-09): a DJ's, makeup
 * artist's or hair stylist's client books in one link — accepts and signs the
 * quote in one booking agreement, then pays the deposit on the next screen —
 * and the studio sees one booking, not a contract chore and a retainer chore.
 * A photographer's journey does not change at all.
 */

const read = (path: string) => readFileSync(path, "utf8");

// ── One-link booking is on by default for vendor trades ───────────────────

test("a vendor studio has the booking link without the flag; a photographer still needs it", () => {
  for (const trade of ["dj", "makeup", "hair"]) {
    assert.equal(combinedAgreementOn(null, trade), true, trade);
    assert.equal(combinedAgreementOn({}, trade), true, trade);
    // The tenant itself reads too, as tradeOf does.
    assert.equal(combinedAgreementOn(null, { trade }), true, trade);
  }
  // A photographer, or a studio from before trades: exactly as before.
  for (const trade of ["photographer", undefined, null, "florist"]) {
    assert.equal(combinedAgreementOn(null, trade), false, String(trade));
    assert.equal(combinedAgreementOn({ combinedAgreement: true }, trade), true, String(trade));
    assert.equal(combinedAgreementOn({ combinedAgreement: false }, trade), false, String(trade));
  }
  assert.equal(combinedAgreementOn(null), false);
  assert.equal(combinedAgreementOn({ nativeContractSigning: true, combinedAgreement: true }), true);
});

/** Just enough Firestore for the gate: a tenantFeatures doc and a tenant's trade. */
function fakeDb(features: Record<string, unknown>, trade: string | null) {
  return {
    doc: (path: string) => ({
      get: async () => {
        const data: Record<string, unknown> = path.startsWith("tenantFeatures/")
          ? features
          : trade
            ? { trade }
            : {};
        return { exists: true, get: (field: string) => data[field], data: () => data };
      },
    }),
  } as never;
}

test("the server decides the same way, from the tenant's trade", async () => {
  for (const trade of ["dj", "makeup", "hair"]) {
    assert.equal(await combinedAgreementEnabled(fakeDb({}, trade), "t1"), true, trade);
  }
  assert.equal(await combinedAgreementEnabled(fakeDb({}, "photographer"), "t1"), false);
  assert.equal(await combinedAgreementEnabled(fakeDb({}, null), "t1"), false, "no trade is a photographer");
  assert.equal(await combinedAgreementEnabled(fakeDb({ combinedAgreement: true }, "photographer"), "t1"), true);
  // A trade already read is used as given.
  assert.equal(await combinedAgreementEnabled(fakeDb({}, "photographer"), "t1", "makeup"), true);
  const commands = read("functions/src/contracts/combined-commands.ts");
  assert.match(commands, /throw new Error\("COMBINED_AGREEMENT_NOT_ENABLED"\)/);
  assert.match(commands, /combinedAgreementEnabled\(db, context\.tenantId, trade\)/);
});

test("every place that reads the switch passes the studio's trade", () => {
  assert.match(read("components/contracts/use-native-signing.ts"), /combinedAgreementOn\(features\?\.exists\(\) \? features\.data\(\) : null, trade\)/);
  // The Console says vendors already have it.
  for (const path of ["features/console/feature-catalog.ts", "functions/src/console/features.ts"]) {
    assert.match(read(path), /Already on for DJ, makeup and hair studios/, path);
  }
});

// ── The client's one link ─────────────────────────────────────────────────

const quote = { offer: "quote", oneLink: true } as const;
const payable = { status: "sent", balanceCents: 15_000, hostedUrl: "https://quickbooks.example/pay", atProvider: true, currency: "USD" };

test("a makeup client's portal shows one step, Book your date", () => {
  const view = bookingSteps({ proposalStatus: "sent", contractStatus: "sent", retainer: null, ...quote });
  assert.deepEqual(
    view.steps.map((step) => [step.key, step.label, step.state]),
    [
      ["book", "Book your date", "current"],
      ["booked", "Your date is booked", "upcoming"],
    ],
  );
});

test("the next move is right at every moment of the one link", () => {
  // The booking link is out: read, sign, pay — all on the agreement page.
  const out = bookingSteps({ proposalStatus: "sent", contractStatus: "sent", retainer: null, ...quote });
  assert.equal(out.next.title, "Review and book");
  assert.equal(out.next.href, "/client/contract");
  assert.match(out.next.detail, /Read your quote and the terms and sign, then pay your deposit — all in one visit\./);

  // A quote the studio sent on its own still books the long way round.
  const alone = bookingSteps({ proposalStatus: "viewed", contractStatus: null, retainer: null, ...quote });
  assert.equal(alone.next.title, "Review and book");
  assert.equal(alone.next.href, "/client/proposal");

  // Signed; the deposit invoice is on its way from the accounting app.
  const signed = bookingSteps({ proposalStatus: "accepted", contractStatus: "completed", retainer: null, ...quote });
  assert.equal(signed.next.title, "Your deposit invoice is on its way");
  assert.equal(signed.next.href, null);
  assert.equal(signed.deposit, null);
  assert.equal(signed.steps[0]?.state, "waiting");
  const syncing = bookingSteps({
    proposalStatus: "accepted",
    contractStatus: "completed",
    retainer: { status: "sent", balanceCents: 15_000, hostedUrl: null },
    ...quote,
  });
  assert.equal(syncing.next.title, "Your deposit invoice is on its way");
  assert.equal(syncing.deposit?.route, "preparing");

  // Signed, with a pay link: the deposit, and how much.
  const due = bookingSteps({ proposalStatus: "accepted", contractStatus: "completed", retainer: payable, ...quote });
  assert.equal(due.next.title, "Pay your deposit");
  assert.equal(due.next.href, "/client/payments");
  assert.equal(due.steps[0]?.state, "current");
  assert.deepEqual(due.deposit, { route: "online", balanceCents: 15_000, currency: "USD", hostedUrl: payable.hostedUrl });

  // No online payments: paid to the studio directly, said plainly.
  const direct = bookingSteps({
    proposalStatus: "accepted",
    contractStatus: "completed",
    retainer: { ...payable, hostedUrl: null },
    ...quote,
  });
  assert.equal(direct.next.title, "Your deposit invoice is ready");
  assert.equal(direct.deposit?.route, "direct");

  // Paid: booked, and nothing left to pay.
  const booked = bookingSteps({
    proposalStatus: "accepted",
    contractStatus: "completed",
    retainer: { ...payable, status: "paid", balanceCents: 0 },
    ...quote,
  });
  assert.equal(booked.booked, true);
  assert.equal(booked.deposit, null);
  assert.ok(booked.steps.every((step) => step.state === "done"));
  assert.equal(booked.next.title, "Your date is booked");
});

test("a job with no agreement has nothing to merge, even for a vendor", () => {
  const view = bookingSteps({
    proposalStatus: "accepted",
    contractStatus: null,
    retainer: null,
    needs: { agreement: false, payment: true, paidInFull: true },
    ...quote,
  });
  assert.deepEqual(view.steps.map((step) => step.key), ["proposal", "deposit", "booked"]);
});

test("the portal's hook passes the trade's one link, and watches for the deposit after signing", () => {
  const hook = read("components/client/live-client-views.tsx");
  assert.match(hook, /const oneLink = tradeProfile\(useWorkspace\(\)\.tenantTrade\)\.journey\.oneLinkBooking;/);
  assert.match(hook, /\n\s+oneLink,\n\s+\}\)/);
  assert.match(hook, /const DEPOSIT_WATCH_MS = 3 \* 60_000;/);
  // The photographer's 20-second look is untouched.
  assert.match(hook, /refreshContracts\?\.\(\);\s*refreshInvoices\?\.\(\);\s*\}, 20_000\);/);
});

test("after signing, a one-link client pays the deposit on the same screen", () => {
  const page = read("components/client/kit/client-contract.tsx");
  assert.match(page, /const oneLink = tradeProfile\(workspace\.tenantTrade\)\.journey\.oneLinkBooking && needs\.agreement;/);
  assert.match(page, /afterSigning=\{\s*oneLink \? \(\s*<PayAfterSigning/);
  // Every list re-reads after the signature, so the steps follow it.
  assert.match(page, /onChanged=\{\(\) => \(oneLink \? refreshClientRecords\(\) : refreshContracts\?\.\(\)\)\}/);
  assert.match(page, /Pay \{money\(deposit\.balanceCents, deposit\.currency\)\} securely/);
  assert.match(page, /is on its way`\}/);
  const signing = read("components/client/contract-signing.tsx");
  // A photographer's client keeps the link to Payments.
  assert.match(signing, /\{handsOn \? null : \(\s*<Button href="\/client\/payments" variant="secondary">\s*Next: your retainer/);
  assert.match(signing, /\{status === "completed" \? afterSigning : null\}/);
});

// ── The studio's side ──────────────────────────────────────────────────────

test("a vendor sends the booking link; a photographer's send reads as before", () => {
  const send = read("components/contracts/combined-agreement-send.tsx");
  assert.match(send, /const oneLink = tradeProfile\(workspace\.tenantTrade\)\.journey\.oneLinkBooking;/);
  assert.match(send, /oneLink \? "Send the booking link" : "Send as one booking agreement"/);
  assert.match(send, /`Your terms and these prices together — the couple signs both at once, and that accepts the \$\{offer\}\.`/);
  assert.match(send, /`Sign & send to \$\{preview\.clientName \|\| "the couple"\}`/);

  const proposal = read("components/proposals/studio-proposal-workspace.tsx");
  assert.match(proposal, /const oneLink = jobNeeds\.agreement && tradeProfile\(workspace\.tenantTrade\)\.journey\.oneLinkBooking;/);
  assert.match(proposal, /oneLink \? `Send the \$\{offer\} on its own` : offer === "proposal" \? "Send proposal" : `Send \$\{offer\}`/);
  assert.match(proposal, /oneLink \? "Booking link sent" : "Sent as a booking agreement"/);
  assert.match(proposal, /: "The project can now move into the agreement and retainer workflow\."/);
});

test("the booking page reads as one booking for a vendor, and unchanged for a photographer", () => {
  const booking = read("components/booking/project-booking-workspace.tsx");
  assert.match(booking, /const oneLink = kindNeeds\.agreement && tradeProfile\(workspace\.tenantTrade\)\.journey\.oneLinkBooking;/);
  assert.match(booking, /title: kindNeeds\.agreement \? \(oneLink \? "Booking link" : "Contract"\) : "Agreement",/);
  assert.match(booking, /\? "Signed and paid"\s*: "Signed — deposit due"/);
  assert.match(booking, /\? "Sent — waiting to sign"/);
  assert.match(booking, /\(oneLink \? "Deposit" : "Retainer"\)/);
  // The quote that went alone can still go as the booking link.
  assert.match(booking, /<CombinedAgreementSend[\s\S]*?proposalId=\{String\(openProposal\.id\)\}/);

  const step = read("components/contracts/native-contract-step.tsx");
  assert.match(step, /bookingLink \? "Booking link sent — waiting to sign\." : "Out for signature\."/);
  assert.match(step, /bookingLink \? "The booking is signed — the deposit is due\." : "The agreement is complete\."/);

  const hero = read("components/booking/booking-autopilot-workspace.tsx");
  assert.match(hero, /The booking link is with the client\./);
  assert.match(hero, /The booking agreement is with the client\./);
});

// ── Photographers are unchanged ───────────────────────────────────────────

test("a photographer's portal steps are exactly as before", () => {
  const cases = [
    { proposalStatus: "sent", contractStatus: null, retainer: null },
    { proposalStatus: "accepted", contractStatus: null, retainer: null },
    { proposalStatus: "accepted", contractStatus: "sent", retainer: null },
    { proposalStatus: "accepted", contractStatus: "completed", retainer: payable },
    { proposalStatus: "accepted", contractStatus: "completed", retainer: { ...payable, status: "paid", balanceCents: 0 } },
  ];
  for (const input of cases) {
    // Off and omitted are the same view.
    assert.deepEqual(bookingSteps({ ...input, oneLink: false }), bookingSteps(input));
  }
  const open = bookingSteps(cases[0]!);
  assert.deepEqual(open.steps.map((step) => step.label), ["Accept your proposal", "Sign the agreement", "Pay your deposit", "Your date is booked"]);
  assert.equal(open.next.title, "Review and accept your proposal");
  assert.equal(open.next.href, "/client/proposal");
  assert.equal(bookingSteps(cases[2]!).next.title, "Sign your agreement");
  assert.equal(bookingSteps(cases[3]!).next.title, "Pay your deposit");
  assert.equal(bookingSteps(cases[3]!).next.detail, "The last step. Your date is secured the moment it's paid.");
});
