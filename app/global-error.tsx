"use client";

import { useEffect } from "react";
import { reportClientError } from "@/components/observability/error-reporter";

/**
 * The root layout itself failed. This replaces it, so it brings its own
 * <html> and <body>, loads nothing, and styles itself inline. Plain <a> links:
 * after a failure this deep, a full page load is the reliable way out.
 */
const ink = "#1E2521";
const soft = "#4b5550";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportClientError(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#fbfbfa", color: ink, fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif" }}>
        <main style={{ margin: "0 auto", maxWidth: 640, padding: "96px 24px" }}>
          <p style={{ color: soft, fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", margin: 0, textTransform: "uppercase" }}>
            StudioCue
          </p>
          <h1 style={{ fontFamily: "Georgia, serif", fontSize: "clamp(32px, 7vw, 44px)", fontWeight: 500, lineHeight: 1.15, margin: "14px 0 18px" }}>
            Something went wrong.
          </h1>
          <p style={{ color: soft, fontSize: 18, lineHeight: 1.6, margin: "0 0 28px" }}>
            It&apos;s been logged and we&apos;ll look into it. Try again in a moment.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, margin: "0 0 28px" }}>
            <button
              type="button"
              onClick={reset}
              style={{ background: ink, border: 0, borderRadius: 999, color: "#fff", cursor: "pointer", font: "inherit", fontSize: 15, fontWeight: 600, padding: "12px 22px" }}
            >
              Try again
            </button>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a full reload is the point here */}
            <a href="/" style={{ border: `1px solid ${ink}`, borderRadius: 999, color: ink, fontSize: 15, fontWeight: 600, padding: "11px 21px", textDecoration: "none" }}>
              Go to the home page
            </a>
          </div>
          <p style={{ color: soft, fontSize: 14, lineHeight: 1.7, margin: 0 }}>
            Still stuck?{" "}
            <a href="/support" style={{ color: "#2e6b4b", fontWeight: 600 }}>Support</a>, or email{" "}
            <a href="mailto:support@studio-cue.com" style={{ color: "#2e6b4b", fontWeight: 600 }}>
              support@studio-cue.com
            </a>
            .
          </p>
        </main>
      </body>
    </html>
  );
}
