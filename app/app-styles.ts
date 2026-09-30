/**
 * The app's stylesheets, imported by every section's layout rather than by
 * the root layout.
 *
 * The root layout used to import them, and Next.js loads whatever the root
 * layout imports on every page — so the public inquiry form, which couples
 * open on their phones and studios embed on their websites, carried 729 KB of
 * CSS (6,369 rules) for one form (H5). /inquiry loads only the mobile kit and
 * app/inquiry/inquiry.css. tests/app-styles-coverage.test.ts fails if a
 * section forgets this import.
 */
import "./globals.css";
import "./design-system.css";
import "./legacy-bridge.css";
import "./contracts.css";
// The mobile kit (couple and crew). Scoped to `.kit`; see app/kit.css.
import "./kit-tokens.css";
import "./kit.css";
