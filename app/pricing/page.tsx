import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CircleCheck } from "lucide-react";
import { MarketingLayout } from "@/components/marketing/marketing-layout";
import { planCards } from "@/config/saas-plans";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    `StudioCue plans from ${planCards[0].monthly} a month, with unlimited clients and projects, a 14-day trial, and no percentage taken from client payments.`,
  alternates: { canonical: "/pricing" },
};

export default function PricingPage() {
  return (
    <MarketingLayout eyebrow="Simple, serious software" title="Price the operation—not every client." description="Unlimited clients and projects on every plan, with clear team, AI, workflow, and brand entitlements.">
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
    </MarketingLayout>
  );
}
