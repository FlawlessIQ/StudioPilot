import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { LEGAL_DOCUMENTS } from "@/features/legal/registry";
import { LEGAL_ENTITY, legalDate } from "@/features/legal/legal";

export const metadata: Metadata = {
  title: "Legal",
  description: "StudioCue's Terms of Service, Privacy Policy, Data Processing Addendum and other legal documents.",
  alternates: { canonical: "/legal" },
};

/** Every StudioCue legal document in one place. */
export default function LegalHubPage() {
  return (
    <main className="ds-root legal-page" data-ds-theme="emerald">
      <header>
        <Link href="/">
          <Logo />
        </Link>
        <Link href="/">
          <ArrowLeft size={15} /> Back home
        </Link>
      </header>
      <article>
        <p className="eyebrow">Legal</p>
        <h1>Legal documents</h1>
        <p className="legal-lead">
          The agreements and policies that govern StudioCue, which is operated by {LEGAL_ENTITY.name},{" "}
          {LEGAL_ENTITY.addressOneLine}.
        </p>
        <ul className="legal-list">
          {LEGAL_DOCUMENTS.map((entry) => (
            <li key={entry.slug}>
              <Link href={entry.path}>{entry.title}</Link> — {entry.description} (version {entry.version}, effective{" "}
              {legalDate(entry.effective)})
            </li>
          ))}
        </ul>
        <h2>Contact</h2>
        <p>
          Questions about these documents: <a href={`mailto:${LEGAL_ENTITY.email}`}>{LEGAL_ENTITY.email}</a>.
        </p>
      </article>
    </main>
  );
}
