import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { CreatePackageForm } from "@/components/crm/create-package-form";
import { AppShell } from "@/components/layout/app-shell";

export const metadata: Metadata = { title: "New package · StudioHub" };

export default function NewPackagePage() {
  return <AppShell active="Packages"><div className="crm-form-page"><Link className="back-link" href="/studio/packages"><ArrowLeft size={15} /> Packages</Link><div className="dashboard-heading"><div><p className="eyebrow">New offering</p><h1>Create a package</h1><p>Money is stored as integer cents and the first saved record becomes version 1.</p></div></div><CreatePackageForm /></div></AppShell>;
}
