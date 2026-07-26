import { Download, FileCheck2, ShieldCheck } from "lucide-react";
import { CrewDocumentUpload } from "@/components/crew/document-upload";
import { CrewPortalShell } from "@/components/crew/crew-portal-shell";
import { StatusBadge } from "@/components/ui/status-badge";

const documents = [
  { name: "Subcontractor agreement", meta: "Completed Jul 18 · Docusign evidence", status: "Current" },
  { name: "W-9", meta: "Verified Jul 20 · Studio-only tax handling", status: "Verified" },
  { name: "Liability insurance", meta: "Expires Mar 4, 2027", status: "Current" },
] as const;

export default function CrewDocumentsPage() {
  return <CrewPortalShell active="Documents"><div className="crew-mobile-page"><header className="crew-portal-hero"><div><p className="eyebrow">Secure files</p><h1>Documents</h1><p>Only your required crew documents and job briefs appear here.</p></div></header><div className="crew-scope-note"><ShieldCheck/><span><strong>Private by default</strong><small>Client contracts, invoices, galleries, and unrelated Dropbox content are never exposed.</small></span></div><section className="panel crew-document-list">{documents.map(item=><article key={item.name}><FileCheck2/><span><strong>{item.name}</strong><small>{item.meta}</small></span><StatusBadge tone="success">{item.status}</StatusBadge><a href={`data:text/plain,StudioHub%20development%20document%20reference%3A%20${encodeURIComponent(item.name)}`} download={`${item.name}.txt`} aria-label={`Download ${item.name} reference`}><Download size={16}/></a></article>)}</section><CrewDocumentUpload/></div></CrewPortalShell>;
}
