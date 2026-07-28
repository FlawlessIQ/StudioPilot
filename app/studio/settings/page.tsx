import { AppShell } from "@/components/layout/app-shell";
import { DataControls } from "@/components/settings/data-controls";
import { EmailBranding } from "@/components/settings/email-branding";

export default function SettingsPage() {
  return (
    <AppShell active="Settings">
      <div className="saas-page">
        <header className="page-heading">
          <div>
            <p className="eyebrow">Workspace settings</p>
            <h1>Workspace settings</h1>
            <p>
              Control how clients see your studio and manage your account data.
            </p>
          </div>
        </header>
        <EmailBranding />
        <DataControls />
      </div>
    </AppShell>
  );
}
