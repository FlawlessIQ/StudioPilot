import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { PendingImportNotice } from "@/components/ai/pending-import-notice";
import { KindGlyph } from "@/components/library/kind-glyph";
import type { LibraryKind } from "@/features/library/kinds";

export const metadata: Metadata = { title: "Studio library" };

/**
 * These five cards are the same five kinds the import studio colour-codes
 * on its way in. Until now they all arrived here as identical green tiles,
 * so a photographer who had just been shown a violet contract, a gold
 * questionnaire and a violet package watched all three turn the same
 * colour the moment they reached the place they live.
 */
const resources: Array<{
  title: string;
  description: string;
  href: string;
  kind: LibraryKind;
}> = [
  {
    title: "Packages",
    description: "Build reusable offers, pricing, coverage, and add-ons.",
    href: "/studio/packages",
    kind: "package",
  },
  {
    title: "Questionnaire templates",
    description: "Collect the client details each project type needs.",
    href: "/studio/questionnaires",
    kind: "questionnaire",
  },
  {
    title: "Workflow templates",
    description: "Define repeatable tasks, deadlines, and readiness requirements.",
    href: "/studio/workflows",
    kind: "workflow",
  },
  {
    title: "Documents",
    description: "Find generated documents and project files.",
    href: "/studio/documents",
    kind: "document",
  },
  {
    title: "Communications",
    description: "Review client and project message history.",
    href: "/studio/messages",
    kind: "message",
  },
];

export default function LibraryPage() {
  return (
    <AppShell active="Library">
      <div className="hub-page">
        <header className="page-heading">
          <div>
            <p className="eyebrow">Reusable studio resources</p>
            <h1>Library</h1>
            <p>Set up the packages, forms, workflows, and content your team uses across projects.</p>
          </div>
        </header>
        <PendingImportNotice />
        <section className="hub-grid">
          {resources.map((resource) => (
            <Link href={resource.href} key={resource.title}>
              <KindGlyph kind={resource.kind} size={42} />
              <div><h2>{resource.title}</h2><p>{resource.description}</p></div>
              <ArrowRight size={17} />
            </Link>
          ))}
        </section>
      </div>
    </AppShell>
  );
}
