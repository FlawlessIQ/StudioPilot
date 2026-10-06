import { Play } from "lucide-react";
import { FilmButton } from "@/components/help/journey-film";
import { filmLength } from "@/features/help/videos";
import { CapabilityGrid, MarketingLayout } from "@/components/marketing/marketing-layout";
import { HireComparison } from "@/components/marketing/hire-comparison";
import { JobDescription } from "@/components/marketing/job-description";
import { SaturdayLog } from "@/components/marketing/saturday-log";
import { StudioProof } from "@/components/marketing/studio-proof";
import { marketingMetadata } from "@/features/marketing/metadata";

export const metadata = marketingMetadata({
  title: "Meet Cue, your studio's office manager",
  description:
    "Cue's job description: what it does on its own at any hour, what it prepares for your yes, and what it will never do. Part of StudioCue, for photography studios.",
  path: "/office-manager",
  og: "office-manager",
});

/**
 * Cue's whole job description: the canonical "what Cue does" page
 * (docs/positioning-office-manager-plan-2026-10-06.md). Every duty, its
 * "on its own" / "you approve" tag and what it needs come from
 * features/marketing/cue-duties.ts. No video: the page's pictures are built in
 * it, so it plays nothing (tests/marketing-media-budget.test.ts).
 */
export default function OfficeManagerPage() {
  return (
    <MarketingLayout
      eyebrow="Meet Cue"
      title="Your studio's office manager. On every hour."
      description="Cue answers new inquiries, sends the paperwork, chases the insurance certificate, lines up your crew and keeps your clients on schedule, at any hour. Anything that matters waits for your yes."
    >
      <section aria-labelledby="om-saturday-title" className="mk-section mk-section--first">
        <div className="mk-split">
          <header className="mk-section-head mk-section-head--left">
            <span className="section-kicker">While you were shooting</span>
            <h2 id="om-saturday-title">A Saturday, from Cue&rsquo;s side of the desk.</h2>
            <p>
              You were shooting all day. Cue handled the routine work as it came in and left
              the rest for Monday, prepared and ready to send. Routine notices and reminders go out
              on their own. Anything Cue writes for you, and anything about money or signatures,
              waits for your yes.
            </p>
            <FilmButton
              blurb="what Cue did while you were out shooting, and what it left for Monday."
              className="button button-dark"
              href="#om-role-title"
              linkLabel="Read the job description"
              title="One Saturday"
              videoId="one-saturday"
            >
              <Play aria-hidden="true" size={16} />
              {filmLength("one-saturday") ? `Watch one Saturday · ${filmLength("one-saturday")}` : "Read the job description"}
            </FilmButton>
          </header>
          <SaturdayLog />
        </div>
      </section>

      <section aria-labelledby="om-role-title" className="mk-section">
        <header className="mk-section-head">
          <span className="section-kicker">The job description</span>
          <h2 id="om-role-title">What Cue does, and what waits for you.</h2>
          <p>
            &ldquo;On its own&rdquo; runs at any hour with nobody there. &ldquo;You approve&rdquo; is prepared
            and waits for one tap. Some duties need something connected first, and say so.
          </p>
        </header>
        <JobDescription showNeeds />
      </section>

      <CapabilityGrid
        items={[
          {
            title: "It starts by asking",
            text: "On day one, the messages that sound like you wait for you: the schedule confirmation, the day-before checklist, the balance notice. Approve the same kind three times without changing a word and Cue offers to send it on its own from then on.",
            points: [
              "You choose what it may send without asking",
              "Money and signatures always wait",
              "Anything Cue writes itself always waits",
            ],
          },
          {
            title: "It speaks as your studio",
            text: "Your clients and your crew never deal with Cue. Every email and every page they see carries your studio's name and your voice. Cue works behind the scenes, for you.",
            points: [
              "Your name on every email and page",
              "Replies drafted in your voice",
              "Never pretends to be a person",
            ],
          },
          {
            title: "It learns from your own paperwork",
            text: "Bring in the agreement, packages, questionnaires and email templates you already use, and the jobs you've already booked. Cue works from them, not from a template someone else wrote.",
            points: [
              "Your agreement and your packages",
              "Your forms and your wording",
              "Booked jobs arrive quietly, with nothing sent",
            ],
          },
          {
            title: "It never touches your photos",
            text: "Cue runs the office. Editing, culling, album design and the gallery you send are yours. Cue reminds the client to choose their album photos and asks for the review afterward.",
            points: ["No editing or culling", "You release the gallery", "Reminders and the review ask, after"],
          },
        ]}
      />

      <section aria-labelledby="om-compare-title" className="mk-section">
        <header className="mk-section-head">
          <span className="section-kicker">Hire, software, or Cue</span>
          <h2 id="om-compare-title">Works like an assistant. Costs like software.</h2>
        </header>
        <HireComparison />
      </section>

      <StudioProof />
    </MarketingLayout>
  );
}
