import type { Metadata } from "next";
import "@/app/app-styles";

/** A private token link: never in search, whoever forwards it. */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/** Loads the app's stylesheets for this section (see app/app-styles.ts). */
export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
