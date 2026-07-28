import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  ClipboardList,
  FileStack,
  MessageCircle,
  Package,
  Workflow,
} from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";

export const metadata: Metadata = { title: "Studio library" };

const resources = [
  {
    title: "Packages",
    description: "Build reusable offers, pricing, coverage, and add-ons.",
    href: "/studio/packages",
    icon: Package,
  },
  {
    title: "Questionnaire templates",
    description: "Collect the client details each project type needs.",
    href: "/studio/questionnaires",
    icon: ClipboardList,
  },
  {
    title: "Workflow templates",
    description: "Define repeatable tasks, deadlines, and readiness requirements.",
    href: "/studio/workflows",
    icon: Workflow,
  },
  {
    title: "Documents",
    description: "Find generated documents and project files.",
    href: "/studio/documents",
    icon: FileStack,
  },
  {
    title: "Communications",
    description: "Review client and project message history.",
    href: "/studio/messages",
    icon: MessageCircle,
  },
];

export default function LibraryPage() {
  return (
    <AppShell active="Packages">
      <div className="hub-page">
        <header className="page-heading">
          <div>
            <p className="eyebrow">Reusable studio resources</p>
            <h1>Library</h1>
            <p>Set up the packages, forms, workflows, and content your team uses across projects.</p>
          </div>
        </header>
        <section className="hub-grid">
          {resources.map((resource) => {
            const Icon = resource.icon;
            return (
              <Link href={resource.href} key={resource.title}>
                <span><Icon size={20} /></span>
                <div><h2>{resource.title}</h2><p>{resource.description}</p></div>
                <ArrowRight size={17} />
              </Link>
            );
          })}
        </section>
      </div>
    </AppShell>
  );
}
