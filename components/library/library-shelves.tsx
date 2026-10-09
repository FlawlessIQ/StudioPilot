"use client";

import Link from "next/link";
import { ArrowRight, PackagePlus, Sparkles, type LucideIcon } from "lucide-react";
import { useTenantDocuments } from "@/components/live/tenant-records";
import { isCataloguePackage } from "@/features/packages/one-off";
import { KindGlyph } from "@/components/library/kind-glyph";
import { useWorkspace } from "@/features/auth/workspace-context";
import { extraIdeasFor } from "@/features/packages/extra-ideas";
import { packagesShelfDescription } from "@/components/crm/package-copy";
import type { LibraryKind } from "@/features/library/kinds";

/**
 * The Library, as an inventory rather than a directory.
 *
 * Two problems it exists to fix.
 *
 * **It never said what was in it.** Five cards reading "Packages — build
 * reusable offers" looked identical whether a studio had nine packages or
 * none, so the one question a photographer opens this page with — have I
 * set my studio up yet? — took five clicks to answer. Each shelf now
 * carries its own count, and a shelf with nothing in it says so and offers
 * the way to fill it.
 *
 * **It mixed two different kinds of thing.** Packages, questionnaires and
 * workflows are what a studio *sets up* once and reuses. Documents and
 * message history are what *accumulates* as jobs run — you never create
 * one from here. Filing them together made the setup work harder to see,
 * which matters because the whole product depends on that setup existing.
 */
type Shelf = {
  title: string;
  description: string;
  href: string;
  kind: LibraryKind;
  collection: string;
  /** Shown when the shelf is empty, in place of the count. */
  emptyLabel: string;
  /** Singular and plural nouns for the count line. */
  noun: [string, string];
  /** Which records the shelf counts, when not every one in the collection. */
  counts?: (record: Record<string, unknown>) => boolean;
  /** A glyph of its own, where two shelves share a kind. */
  icon?: LucideIcon;
};

const SETUP: Shelf[] = [
  {
    title: "Packages",
    // Read per trade in ShelfCard; this is a photographer's.
    description: packagesShelfDescription(undefined),
    href: "/studio/packages",
    kind: "package",
    collection: "packages",
    emptyLabel: "Nothing to offer clients yet",
    noun: ["package", "packages"],
    // A one-off written for one couple is not on the studio's shelf.
    counts: (record) => isCataloguePackage(record),
  },
  {
    title: "Add-ons",
    description: "Extras sold on top of a package — an engagement session, an extra hour.",
    href: "/studio/library/add-ons",
    kind: "package",
    icon: PackagePlus,
    collection: "addOns",
    emptyLabel: "No extras to offer yet",
    noun: ["add-on", "add-ons"],
  },
  {
    title: "Questionnaire templates",
    description: "Collect the client details each project type needs.",
    href: "/studio/questionnaires",
    kind: "questionnaire",
    collection: "questionnaireTemplates",
    emptyLabel: "No forms to send yet",
    noun: ["template", "templates"],
  },
  {
    title: "Workflow templates",
    description: "Define repeatable tasks, deadlines, and readiness requirements.",
    href: "/studio/workflows",
    kind: "workflow",
    collection: "workflowTemplates",
    emptyLabel: "No repeatable workflow yet",
    noun: ["template", "templates"],
  },
];

const ARCHIVE: Shelf[] = [
  {
    title: "Documents",
    description: "Find generated documents and project files.",
    href: "/studio/documents",
    kind: "document",
    collection: "documents",
    emptyLabel: "Nothing filed yet",
    noun: ["document", "documents"],
  },
  {
    title: "Communications",
    description: "Review client and project message history.",
    href: "/studio/messages",
    kind: "message",
    collection: "messages",
    emptyLabel: "No messages yet",
    noun: ["message", "messages"],
  },
];

function ShelfCard({ shelf }: { shelf: Shelf }) {
  const { records } = useTenantDocuments(shelf.collection);
  const count = records ? (shelf.counts ? records.filter(shelf.counts).length : records.length) : null;
  const [one, many] = shelf.noun;
  // The add-ons shelf names the extras this trade sells (extra-ideas.ts),
  // and the packages shelf what a package holds in this trade's words
  // (package-copy.ts); a photographer's keep their own lines.
  const trade = useWorkspace().tenantTrade;
  const ideas = extraIdeasFor(trade);
  const description =
    shelf.collection === "addOns" && ideas !== extraIdeasFor(undefined)
      ? `Extras sold on top of a package — ${ideas[0]?.name.toLowerCase()}, ${ideas.find((idea) => idea.perUnit === "hour")?.name.toLowerCase() ?? ideas[1]?.name.toLowerCase()}.`
      : shelf.collection === "packages"
        ? packagesShelfDescription(trade)
        : shelf.description;
  return (
    <Link
      className={count === 0 ? "is-empty" : undefined}
      href={shelf.href}
    >
      <KindGlyph icon={shelf.icon} kind={shelf.kind} size={42} />
      <div>
        <h2>{shelf.title}</h2>
        <p>{description}</p>
        {/* Reserved whether or not the number has arrived, so the card does
            not jump as counts load. */}
        <span className="hub-count">
          {count === null
            ? " "
            : count === 0
              ? shelf.emptyLabel
              : `${count} ${count === 1 ? one : many}`}
        </span>
      </div>
      <ArrowRight size={17} />
    </Link>
  );
}

export function LibraryShelves() {
  return (
    <>
      {/* The import studio is how a studio fills this page, and it was
          reachable only by typing the URL. It is the first thing here, and
          it does not pretend to be a shelf — it is the way to stock them. */}
      <Link className="library-import-cta" href="/studio/import">
        <span className="library-import-glyph">
          <Sparkles aria-hidden="true" size={20} />
        </span>
        <span>
          <strong>Bring your current business in</strong>
          <small>
            Upload the contracts, questionnaires and price lists you already
            use. StudioCue drafts them into templates and asks you to approve
            before anything goes live.
          </small>
        </span>
        <span className="library-import-go">
          Open AI import studio <ArrowRight size={15} />
        </span>
      </Link>

      <section className="library-shelf">
        <div className="library-shelf-heading">
          <h2>What your studio reuses</h2>
          <p>Set these up once; every job draws on them.</p>
        </div>
        <div className="hub-grid">
          {SETUP.map((shelf) => (
            <ShelfCard key={shelf.title} shelf={shelf} />
          ))}
        </div>
      </section>

      <section className="library-shelf">
        <div className="library-shelf-heading">
          <h2>What your jobs produce</h2>
          <p>Filed automatically as work happens. Nothing to set up here.</p>
        </div>
        <div className="hub-grid">
          {ARCHIVE.map((shelf) => (
            <ShelfCard key={shelf.title} shelf={shelf} />
          ))}
        </div>
      </section>
    </>
  );
}
