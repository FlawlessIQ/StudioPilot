import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { SettingsShell } from "@/components/settings/settings-shell";

// Every studio page names itself on its tab; these fell back to
// "StudioCue · Photography Operations OS" (UI audit, 2026-10-02).
export const metadata: Metadata = { title: "Studio settings" };

export default function SettingsPage() {
  return (
    <AppShell active="Settings">
      <SettingsShell />
    </AppShell>
  );
}
