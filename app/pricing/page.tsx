import Link from "next/link";
import { ArrowRight, CircleCheck } from "lucide-react";
import { MarketingLayout } from "@/components/marketing/marketing-layout";
import { HireComparison } from "@/components/marketing/hire-comparison";
import { planCards } from "@/config/saas-plans";
import { assistantHoursFor } from "@/features/marketing/cue-duties";
import { marketingMetadata } from "@/features/marketing/metadata";

export const metadata = marketingMetadata({
  title: "Pricing",
  description:
    `StudioCue plans from ${planCards[0].monthly} a month, with unlimited clients and projects, a 14-day trial, and no percentage taken from client payments.`,
  path: "/pricing",
  og: "pricing",
});

export default function PricingPage() {
  return (
    <MarketingLayout
      eyebrow="What Cue costs"
      pricingLink={false}
      title="An office manager for less than a day of an assistant."
      description={`${planCards[0].monthly} a month buys about ${assistantHoursFor(planCards[0].monthlyCents / 100)} of an administrative assistant at the US median wage. Cue works every hour of the month. Unlimited clients and projects on every plan.`}
    >
      <section className="marketing-pricing-grid marketing-pricing-page">
        {planCards.map((plan) => (
          <article className={`marketing-price-card ${plan.highlight ? "is-featured" : ""}`} key={plan.key}>
            <div className="marketing-plan-heading"><span><small>StudioCue</small><h2>{plan.name}</h2></span></div>
            <p>{plan.description}</p>
            <div className="marketing-plan-price"><strong>{plan.monthly}</strong><span>/month</span></div>
            <small className="marketing-annual-price">{plan.yearly}/year · two months free</small>
            <ul>
              <li><CircleCheck /> {plan.users}</li>
              <li><CircleCheck /> {plan.ai}</li>
              {plan.features.map((feature) => <li key={feature}><CircleCheck /> {feature}</li>)}
            </ul>
            <Link className={`button ${plan.highlight ? "button-dark" : "button-light"}`} href={`/auth/register?plan=${plan.key}`}>
              Start with {plan.name} <ArrowRight />
            </Link>
          </article>
        ))}
      </section>
      <p className="marketing-pricing-note">Provider subscriptions, assisted migration, and implementation services are separate. StudioCue does not take a percentage of client payments.</p>
      <section aria-labelledby="pricing-compare-title" className="mk-section">
        <header className="mk-section-head">
          <span className="section-kicker">Hire, software, or Cue</span>
          <h2 id="pricing-compare-title">Works like an assistant. Costs like software.</h2>
        </header>
        <HireComparison />
      </section>
    </MarketingLayout>
  );
}
