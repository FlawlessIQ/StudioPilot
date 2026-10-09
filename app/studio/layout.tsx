import "@/app/app-styles";
import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";

/**
 * A studio page with no title of its own (setup, a crew record) fell back to
 * the marketing site's "StudioCue · The office manager for photography
 * studios", which a DJ or a makeup artist then read in the browser tab. The
 * site keeps its photographer title on purpose; inside the app the tab names
 * the page, or just StudioCue.
 */
export const metadata: Metadata = {
  title: {
    default: "StudioCue",
    template: "%s · StudioCue",
  },
};

export default function StudioLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <AppShell>{children}</AppShell>;
}
