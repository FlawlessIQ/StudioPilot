import { Info } from "lucide-react";

/**
 * A lightweight, keyboard-reachable definition popover for a term of art.
 *
 * The workspace defined none of its vocabulary in place — "readiness",
 * "booking gate", the phase track — so a newcomer met the words with no way to
 * learn them without leaving the screen. This is the smallest fix: an info
 * affordance beside the term that reveals a one-line definition on hover or
 * keyboard focus. No client state — pure CSS reveal (see app/help.css), so it
 * works in a server or client tree alike.
 */
export function InfoHint({
  term,
  children,
}: {
  /** The term being defined, for the accessible label. */
  term: string;
  /** The definition — kept to a sentence or two. */
  children: React.ReactNode;
}) {
  return (
    <span className="info-hint">
      <button
        type="button"
        className="info-hint-trigger"
        aria-label={`What does “${term}” mean?`}
      >
        <Info aria-hidden="true" />
      </button>
      <span className="info-hint-pop" role="tooltip">
        {children}
      </span>
    </span>
  );
}
