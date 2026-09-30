import { glossaryTerm } from "@/features/help/glossary";
import type { Explainer } from "@/features/help/types";
import { RichText } from "@/components/help/rich-text";

/**
 * One written guide: what it's for, the steps, what happens next, and the
 * words worth knowing. The same view renders in the How-to popup, the studio's
 * help hub and the public /how-to pages.
 */
export function ExplainerView({
  guide,
  headingLevel = 3,
}: {
  guide: Explainer;
  /** The level of this view's section headings, under the page's own. */
  headingLevel?: 2 | 3;
}) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const terms = (guide.terms ?? []).map(glossaryTerm).filter((term) => term !== undefined);
  return (
    <div className="help-explainer">
      <p className="help-explainer-purpose">
        <RichText text={guide.purpose} />
      </p>
      <Heading>Steps</Heading>
      <ol className="help-explainer-steps">
        {guide.steps.map((step) => (
          <li key={step}>
            <RichText text={step} />
          </li>
        ))}
      </ol>
      {guide.next ? (
        <>
          <Heading>What happens next</Heading>
          <p>
            <RichText text={guide.next} />
          </p>
        </>
      ) : null}
      {guide.goodToKnow?.length ? (
        <>
          <Heading>Good to know</Heading>
          <ul className="help-explainer-notes">
            {guide.goodToKnow.map((note) => (
              <li key={note}>
                <RichText text={note} />
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {terms.length ? (
        <>
          <Heading>Words to know</Heading>
          <dl className="help-explainer-terms">
            {terms.map((term) => (
              <div key={term.id}>
                <dt>{term.term}</dt>
                <dd>{term.hint}</dd>
              </div>
            ))}
          </dl>
        </>
      ) : null}
    </div>
  );
}
