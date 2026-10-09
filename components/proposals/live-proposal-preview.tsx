"use client";

import { balanceWithSalesTax, readPricedSalesTax, SALES_TAX_ESTIMATE_LABEL, salesTaxEstimateText } from "@/features/billing/sales-tax-pricing";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { doc, getDoc } from "firebase/firestore";
import { useWorkspace } from "@/features/auth/workspace-context";
import { getFirebaseClient } from "@/lib/firebase/client";
import { dataIsLive } from "@/lib/runtime-mode";
import { formatDueDate, formatEventDate } from "@/lib/format/event-date";
import { retainerFromSchedule } from "@/features/booking/agreed-retainer";
import { TRADE_LABELS, tradeOf, tradeProfile, tradeVocab } from "@/features/trades/trades";

type Proposal = Record<string, unknown> & { id: string };
function nested(value: Proposal, path: string) {
  let current: unknown = value;
  for (const segment of path.split("."))
    current =
      current && typeof current === "object"
        ? (current as Record<string, unknown>)[segment]
        : null;
  return current;
}
function money(value: unknown, currency: unknown) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: typeof currency === "string" ? currency : "USD",
  }).format(Number(value ?? 0) / 100);
}

export function LiveProposalPreview({ id }: { id: string }) {
  const workspace = useWorkspace();
  // The studio's words (trades.ts): a makeup artist's or hair stylist's quote,
  // and "Hair package" rather than "Photography package" when a name is missing.
  const Offer = tradeVocab(workspace.tenantTrade).proposal;
  const offer = Offer.toLowerCase();
  const service = TRADE_LABELS[tradeOf(workspace.tenantTrade)];
  const [proposal, setProposal] = useState<Proposal | null | undefined>(
    dataIsLive
      ? undefined
      : {
          id,
          projectName: "Rivera wedding",
          clientSnapshot: { displayName: "Maya and Elena Rivera" },
          eventSnapshot: {
            name: "Rivera wedding",
            eventType: "Wedding photography",
            eventDate: "June 12, 2027",
          },
          version: 2,
          notes:
            "A thoughtful, documentary-led collection built around the moments and people that matter most.",
          termsSummary:
            "The offer is reserved through the expiration date below. Final legal terms are established only by the signed agreement.",
          pricingSnapshot: {
            currency: "USD",
            packageName: "Signature wedding",
            description:
              "Ten hours of coverage, two photographers, and a complete digital collection.",
            subtotalCents: 650000,
            discountCents: 0,
            taxCents: 30000,
            retainerCents: 170000,
            totalCents: 680000,
          },
        },
  );
  useEffect(() => {
    if (!dataIsLive || workspace.loading) return;
    void getDoc(doc(getFirebaseClient().firestore, "proposals", id)).then(
      (snapshot) =>
        setProposal(
          snapshot.exists() && snapshot.get("tenantId") === workspace.tenantId
            ? ({ id: snapshot.id, ...snapshot.data() } as Proposal)
            : null,
        ),
    );
  }, [id, workspace.loading, workspace.tenantId]);
  if (proposal === undefined)
    return <main className="pdf-preview"><p>{`Loading secure ${offer}…`}</p></main>;
  if (!proposal)
    return <main className="pdf-preview"><h1>{`${Offer} unavailable`}</h1><p>This record is not available in the active studio.</p></main>;
  const snapshot =
    nested(proposal, "pricingSnapshot") as Record<string, unknown> | null;
  const packageName = String(snapshot?.packageName ?? `${service} package`);
  const total = Number(snapshot?.totalCents ?? proposal.totalCents ?? 0);
  // The retainer the payment schedule asks for, which is the one the couple
  // is billed — a studio's override is not in the pricing (H2, M7).
  const retainer = retainerFromSchedule(
    proposal.paymentSchedule,
    Number(snapshot?.retainerCents ?? proposal.retainerCents ?? 0),
  );
  const lines = Array.isArray(snapshot?.lineItems)
    ? (snapshot.lineItems as Array<Record<string, unknown>>)
    : [];
  const discountCents = Number(snapshot?.discountCents ?? 0);
  const taxCents = Number(snapshot?.taxCents ?? 0);
  const currency = snapshot?.currency ?? proposal.currency;
  // Pre-tax "plus sales tax" (QuickBooks works it out): as the PDF prints it.
  const salesTax = readPricedSalesTax(snapshot?.salesTax);
  const salesTaxEstimate = salesTaxEstimateText(salesTax, String(currency ?? "USD"));
  const clientName =
    nested(proposal, "clientSnapshot.displayName") ??
    nested(proposal, "clientSnapshot.primaryName") ??
    proposal.projectName ??
    "Client";
  const eventType =
    nested(proposal, "eventSnapshot.eventType") ??
    proposal.eventType ??
    `${service} project`;
  const eventDate =
    nested(proposal, "eventSnapshot.eventDate") ??
    proposal.eventDate ??
    "Date pending";
  return (
    <div className="proposal-preview-page">
      <Link className="back-link" href={`/studio/proposals/${id}`}><ArrowLeft /> {`Back to ${offer}`}</Link>
      <main className="pdf-preview">
      {/* The studio's own initial, not StudioCue's, and no claim that a film
          package is "photography" (walked 2026-09-29). */}
      <header><span>{(workspace.tenantName.trim()[0] ?? "S").toUpperCase()}</span><div><small>{workspace.tenantName.toUpperCase()}</small><strong>{Offer}</strong></div><p>VERSION {String(proposal.version ?? 1)}</p></header>
      <section><p className="eyebrow">Prepared for</p><h1>{String(clientName)}</h1><p>{String(eventType)} · {/^\d{4}-\d{2}-\d{2}/.test(String(eventDate)) ? formatEventDate(String(eventDate).slice(0, 10)) : String(eventDate)}</p></section>
      <section><h2>{packageName}</h2><p>{String(proposal.notes ?? snapshot?.description ?? (tradeProfile(workspace.tenantTrade).family === "photo" ? "Scope and deliverables are preserved in this proposal version." : `What's included is preserved in this ${offer} version.`))}</p>
        {/* Each line, then the discount and the tax on their own: one
            "Discounts and tax" figure netted the two together. */}
        <table><tbody>
          {lines.length ? (
            lines.map((line, index) => (
              <tr key={index}>
                <td>{String(line.description ?? packageName)}{Number(line.quantity ?? 1) > 1 ? ` × ${Number(line.quantity)}` : ""}</td>
                <td>{money(Number(line.totalCents ?? 0), currency)}</td>
              </tr>
            ))
          ) : (
            <tr><td>{packageName}</td><td>{money(snapshot?.subtotalCents ?? total, currency)}</td></tr>
          )}
          {discountCents > 0 ? <tr><td>Discount</td><td>{money(-discountCents, currency)}</td></tr> : null}
          {taxCents > 0 ? <tr><td>Tax</td><td>{money(taxCents, currency)}</td></tr> : null}
          <tr className="total"><td>{salesTax && !salesTax.exempt ? "Total, plus sales tax" : "Total"}</td><td>{money(total, currency)}</td></tr>
          {salesTaxEstimate ? <tr><td>{SALES_TAX_ESTIMATE_LABEL} — not included above</td><td>{salesTaxEstimate}</td></tr> : null}
          {salesTax?.exempt ? <tr><td>No sales tax on this booking</td><td>None</td></tr> : null}
        </tbody></table>
      </section>
      <section className="pdf-terms"><h2>Payment schedule</h2><div><span><small>Retainer</small><strong>{money(retainer, currency)}</strong></span><span><small>Remaining balance</small><strong>{balanceWithSalesTax(money(Math.max(0, total - retainer), currency), salesTax)}</strong></span></div><p className="pdf-terms-summary">{String(proposal.termsSummary ?? "Final terms are the ones in the signed agreement.")}</p></section>
      <footer><span>Generated {formatDueDate(new Date().toISOString())}</span><span>{workspace.tenantName}</span><span>Preview</span></footer>
      </main>
    </div>
  );
}
