import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { EditPackageForm } from "@/components/crm/edit-package-form";

export const metadata: Metadata = { title: "Edit package" };

export default async function EditPackagePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <AppShell active="Packages">
      <div className="crm-form-page">
        <Link className="back-link" href="/studio/packages">
          <ArrowLeft size={15} /> Back to packages
        </Link>
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
