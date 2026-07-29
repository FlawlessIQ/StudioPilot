"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { doc, getDoc } from "firebase/firestore";
import { useWorkspace } from "@/features/auth/workspace-context";
import { getFirebaseClient } from "@/lib/firebase/client";
import { dataIsLive } from "@/lib/runtime-mode";

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
    return <main className="pdf-preview"><p>Loading secure proposal…</p></main>;
  if (!proposal)
    return <main className="pdf-preview"><h1>Proposal unavailable</h1><p>This record is not available in the active studio.</p></main>;
  const snapshot =
    nested(proposal, "pricingSnapshot") as Record<string, unknown> | null;
  const packageName = String(snapshot?.packageName ?? "Photography package");
  const total = Number(snapshot?.totalCents ?? proposal.totalCents ?? 0);
  const retainer = Number(snapshot?.retainerCents ?? proposal.retainerCents ?? 0);
  const currency = snapshot?.currency ?? proposal.currency;
  const clientName =
    nested(proposal, "clientSnapshot.displayName") ??
    nested(proposal, "clientSnapshot.primaryName") ??
    proposal.projectName ??
    "Client";
  const eventType =
    nested(proposal, "eventSnapshot.eventType") ??
    proposal.eventType ??
    "Photography project";
  const eventDate =
    nested(proposal, "eventSnapshot.eventDate") ??
    proposal.eventDate ??
    "Date pending";
  return (
    <div className="proposal-preview-page">
      <Link className="back-link" href={`/studio/proposals/${id}`}><ArrowLeft /> Back to proposal</Link>
      <main className="pdf-preview">
      <header><span>SC</span><div><small>{workspace.tenantName.toUpperCase()}</small><strong>Photography Proposal</strong></div><p>VERSION {String(proposal.version ?? 1)}</p></header>
      <section><p className="eyebrow">Prepared for</p><h1>{String(clientName)}</h1><p>{String(eventType)} · {String(eventDate)}</p></section>
      <section><h2>{packageName}</h2><p>{String(proposal.notes ?? snapshot?.description ?? "Scope and deliverables are preserved in this proposal version.")}</p>
        <table><tbody><tr><td>{packageName}</td><td>{money(snapshot?.subtotalCents ?? total, currency)}</td></tr><tr><td>Discounts and tax</td><td>{money(Number(snapshot?.taxCents ?? 0) - Number(snapshot?.discountCents ?? 0), currency)}</td></tr><tr className="total"><td>Total</td><td>{money(total, currency)}</td></tr></tbody></table>
      </section>
      <section className="pdf-terms"><h2>Payment schedule</h2><div><span><small>Retainer</small><strong>{money(retainer, currency)}</strong></span><span><small>Remaining balance</small><strong>{money(Math.max(0, total - retainer), currency)}</strong></span></div><p>{String(proposal.termsSummary ?? "Final contractual terms are governed only by the completed signature-provider agreement.")}</p></section>
      <footer><span>Generated {new Date().toLocaleDateString()}</span><span>{workspace.tenantName}</span><span>Preview</span></footer>
      </main>
    </div>
  );
}
