import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { SettingsSectionPage } from "@/components/settings/settings-shell";
import { SETTINGS_SECTIONS, settingsSectionBySlug } from "@/features/settings/sections";

export function generateStaticParams() {
  return SETTINGS_SECTIONS.map((section) => ({ section: section.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ section: string }>;
}): Promise<Metadata> {
  const { section } = await params;
  return { title: settingsSectionBySlug(section)?.title ?? "Studio settings" };
}

export default async function SettingsSectionRoute({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  const found = settingsSectionBySlug(section);
  if (!found) notFound();
  return (
    <AppShell active="Settings">
      <SettingsSectionPage sectionKey={found.key} />
    </AppShell>
  );
}
