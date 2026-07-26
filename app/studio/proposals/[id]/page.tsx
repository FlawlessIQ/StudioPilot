import Link from "next/link";
import { ArrowLeft, FileText, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { StatusBadge } from "@/components/ui/status-badge";

export default async function ProposalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AppShell active="Proposals"><div className="booking-page">
    <Link className="back-link" href="/studio/proposals"><ArrowLeft size={15}/> All proposals</Link>
    <header className="page-heading"><div><p className="eyebrow">{id} · Version 3</p><h1>Priya &amp; Jordan</h1><p>Signature Collection · September 19, 2026 · The Foundry</p></div><StatusBadge tone="warning">Viewed</StatusBadge></header>
    <div className="proposal-detail-grid"><section className="panel proposal-sheet"><div className="proposal-brand"><span>A&amp;M</span><div><small>Alder &amp; Muse</small><strong>Photography proposal</strong></div></div><h2>Photography built around the way your day feels.</h2><p>Ten hours of documentary coverage with two photographers, a refined digital gallery, and an engagement session.</p>
      <div className="proposal-pricing"><span><small>Signature Collection</small><strong>$6,500</strong></span><span><small>Engagement session</small><strong>$650</strong></span><span><small>Tax</small><strong>$490</strong></span><span className="proposal-total"><small>Total</small><strong>$7,640</strong></span></div>
      <div className="proposal-payment"><span><small>Retainer due on signing</small><strong>$1,910</strong></span><span><small>Final balance</small><strong>$5,730</strong></span></div>
    </section><aside className="panel proposal-controls"><FileText size={22}/><h2>Version locked</h2><p>Package v4 and its exact pricing are preserved. Later package edits cannot change this proposal.</p><Link className="button button-dark" href={`/studio/proposals/${id}/preview`}>Open PDF preview</Link><div className="evidence-note"><ShieldCheck size={17}/><span><strong>Approval boundary</strong><small>Sending requires studio approval. Acceptance does not mark a contract signed.</small></span></div></aside></div>
  </div></AppShell>;
}
