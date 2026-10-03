import type { Metadata } from "next";
import { LegalDocumentPage } from "@/components/legal/legal-document";
import { legalDocument } from "@/features/legal/registry";

const document = legalDocument("privacy");

export const metadata: Metadata = {
  title: document.title,
  description: document.description,
  alternates: { canonical: document.path },
  openGraph: { title: `${document.title} · StudioCue`, description: document.description },
};

export default function PrivacyPage() {
  return <LegalDocumentPage document={document} />;
}
