import type { Metadata } from "next";
import { cache } from "react";
import Link from "next/link";
import { ArrowLeft, LockKeyhole, ShieldCheck } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { LeadIntakeForm } from "@/components/crm/lead-intake-form";
import { KitRoot, StudioMark } from "@/components/kit/kit";
import { resolveTenantBrand, type TenantBrand } from "@/features/branding/tenant-brand";
import { dataIsLive } from "@/lib/runtime-mode";
import { adminFirestore } from "@/server/firebase/admin";

type InquiryStudio = {
  name: string;
  slug: string;
  brand: TenantBrand;
};

/**
 * Once per request. `generateMetadata` and the page both need the studio, and
 * each used to run its own lookup, so a couple waited on up to four Firestore
 * reads, one after another, before the first byte.
 */
const studioForSlug = cache(lookupStudio);

async function lookupStudio(slug: string): Promise<InquiryStudio | null> {
  if (!/^[a-z0-9-]{2,80}$/.test(slug)) return null;
  if (!dataIsLive && slug === "demo-studio") {
    const name = "Aperture & Light Studio";
    return { name, slug, brand: resolveTenantBrand({ brandName: name }) };
  }
  /**
   * Every address the studio has ever had, not just its current one.
   *
   * The slug became editable, and a studio hands this URL out on cards and in
   * email signatures — an exact match on `publicSlug` would turn all of those
   * into a 404 the moment they tidied it. `slugAliases` accumulates; the
   * fallback covers tenants created before that field existed.
   */
  /**
   * A backend that cannot answer means "unavailable", never a 500.
   *
   * This is the first page anyone outside the business ever sees, reached from
   * a link on a card or in an email signature. An unhandled read left a couple
   * looking at a server error; the branch below already says the right thing
   * — ask the studio for its current link — and says it in the studio's own
   * shell.
   */
  let result;
  try {
    // Both at once: the alias is tried first, but waiting for it to miss
    // before asking for the current slug doubled the wait for most studios.
    const [byAlias, bySlug] = await Promise.all([
      adminFirestore
        .collection("tenants")
        .where("slugAliases", "array-contains", slug)
        .limit(2)
        .get(),
      adminFirestore
        .collection("tenants")
        .where("publicSlug", "==", slug)
        .limit(2)
        .get(),
    ]);
    result = byAlias.empty ? bySlug : byAlias;
  } catch {
    return null;
  }
  const studio = result.docs.find((candidate) => {
    const status = candidate.get("status");
    return status === "trial" || status === "active";
  });
  if (!studio) return null;
  const brand = resolveTenantBrand(studio.data(), "Photography studio");
  return { name: brand.brandName, slug, brand };
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
      {/* The studio's own mark: a couple is writing to the studio, not to
          StudioCue, whose logo and "Back to StudioCue" link used to head the
          page. The back link now shows only to the studio previewing it. */}
      <header>
        <KitRoot className="kit-inline" studio={{ color: tenant.brand.primaryColor }}>
          <span className="kit-brand">
            <StudioMark
              size={34}
              studio={{ name: tenant.name, logoUrl: tenant.brand.logoUrl }}
            />
            <span className="kit-brand-name">{tenant.name}</span>
          </span>
        </KitRoot>
        {preview === "studio" ? (
          <Link href={backLink.href}><ArrowLeft size={15} /> {backLink.label}</Link>
        ) : null}
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
        <LeadIntakeForm brandName={tenant.name} preview={preview === "studio"} tenantSlug={tenant.slug} />
      </div>
    </main>
  );
}
