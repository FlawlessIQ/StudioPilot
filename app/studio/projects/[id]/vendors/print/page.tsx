import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { VendorContactSheet } from "@/components/vendors/vendor-contact-sheet";

export const metadata: Metadata = { title: "Vendor contacts" };

/** The job's vendors on one printable page (components/vendors/vendor-contact-sheet.tsx). */
export default async function VendorContactsPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <AppShell active="Jobs">
      <VendorContactSheet projectId={id} />
    </AppShell>
  );
}
