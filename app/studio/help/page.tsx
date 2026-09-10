import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { HelpCenter } from "@/components/help/help-center";

export const metadata: Metadata = { title: "Help & guides" };

export default function HelpPage() {
  return (
    <AppShell active="Help & guides">
      <HelpCenter />
    </AppShell>
  );
}
