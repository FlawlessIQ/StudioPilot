/**
 * Writes the whole counsel review as ONE document: a briefing, every open
 * question in one numbered list, then the full text of everything StudioCue
 * publishes or writes into a contract, from the same data the site and the
 * agreement renderer use. So what counsel reads is what is live.
 *
 *   npx tsx scripts/legal/export-counsel-review-pack.ts [outDir]
 *
 * Default outDir: docs/counsel/<today>-review-pack. Writes
 * `counsel-review-pack.md` and, when Playwright's Chromium is installed,
 * `counsel-review-pack.pdf` (the file to send).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { eventDetailsBlocks, eventDetailsFrom, kindTermsBlocks } from "../../features/contracts/event-details";
import { BEAUTY_STARTER_AGREEMENT, PLANNER_STARTER_AGREEMENT, starterAgreementFor } from "../../features/contracts/sample";
import { JOB_KINDS, JOB_KIND_LABELS, PAYMENT_SHAPE_LABELS, journeyProfile } from "../../features/job-kinds/job-kinds";
import { LEGAL_ENTITY, legalDate } from "../../features/legal/legal";
import { LEGAL_DOCUMENTS } from "../../features/legal/registry";
import { TRADES, TRADE_LABELS } from "../../features/trades/trades";
import { agreementTextMarkdown, documentMarkdown, esignMarkdown, noticesMarkdown } from "./export-counsel-package";

type Part = { text: string; bold?: boolean };
type Block =
  | { type: "heading"; level?: number; content: Part[] }
  | { type: "paragraph"; content: Part[] }
  | { type: "list"; items: Array<{ content: Part[] }> }
  | { type: string };

const join_ = (parts: Part[]) => parts.map((part) => (part.bold ? `**${part.text.trim()}** ` : part.text)).join("").replace(/\*\* +/g, "** ");

function blocksMarkdown(blocks: readonly unknown[], headingLevel = 4): string {
  return (blocks as Block[])
    .map((item) => {
      if (item.type === "heading" && "content" in item) return `${"#".repeat(headingLevel)} ${join_(item.content)}`;
      if (item.type === "paragraph" && "content" in item) return join_(item.content);
      if (item.type === "list" && "items" in item) return item.items.map((line) => `- ${join_(line.content)}`).join("\n");
      return "";
    })
    .filter(Boolean)
    .join("\n\n");
}

/** Pushes every Markdown heading down `by` levels, outside code fences. */
function demote(markdown: string, by: number): string {
  let fenced = false;
  return markdown
    .split("\n")
    .map((line) => {
      if (line.startsWith("```")) fenced = !fenced;
      return !fenced && /^#{1,5} /.test(line) ? "#".repeat(by) + line : line;
    })
    .join("\n");
}

/** A review doc's section, from its heading to the next heading of the same level. */
function section(file: string, heading: string): string {
  const lines = readFileSync(file, "utf8").split("\n");
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start < 0) throw new Error(`${heading} not in ${file}`);
  const level = heading.match(/^#+/)![0].length;
  const end = lines.findIndex((line, index) => index > start && new RegExp(`^#{1,${level}} `).test(line));
  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n").trim();
}

function kindsTable(): string {
  const rows = JOB_KINDS.map((kind) => {
    const profile = journeyProfile(kind);
    return `| ${JOB_KIND_LABELS[kind]} | ${profile.agreement ? "Yes" : "**No**"} | ${PAYMENT_SHAPE_LABELS[profile.payment]} | ${profile.agreementTerms ? `Yes — ${JOB_KIND_LABELS[profile.agreementTerms as keyof typeof JOB_KIND_LABELS] ?? profile.agreementTerms} terms` : "—"} |`;
  });
  return ["| Kind of job | Signed agreement? | Payment | Schedule B? |", "| --- | --- | --- | --- |", ...rows].join("\n");
}

function scheduleB(): string {
  const kinds = JOB_KINDS.filter((kind) => journeyProfile(kind).agreementTerms);
  return kinds
    .map((kind) => {
      const terms = journeyProfile(kind).agreementTerms!;
      const byTrade = TRADES.map((trade) => `#### ${TRADE_LABELS[trade]}\n\n${blocksMarkdown(kindTermsBlocks(terms, trade) ?? [], 5)}`);
      return [`### ${JOB_KIND_LABELS[kind]}`, ...byTrade].join("\n\n");
    })
    .join("\n\n");
}

function scheduleAExamples(): string {
  const quince = eventDetailsBlocks(
    eventDetailsFrom({
      eventType: "Quinceañera",
      eventKind: "quince",
      kindDetails: { parts: "quince", title: "Quinceañera details" },
      date: "May 15, 2027",
      venue: "The Grand Ballroom",
      coverage: "1 photographer, 6 hours",
      answers: [
        { question: "Mass location", answer: "St Anne's Church" },
        { question: "Mass start time", answer: "2:00 PM" },
      ],
    } as never),
  );
  return `#### Example: a quinceañera (a kind with its own parts)\n\n${blocksMarkdown(quince, 5)}`;
}

function starters(): string {
  const fence = (body: string) => "```text\n" + body.trim() + "\n```";
  const dj = starterAgreementFor("dj");
  return [
    "The photographer's starter is in part 1 above. The other trades' starters, as offered to a studio with no agreement of its own:",
    `#### ${dj.title} (DJ)\n\nThe photographer's starter with three changes: "services" for "coverage", "deposit" for "retainer", and section 4 about equipment and the venue instead of image rights.\n\n${fence(dj.body)}`,
    `#### ${starterAgreementFor("makeup").title} / ${starterAgreementFor("hair").title} (makeup and hair)\n\n${fence(BEAUTY_STARTER_AGREEMENT)}`,
    `#### ${starterAgreementFor("planner").title} (planner)\n\n${fence(PLANNER_STARTER_AGREEMENT)}`,
  ].join("\n\n");
}

function briefing(today: string): string {
  return `# StudioCue — legal review pack for counsel

Prepared ${legalDate(today)} · ${LEGAL_ENTITY.name}, ${LEGAL_ENTITY.addressOneLine} (${LEGAL_ENTITY.state}) · ${LEGAL_ENTITY.email}

## 1. What we are asking for

StudioCue is software for wedding and event businesses: photographers and
videographers, DJs, makeup artists, hair stylists and planners ("studios").
A studio runs its inquiries, quotes, contracts, e-signatures, payments,
planning forms and crew in StudioCue. Its clients (couples and families) and
its crew use a portal. StudioCue has no paying customers yet.

Everything in this pack is **live at studio-cue.com and has not been reviewed
by a lawyer.** We would like you to:

1. **Review our own legal set**: Terms of Service, Privacy Policy, DPA and six
   more (Appendix A). It has been live since October 5, 2026.
2. **Review the wording StudioCue writes into studios' contracts with their
   clients** (Appendix C): starter agreements, Schedule A (event details),
   Schedule B (extra terms for some kinds of event), amendments.
3. **Review the electronic-signature consent and process** (Appendix B), and
   the two-signature "booking agreement" held back for your review.
4. **Answer the questions in Section 3.** Each one names the appendix with the
   text it is about.

**Who is party to what.** StudioCue (FlawlessIQ LLC) contracts with studios
under the Terms. Each studio contracts with its own clients under the studio's
own agreement. StudioCue is not a party to that agreement, but it supplies
starting wording, adds schedules to it and runs the signing.

**How your changes ship.** Each document has a version. Your edits ship as the
next version (Terms 1.1, Privacy 2.3 and so on). The Terms promise studios 30
days' email notice of a material change. A change to contract wording applies
to agreements written after it, never to one already signed. A change to the
e-signature consent becomes a new consent version, and each signature records
the version its signer saw.

## 2. Decisions already made (please confirm or change)

**Our legal set**
- New Jersey law; Morris County courts / D.N.J.; jury waiver; no class actions; one-year limit on claims.
- Liability cap: fees paid in the prior 12 months, or $100 if greater.
- Refunds: none for partial periods. Annual plans are refundable in full within 14 days of the first annual charge.
- Failed payment: 7 days of full access, then read-only (view and export only). Client messages are held, not dropped.
- Cancellation: 30 days to export, deletion within 90 days (backups age out in 84).
- The DPA has no signature step; the Terms incorporate it by reference.
- AI: Gemini via Vertex AI in StudioCue's own Google Cloud project. No training on customer data. A person approves everything AI drafts before it is sent.

**Contracts and signing**
- StudioCue's own e-signature has been **on for every studio since October 2, 2026**, before this review.
- Schedule B (extra terms for a bar/bat mitzvah, a quinceañera or a Sweet 16) **went live before this review**, on October 14–15, 2026. It is added to the studio's own agreement and, where they conflict, it wins.
- Some kinds of job book **with no signed agreement at all**, and are paid in full at booking (table below). This was a product decision, to keep small family sessions simple.
- The two-signature "booking agreement" (Appendix B, part 3) is **held** until you have seen it. Only our own test studio has it.

**Which kinds of job get which contract** (live today):

${kindsTable()}

## 3. Questions

### A. Our legal set (Appendix A)

1. **Courts or arbitration?** Currently courts, with a jury waiver and a class waiver.
2. **Automatic renewal.** Do California, New York or other states need renewal reminders beyond Stripe's trial-ending email and our in-app notice three days before renewal?
3. **DPA.** Do larger or non-US studios need a separately signable DPA, or Standard Contractual Clauses?
4. **Sales tax** on the subscription (Stripe Tax is not on yet).
5. **DMCA.** Our agent is registered (DMCA-1081859). Is anything else needed for the safe harbor?
6. **Studio referrals and partner payouts.** Studios get a referral code and a one-off bill credit when studios they refer stay. Vendors can be given partner codes that earn payouts (we issue 1099s). Do these need written program terms, beyond what the Terms and Privacy Policy say now?

### B. Electronic signatures (Appendix B)

7. **Is consent version 2 acceptable as written?**
8. **"Has the same effect as a handwritten signature."** Is that safe to say to consumers in the US, UK and EU, or should it be softened?
9. **Scope.** The consent covers this agreement and its signed copy only. Studios also email clients invoices, schedules and notices. Should those be in scope?
10. **Version 1.** One signature was given under it: our own internal test, with no real client. Anything to do differently if a real client ever signs under a version later found wanting?
11. **Clients outside the US.** Is anything required beyond this for UK and EU clients (simple electronic signature under eIDAS / the UK Electronic Communications Act 2000)? Or for specific US states?
12. **Notice of changed requirements.** Version 2 promises an email before any change that could stop someone opening their signed copy. Is that the right commitment, and how long after signing does it run?
13. **Automatic studio signature.** A studio owner can consent once to have their typed name applied automatically to each contract sent when a proposal is accepted (recorded as an "adopted signature"). Is that a valid signature for the studio?
14. **Retention.** We keep the signing record as long as the agreement. A studio can permanently delete a job, which deletes its signed agreement too (the client keeps their emailed copy). Should we enforce a minimum retention?
15. **The studio's own agreement.** Should studios' agreements carry their own clause about signing electronically, or is our consent screen enough?
16. **E-signature live before review.** Signing has been on for every studio since October 2. Is there anything we should do now about agreements already signed?
17. **The two-signature booking agreement** (Appendix B, part 3). The client signs the studio's terms (part 1) and then the pricing (part 2) in one sitting. Both signatures are saved or neither is, and the studio has already signed both parts. Is this sound? Should the client be able to accept the pricing without the terms, or the reverse? Is a "Request changes" button needed before we offer it?

### C. Studios' agreements: the starters (Appendix C)

18. **Blank sections.** Each starter leaves cancellation, copyright/image use and liability for the studio to write. Should StudioCue offer suggested clauses, and with what disclaimer?
19. **The DJ, beauty and planner starters.** Please review them as you review the photographer's. The beauty starter leaves allergies, sensitive skin and patch tests for the studio to write: should StudioCue suggest wording there?
20. **The corporate starter draft** (Appendix C, part 7; not offered to studios yet) and the five questions at its end.
21. **Schedule A** says details "marked 'To be confirmed' are added when the final details are confirmed". For a wedding, a bar/bat mitzvah, a quinceañera, a Sweet 16 or a vow renewal it then locks the details (four weeks out by default) ("changes … are agreed with us in writing"). Is this enforceable as part of the signed agreement when the details are filled in after signing?
22. **Amendments.** A signed booking changes only through an amendment the client signs. The amendment restates the whole agreement. Is a full restatement the right form?

### D. Schedule B: events with children (Appendix C, part 4)

These questions apply to all three Schedule Bs (bar/bat mitzvah, quinceañera, Sweet 16). They were written together and share their structure.

23. **Precedence.** "Where they differ from the terms above, these apply." Does this reliably override a conflicting clause in the studio's own agreement, such as a broad grant to use every image for advertising? Studios write their own agreements and we can't see every one. Should Schedule B name the clauses it overrides?
24. **Images of children.** The client is the honoree's parent. Is "unless the Client agrees in writing" enough for the honoree? Is it enough for *other* children at the event (a quinceañera's court, for example), whose parents are not parties? Should the studio need each child's parent's consent, or simply never use other children's images?
25. **"Personal use."** Does "the images delivered are for the family's personal use" conflict with a studio's copyright clause or its license to the client? Should it say "license" in so many words?
26. **The house of worship.** Is "not a shortfall" clear enough to stop a claim for services that the congregation's or parish's rules prevented? Should it also say the fee is unchanged?
27. **Beauty services for minors.** Is "a parent or guardian present" the right standard? Should the agreement ask about allergies, or require a patch test, for a minor?
28. **Planners and supervision.** Is the sentence "does not provide childcare" enough to keep a planner from being treated as responsible for child guests, including at a court's rehearsals?
29. **Placement.** Schedule B is added at the end, after Schedule A, as part of the signed document. Is a schedule the right form, or should these be numbered clauses in the body?
30. **Shipped before review.** Agreements carrying Schedule B may have been signed since October 14. If you change the wording, is anything needed for those agreements, or do new agreements simply use the new version?

### E. Minors, and bookings with no agreement

31. **Bookings with no agreement.** First communions, confirmations, baptisms, prom getting-ready, family sessions and sports book with no signed agreement. The client accepts a quote and pays (in full at booking, or on the day for sports). Is accepting the quote and paying enough? Or should these clients accept short terms (images of children, cancellation, refunds) at booking? If so, what is the minimum?
32. **Group sign-ups.** A studio can offer a whole class (a First Communion), a team, or a group of friends (prom) a sign-up link. Each parent signs up their child and pays the studio directly (card, Venmo, Zelle or check), with no agreement. Is a notice on the sign-up page needed: what the studio may do with the photos, the refund policy, who the parent is dealing with?
33. **Children's data.** We create no child accounts and never message children; a parent or guardian is always the client. Children's names appear where a studio or parent types them (rosters, shot lists, the honoree's name on the job). Is our current wording enough under COPPA and state minors' privacy laws?
34. **Prom.** Many students are 17 or 18. Does an 18-year-old student booking their own hair or makeup change anything, given the parent is usually the client?

### F. Data and privacy

35. **Vendor network.** When a studio shares a timeline with the other vendors a couple names, we may invite those vendors to try StudioCue. The invitation is a one-time offer in the same email. Their contact details came from the couple, through the studio. Does that make StudioCue a controller of that data? What needs to change in the Privacy Policy and DPA? Is our approach (a transactional email with a one-time offer, an opt-out and the postal address) right under CAN-SPAM?
36. **Deleting invoice records.** Studios can now bill clients themselves, without QuickBooks, and delete their invoice records. Do the Privacy Policy's and DPA's retention sections need to say so? Should we keep any minimum record?
37. **Meeting summaries.** Once Zoom approves our app, a studio will be able to have StudioCue read the summary of a consultation call with a client. Is any notice to the client needed (for example, in states that require every party's consent to recording)?
38. **AI drafts sent by studios.** Our assistant drafts replies and emails, and the studio approves each one before it is sent. Is anything needed beyond what the Terms and Privacy Policy say about AI?

## 4. What changed since the October 5 package

The October 5 package (v1) covered the legal set and the contract text as
they were then. Since then:

- **Privacy Policy 2.0 → ${LEGAL_DOCUMENTS.find((entry) => entry.slug === "privacy")?.version ?? "?"}** (October 7–8): signup attribution (how a studio found us), demo requests, and studio referral codes and credits.
- **Cookie notice 1.0 → ${LEGAL_DOCUMENTS.find((entry) => entry.slug === "cookies")?.version ?? "?"}** (October 8).
- **New trades with their own starter agreements:** DJ, makeup, hair (October 8–9) and planner (October 12).
- **New kinds of event:** bar/bat mitzvah (October 14); quinceañera, Sweet 16, communion/confirmation/baptism, prom and vow renewal (October 15). Schedule B for the first three.
- **Payment plans** (a deposit, up to six installments, the balance) and **studios billing clients themselves**, with deletable invoice records (October 9–13).
- **Vendor network** (October 13): timelines shared with a couple's other vendors, and the one-time offer to them (question 35).

## 5. How to read the appendices

- **Appendix A** — our nine published legal documents, in full, as on the site.
- **Appendix B** — the e-signature consent (both versions), how signing works, what we record, and the two-signature booking agreement.
- **Appendix C** — the wording StudioCue puts into studios' contracts: starters, Schedule A, Schedule B by event and trade, amendments, pricing clauses, and the corporate draft.
- **Appendix D** — the notices people see at signup, on the inquiry form and in every email.
`;
}

function appendixB(): string {
  const review = "docs/esign-consent-review.md";
  return `# Appendix B — Electronic signatures

## 1. How signing works

${section(review, "## How signing works")}

## 2. What we record with each signature

${section(review, "## What we record with each signature")}

## 3. The consent, both versions

${demote(esignMarkdown().split("\n").slice(1).join("\n").replace(/The element-by-element review\nand the nine open questions are in `docs\/esign-consent-review.md`\./, "Questions 7–15 in Section 3 are about it."), 1)}

### How version 2 differs, against ESIGN §7001(c)

${demote(section(review, "## What changed, against ESIGN §7001(c)"), 1)}

## 4. The certificate page (example)

${demote(section(review, "## The certificate page (example)"), 1)}

## 5. The two-signature booking agreement (held for your review)

Today a client accepts the studio's proposal (the pricing), and the studio then
sends its agreement to sign. With this option on, the studio sends one
**booking agreement** in two parts, and the client signs both in one sitting:

- **Part 1, Terms & conditions:** the studio's own agreement.
- **Part 2, Your coverage:** the packages, extras, total and payment schedule from the proposal.
- **Certificate:** the signers, IP address and device, the consent version, and the fingerprints.

The studio reads both parts and signs each one before sending. The client
reads part 1 and signs it, then reads part 2 and signs it. Both signatures are
saved together or neither is. Signing them accepts the proposal and signs the
agreement in one step. Each signature records the fingerprint of its own
part and of the whole document, so neither part can be swapped out later. The
client can't accept the proposal on its own once it's in a booking agreement.
The sealed PDF groups the signatures by part. Question 17 is about this.
`;
}

function appendixC(): string {
  const base = agreementTextMarkdown()
    .replace(/^# Agreement text StudioCue writes into studios' contracts\n/, "")
    .replace("## 1. Starter agreement", "## 1. Starter agreement (photographer)")
    .replace("## 2. Schedule A — event details (every agreement)", "## 3. Schedule A — event details (every agreement)")
    .replace("## 3. Booking amendments", "## 5. Booking amendments")
    .replace("## 4. Pricing clauses", "## 6. Pricing clauses")
    .replace("(weddings; four weeks by default, set per studio)", "(weddings, mitzvahs, quinceañeras, Sweet 16s and vow renewals; four weeks by default, set per studio)");
  const [intro, rest] = base.split("## 3. Schedule A");
  const [scheduleAText, tail] = rest!.split("## 5. Booking amendments");
  const corporate = readFileSync("docs/counsel/2026-10-05-v1/corporate-agreement-draft.md", "utf8").replace(/^# .*\n/, "");
  return `# Appendix C — Wording StudioCue writes into studios' contracts

${intro!.trim()}

## 2. Starter agreements (DJ, makeup and hair, planner)

${starters()}

## 3. Schedule A${scheduleAText!.trimEnd()}

${scheduleAExamples()}

## 4. Schedule B — events with children, by event and trade

Added after Schedule A, only to agreements for these kinds of event, in the
words of the studio's trade. Live since October 14 (bar/bat mitzvah) and
October 15 (quinceañera, Sweet 16). Questions 23–30 are about it.

${demote(scheduleB(), 0)}

## 5. Booking amendments${tail!.trimEnd()}

## 7. Corporate starter agreement (draft, not offered to studios yet)

${demote(corporate.trim(), 1)}
`;
}

function appendixA(): string {
  return [
    "# Appendix A — StudioCue's published legal documents",
    "As published at studio-cue.com/legal, in full.",
    ...LEGAL_DOCUMENTS.map((document) => demote(documentMarkdown(document), 1)),
  ].join("\n\n");
}

function appendixD(): string {
  return demote(noticesMarkdown().replace(/^# Notices people see/, "# Appendix D — Notices people see"), 0);
}

async function pdf(markdown: string, out: string) {
  const { marked } = await import("marked");
  const { chromium } = await import("playwright");
  const body = await marked.parse(markdown);
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>StudioCue — legal review pack</title><style>
    body { font: 10.5pt/1.5 Georgia, "Times New Roman", serif; color: #111; max-width: 46em; margin: 0 auto; }
    h1 { font-size: 20pt; page-break-before: always; margin-top: 0; } h1:first-of-type { page-break-before: avoid; }
    h2 { font-size: 14pt; margin-top: 1.6em; } h3 { font-size: 12pt; } h4, h5 { font-size: 11pt; }
    pre { white-space: pre-wrap; background: #f5f5f2; padding: 0.8em; font-size: 9pt; }
    code { font-size: 9pt; } blockquote { border-left: 3px solid #bbb; margin-left: 0; padding-left: 1em; color: #333; }
    table { border-collapse: collapse; font-size: 9.5pt; margin: 0.8em 0; } th, td { border: 1px solid #bbb; padding: 4px 6px; vertical-align: top; text-align: left; }
  </style></head><body>${body}</body></html>`;
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "load" });
  await page.pdf({
    path: out,
    format: "Letter",
    margin: { top: "0.8in", bottom: "0.8in", left: "0.9in", right: "0.9in" },
    displayHeaderFooter: true,
    headerTemplate: "<span></span>",
    footerTemplate: `<div style="font-size:8pt;width:100%;text-align:center;color:#666">StudioCue — legal review pack · page <span class="pageNumber"></span> of <span class="totalPages"></span></div>`,
  });
  await browser.close();
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const outDir = process.argv[2] ?? join("docs", "counsel", `${today}-review-pack`);
  mkdirSync(outDir, { recursive: true });
  const markdown = [briefing(today), appendixA(), appendixB(), appendixC(), appendixD()].join("\n\n") + "\n";
  writeFileSync(join(outDir, "counsel-review-pack.md"), markdown);
  console.log(`Wrote ${join(outDir, "counsel-review-pack.md")}`);
  try {
    await pdf(markdown, join(outDir, "counsel-review-pack.pdf"));
    console.log(`Wrote ${join(outDir, "counsel-review-pack.pdf")}`);
  } catch (error) {
    console.log(`No PDF (${(error as Error).message.split("\n")[0]}). Install Chromium: npx playwright install chromium`);
  }
}

if (process.argv[1]?.endsWith("export-counsel-review-pack.ts")) void main();
