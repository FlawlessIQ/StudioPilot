# Importing existing jobs — review, 2026-10-26

**Question:** does bringing over the jobs a studio already has cope with every
crew a real studio sends — videographers beside photographers, a hair studio's
three assistants on one wedding and two different ones on the next, a DJ's
assistant — and is it accurate enough that a studio trusts what landed?

**Verdict: no, on both counts.** Every way in describes a job's crew as two
numbers: the studio's main role, and videographers (photographers only). There
is no assistant anywhere in the product, no way to say *who* worked a job, and
the spreadsheet reader reads columns of names as counts. Run against three
sheets shaped like real exports, it blocked every photo and DJ row, imported a
hair booking under the wrong client without a word, and showed none of it on
the review screen.

## What was tested

Three sheets, the columns studios actually keep, through the real parser
(`features/imports/spreadsheet.ts`) with each studio's trade:

| Studio | Sheet columns that matter | What happened |
|---|---|---|
| Photographer | Lead Photographer (a name), Second Shooter (Yes/No), Videographers (2), Photo Booth | **Every row blocked**: "Lead Photographer" was taken as the photographer *count*, so `Couldn't read the number of photographers "Gabe"`. Second Shooter and Photo Booth ignored. |
| Hair studio | Bride, Stylists (1), Assistants (3), Assistant Names ("Kim, Tara, Joy"), Start Time, Party Size | **Wrong client, silently**: "Assistant Names" contains "name", so it became the *client's* name — Jess Lee's wedding would import as client "Kim Tara, Joy". Bride, Stylists, Assistants, Start Time and Party Size ignored; hours defaulted to 8 (a morning is ~2); a phone-only bride was blocked for having no email. |
| DJ | DJ (a name), Assistant (Yes/No), Uplighting, Team size | **Every row blocked**, and the message to a DJ says "photographers". Assistant ignored. |

## Findings, ranked

### P0 — wrong or blocked data

1. **Columns of names are read as numbers, and any header containing a field
   word wins.** Detection is header-only and substring-based
   (`detectColumns`): "Lead Photographer", "DJ", "Second Shooter Name" become
   the crew count; "Assistant Names" becomes the client. Nothing looks at what
   is *in* the column.
2. **A wrong client can be imported with no warning.** The review row shows
   "Kim & … · date · total · paid" — nothing that tells the studio the name
   came from the assistants column.
3. **Photographer words for every trade.** A row with no package is named
   `"Wedding photography"`; the crew problem says "photographers" to a DJ or a
   stylist; Cue's contract reader is told it is reading "a photography studio".
4. **Defaults that look like facts.** 8 hours and 1 crew member are filled in
   for every trade when the sheet or contract says nothing (spreadsheet,
   the one-at-a-time form, and Cue's reading), and nothing marks them as
   assumed. A stylist's "8 hours on site" or a DJ's "1 DJ" when the contract
   named two is exactly the inaccuracy that costs trust.

### P1 — the crew a real studio sends can't be described

5. **Crew is two counts.** `existingBookingSchema` has `photographers` and
   (photographers only) `videographers`. A DJ's assistant, a hair studio's
   assistants, a makeup studio that also sends a hair stylist, a planner's
   day-of coordinators beyond one: none can be recorded.
6. **No assistant role exists in the product** (`features/packages/coverage.ts`
   has photographer, videographer, DJ, makeup artist, hair stylist,
   coordinator). The fix belongs in the crew model, not only the import —
   packages, offers and the portal all read the same list.
7. **No way to say who worked a job.** An import writes no crew assignments,
   so "3 assistants here, 2 different ones there" is lost, and every imported
   job then reads as *not staffed*: readiness's `crewAccepted` checkpoint
   stays open, and once brought live the studio's only route is to offer the
   job to crew who already agreed to it elsewhere.
8. **Start times and party size aren't kept.** The crew's call time and a
   beauty booking's headcount are among the first things each trade checks.

### P2 — confidence

9. **The review shows four facts per row** (names, date, total, paid). Crew,
   hours, package, kind of job, venue and every assumption are invisible until
   after import.
10. **Every fix is a re-upload.** A row that needs one correction has to be
    fixed in the sheet and the whole file loaded again.
11. **Columns that weren't used are listed nowhere.** "Photo Booth", "Party
    Size", "Uplighting" vanish; the studio can't see what didn't come over.
12. **Email is required for the primary client.** Beauty and DJ clients are
    often phone-only; they should import, with the portal invite waiting for
    an email.

### P3 — coverage of the business

13. **Past and in-progress jobs can't be imported** (ADR 0005, "not
    importable yet"). A studio moving mid-season has weddings in editing and
    galleries to deliver; those stay in the old tool, so the move is never
    complete. In the sheet run, they also show as errors rather than as
    "skipped: already happened".
14. **CSV only.** Excel and Google Sheets need exporting first; `.xlsx` is
    rejected.
15. **Currency is fixed to USD** in the spreadsheet path.

## Proposed design

**Crew lines everywhere a job is imported.** Replace the two counts with a
list, `crew: [{ role, count, names[] }]`:

- Roles: every coverage role, **plus a new `assistant` role** — chosen per
  line, not limited to the studio's trade (a makeup studio can send a hair
  stylist). The count is the number of people; names are optional and, when
  given, set the count.
- Named crew are matched to the studio's roster (name or email). A match gets
  an **accepted, imported crew assignment** — no offer, no email — so the job
  reads as staffed. A name not on the roster is kept on the job and listed
  after import with one tap to add them.
- The package snapshot's coverage is built from the lines, so offers, the
  portal and readiness all see the same crew.

**A spreadsheet reader that looks at the cells, not just the header.**

- Each column is classified by its contents: numbers, yes/no, names (one or a
  comma-separated list), times, money, dates. A crew column is placed by the
  role word in its header ("Second Shooter", "Assistants", "DJ", "Video") and
  read by its contents: a number is a count, Yes is one, names are named crew
  (and their count).
- Whole-word header matching, so "Assistant Names" can never be the client;
  "Bride", "Groom", "Client" and the trade's own client words are client
  columns.
- Start time and party size columns.
- Trade-aware defaults (hours, package name), each one marked *assumed*.
- Unused columns listed, with "keep in the job's notes" as one tick.

**A review a studio can trust.** Each row expands to every field StudioCue
read, where it came from ("from Assistants") and which values were assumed;
any row opens in the one-at-a-time form, prefilled, to fix it in place. After
import: "12 jobs imported · 31 crew assigned · 4 names to add to your roster".

**Cue's contract reader** reads crew lines in the studio's trade and leaves a
value empty rather than defaulting it.

## Decisions (Conor, 2026-10-26)

1. **An assistant role per trade** — photo assistant, DJ assistant, makeup
   assistant, hair assistant — not one shared role.
2. **Named crew not on the roster are added to it quietly**: a roster entry,
   no invite sent, so the job reads as staffed at once.
3. **Past and in-progress jobs are built now**, in the same piece of work.

## Built (2026-10-26)

- **Crew model:** `photo_assistant`, `dj_assistant`, `makeup_assistant` and
  `hair_assistant` beside each trade's lead (coverage.ts, trades.ts). A DJ's or
  stylist's packages now count assistants; staffing reads "Hair assistant" as
  that role; Cue knows photo assistants.
- **Crew lines on every import:** role, how many, and who. Named people are
  matched to the roster by name or added to it with no email and no invite;
  each is booked on the job (accepted, past job or not) with nothing sent. A roster entry with no email is never offered work and can't
  be invited until it has one (`CREW_EMAIL_REQUIRED`).
- **Past and in-progress jobs:** event done, in editing, delivered and
  finished, each with the records its screens and closeout read (ADR 0005
  amendment). The paid record says `paidInFull`, so closeout's final balance
  is met for every import.
- **Spreadsheet reader:** reads columns by whole words and by their cells;
  crew columns by role (names, counts, Yes, second shooter); bride/groom;
  start time; job status; delivery link and date; phone-only clients; trade
  defaults marked as assumed; unused columns kept in notes; Excel (.xlsx) as
  well as CSV; each trade's own template.
- **Review:** each row shows where the job is and its crew, and opens to
  "What StudioCue read" — every field, the column it came from, what was
  assumed — with "Fix and import this one" opening the form prefilled. The
  summary says how many crew were booked and who was added to the crew list.
- **Form:** crew lines, every state, start time, delivery link, email or
  phone.
- **Cue:** reads a contract for the studio's own trade and its crew as
  written; leaves hours and crew empty when the contract doesn't say.

Walked locally: an Excel sheet with an upcoming wedding (lead, second
shooter, videographer, named photo assistant), a delivered wedding with its
gallery link, and a phone-only elopement in editing. All three imported in
their states, 4 crew booked, 3 names added to the crew list with no email,
and no email or calendar job queued for any of them.

## Confirm before import (2026-10-26, after GR's sheet)

Gabe's real sheet (11 jobs) would have imported nine rows as fact that its
own notes contradicted: eight retainers listed as paid beside "no payment
confirmation in contract", one $3,000 "paid" where the notes said the
retainer was $1,000, another $3,000 against a $2,000 retainer, a photo-only
wedding with a videographer, a nine-digit phone. Two more were refused
outright (an unsigned contract; a bride and groom sharing one email). Conor:
add a human step when confidence is low.

What was built:

- **Questions** (`features/imports/import-questions.ts`, pure): fixed rules
  read each row against its own notes. Payment unconfirmed → "Has the $3,000
  been received?" (received / still owed). A different retainer in the notes
  → both figures and "Nothing yet · $1,000 owed". Photo only with a
  videographer → keep or drop. A phone that isn't 10 digits → blank or keep.
  A mitzvah child named only in the notes → save as who it celebrates. No
  signing date → add as an inquiry or leave out; "unsigned" in the notes of a
  signed row → booked, inquiry, or leave out. An answer only picks between
  what the row already says; the server still checks the result.
- **The review** asks on each row, rows asking first; "Same answer for the N
  others like this" settles a run of the same question (never a child's name).
  Answers stay changeable until import.
- **A retainer still owed** (`retainerOwedCents`) imports as a retainer bill
  due now: no provider, no customer, nothing sent. "Record a payment" on the
  booking page settles it; the journey no longer ticks "Retainer paid" on a
  booked job whose retainer is still out (features/journey/steps.ts — the same
  was wrong for a job booked on a retainer exception).
- **Inquiries:** an unsigned row becomes a LEAD job through the ordinary
  createContact/createProject commands, its package, quote and notes kept in
  the job's source message.
- **Shared email:** kept on the first person, the partner left without, with a
  note — no longer a refusal.
- **Child's name:** a column the reader knows ("Child's name", "Honoree"), in
  the template, and the mitzvah variant read from the sheet's own type.
- **Already here → Update it** (`updateImportedBooking`): for an imported job,
  what it lacks is filled; where it disagrees with the sheet the studio picks.
  Crew counts change through a new package snapshot. Money and the signature
  are never changed this way; a different total is said.
- **Keep for later** (`holdImportRows` → `importDrafts`, owner/admin read
  only): unanswered rows wait as one Today card, "N imported jobs need an
  answer", and reopen on the import page with their answers.
- What was confirmed is kept on the job (`importConfirmations`, with who and
  when) and shown in the import banner: "Checked when it was imported".

Walked locally with Gabe's own sheet: 10 rows asked, the 5-row bulk answer,
9 imported (5 with retainers owed), 2 kept for later → Today card → answered
→ the shared-email row imported with its phone blank and the unsigned one
added as an inquiry; one
owed retainer recorded as paid with no email queued; a later sheet updated
one job's city and crew through a new snapshot.
