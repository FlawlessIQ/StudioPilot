import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, LockKeyhole, ShieldCheck } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { LeadIntakeForm } from "@/components/crm/lead-intake-form";
import { dataIsLive } from "@/lib/runtime-mode";
import { adminFirestore } from "@/server/firebase/admin";

type InquiryStudio = {
  name: string;
  slug: string;
};

async function studioForSlug(slug: string): Promise<InquiryStudio | null> {
  if (!/^[a-z0-9-]{2,80}$/.test(slug)) return null;
  if (!dataIsLive && slug === "demo-studio") {
    return { name: "Aperture & Light Studio", slug };
  }
  /**
   * Every address the studio has ever had, not just its current one.
   *
   * The slug became editable, and a studio hands this URL out on cards and in
   * email signatures — an exact match on `publicSlug` would turn all of those
   * into a 404 the moment they tidied it. `slugAliases` accumulates; the
   * fallback covers tenants created before that field existed.
   */
  const byAlias = await adminFirestore
    .collection("tenants")
    .where("slugAliases", "array-contains", slug)
    .limit(2)
    .get();
  const result = byAlias.empty
    ? await adminFirestore
        .collection("tenants")
        .where("publicSlug", "==", slug)
        .limit(2)
        .get()
    : byAlias;
  const studio = result.docs.find((candidate) => {
    const status = candidate.get("status");
    return status === "trial" || status === "active";
  });
  if (!studio) return null;
  return {
    name: String(studio.get("brandName") ?? studio.get("businessName") ?? "Photography studio"),
    slug,
  };
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ studio?: string; preview?: string }>;
}): Promise<Metadata> {
  const { studio = "" } = await searchParams;
  const tenant = await studioForSlug(studio);
  return {
    title: tenant ? `Photography inquiry · ${tenant.name}` : "Photography inquiry",
    description: tenant
      ? `Tell ${tenant.name} about your event and request photography availability.`
      : "Request photography availability from a StudioCue studio.",
  };
}

export default async function InquiryPage({
  searchParams,
}: {
  searchParams: Promise<{ studio?: string; preview?: string }>;
}) {
  const { studio = "", preview = "" } = await searchParams;
  const backLink =
    preview === "studio"
      ? { href: "/studio/setup", label: "Back to Studio setup" }
      : { href: "/", label: "Back to StudioCue" };
  const tenant = await studioForSlug(studio);
  if (!tenant) {
    return (
      <main className="inquiry-page inquiry-unavailable">
        <header><Logo /><Link href={backLink.href}><ArrowLeft size={15} /> {backLink.label}</Link></header>
        <section className="panel">
          <p className="eyebrow">Inquiry form unavailable</p>
          <h1>Ask the studio for its current inquiry link.</h1>
          <p>This link is missing a valid studio address or the form is not currently accepting inquiries.</p>
          <Link className="button button-dark" href="/">Visit StudioCue</Link>
        </section>
      </main>
    );
  }
  return (
    <main className="inquiry-page">
      <header>
        <Logo />
        <Link href={backLink.href}><ArrowLeft size={15} /> {backLink.label}</Link>
      </header>
      <div className="inquiry-layout">
        <aside className="inquiry-intro">
          <p className="eyebrow">{tenant.name}</p>
          <h1>Let’s make something worth remembering.</h1>
          <p>
            Share the essentials and our studio will confirm availability, then send a
            thoughtful next step—never an automated price guess.
          </p>
          <div className="inquiry-assurance">
            <span><ShieldCheck size={18} /><strong>Human reviewed</strong><small>Every inquiry is reviewed by our studio team.</small></span>
            <span><LockKeyhole size={18} /><strong>Private by default</strong><small>Your details stay within this studio workspace.</small></span>
          </div>
        </aside>
        <LeadIntakeForm brandName={tenant.name} tenantSlug={tenant.slug} />
      </div>
    </main>
  );
}
