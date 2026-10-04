/**
 * Writes the counsel package: every published legal document as Markdown,
 * the e-signature consent, the agreement text StudioCue writes into studios'
 * contracts, and the notices people see — from the same data the site
 * renders, so what counsel reads is what is live.
 *
 *   npx tsx scripts/legal/export-counsel-package.ts [outDir]
 *
 * Default outDir: docs/counsel/<today>. Re-run for each version sent.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { ESIGN_CONSENT_V1, currentEsignConsent } from "../../features/contracts/esign-consent";
import { eventDetailsBlocks, eventDetailsFrom } from "../../features/contracts/event-details";
import { STARTER_AGREEMENT } from "../../features/contracts/sample";
import type { LegalBlock, LegalDocument } from "../../features/legal/document-types";
import { LEGAL_ENTITY, legalDate } from "../../features/legal/legal";
import { LEGAL_DOCUMENTS } from "../../features/legal/registry";

const SITE = "https://studio-cue.com";

/** Site-relative links become absolute, so the files read on their own. */
const absolute = (text: string) => text.replace(/\]\((\/[^)]*)\)/g, (_, path: string) => `](${SITE}${path})`);

function block(item: LegalBlock): string {
  if ("p" in item) return absolute(item.p);
  if ("h3" in item) return `### ${absolute(item.h3)}`;
  if ("note" in item) return `> ${absolute(item.note)}`;
  if ("list" in item) return item.list.map((line) => `- ${absolute(line)}`).join("\n");
  if ("ordered" in item) return item.ordered.map((line, index) => `${index + 1}. ${absolute(line)}`).join("\n");
  const cell = (value: string) => absolute(value).replaceAll("|", "\\|").replaceAll("\n", " ");
  return [
    `| ${item.table.head.map(cell).join(" | ")} |`,
    `| ${item.table.head.map(() => "---").join(" | ")} |`,
    ...item.table.rows.map((row) => `| ${row.map(cell).join(" | ")} |`),
  ].join("\n");
}

export function documentMarkdown(document: LegalDocument): string {
  return [
    `# ${document.title}`,
    `Version ${document.version} · Effective ${legalDate(document.effective)} · ${SITE}${document.path}`,
    ...document.intro.map(absolute),
    ...document.sections.flatMap((section) => [`## ${section.title}`, ...section.blocks.map(block)]),
  ].join("\n\n") + "\n";
}

function agreementTextMarkdown(): string {
  const schedule = eventDetailsBlocks(
    eventDetailsFrom({
      eventType: "Wedding",
      date: "June 12, 2027",
      venue: "Harbor View Estate",
      coverage: "2 photographers, 8 hours",
      answers: [
        { question: "Ceremony location", answer: "St Mary's Church, 3 Church St" },
        { question: "Ceremony start", answer: "3:00 PM" },
      ],
    }),
  );
  const scheduleText = schedule
    .map((item) =>
      item.type === "heading"
        ? `### ${item.content.map((part) => part.text).join("")}`
        : item.type === "paragraph"
          ? item.content.map((part) => part.text).join("")
          : item.type === "list"
            ? item.items.map((line) => `- ${line.content.map((part) => part.text).join("")}`).join("\n")
            : "",
    )
    .join("\n\n");
  return `# Agreement text StudioCue writes into studios' contracts

StudioCue is not a party to these agreements. Each studio writes or adopts its
own agreement; StudioCue supplies a starting point and fills in job details.
What follows is every piece of wording StudioCue itself contributes.

## 1. Starter agreement

Offered to a studio that has no agreement of its own. Each \`[Replace …]\`
section must be completed by the studio; \`{{…}}\` fields are filled from the
job. Source: \`features/contracts/sample.ts\` (\`STARTER_AGREEMENT\`).

\`\`\`text
${STARTER_AGREEMENT.trim()}
\`\`\`

## 2. Schedule A — event details (every agreement)

Appended to every agreement (or placed where the studio's template puts
\`{{event.details}}\`). The lock sentence appears only for job types that lock
details (weddings; four weeks by default, set per studio). Example as rendered:

${scheduleText}

Source: \`features/contracts/event-details.ts\`.

## 3. Booking amendments

A signed booking changes only through an amendment the client signs. The
amendment restates the whole agreement beneath this preamble (source:
\`functions/src/contracts/amendments.ts\`, \`amendedDocument\`):

> **What this changes**
>
> This amends the agreement signed on {date}. It changes only what is listed
> here; the agreement below restates everything as it stands after the change,
> and replaces the earlier version once both parties sign.
>
> - {each change, one line}
>
> **The agreement as amended**

## 4. Pricing clauses

When a studio's own wording states a price (e.g. "$4,500" or "a 25%
retainer"), StudioCue flags the line and asks the studio to replace it with
\`{{price.total}}\` / \`{{price.retainer}}\`, so the proposal and agreement
cannot disagree. Nothing is changed for them. Source:
\`features/contracts/pricing-clauses.ts\`.
`;
}

function esignMarkdown(): string {
  const consent = (version: typeof currentEsignConsent) =>
    [`**Confirmation the signer ticks:** ${version.label}`, ...version.disclosure.map((line) => `- ${line}`)].join("\n\n");
  return `# Electronic signature consent

Shown to every signer before they sign; the version accepted is recorded with
the signature. Published at ${SITE}/legal/esign. The element-by-element review
and the nine open questions are in \`docs/esign-consent-review.md\`.

## Current: ${currentEsignConsent.id}

${consent(currentEsignConsent)}

## Previous: ${ESIGN_CONSENT_V1.id} (kept: earlier signatures name it)

${consent(ESIGN_CONSENT_V1)}
`;
}

function noticesMarkdown(): string {
  return `# Notices people see

## Studio signup (register page)

> By creating an account, you agree to the Terms of Service and Privacy
> Policy. Your 14-day trial needs a card; nothing is charged until it ends,
> then your plan renews automatically until you cancel.

Signup records \`termsVersion\`, \`privacyVersion\`, \`acceptedAt\` and
\`acceptedBy\` on the user and the studio (\`functions/src/legal/versions.ts\`).

## Invited client or teammate (accept page)

> By continuing, you agree to StudioCue's Terms of Service and Privacy Policy.

## Inquiry form (clients who never create an account)

> [ ] I agree that {Studio} may contact me about this inquiry.
>
> {Studio} uses StudioCue to manage inquiries. StudioCue privacy policy (link)

## Every email

> StudioCue is operated by ${LEGAL_ENTITY.name}, ${LEGAL_ENTITY.addressOneLine}

The studio's own postal address replaces this when the studio has set one.

## Client portal and studio pages

Footer: "Powered by StudioCue · Privacy" (link to ${SITE}/privacy).
`;
}

function readme(documents: readonly LegalDocument[], today: string): string {
  return `# StudioCue legal package for counsel — ${legalDate(today)}

Operator: **${LEGAL_ENTITY.name}**, ${LEGAL_ENTITY.addressOneLine} (${LEGAL_ENTITY.state}).
Live at ${SITE}/legal since October 5, 2026. Everything here is generated from
the text the site renders (\`scripts/legal/export-counsel-package.ts\`).

## What is in this folder

| File | Document | Version | Effective |
| --- | --- | --- | --- |
${documents.map((document) => `| \`${document.slug}.md\` | ${document.title} | ${document.version} | ${legalDate(document.effective)} |`).join("\n")}
| \`esign-consent.md\` | Electronic signature consent (signer-facing) | ${currentEsignConsent.id} | — |
| \`agreement-text.md\` | Wording StudioCue writes into studios' contracts | — | — |
| \`notices.md\` | Signup consent, inquiry notice, email footer | — | — |
| \`corporate-agreement-draft.md\` | Corporate event starter agreement (draft, not offered yet; hand-written, not generated) | draft | — |

## Decisions already made (please confirm or change)

- New Jersey law; Morris County courts / D.N.J.; jury waiver; no class actions; one-year limit on claims.
- Liability cap: fees paid in the prior 12 months, or $100 if greater.
- Refunds: none for partial periods; annual plans refundable in full within 14 days of the first annual charge.
- Failed payment: 7 days of full access, then read-only (view and export only) and client messages held, not dropped.
- Cancellation: 30 days to export, deletion within 90 days (backups age out in 84).
- No DPA signature step: the DPA is incorporated by reference in the Terms.
- AI: Gemini via Vertex AI in StudioCue's Google Cloud project; no training on customer data; human review of every send.

## Open questions

1. Courts vs arbitration (currently courts, with a jury waiver and class waiver).
2. Automatic-renewal laws: are CA/NY/other renewal reminders needed beyond Stripe's trial-ending email and the in-app notice three days before?
3. Is a separately signable DPA (or SCCs) needed for larger or non-US studios?
4. Minors: family and sports jobs — guardian as client, no child accounts; is the current wording sufficient (COPPA, state minors' privacy laws)?
5. Sales tax on the subscription (Stripe Tax not yet on).
6. The nine e-signature questions in \`docs/esign-consent-review.md\`.
7. The starter agreement leaves cancellation, copyright and liability for each studio to write. Should StudioCue offer suggested clauses, and with what disclaimer?
8. DMCA agent registered (DMCA-1081859); anything else needed for the safe harbor?
9. The corporate starter agreement (\`corporate-agreement-draft.md\`) and the five questions at its end.

## How changes ship

Counsel's edits ship as version 1.1 (2.1 for the Privacy Policy). The Terms
promise 30 days' email notice for material changes. Record each change here:

| Document | Section | Change | Material? | Notice sent | Effective |
| --- | --- | --- | --- | --- | --- |
| | | | | | |
`;
}

function main() {
  const today = new Date().toISOString().slice(0, 10);
  const outDir = process.argv[2] ?? join("docs", "counsel", today);
  mkdirSync(outDir, { recursive: true });
  for (const document of LEGAL_DOCUMENTS) {
    writeFileSync(join(outDir, `${document.slug}.md`), documentMarkdown(document));
  }
  writeFileSync(join(outDir, "esign-consent.md"), esignMarkdown());
  writeFileSync(join(outDir, "agreement-text.md"), agreementTextMarkdown());
  writeFileSync(join(outDir, "notices.md"), noticesMarkdown());
  writeFileSync(join(outDir, "README.md"), readme(LEGAL_DOCUMENTS, today));
  console.log(`Wrote ${LEGAL_DOCUMENTS.length + 4} files to ${outDir}`);
}

if (process.argv[1]?.endsWith("export-counsel-package.ts")) main();
