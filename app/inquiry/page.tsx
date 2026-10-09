import type { Metadata } from "next";
import { cache } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { LeadIntakeForm } from "@/components/crm/lead-intake-form";
import { resolveTenantBrand, type TenantBrand } from "@/features/branding/tenant-brand";
import { normaliseInquiryFormConfig, type InquiryFormConfig } from "@/features/leads/inquiry-form-config";
import { dataIsLive } from "@/lib/runtime-mode";
import { TRADE_LABELS, tradeOf, type Trade } from "@/features/trades/trades";
import { adminFirestore } from "@/server/firebase/admin";

type InquiryStudio = {
  name: string;
  slug: string;
  brand: TenantBrand;
  /** The studio's own form: its types, questions and colours (Settings → Inquiry capture). */
  form: InquiryFormConfig;
  /** What the studio does (trades.ts): the page's tab names it. */
  trade?: Trade;
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
    return { name, slug, brand: resolveTenantBrand({ brandName: name }), form: normaliseInquiryFormConfig(null) };
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
  const trade = tradeOf(studio.get("trade"));
  const brand = resolveTenantBrand(studio.data(), trade === "photographer" ? "Photography studio" : TRADE_LABELS[trade]);
  /**
   * The studio's own form, read here so the first paint already asks the
   * right questions. Unreadable settings are the default form, never an
   * unavailable page: the server checks against the same settings either way.
   */
  const settings = await adminFirestore
    .doc(`leadCaptureSettings/${studio.id}`)
    .get()
    .catch(() => null);
  const form = normaliseInquiryFormConfig(settings?.get("inquiryForm"));
  return { name: brand.brandName, slug, brand, form, trade };
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ studio?: string; preview?: string }>;
}): Promise<Metadata> {
  const { studio = "" } = await searchParams;
  const tenant = await studioForSlug(studio);
  if (!tenant) {
    return {
      title: "Photography inquiry",
      description: "Request photography availability from a StudioCue studio.",
    };
  }
  /**
   * The card a couple sees when the studio texts or posts this link. It was
   * StudioCue's own — "StudioCue · From inquiry to gallery." with our banner —
   * so a studio sending its form to a couple looked like it was sending an ad
   * for software (Gabe, 2026-09-30: "Just sent them this???"). It is the
   * studio's now: its name, and its logo when it has one. Replacing
   * `openGraph` and `twitter` whole is deliberate, so none of the site-wide
   * StudioCue card leaks through.
   */
  const title = `${tenant.name} · Check availability`;
  const description = `Tell ${tenant.name} about your day and check their availability. It takes about two minutes.`;
  const images = tenant.brand.logoUrl ? [{ url: tenant.brand.logoUrl, alt: tenant.name }] : [];
  return {
    // A makeup artist's client reads "Makeup inquiry", not "Photography inquiry".
    title: `${!tenant.trade || tenant.trade === "photographer" ? "Photography" : TRADE_LABELS[tenant.trade]} inquiry · ${tenant.name}`,
    description,
    openGraph: { type: "website", siteName: tenant.name, title, description, images },
    twitter: { card: "summary", title, description, images: images.map((image) => image.url) },
  };
}

export default async function InquiryPage({
  searchParams,
}: {
  searchParams: Promise<{ studio?: string; preview?: string; embed?: string }>;
}) {
  const { studio = "", preview = "", embed = "" } = await searchParams;
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
    // The whole screen is the form now, in the studio's brand and the mobile
    // kit (M2 of docs/mobile-first-client-crew-plan-2026-09-28.md). The desktop
    // intro column it replaced pushed the form below the fold on a phone.
    <LeadIntakeForm
      brandName={tenant.name}
      config={tenant.form}
      embedded={embed === "1"}
      preview={preview === "studio"}
      studio={{
        name: tenant.name,
        color: tenant.brand.primaryColor,
        logoUrl: tenant.brand.logoUrl,
      }}
      tenantSlug={tenant.slug}
    />
  );
}
