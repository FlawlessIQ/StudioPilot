import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { IntegrationsTabs } from "@/components/integrations/integrations-tabs";

// Every studio page names itself on its tab; these fell back to
// "StudioCue · Photography Operations OS" (UI audit, 2026-10-02).
export const metadata: Metadata = { title: "Integrations" };

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  return (
    <AppShell active="Integrations">
      <div className="integrations-page">
        <header className="integrations-heading">
          <div>
            <p className="eyebrow">Studio connections</p>
            <h1>Integrations</h1>
            <p>
              The tools StudioCue works with: calendar, meetings, files and
              accounting. Each connection is private to this workspace and can
              be removed at any time.
            </p>
          </div>
        </header>
        <IntegrationsTabs
          initialTab={tab === "autopay" ? "autopay" : tab === "quickbooks" ? "quickbooks" : "connections"}
        />
      </div>
    </AppShell>
  );
}
