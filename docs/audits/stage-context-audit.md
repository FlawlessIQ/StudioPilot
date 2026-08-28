# The stage–context audit

A reusable prompt for finding the class of defect where **StudioCue tells a
studio something that is not true of their job right now**.

Every instance found so far reduces to one of three failures. Learn these three
and you can hunt them rather than stumble on them.

1. **A step reads its own record, but not its context.** "Is the form answered?"
   and never "is this still the moment for a form?" A wedding shot sixty days
   ago read *Your next move: send the form — prep locations, times, and family
   names.*
2. **Two surfaces answer the same question differently.** "100% ready — nothing
   blocking" directly above "Crew confirmed ✗". "Questionnaire assigned" above
   "No questionnaires assigned". "PDF generation failed" under "the branded PDF
   is being generated".
3. **An instruction you cannot follow.** "Send the form" landing on a page whose
   send control is below the fold. "It already happened — mark done" landing on
   "Schedule the consultation first". A filter for archived records when nothing
   could archive.

---

## The prompt

> Audit StudioCue for stage–context defects: places where the product says
> something untrue of the job in front of it.
>
> **Method.** Do not read code looking for bugs. Put real jobs in front of
> yourself and look at them. Build a matrix of job stages × surfaces and walk
> the cells. The defects live in the cells nobody visits — a cancelled job's
> Today card, a postponed job's booking page, a delivered job's readiness page.
>
> **Stages to hold a job at.** LEAD with no email · CONSULTATION marked done by
> hand with no meeting record · PROPOSAL approved but never sent · PROPOSAL sent
> and accepted outside StudioCue · CONTRACT_PENDING with a paper signature ·
> BOOKED shooting solo · BOOKED with crew invited but not accepted · PLANNING at
> 100% · PLANNING with no checkpoints at all · READY with the event tomorrow ·
> READY with the event a year out · **EVENT_COMPLETE and POST_PRODUCTION with
> preparation still incomplete** · DELIVERED with the balance unpaid · POSTPONED
> · CANCELLED · CLOSED.
>
> **Surfaces to check at each.** Today · the job page (next move, journey rail,
> reference list) · Jobs · Calendar · Messages · People · AI review · Insights ·
> the Overview/Booking/Plan/Delivery tabs · Library · Studio settings · the
> client portal · the crew workspace.
>
> **The three questions, at every screen.**
> 1. Would this still be said if the event were behind them? If the job were
>    cancelled, or on hold? If the client had no portal account?
> 2. Does another screen answer this same question differently right now? Open
>    both and compare — a contradiction is only visible side by side.
> 3. If I do exactly what it tells me, does the next screen let me finish? Click
>    it. Count the steps. An instruction that needs scrolling past its own
>    "not done" message is a failed instruction.
>
> **Also flag**, because each has bitten before:
> - A status field trusted over the record it summarises (`status: "submitted"`
>   with no answers; a lead `status: "new"` carrying a `projectId`).
> - A command with no caller, or a caller with no command.
> - A control that vanishes instead of explaining itself.
> - A setting nothing reads.
> - A success notice that dies when its branch re-renders.
> - A component rendered somewhere too small for what it draws.
>
> **Evidence rules.**
> - Read the code before claiming a defect. Several "findings" have turned out
>   to be the seed's odd data, or a page read before it hydrated. Confirm the
>   page rendered before recording what it showed.
> - Separate "the demo data is strange" from "the product is wrong". Say which.
> - When you were wrong, retract it in writing in the report. A retracted
>   finding is worth more than a hedged one.
>
> **Output.** For each finding: the job stage, the surface, what it said, what
> was true, and which of the three failures it is. Rank by whether a real studio
> would act on the false statement.

---

## Why the stage matters more than the screen

The questionnaire step had been read many times and looked correct, because it
was only ever read on a job that had not happened yet. It is right there and
wrong sixty days later, and no amount of staring at the component reveals that —
only moving the job does.

So when a walk finds nothing, the walk was probably at the wrong stage, not the
code correct.
