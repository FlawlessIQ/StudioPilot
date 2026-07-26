import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { CreateContactForm } from "@/components/crm/create-contact-form";
import { AppShell } from "@/components/layout/app-shell";

export const metadata: Metadata = { title: "New client · StudioHub" };

export default function NewClientPage() {
  return <AppShell active="Clients"><div className="crm-form-page"><Link className="back-link" href="/studio/clients"><ArrowLeft size={15} /> Clients</Link><div className="dashboard-heading"><div><p className="eyebrow">New record</p><h1>Add a client</h1><p>Create a tenant-scoped contact for project work and portal access.</p></div></div><CreateContactForm /></div></AppShell>;
}
