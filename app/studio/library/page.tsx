import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { PendingImportNotice } from "@/components/ai/pending-import-notice";
import { LibraryShelves } from "@/components/library/library-shelves";

export const metadata: Metadata = { title: "Studio library" };

export default function LibraryPage() {
  return (
    <AppShell active="Library">
      <div className="hub-page">
        <header className="page-heading">
          <div>
            <p className="eyebrow">Reusable studio resources</p>
            <h1>Library</h1>
            <p>
              The packages, forms and workflows every job draws on — and the
              documents and messages your jobs leave behind.
            </p>
          </div>
        </header>
        <PendingImportNotice />
        <LibraryShelves />
      </div>
    </AppShell>
  );
}
