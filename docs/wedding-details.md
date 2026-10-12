# Wedding details: in the contract, locked four weeks before (2026-10-02)

GR Productions: the details belong in the contract, because that is what stops a
couple changing things — the photo stop on the way from the church to the hotel,
the ceremony time. Gabe's answers: at booking a couple has their prep, ceremony and
reception locations and the general times; couples can still update little things;
send the schedule six months before (or let each studio pick); no charge to change
the schedule; lock four weeks before.

## 1. Schedule A in every agreement

`features/contracts/event-details.ts` (mirrored in functions) sorts the couple's form
answers by what each question asks — getting ready, ceremony, reception, photo
locations, times, guests, contacts — with the date, venue and coverage from the
records. `resolveContractDocument` puts it where the template says `{{event.details}}`,
otherwise at the end, so every agreement carries it: prepared, auto-sent on
acceptance, combined, and amended. Plain headings and lists, inside the signed hash.
A wedding missing getting ready, ceremony, reception or times prints "To be confirmed"
and the studio is told before sending (`detailsMissing` on the draft); it doesn't
block sending.

## 2. When the planning form goes out

`tenants/{id}.planningTimeline` (`features/planning/planning-timeline.ts`): months
before (default 6), remind or send automatically, which form (default: the newest
planning form that isn't the inquiry form), and the lock (default 28 days). Settings →
Planning timeline. On "remind", Today's "Send the form" appears from that day, not
from booking. On "auto", `planningFormScheduler` (daily) sends it through the same
code as the studio's button (`planning/send-questionnaire.ts`); never to a quiet job,
never a second copy.

## 3. After sending, and the lock

A couple can change a form they already sent: little things any time, locations and
times until the lock (`saveQuestionnaire`, `amendingReturned`). The studio sees each
change as a receipt. What locks is `features/planning/details-lock.ts` — the same
sorting as Schedule A, so what the agreement lists is what locks.

On the lock day `finalDetailsScheduler` opens `detailSignoffs/{tenantId}_{projectId}`:
every location and time from their forms (newest answer wins) and the published
timeline's couple-visible items, and emails them to confirm. They confirm on their
portal home by typed name; the confirmation must match the snapshot they were shown
(`FINAL_DETAILS_CHANGED` otherwise). Five days without it, Today nudges the studio.

### Booked inside the window (2026-10-12)

Walking prod with Jess Styles Bridal (hair, 30-day lock), a sangeet booked the day
of the event showed four things wrong. One rule now decides when the details go,
for every reader: `features/planning/final-details-due.ts` (mirrored in functions)
— booked (BOOKED, PLANNING, READY), not quiet, a job with a lock, on or after the
lock day and not after the event. "Today" is the job's own calendar day
(`finalDetailsToday`: the event's zone, else the studio's, else UTC) for the
sweep, the booking and form-return path, the job page and Today alike; the server
read UTC and the page the viewer's clock, so a US evening booking of a same-day
job was "asked within the day" on the page and "event passed" on the server.

- **Waiting on the client only once asked.** The journey's step read the date
  alone, so a *lead* dated inside the window said "Meanwhile, waiting on the
  client: Final headcount". Now `invited` needs an open sign-off (and, for a final
  details call, the link it carries: `finalCallLinkId`; null means nobody to send
  it to, so the studio invites them). Past the lock with nothing open, the step
  says when it goes: as soon as they book (a headcount: once they've booked *and*
  the party list is in), within the day, or once the party list is in. Whether a
  sign-off or a list is missing is read from the job's own records
  (`components/planning/use-final-details-records.ts`), never from the tenant-wide
  reads, which stop at 100.
- **Opened the moment it can be.** `openFinalDetailsIfDue` (functions
  `planning/final-details.ts`) runs from `completeBookingResources`, which every
  booking path queues, and from `crewBriefOnQuestionnaireWrite` when a form comes
  back; the daily sweep stays as the backstop. Idempotent (`exists`). A form
  coming back while the sign-off still waits refreshes what they confirm
  (`refreshAwaitingSignoff`), as an accepted change does — except a headcount,
  whose number at the lock is the floor the agreement holds them to: a list cut
  afterwards never lowers it, and someone added is counted when they confirm.
  Only an old "Still 0" sign-off takes the list's number, once.
- **No headcount without a party list.** A makeup or hair sign-off is never
  opened before the list is back (`no_party_list`, counted in the sweep's tally):
  the sweep would have asked "Still 0 getting ready?". Today says which is
  missing ("haven't sent their party list"; back with nobody on it; nobody down
  for the studio's own service).
- **Schedule A written after the lock** says the details (or headcount) are
  confirmed as soon as the booking is made (or the party list is in), not "30
  days before the date". Only agreements written on or after the lock day; the
  rest are byte-identical (golden hashes in
  `tests/final-details-lock-window.test.ts`). The contract keeps
  `detailsLockPassed`. An amendment that keeps the date keeps the signed
  agreement's words (one signed months ahead still says "four weeks before the
  date"); one that moves the date is decided from the new date, so a booking
  signed the day of the event and postponed three months promises the new lock
  day again.

## 4. Changes after the lock

On the sent form, a location or time says "Request a change"
(`requestDetailChange` → `detailChangeRequests`); little things still say "Change".
Today shows "{couple} want to change {question}: from → to" with Accept / Decline
(`decideDetailChange`). Accept changes the answer ("Changed at the couple's
request"), emails the couple, opens a task when a timeline is already published, and
— if they've confirmed — records the change beside the confirmed details (which stay
as signed); before they confirm, it refreshes what they'll confirm. Decline keeps it
and tells them. No fees. The planning page shows the final details and every change.

Walk: `scripts/uat/wedding-details-walk.mts`.

## 5. Recommended forms (GR's own), TBD and suggested times

Gabe sent GR's two wedding forms "as detailed as possible… 99.9% of weddings", to
offer every studio as ready-to-go templates they can copy and adjust
(`features/questionnaires/recommended-templates.ts`). Questionnaires → "Ready-to-use
wedding forms" → Make a copy: an ordinary template (`recommendedId` on it), edited
like any other. Nothing is written into a studio's library until they copy.

- **Event details form** — with new inquiries. Locations, times and guest count
  allow "TBD" (`allowTbd`): an answer, printed "To be confirmed" in Schedule A
  and still listed as missing; never copied forward into a later form.
- **Final schedule** — the planning form. The same questions in the same words,
  so the event details fill it in (job-facts matches by question), then family
  names and the day in order. Gabe's rules are each step's note (`help`) and,
  where a rule names a time, a suggestion (`suggestedFrom: {fieldId, minutes}`):
  filled when the form is sent, and offered as "Suggested: 1:30 PM — use it" to
  a couple who clears one. Every step's wording says "time", so Schedule A and
  the lock sort it.

Fixed on the way: a form was due before it was sent when its due-days ran past
the wedding (`questionnaire-due.ts`: never sooner than a week, never after the
day); and after the lock date a couple couldn't fill in a form they hadn't sent
back yet — the lock now applies only to answers already returned.

## 6. "Which are you?" — forms that ask by role

GR's forms ask "Bride's name", "Groom's email". An inquiry says who wrote in and their
partner's name, never which is the bride, so those questions couldn't fill by rule.
When a form asks by role and the job knows the person who inquired, the couple sees
"Which are you? I'm the bride / I'm the groom" at the top of that section: one tap
fills their own name, email and phone and their partner's name and details, blanks
only (`coupleRoleChoices` in job-facts.ts; `components/client/kit/role-chooser.tsx`
on the portal form and the inquiry page). It goes once they've picked or typed any
of those answers. The final schedule then fills from those answers as usual.

## 7. Editing a form: order, sections and rules

A copied form (or any template) is fully editable on Questionnaires → Edit this
questionnaire, and "Build template" opens the same editor empty
(`components/planning/questionnaire-template-editor.tsx`): questions up and down (across
sections at the edges) and "Move to…" another section; sections added, renamed, moved
and deleted (keeping or dropping their questions); "When it shows" — only when an
earlier answer is X — and, on a time, a suggested time from an earlier time; reminder
days. A rule can only read an earlier question: every rearrangement runs
`repairTemplateLinks` (`features/questionnaires/template-rules.ts`, mirrored in functions)
and says what it cleared, and the server refuses a template that still breaks one
(`QUESTIONNAIRE_TEMPLATE_INVALID`). Each question shows where its answer goes — "In the
contract", "Locks with the final details" — from its wording, as the studio types.
