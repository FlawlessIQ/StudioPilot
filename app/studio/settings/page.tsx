import { AppShell } from "@/components/layout/app-shell";
import { ConsultationAvailability } from "@/components/settings/consultation-availability";
import { DataControls } from "@/components/settings/data-controls";
import { EmailBranding } from "@/components/settings/email-branding";
import { EmailTemplateDesigner } from "@/components/communications/email-template-designer";
import { SettingsDestinations } from "@/components/settings/settings-destinations";

export default function SettingsPage() {
  return (
    <AppShell active="Settings">
      <div className="saas-page">
        <header className="page-heading">
          <div>
            <p className="eyebrow">Your studio</p>
            <h1>Studio settings</h1>
            <p>
              How clients see your studio, what it connects to, and what you
              pay for.
            </p>
          </div>
        </header>
        <SettingsDestinations />
        <EmailBranding />
        <EmailTemplateDesigner />
        <ConsultationAvailability />
        <DataControls />
      </div>
    </AppShell>
  );
}
