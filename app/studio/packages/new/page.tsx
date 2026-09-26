import type { Metadata } from "next";
import { BackToSetup } from "@/components/setup/back-to-setup";
import { CreatePackageForm } from "@/components/crm/create-package-form";
import { AppShell } from "@/components/layout/app-shell";

export const metadata: Metadata = { title: "New package" };

export default async function NewPackagePage({ searchParams }: { searchParams: Promise<{ return?: string; from?: string }> }) {
  const { return: returnTo, from } = await searchParams;
  // Only ever bounce back inside the studio app.
  const safeReturn = returnTo?.startsWith("/studio/") ? returnTo : null;
  return <AppShell active="Packages"><div className="crm-form-page"><BackToSetup fallback={{ href: "/studio/packages", label: "Back to packages" }} from={from} /><div className="dashboard-heading"><div><p className="eyebrow">New offering</p><h1>Create a package</h1><p>Define the price, coverage, retainer, and deliverables clients can choose.</p></div></div><CreatePackageForm returnTo={safeReturn} /></div></AppShell>;
}
