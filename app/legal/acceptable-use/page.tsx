import type { Metadata } from "next";
import { LegalDocumentPage } from "@/components/legal/legal-document";
import { legalDocument } from "@/features/legal/registry";

const document = legalDocument("acceptable-use");

export const metadata: Metadata = {
  title: document.title,
  description: document.description,
  alternates: { canonical: document.path },
  openGraph: { title: `${document.title} · StudioCue`, description: document.description },
};

export default function AcceptableUsePage() {
  return <LegalDocumentPage document={document} />;
}
