import Link from "next/link";
import { ArrowLeft } from "lucide-react";

/**
 * The way back, for a page setup sent the studio to.
 *
 * Setup's questions open other pages (import, consultation hours, the
 * agreement), and each of those only led back to where it lives (Library,
 * the Settings hub, Contracts). A studio part-way through setup had to find
 * its own way back. Setup now adds `?from=setup`; with it, the page's back
 * link returns to setup instead.
 */
export function BackToSetup({
  from,
  fallback,
  className = "back-link",
}: {
  from: string | undefined;
  fallback: { href: string; label: string } | null;
  className?: string;
}) {
  const toSetup = from === "setup";
  if (!toSetup && !fallback) return null;
  return (
    <Link className={className} href={toSetup ? "/studio/setup" : fallback!.href}>
      <ArrowLeft size={15} /> {toSetup ? "Back to setup" : fallback!.label}
    </Link>
  );
}

/** A setup link that says where it came from. */
export function fromSetup(href: string): string {
  return `${href}${href.includes("?") ? "&" : "?"}from=setup`;
}
