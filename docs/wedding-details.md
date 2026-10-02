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
