import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import type { LegalBlock, LegalDocument } from "@/features/legal/document-types";
import { LEGAL_DOCUMENTS } from "@/features/legal/registry";
import { legalDate } from "@/features/legal/legal";

/** **bold** and [text](href) → React nodes. Nothing else is interpreted. */
export function legalInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /\*\*(.+?)\*\*|\[(.+?)\]\((.+?)\)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = pattern.exec(text))) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    if (match[1] !== undefined) nodes.push(<strong key={key++}>{match[1]}</strong>);
    else {
      const href = match[3]!;
      nodes.push(
        href.startsWith("/") ? (
          <Link href={href} key={key++}>
            {match[2]}
          </Link>
        ) : (
          <a href={href} key={key++} rel="noopener noreferrer" target={href.startsWith("mailto:") ? undefined : "_blank"}>
            {match[2]}
          </a>
        ),
      );
    }
    last = pattern.lastIndex;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function Block({ block }: { block: LegalBlock }) {
  if ("p" in block) return <p>{legalInline(block.p)}</p>;
  if ("h3" in block) return <h3>{block.h3}</h3>;
  if ("note" in block) return <p className="legal-note">{legalInline(block.note)}</p>;
  if ("list" in block)
    return (
      <ul className="legal-list">
        {block.list.map((item, index) => (
          <li key={index}>{legalInline(item)}</li>
        ))}
      </ul>
    );
  if ("ordered" in block)
    return (
      <ol className="legal-ordered">
        {block.ordered.map((item, index) => (
          <li key={index}>{legalInline(item)}</li>
        ))}
      </ol>
    );
  return (
    <div className="legal-table-wrap">
      <table className="legal-table">
        <thead>
          <tr>
            {block.table.head.map((cell) => (
              <th key={cell} scope="col">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.table.rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex}>{legalInline(cell)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A StudioCue legal document: title, version, contents, numbered sections, related documents. */
export function LegalDocumentPage({ document }: { document: LegalDocument }) {
  const related = LEGAL_DOCUMENTS.filter((entry) => entry.slug !== document.slug);
  return (
    <main className="ds-root legal-page" data-ds-theme="emerald">
      <header>
        <Link href="/">
          <Logo />
        </Link>
        <Link href="/legal">
          <ArrowLeft size={15} /> All legal documents
        </Link>
      </header>
      <article>
        <p className="eyebrow">
          Version {document.version} · Effective {legalDate(document.effective)}
        </p>
        <h1>{document.title}</h1>
        {document.intro.map((paragraph, index) => (
          <p className={index === 0 ? "legal-lead" : undefined} key={index}>
            {legalInline(paragraph)}
          </p>
        ))}
        <nav aria-label="Contents" className="legal-toc">
          <p>Contents</p>
          <ol>
            {document.sections.map((section) => (
              <li key={section.id}>
                <a href={`#${section.id}`}>{section.title}</a>
              </li>
            ))}
          </ol>
        </nav>
        {document.sections.map((section) => (
          <Fragment key={section.id}>
            <h2 id={section.id}>{section.title}</h2>
            {section.blocks.map((block, index) => (
              <Block block={block} key={index} />
            ))}
          </Fragment>
        ))}
        <nav aria-label="Related legal documents" className="legal-related">
          <p>Related documents</p>
          <ul>
            {related.map((entry) => (
              <li key={entry.slug}>
                <Link href={entry.path}>{entry.title}</Link>
              </li>
            ))}
          </ul>
        </nav>
      </article>
    </main>
  );
}
