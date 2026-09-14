import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { LiveDocumentViewer } from "@/components/documents/live-document-viewer";

export const metadata: Metadata = { title: "Document" };

export default async function DocumentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <AppShell active="Documents">
      <LiveDocumentViewer id={id} />
    </AppShell>
  );
}
