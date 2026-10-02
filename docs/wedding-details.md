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
