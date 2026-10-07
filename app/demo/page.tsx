import { MarketingLayout } from "@/components/marketing/marketing-layout";
import { DemoForm } from "@/components/marketing/demo-form";
import { marketingMetadata } from "@/features/marketing/metadata";

export const metadata = marketingMetadata({
  title: "Book a demo of StudioCue",
  absoluteTitle: true,
  description:
    "See StudioCue run a photography studio's office: inquiries, agreements, invoices, planning and crew, prepared by Cue for your approval. Book a 30-minute demo.",
  path: "/demo",
  og: "home",
});

/** "Book a demo" (docs/console.md, "Pipeline"): a request lands on the Console's pipeline. */
export default function DemoPage() {
  return (
    <MarketingLayout
      description="Thirty minutes with the team that built it alongside a working studio. We'll show Cue running an inquiry through to a booked job, and answer what you want to know."
      eyebrow="Book a demo"
      hero="plain"
      title="See StudioCue on your kind of job"
    >
      <section className="marketing-demo">
        <DemoForm />
      </section>
    </MarketingLayout>
  );
}
