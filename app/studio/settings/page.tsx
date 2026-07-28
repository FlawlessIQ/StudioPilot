import { AppShell } from "@/components/layout/app-shell";
import { DataControls } from "@/components/settings/data-controls";

export default function SettingsPage() {
  return (
    <AppShell active="Settings">
      <div className="saas-page">
        <header className="page-heading">
          <div>
            <p className="eyebrow">Workspace settings</p>
            <h1>Data & account</h1>
            <p>Export your studio data or request account deletion.</p>
          </div>
        </header>
        <DataControls />
      </div>
    </AppShell>
  );
}
