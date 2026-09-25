import type { ContractDocument, ContractInline } from "@/features/contracts/document";

/**
 * A StudioCue contract, on screen.
 *
 * The same blocks the sealed PDF draws, so what the couple reads here and the
 * copy they are emailed are two renderings of one record. React escapes every
 * string; nothing in a studio's agreement is ever interpreted as markup.
 *
 * `showFields` marks the text StudioCue filled in, for the studio's review —
 * the couple sees plain prose.
 */
export function ContractDocumentView({
  document,
  showFields = false,
  missing = [],
}: {
  document: ContractDocument;
  showFields?: boolean;
  missing?: readonly string[];
}) {
  const inline = (content: ContractInline[], keyPrefix: string) =>
    content.map((piece, index) => {
      const className = [
        piece.bold ? "contract-bold" : "",
        showFields && piece.field ? "contract-field" : "",
        showFields && piece.field && missing.includes(piece.field) ? "is-missing" : "",
      ]
        .filter(Boolean)
        .join(" ");
      return className ? (
        <span
          className={className}
          key={`${keyPrefix}-${index}`}
          title={showFields && piece.field ? piece.field : undefined}
        >
          {piece.text}
        </span>
      ) : (
        <span key={`${keyPrefix}-${index}`}>{piece.text}</span>
      );
    });
  return (
    <article className="contract-document" aria-label={document.title}>
      <h2 className="contract-document-title">{document.title}</h2>
      {document.blocks.map((block, index) => {
        const key = `block-${index}`;
        if (block.type === "heading") {
          return block.level === 1 ? (
            <h3 className="contract-heading" key={key}>{inline(block.content, key)}</h3>
          ) : (
            <h4 className="contract-subheading" key={key}>{inline(block.content, key)}</h4>
          );
        }
        if (block.type === "paragraph") {
          return <p className="contract-paragraph" key={key}>{inline(block.content, key)}</p>;
        }
        if (block.type === "list") {
          return (
            <ul className="contract-list" key={key}>
              {block.items.map((item, itemIndex) => (
                <li key={`${key}-${itemIndex}`}>{inline(item.content, `${key}-${itemIndex}`)}</li>
              ))}
            </ul>
          );
        }
        return (
          <div className="contract-schedule" key={key} role="table" aria-label="Payment schedule">
            <div className="contract-schedule-row is-head" role="row">
              <span role="columnheader">Payment</span>
              <span role="columnheader">Amount</span>
              <span role="columnheader">Due</span>
            </div>
            {block.rows.map((row, rowIndex) => (
              <div className="contract-schedule-row" key={`${key}-${rowIndex}`} role="row">
                <span role="cell">{row.label}</span>
                <span role="cell">{row.amount}</span>
                <span role="cell">{row.due}</span>
              </div>
            ))}
          </div>
        );
      })}
    </article>
  );
}
