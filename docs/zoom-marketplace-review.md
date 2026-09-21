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

**Account created 2026-09-21 and it went straight into the workspace** — no
Checkout. Verified in the data: `status: active`, `plan: studio`, period end
`2099-12-31`, **no Stripe subscription id at all**, exactly as the comped path
intends.

- Tenant: `tenant_4402ac21-aca3-412d-a556-69aaa3f7eeb8` ("Zoom test studio")
- Login: `conor+zoomreview@flawlessiq.com` (password set by Conor at signup)

Give Zoom that email and password.

## 3. Dummy data — seeded 2026-09-21

Created through the product, so every record is shaped the way the app expects:

- **Client:** Testcouple Demo — `testcouple@example.com`
- **Project:** *Sample Wedding (Zoom review demo)* — 20 Jun 2027, Sample City

Deliberately fictional names. This tenant is separate from the reference
studio's, which holds live client data and must never be shown to reviewers.

**No consultation was booked.** Booking one *is* the flow under review, so it
is left for the reviewer to do.

### The path they will take, walked end to end to confirm it is clear

1. **Jobs → Sample Wedding (Zoom review demo)**
2. The job's next move is **"Schedule consultation"** — one click
3. That routes to the calendar, scoped to the project, with open slots on every
   weekday (default availability is already configured — nothing to set up)
4. **Book** any slot. The dialog opens with **Meeting type: Zoom already
   selected**, and — while Zoom is unconnected — a plain disclosure:

   > "Nothing is connected to create meeting links. You will need to paste your
   > own meeting link. **Connect Zoom**"

   So the OAuth flow is reachable from the exact screen where it is needed. The
   reviewer can also connect first from **Studio settings → Integrations**.
5. **Confirm booking** creates the Zoom meeting and puts the join link on the
   consultation.

Reschedule and cancel from the same consultation exercise
`meeting:update:meeting` and `meeting:delete:meeting`. The summary scope fires
after a real meeting ends, via the `meeting.summary_completed` webhook.

## 3b. Client-portal login — invited 2026-09-21

Zoom's note asked for logins for **all roles** if the app has a two-user flow.
The client never authorizes Zoom — they only receive the join link — so this is
arguably single-user for Zoom's purposes. Offering it anyway costs less than
being asked twice.

- **Client:** Testcouple Demo, email changed from `testcouple@example.com` to
  **`conor+zoomclient@flawlessiq.com`** so the invitation actually arrives —
  `example.com` would never have delivered.
- Portal invite **sent and delivered**: `emailJobs` shows `status: succeeded`
  on the first attempt, and the invitation is `pending` (awaiting the client
  setting a password), expiring **2026-09-28**.
- Scope: the invite shares **only** *Sample Wedding (Zoom review demo)* — the
  portal shows that one project and nothing else.

**Accepted 2026-09-21T20:03Z.** Verified in the data: invitation `accepted`,
auth user exists and is email-verified, and the membership is
`role: client, status: active` with `projectIds` holding exactly the one demo
project — so the client sees that wedding and nothing else.

### Both logins, ready to send Zoom

| Role | Email | What they see |
|---|---|---|
| Studio owner | `conor+zoomreview@flawlessiq.com` | The full workspace: the job, the calendar, Integrations → Connect Zoom |
| Client | `conor+zoomclient@flawlessiq.com` | The client portal for *Sample Wedding (Zoom review demo)* only |

Passwords were set by Conor at signup and are not recorded here.

### This email is also the first real test of the link branding

A1 shipped `url5544.studio-cue.com` but nobody has yet read an actual client
email and clicked an actual branded link — the last mile flagged in
`walk-it-on-prod-or-it-is-not-done`. This invitation is a genuine client-facing
send. **Confirmed: the delivered email carried `url5544.studio-cue.com`.** That
closes A1 — the branding is not merely configured, it is being applied at send
time, read in a real client email rather than inferred from SendGrid's own
status page.

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
