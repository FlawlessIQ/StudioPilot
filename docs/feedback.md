# Studio feedback

Studios tell the StudioCue team anything from inside the product, and the team
answers. Studios only: couples and crew don't get the button.

## Where it lives

| Piece | Where |
| --- | --- |
| Kinds, statuses, roles, subject line | `features/feedback/model.ts` (mirrored in `functions/src/feedback/model.ts`, compared by `tests/feedback.test.ts`) |
| The button and sheet | `components/feedback/feedback-launcher.tsx`: a tab on the right edge of every studio screen on desktop; **Send feedback** in the More drawer on a phone; **Still unclear? Tell the team** in the How-to popup |
| Screenshot | `lib/feedback/screenshot.ts`: the visible screen, captured as the button is pressed (before the sheet covers it), JPEG ≤ 2.5 MB; or an image the studio attaches |
| Command | `functions/src/feedback/commands.ts`, `feedbackCommand`: `submitFeedback` (studio member) and `setFeedbackStatus` (platform admin) |
| Studio's list | **Your feedback** in Help & guides (`components/feedback/your-feedback.tsx`) |
| Team triage | Platform admin → **Feedback** (`components/platform/feedback-triage.tsx`) |

## What happens when a studio sends one

1. `feedback/{id}` is stored with the message, kind, screen, device, last page
   error and contact preference. The id comes from the sender and the sheet's
   idempotency key, so a retry is the same feedback. Ten per person per hour.
2. The screenshot goes to `feedback/{tenantId}/{id}.jpg` in the default bucket.
   Only platform admins can read it (`storage.rules`). It can show client
   details.
3. Two emails are queued under tenant `platform`. Like auth mail they use
   StudioCue's letterhead (`isPlatformEmailType`), and a failure never lands on
   a studio's Today:
   - `feedback_received` goes to `FEEDBACK_INBOX`, with the screenshot
     attached. Reply-To is the studio when they allowed contact, so a reply
     from the inbox answers them directly.
   - `feedback_thanks` goes to the studio, signed "The StudioCue team".
     Reply-To is `FEEDBACK_REPLY_TO` (default `support@studio-cue.com`).

Moving one to **Planned** or **Shipped** in triage emails the studio once per
status (`feedback_planned` / `feedback_shipped`), with the team's note. This
only happens if they allowed contact. **Closed** reads as "Reviewed" to the
studio and sends nothing.

The command is deliberately not gated on the subscription. A studio whose trial
lapsed is exactly the one worth hearing from.

## Configuration

`FEEDBACK_INBOX` in `functions/.env.studiohub-prod` (see the `.example`). When
it is unset, feedback is still stored but nobody is emailed. The function logs
`feedback.inbox_not_configured` instead.

`support@studio-cue.com` only receives mail once `studio-cue.com` has an MX
record. On 2026-09-30 it had none, so replies to the thank-you bounced until
email routing was set up.

## Deploying a change here

`email-templates.ts` and `operations/jobs.ts` are shared. A template change
must reach `operationsTaskWorker`; see "Working on main" rule 6 in `CLAUDE.md`.
