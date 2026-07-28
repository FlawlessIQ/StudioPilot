"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { doc, getDoc } from "firebase/firestore";
import { useWorkspace } from "@/features/auth/workspace-context";
import { getFirebaseClient } from "@/lib/firebase/client";

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
  const [proposal, setProposal] = useState<Proposal | null>();
  useEffect(() => {
    if (workspace.loading) return;
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
  return (
    <div className="proposal-preview-page">
      <Link className="back-link" href={`/studio/proposals/${id}`}><ArrowLeft /> Back to proposal</Link>
      <main className="pdf-preview">
      <header><span>SC</span><div><small>{workspace.tenantName.toUpperCase()}</small><strong>Photography Proposal</strong></div><p>VERSION {String(proposal.version ?? 1)}</p></header>
      <section><p className="eyebrow">Prepared for</p><h1>{String(nested(proposal, "clientSnapshot.primaryName") ?? proposal.projectName ?? "Client")}</h1><p>{String(proposal.eventType ?? "Photography project")} · {String(proposal.eventDate ?? "Date pending")}</p></section>
      <section><h2>{packageName}</h2><p>{String(snapshot?.description ?? proposal.notes ?? "Scope and deliverables are preserved in this proposal version.")}</p>
        <table><tbody><tr><td>{packageName}</td><td>{money(snapshot?.subtotalCents ?? total, proposal.currency)}</td></tr><tr><td>Discounts and tax</td><td>{money(Number(snapshot?.taxCents ?? 0) - Number(snapshot?.discountCents ?? 0), proposal.currency)}</td></tr><tr className="total"><td>Total</td><td>{money(total, proposal.currency)}</td></tr></tbody></table>
      </section>
      <section className="pdf-terms"><h2>Payment schedule</h2><div><span><small>Retainer</small><strong>{money(retainer, proposal.currency)}</strong></span><span><small>Remaining balance</small><strong>{money(Math.max(0, total - retainer), proposal.currency)}</strong></span></div><p>Final contractual terms are governed only by the completed signature-provider agreement.</p></section>
      <footer><span>Generated {new Date().toLocaleDateString()}</span><span>{workspace.tenantName}</span><span>Preview</span></footer>
      </main>
    </div>
  );
}
