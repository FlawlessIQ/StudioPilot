import { AppShell } from "@/components/layout/app-shell";
import { SettingsShell } from "@/components/settings/settings-shell";

export default function SettingsPage() {
  return (
    <AppShell active="Settings">
      <SettingsShell />
    </AppShell>
  );
}
