import "@/app/app-styles";
import "@/app/console.css";
import type { Metadata } from "next";
import { ConsoleFrame } from "@/components/console/console-frame";

export const metadata: Metadata = {
  title: "StudioCue Console",
  robots: { index: false, follow: false },
};

/**
 * The StudioCue Console (docs/console.md). The frame — rail, ⌘K, the shared
 * studio rows — mounts here once, so moving between pages keeps it.
 */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <ConsoleFrame>{children}</ConsoleFrame>;
}
