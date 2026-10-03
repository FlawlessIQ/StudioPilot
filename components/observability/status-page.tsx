import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { CueMark } from "@/components/brand/logo";

/**
 * The page behind app/not-found.tsx and app/error.tsx.
 *
 * Laid out as the legal and support pages are (`ds-root legal-page`), and
 * styled inline as well. The root layout loads no stylesheet (see
 * app/app-styles.ts), so a URL that matches no section renders this with none
 * of the app's CSS — and these pages must not import it themselves, or the
 * error boundary would carry 700 KB of CSS onto every page, the public inquiry
 * form included. The inline values are the ones `.legal-page` sets, so with or
 * without the sheet it looks the same.
 */

const INK = "#1E2521";
const SOFT = "#4b5550";
const LINK = "#2e6b4b";

const styles = {
  main: {
    background: "#fbfbfa",
    color: INK,
    fontFamily: "var(--font-instrument), ui-sans-serif, system-ui, sans-serif",
    minHeight: "100vh",
  },
  header: {
    alignItems: "center",
    borderBottom: "1px solid #e4e6e3",
    display: "flex",
    height: 70,
    margin: "0 auto",
    maxWidth: 980,
    padding: "0 24px",
  },
  brand: {
    alignItems: "center",
    color: INK,
    display: "inline-flex",
    fontSize: 17,
    fontWeight: 600,
    gap: 10,
    textDecoration: "none",
  },
  article: { margin: "0 auto", maxWidth: 760, padding: "76px 24px 100px" },
  eyebrow: {
    color: SOFT,
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: "0.08em",
    margin: 0,
    textTransform: "uppercase",
  },
  h1: {
    fontFamily: "var(--font-fraunces), Georgia, serif",
    fontSize: "clamp(34px, 7vw, 49px)",
    fontWeight: 460,
    letterSpacing: "-0.022em",
    lineHeight: 1.1,
    margin: "14px 0 20px",
  },
  lead: { color: SOFT, fontSize: 18, lineHeight: 1.6, margin: "0 0 32px" },
  actions: { alignItems: "center", display: "flex", flexWrap: "wrap", gap: 12, margin: "0 0 32px" },
  primary: {
    background: INK,
    border: 0,
    borderRadius: 999,
    color: "#fff",
    cursor: "pointer",
    font: "inherit",
    fontSize: 15,
    fontWeight: 600,
    padding: "12px 22px",
    textDecoration: "none",
  },
  secondary: {
    border: `1px solid ${INK}`,
    borderRadius: 999,
    color: INK,
    fontSize: 15,
    fontWeight: 600,
    padding: "11px 21px",
    textDecoration: "none",
  },
  note: { color: SOFT, fontSize: 14, lineHeight: 1.7, margin: 0 },
  link: { color: LINK, fontWeight: 600, textDecoration: "underline", textUnderlineOffset: 2 },
} satisfies Record<string, CSSProperties>;

export const statusPageStyles = styles;

export function StatusPage({
  eyebrow,
  title,
  lead,
  action,
}: {
  eyebrow: string;
  title: string;
  lead: string;
  /** Shown before "Go to the home page", e.g. error.tsx's Try again. */
  action?: ReactNode;
}) {
  return (
    <main className="ds-root legal-page" data-ds-theme="emerald" style={styles.main}>
      <header style={styles.header}>
        <Link href="/" style={styles.brand}>
          <CueMark size={32} />
          StudioCue
        </Link>
      </header>
      <article style={styles.article}>
        <p style={styles.eyebrow}>{eyebrow}</p>
        <h1 style={styles.h1}>{title}</h1>
        <p style={styles.lead}>{lead}</p>
        <div style={styles.actions}>
          {action}
          <Link href="/" style={action ? styles.secondary : styles.primary}>
            Go to the home page
          </Link>
        </div>
        <p style={styles.note}>
          Still stuck? See <Link href="/support" style={styles.link}>Support</Link>, or email{" "}
          <a href="mailto:support@studio-cue.com" style={styles.link}>
            support@studio-cue.com
          </a>
          .
        </p>
      </article>
    </main>
  );
}
