import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { ImportBookingsWorkspace } from "@/components/imports/import-bookings-workspace";

export const metadata: Metadata = {
  title: "Import bookings",
  description: "Bring in the weddings you booked before StudioCue, without contacting the couples.",
};

export default function ImportBookingsPage() {
  return (
    <AppShell active="Jobs">
      <div className="crm-page">
        <Link className="back-link" href="/studio/projects">
          <ArrowLeft size={15} /> All jobs
        </Link>
        <div className="dashboard-heading">
          <div>
            <p className="eyebrow">Moving to StudioCue</p>
            <h1>Bookings you already have</h1>
            <p>
              Weddings you booked somewhere else, with the contract signed and
              the retainer paid. They come in quiet: no emails, no invoices, no
              reminders, until you bring each couple in.
            </p>
          </div>
        </div>
        <ImportBookingsWorkspace />
      </div>
    </AppShell>
  );
}
