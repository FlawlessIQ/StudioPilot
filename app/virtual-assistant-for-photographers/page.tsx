import { CapabilityGrid, MarketingLayout } from "@/components/marketing/marketing-layout";
import { HireComparison } from "@/components/marketing/hire-comparison";
import { marketingMetadata } from "@/features/marketing/metadata";

export const metadata = marketingMetadata({
  title: "A virtual assistant for photographers",
  description:
    "What photographers hire a virtual assistant for (inquiries, contracts, invoices, reminders, crew) and how Cue, StudioCue's office manager, does it at any hour without the hiring.",
  path: "/virtual-assistant-for-photographers",
  og: "virtual-assistant",
});

/**
 * The page for people searching "virtual assistant for photographers"
 * (docs/positioning-office-manager-plan-2026-10-06.md). It maps the jobs
 * photographers hand to an assistant onto what Cue really does, and says
 * plainly what an assistant does that Cue doesn't. Every claim here is one of
 * the duties in features/marketing/cue-duties.ts; nothing about chasing late
 * payments, the phone, or the studio's own inbox, because Cue does none of
 * those.
 */
export default function VirtualAssistantPage() {
  return (
    <MarketingLayout
      eyebrow="A virtual assistant for photographers"
      title="The assistant you were going to hire, without the hiring."
      description="Photographers hire an assistant to answer inquiries, send contracts and invoices, and keep clients and crew on schedule. Cue, StudioCue's office manager, does that work at any hour, from your own paperwork, and waits for you on what matters."
    >
      <CapabilityGrid
        items={[
          {
            title: "Answering inquiries while you shoot",
            text: "An inquiry answered tomorrow is often an inquiry lost. Cue acknowledges every inquiry from your website the moment it arrives, checks your date, and has your personal reply drafted for when you're back.",
            points: [
              "Acknowledged at any hour",
              "Your date checked right away",
              "Your reply drafted, in your voice",
            ],
          },
          {
            title: "Contracts and invoices",
            text: "Cue writes the agreement from the proposal your client accepted, reminds them to sign, and sends the retainer invoice from your own QuickBooks once they have. The final balance invoice is raised 28 days before the day.",
            points: [
              "Agreements signed online",
              "Signing reminders on day 3 and day 7",
              "Invoices from your QuickBooks, on time",
            ],
          },
          {
            title: "Consultations and client reminders",
            text: "Clients book, move or cancel their consultation themselves. Cue reminds them about unfinished planning forms, locks the details four weeks out, and sends the week-before note.",
            points: [
              "Self-serve consultation booking",
              "Form reminders and a final details sign-off",
              "The week-before note",
            ],
          },
          {
            title: "Second shooters and crew",
            text: "When someone passes on a job, Cue offers it to the next person on your list. When they say yes, it goes on their Google Calendar, and their call times arrive two days before.",
            points: [
              "Next on your list, without you noticing",
              "On their calendar when they accept",
              "Call times two days out",
            ],
          },
          {
            title: "Insurance certificates",
            text: "Cue gets the request to your agent ready, chases until the certificate is back, and checks it against what the venue requires before you send it on.",
            points: [
              "Chased until it arrives",
              "Checked against the venue's requirements",
              "Sent on once you approve",
            ],
          },
          {
            title: "What an assistant does that Cue doesn't",
            text: "Cue is software, and it's honest about the edges. It doesn't answer your phone or write from your own inbox, it never touches your photos, and it leaves pricing, discounts and signatures to you.",
            points: [
              "No phone calls",
              "No editing or culling",
              "Your judgment calls stay yours",
            ],
          },
        ]}
      />

      <section aria-labelledby="va-compare-title" className="mk-section">
        <header className="mk-section-head">
          <span className="section-kicker">Hire, software, or Cue</span>
          <h2 id="va-compare-title">Works like an assistant. Costs like software.</h2>
          <p>
            No hiring, no training period and no turnover. Cue starts from your own agreement,
            packages and forms, and is on every hour of the month.
          </p>
        </header>
        <HireComparison />
      </section>
    </MarketingLayout>
  );
}
