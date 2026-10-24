import type { Metadata } from "next";
import { BackToSetup } from "@/components/setup/back-to-setup";
import { AppShell } from "@/components/layout/app-shell";
import { EditPackageForm } from "@/components/crm/edit-package-form";

export const metadata: Metadata = { title: "Edit package" };

export default async function EditPackagePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { id } = await params;
  // Setup's price review links each package it added here to check it.
  const { from } = await searchParams;
  return (
    <AppShell active="Packages">
      <div className="crm-form-page">
        <BackToSetup fallback={{ href: "/studio/packages", label: "Back to packages" }} from={from} />
        <div className="dashboard-heading">
          <div>
            <p className="eyebrow">Your offering</p>
            <h1>Edit package</h1>
            <p>
              Change the price, the deposit you ask for, and whether clients
              can see it.
            </p>
          </div>
        </div>
        <EditPackageForm packageId={id} />
      </div>
    </AppShell>
  );
}
