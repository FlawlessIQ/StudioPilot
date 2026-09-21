# Zoom Marketplace — production review submission

Reviewer note of 2026-08-18 ("Account Credentials — CREATE") asked for three
things. Two were already satisfied; the third is what had the submission stuck.

## 1. Production ClientID — already correct

> "We will not be able to begin testing if your Development ClientID is used."

Verified on the deployed function, not assumed:

```
integrationOAuthEast4  ZOOM_CLIENT_ID=_QrWsTDcTu5r5dcQXejgg
```

That is the **Production** Client ID shown on the Marketplace app page. The
OAuth redirect also matches the allow list exactly:

```
OAUTH_CALLBACK_URL=https://studio-cue.com/api/integrations/oauth/callback
```

Nothing to change.

## 2. Test credentials — the actual blocker

StudioCue signup is a **card-required trial**: onboarding creates the studio
with an `incomplete` subscription and the app gate routes to Stripe Checkout
before any of the workspace is reachable. A reviewer signing up would have hit
a payment wall before seeing a single Zoom screen. That is almost certainly why
this sat from 18 August.

The product already has the mechanism for this — `COMPED_OWNER_EMAILS` in
`functions/src/saas/onboarding.ts`. A comped owner is granted `status: active`
immediately: no Stripe ids, no Checkout, no trial to end, and nothing flips it
back (there is no Stripe subscription for a webhook to touch, and no scheduler
expires an `active` status by date).

**Done 2026-09-21:** `conor+zoomreview@flawlessiq.com` added to
`COMPED_OWNER_EMAILS`, deployed and verified on `tenantOnboardingCommand`.

Remaining, and it needs a human because it sets a password:

1. Sign up at `https://studio-cue.com/auth/register` with
   `conor+zoomreview@flawlessiq.com`. Plus-addressing delivers to the normal
   inbox, so the verification mail arrives without a new mailbox.
2. It will land straight in the workspace rather than at Checkout. If it asks
   for a card, stop — the comped list did not take.
3. Seed dummy data (below).
4. Give Zoom the email and password.

## 3. Dummy data the reviewer needs

The Zoom path is: **studio books a client consultation → StudioCue creates the
Zoom meeting → the join link goes on the consultation and to the client.** So
the account needs one fake couple and one consultation far enough ahead to be
bookable.

- A client named something obviously fictional (not a real couple's name)
- A project/wedding for them
- A consultation slot to book

Nothing real. This tenant is separate from the reference studio's, which holds
live client data and must not be shown to reviewers.

## 4. What to tell Zoom about the integration

**Use case.** A photography studio schedules a consultation with a prospective
client inside StudioCue. The app creates the Zoom meeting, stores the join link
on the consultation, updates it if the time moves, deletes it if the
consultation is cancelled, and captures the meeting summary afterwards so the
studio does not retype its notes.

**Scopes — six, all exercised in code:**

| Scope | Where it is used |
|---|---|
| `meeting:write:meeting` | `POST /v2/users/me/meetings` — create the consultation meeting |
| `meeting:read:meeting` | read it back when rendering the consultation |
| `meeting:update:meeting` | `PATCH /v2/meetings/{id}` on reschedule |
| `meeting:delete:meeting` | `DELETE /v2/meetings/{id}` on cancellation |
| `meeting:read:list_meetings` | health probe only — `GET /v2/users/me/meetings?page_size=1` |
| `meeting:read:summary` | `GET /v2/meetings/{id}/meeting_summary` after `meeting.summary_completed` |

**Other endpoints:** `GET /v2/users/me`, called once at connect, to label the
connection with the account it belongs to.

**Meeting settings we set:** `waiting_room: true`, `auto_recording: "none"`,
and `auto_start_meeting_summary` only when `meeting:read:summary` was actually
granted (the code checks the granted scope list, not just the request).

**Webhook:** subscribed to `meeting.summary_completed`. Implements
`endpoint.url_validation`, and verifies `x-zm-signature` with HMAC-SHA256 and a
timing-safe comparison (`functions/src/booking/zoom-webhook.ts`).

**Data handling.** OAuth refresh tokens are held in Google Secret Manager and
never written to the database the browser can read. Per meeting we store the
meeting id and join URL on the consultation record, plus the summary text when
it arrives. Disconnecting removes the credential.

## Still to confirm before submitting

- Whether `studio-cue.com/privacy` and `/terms` say what Zoom's review requires
  about third-party data handling. The pages exist; nobody has read them
  against Zoom's checklist.
- Whether Zoom wants a second login for the **client** role. The client never
  authorizes Zoom — they only receive a join link — so this is arguably a
  single-user flow for Zoom's purposes, but the note asked about two-user flows
  explicitly and it is cheaper to offer one than to be asked twice.
