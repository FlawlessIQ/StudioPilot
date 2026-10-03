/**
 * The homepage's questions, each answered only as far as the code goes.
 * tests/marketing-claims.test.ts holds every answer to the mechanism behind
 * it: the web-link portal, the import paths, the AI write boundary, the
 * trial length, and QuickBooks as the way clients pay.
 *
 * Táve is not named: the bookings import reads any CSV, but the product has
 * only been described against HoneyBook, Dubsado, Studio Ninja and 17hats
 * exports (features/imports/spreadsheet.ts).
 *
 * Plain strings on purpose: the same words go to the page and to the
 * FAQPage structured data, so the two can't drift.
 */
export const HOME_FAQ: ReadonlyArray<{ question: string; answer: string }> = [
  {
    question: "Do my couples need to download an app?",
    answer:
      "No. Their portal is a web page that opens from a link in your email, on any phone or computer. They sign in with a one-time link we email them, so there is no password to remember.",
  },
  {
    question: "Can I bring in weddings I've already booked?",
    answer:
      "Yes. Add them one at a time, or upload a spreadsheet exported from your current tool and check every row before anything is imported. Imported jobs arrive quietly: nothing is emailed, invoiced or charged to your client until you choose to bring them in.",
  },
  {
    question: "What does the AI do on its own?",
    answer:
      "It drafts. Replies, proposals, the run of show and follow-ups are prepared for you, and nothing it writes is sent until you approve it. It never records a payment, a signature or a permission, and never marks a job ready. Some routine messages, like reminders, can send on their own; you choose which in Settings.",
  },
  {
    question: "Is my card charged during the trial?",
    answer:
      "No. A card is needed to start, and nothing is charged for 14 days. Cancel before then and you pay nothing.",
  },
  {
    question: "Do you take a cut of client payments?",
    answer:
      "No. Your clients pay you through your own QuickBooks, with QuickBooks Payments pay links and autopay if you use them. StudioCue never takes a percentage; you pay your plan, and QuickBooks charges its usual card fees.",
  },
  {
    question: "Can I switch from HoneyBook, Dubsado or 17hats?",
    answer:
      "Yes. Bring in your agreement, packages, questionnaires and email templates from the documents you already use, and your booked clients from a CSV export of HoneyBook, Dubsado, 17hats, Studio Ninja or a spreadsheet. You review everything before it is imported.",
  },
];

export function HomeFaq() {
  const structured = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: HOME_FAQ.map(({ question, answer }) => ({
      "@type": "Question",
      name: question,
      acceptedAnswer: { "@type": "Answer", text: answer },
    })),
  });
  return (
    <section aria-labelledby="faq-title" className="mk-faq" id="faq">
      <header>
        <span className="section-kicker">Questions</span>
        <h2 id="faq-title">Before you start your trial.</h2>
      </header>
      <div className="mk-faq-list">
        {HOME_FAQ.map(({ question, answer }) => (
          <details key={question}>
            <summary>{question}</summary>
            <p>{answer}</p>
          </details>
        ))}
      </div>
      <script
        // Plain JSON from the constants above; nothing user-supplied.
        dangerouslySetInnerHTML={{ __html: structured.replace(/</g, "\\u003c") }}
        type="application/ld+json"
      />
    </section>
  );
}
