/**
 * Couple-facing pages render inside the design system, as the inquiry form
 * does: without it `--font-display` is undefined here, the heading's `font`
 * shorthand is discarded, and the page title renders at body size.
 */
export default function CouplePageLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="ds-root" data-ds-theme="emerald">
      {children}
    </div>
  );
}
