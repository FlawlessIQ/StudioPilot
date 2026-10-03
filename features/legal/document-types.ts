/**
 * The shape every StudioCue legal document is written in. Content lives as
 * data (features/legal/documents/*) and one renderer
 * (components/legal/legal-document.tsx) draws it, so the pages stay
 * consistent and the text can be tested and versioned.
 *
 * Inline markup in strings: **bold** and [link text](/path).
 */
export type LegalBlock =
  | { p: string }
  | { h3: string }
  | { list: string[] }
  | { ordered: string[] }
  | { table: { head: string[]; rows: string[][] } }
  | { note: string };

export type LegalSection = {
  id: string;
  title: string;
  blocks: LegalBlock[];
};

export type LegalDocument = {
  slug: string;
  path: string;
  title: string;
  /** One line for search results and the legal hub. */
  description: string;
  version: string;
  effective: string;
  intro: string[];
  sections: LegalSection[];
};
