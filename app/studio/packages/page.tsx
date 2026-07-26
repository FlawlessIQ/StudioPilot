import type { Metadata } from "next";
import Link from "next/link";
import { Camera, Copy, Plus } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { StatusBadge } from "@/components/ui/status-badge";
import { crmPackages } from "@/config/crm-demo-data";

export const metadata: Metadata = { title: "Packages · StudioHub" };

export default function PackagesPage() {
  return (
    <AppShell active="Packages">
      <div className="crm-page">
        <div className="dashboard-heading">
          <div><p className="eyebrow">Catalog</p><h1>Packages</h1><p>Versioned offerings that create immutable project pricing snapshots.</p></div>
          <Link className="button button-dark" href="/studio/packages/new"><Plus size={16} /> Create package</Link>
        </div>
        <div className="package-note"><Copy size={17} /><div><strong>Booked pricing stays fixed.</strong><p>Editing a package creates a new version. Existing project snapshots never change.</p></div></div>
        <div className="package-grid">
          {crmPackages.map((pkg) => (
            <article className="package-card" key={pkg.id}>
              <header><span><Camera size={18} /></span><small>{pkg.id}</small></header>
              <p className="eyebrow">{pkg.event} · v{pkg.version}</p>
              <h2>{pkg.name}</h2><strong className="package-price">{pkg.price}</strong>
              <div className="package-facts"><span><small>Coverage</small><strong>{pkg.coverage}</strong></span><span><small>Photographers</small><strong>{pkg.photographers}</strong></span><span><small>Add-ons</small><strong>{pkg.addOns}</strong></span></div>
              <footer><StatusBadge tone={pkg.status === "Active" ? "success" : "neutral"} dot>{pkg.status}</StatusBadge><span>Immutable selections</span></footer>
            </article>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
