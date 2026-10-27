# Forms arrive filled in with what the job knows (2026-10-02)

Studios write their own forms, so a form can't name the job's fields. A couple's
form should still never ask for what StudioCue already holds.

## The fact sheet — `functions/src/planning/job-facts.ts`

`loadJobFactSheet` gathers, for one job:

| Fact | From, in order |
|---|---|
| event date, type, venue name / address / city | the project (`eventDate`, `eventType`, `venueName`, `venue.formatted`, `city`), then the inquiry (lead) |
| partner names, emails, phones | the project's client contacts in order (first = who booked); never a couple filed as one contact ("Priya & Jordan") as one person's name; then the lead |
| billing address | the first client contact that has one |
| planner, videographer, florist, DJ, band, caterer, hair & makeup, venue contact | the job's `vendors` by type |
| ceremony time | the latest run of show's "Ceremony" item, in its own zone; then the lead's `ceremonyTime` ("4pm" → 16:00) |
| guest count, budget, how they heard | the lead |
| anything | the same question answered by a person on another of this job's forms |

Values are always read from these records. Prefills on another form are never
carried onward as though the couple had said them.

## Which fact a question asks for

1. **The same question on an earlier form** (same wording, normalised).
2. **Rules** over the label and type (`factForField`). Anything that could mean
   two things stays blank: "Bride's name" (which contact?), "Reception venue"
   (often not the venue), "Phone on the day", "Any restrictions at the venue?".
3. **An AI map** for the studio's odd wordings ("Where's the party?"),
   `questionnaire-fact-map.ts`. Once per form version, only when the studio
   sends a form (never from the public inquiry page or a couple opening one),
   charged to the AI allowance and refunded on failure, audited
   (`ai.questionnaire_fact_map`), cached at `questionnaireFactMaps/{templateId}`.
   The model only names a fact from a fixed list; a name that doesn't exist,
   a question it wasn't asked about, or a fact that doesn't fit the field's type
   is dropped. Mock mode, no allowance or a failure: the rules alone.

A fact goes in only in the field's shape (`valueForField`): dates YYYY-MM-DD,
times HH:MM, emails that are emails, choices only one of the field's own
options (a guest count can pick "100–150"). Files, multi-selects,
acknowledgements and repeating groups are never prefilled.

## When

- **Send the form** (`assignQuestionnaire`): the new response starts filled in.
- **Sent again**: blanks fill from anything learned since.
- **The couple opens it** (`refreshQuestionnairePrefill`, from the portal):
  blanks fill from anything added since it was sent — a venue, a run of show,
  a vendor. Never a submitted form.
- **The inquiry page's event form**: the same engine (`startingAnswers`), over
  what the couple told the page a moment before.

Only blank fields nobody has touched (the response's `changeHistory`) are ever
filled: an answer the couple cleared stays cleared.

## What the couple sees

"Filled in from your booking. You can change it." — or "your inquiry", "your
timeline", "your earlier answers". Shown on text fields and choices, on the
portal and on the inquiry page. Each answer's `answerProvenance` keeps the
source record and field; the inquiry's word is marked `verified: false`.

## From the signed contract (imported jobs, 2026-10-27)

GR imported a book of weddings from a spreadsheet and opened a couple's Final
schedule: the date and the venue, and every name, place and time in the
signed contract "Not answered yet". A sheet has no columns for the day, and
couples won't type it twice.

**Add the signed contracts** (Jobs → Import, or "Fill in the day from the
signed contract" on an imported job's booking page):

1. **Read** (`functions/src/ai/contract-details.ts`, owner/admin, one AI
   charge per contract): the PDF is staged and scanned like Cue's signed
   agreements, then a model answers the studio's own questions — the job's
   forms first, then every form the studio has (`contractQuestions`, each
   wording once, up to 120) — from what the page states. It finds the job: the
   imported one on the contract's date sharing a surname
   (`matchContractToJob`), or the studio picks. Answers are shaped per field
   (`contractRowsFromAnswers`: a time to HH:MM, a choice only one of its
   options) and dropped when they don't fit. No model configured: no answers,
   and the studio is shown the questions to type from the document.
2. **Check**: every answer editable, each with "Use"; the questions the
   contract didn't answer can be typed.
3. **Keep** (`applyContractDetails`, imported jobs only): the rows go on the
   project as `contractDetails` (merged by question, newer wins), never as a
   form of the couple's — it would show as a form they returned everywhere
   forms are counted. Then every open form on the job refreshes its prefill,
   and the signed PDF is filed on the job if it has none.

**Where the rows reach:** the fact sheet offers them as earlier answers
(`source: "contract"`), *after* every form answer, so a couple who has said
otherwise is believed. Prefill provenance: `contract_fact`, "Filled in from
your signed contract", `verified: true`. Schedule A prints a row for any
question no returned form answers (`scheduleAContractAnswers`). Everything
else that reads the couple's answers (crew brief, run of show, lock-day
sign-off) reads them once the couple sends a prefilled form back.

A refreshed prefill now also updates `completionPercent`, which was set once
when a form went out: a form filled since still said "Answered 9%".
