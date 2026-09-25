# Google OAuth — Gmail scope drafts (Stage 2, not submitted)

Prepared 2026-09-25. Nothing here has been sent to Google. The Calendar
verification this was meant to start is already done — see "Current state".

## Current state (read from the console and the verification thread, 2026-09-25)

- `studiohub-prod`: External, **In production**. User cap 1 / 100 (lifetime;
  does not apply while the app only requests approved scopes).
- Branding: **verified and shown to users.** App name StudioCue, logo set,
  home `https://studio-cue.com/`, privacy `/privacy`, terms `/terms`.
  Authorized domains `studio-cue.com` and
  `studiohub--studiohub-prod.us-east4.hosted.app`. Support and developer
  contact: `conor@flawlessiq.com`.
- Data access: **verified.** Google approved `calendar.events.owned` on
  2026-08-25 (thread "OAuth Verification Request Acknowledgement",
  api-oauth-dev-verification-reply). `calendar.freebusy` is classified
  **non-sensitive** and needed no approval.
- Search Console: `studio-cue.com` verified for conor@flawlessiq.com, the
  project's only Owner.
- One OAuth client, "StudioPilot Production", `988256939236-llecv7…`.
  Redirect URIs: the hosted.app callback and
  `https://studio-cue.com/api/integrations/oauth/callback`.
- Google's own rule from the approval email: any new scope, **or any change
  to the consent-screen configuration**, needs a new verification request.

## 1. Scope justification — `gmail.readonly` (restricted)

Console field, ≤ 1000 characters:

> StudioCue is a CRM for wedding and event photography studios. A studio
> connects its own Gmail so inquiries from its website contact form (Wix,
> Squarespace, WordPress) and wedding marketplaces (The Knot, WeddingWire)
> become leads without retyping. We call users.watch (Pub/Sub) and
> history.list to learn of new messages, fetch headers first, and fetch a
> body only when the sender or subject matches an inquiry source. Matching
> messages are parsed into a lead; nothing else is stored. No narrower scope
> works: gmail.metadata is also restricted and cannot read the form fields
> in the body, and the add-on scopes only read a message the user has open,
> not new mail arriving in the background. Data is used only to create that
> studio's leads, never for ads or model training, and humans at StudioCue
> do not read it without the studio's consent.

## 2. Scope justification — `gmail.send` (sensitive)

> When a studio approves a reply to a new lead in StudioCue, we send it with
> messages.send from the studio's own Gmail address, so the client sees the
> studio's real address and the reply lands in the studio's Sent folder.
> StudioCue never sends without the studio clicking Send on that specific
> message, and it sends only replies to leads. gmail.compose and
> gmail.modify grant more than sending, so gmail.send is the minimum.

Lengths: §1 is 839 characters, §2 is 422. Today the console has one
1000-character field for all sensitive scopes, and restricted scopes appear
to get their own. If both end up sharing one field, cut §2 to its first two
sentences.

## 3. Longer write-up (for Google's follow-up email and the CASA lab)

**What is read.** On connect, StudioCue registers `users.watch` on the INBOX
label with a Pub/Sub topic in `studiohub-prod`. Each notification carries a
`historyId`; StudioCue calls `history.list` for message IDs added since the
last one, then `messages.get` with `format=metadata` (From, Reply-To,
Subject, Date, List-Id only). Only messages whose sender is a known
inquiry source (website-builder form notifications, wedding marketplaces)
or a sender this studio has confirmed are fetched in full. On first connect,
the same filter runs over the last 30 days so the studio's current
inquiries come across.

**What is stored.** For each message turned into a lead: the sender's name
and email, the subject, the date, the text of the message, the fields parsed
from it (names, event date, venue, guest count, budget, services), and the
Gmail message ID (so it isn't captured twice). Messages StudioCue is unsure
about wait in a "Maybe an inquiry" tray for the studio to confirm or dismiss,
and are deleted after **[14] days** if nobody acts. Every other message is
discarded after the header check. Nothing about it is kept except its
message ID in a de-duplication ledger, which expires after **[30] days**.
StudioCue also stores the OAuth tokens, server-side in Secret Manager, never
in the browser.

**AI.** Candidate messages are classified and parsed, and a reply is
drafted, by Google's Gemini models on Vertex AI, called from StudioCue's own
Cloud Functions in `studiohub-prod` (us-east4). No third-party AI provider,
gateway or self-hosted model is involved. Vertex AI does not train on
customer prompts or responses. Gmail data is never used to train or improve
any model, including one for that studio.

**Retention and deletion.** Leads, and the message text they came from, are
the studio's business records. They are kept while the lead or job exists
and deleted with it. Disconnecting Gmail stops the watch, deletes the stored
tokens, and ends all reading and sending. Revoking StudioCue at
myaccount.google.com/permissions does the same from Google's side.

**Human access.** StudioCue staff do not read a studio's Gmail data except
with that studio's explicit consent for a support request, for security
investigations, or where required by law.

> **Fix before quoting this to Google.** The header-first filtering, the
> tray expiry and the ledger expiry are design commitments. Build them that
> way before quoting this text to Google. The current plan
> (`lead-capture-plan-2026-09-25.md` §3) has the model score "anything
> else", which would send every unknown-sender email to Gemini. That's much
> harder to justify under "minimum necessary". The bracketed numbers are
> proposals.

## 4. Privacy policy — new "Email connections" section

To add after "Google Calendar data" in `app/privacy/page.tsx`:

> **Email connections**
>
> A studio may connect its own Gmail account so that inquiries arriving from
> its website contact form or from wedding marketplaces become leads in
> StudioCue, and so that it can reply to those leads from its own address.
> StudioCue requests two Google OAuth scopes:
>
> - **https://www.googleapis.com/auth/gmail.readonly** — StudioCue is
>   notified when new mail arrives and reads the sender, subject and date of
>   each new message to decide whether it looks like an inquiry. Only
>   messages from an inquiry source (a website-builder form notification, a
>   wedding marketplace, or a sender the studio has confirmed) are read in
>   full. On first connection, StudioCue does the same for the previous 30
>   days.
> - **https://www.googleapis.com/auth/gmail.send** — StudioCue sends a reply
>   to a lead from the studio's own address, only when someone at the studio
>   approves that specific reply.
>
> **What is kept.** For a message turned into a lead, StudioCue keeps the
> sender's name and address, the subject, date and text of the message, the
> details read from it, and its Gmail message identifier. A message
> StudioCue is unsure about is held for the studio to confirm for up to 14
> days, then deleted. Every other message is discarded once checked; its
> contents are not stored. StudioCue also stores the OAuth tokens for the
> connection in managed secret storage, never in the browser.
>
> **How it is used.** Gmail data is used only to create and update that
> studio's leads and to send the replies it approves. It is not sold, used
> for advertising, shared with other customers, or used to train or improve
> any artificial-intelligence or machine-learning model. StudioCue staff do
> not read it except with the studio's consent for support, for security, or
> where the law requires.
>
> **AI processing.** To recognize inquiries, read their details and draft a
> reply, StudioCue sends candidate messages to Google's Gemini models on
> Google Vertex AI, running in StudioCue's own Google Cloud project. No other
> AI provider receives Gmail data, and Vertex AI does not use it to train
> models.
>
> **Stopping and removing access.** Disconnecting Gmail in StudioCue stops
> all reading and sending and deletes the stored tokens. Leads already
> created stay in StudioCue as the studio's records until the studio deletes
> them. Revoking StudioCue from the Google Account permissions page ends
> access from Google's side.

## 5. Privacy policy — edits to "AI features and Limited Use"

The Limited Use sentence already there covers Gmail and can stay as it is.
Two sentences become false once Gmail ships and must change in the same
release:

- Replace "Data obtained from the Google Calendar API is not sent to these
  features at all: they operate on …" with:
  > Data obtained from the Google Calendar API is not sent to these
  > features. Messages from a connected Gmail account are, only as
  > described under "Email connections": to recognize an inquiry, read its
  > details and draft a reply.
- Add after the Limited Use sentence:
  > The use of information received from Gmail APIs will adhere to the
  > Google API Services User Data Policy, including the Limited Use
  > requirements.

Google's August 22 AI/ML questions will come back for Gmail. Last time the
answer was "Calendar data never reaches AI". This time it is "Gmail data
does reach Gemini on Vertex AI in our own project, and is not used for
training". The reply should name the model generation that's actually live
(Gemini 2.5 retires 2026-10-16).

## 6. Demo video shot list (Gmail, for when the feature is built)

Record in a **separate test project or a hidden staging route**, not
production traffic. The console warns that unverified scopes on prod traffic
disrupt users and use up the 100-user lifetime cap (1 already used). Upload
it to YouTube as **Unlisted**, and keep it in English.

1. studio-cue.com homepage, then sign in as a studio owner.
2. Settings → Integrations → **Connect Gmail**. Explain on screen what it's
   for.
3. The Google consent screen. Hold on the address bar long enough to read
   `client_id=988256939236-…` and both scopes, then expand the permission
   details. Show the "unverified app" screen if it appears; Google expects
   it.
4. Back in StudioCue, it shows as connected.
5. **gmail.readonly:** from another account, submit the studio's website
   contact form. The notification lands in Gmail, and a new-inquiry card
   appears in Today with the parsed fields. Caption: "headers checked, body
   read only for inquiry sources, nothing else stored."
6. Send an ordinary non-inquiry email to the same inbox. It doesn't appear
   in StudioCue. Caption that it was discarded.
7. **gmail.send:** open the inquiry, edit the drafted reply, click
   **Send**. Show it in the studio's Gmail Sent folder and in the client's
   inbox, from the studio's address.
8. Settings → Integrations → **Disconnect Gmail**, then the Google Account
   permissions page showing access removed.
9. The privacy policy's "Email connections" section, on screen.

## 7. CASA (security assessment)

- **Required** for `gmail.readonly` (restricted, server-side access).
  `gmail.send` alone wouldn't need it. Google requests it after the
  restricted-scope submission, and it is renewed every 12 months.
- **Changed since the brief:** the App Defense Alliance replaced Tiers 1–3
  with **Assurance Levels AL1 and AL2** (appdefensealliance.dev/casa,
  updated 2026-06-27). Tier 1 is gone. Google assigns the level. Small apps
  usually get AL1, the old Tier 2, but Google doesn't publish that.
- **Google charges nothing.** You pay the lab.

| Lab | Published price | Notes |
|---|---|---|
| TAC Security | **$675/yr** Basic AL1 (list $1,800), 2 re-scans. $855 Premium, unlimited re-scans. AL2 $5,400 | Cheapest. Prices are published and you buy through casa.tacsecurity.com. There's no separate quote step, so nothing was requested. About 2–3 weeks to the Letter of Validation |
| Leviathan | AL1 $3,000 / $4,500 / $6,000 (start in 30 / 10 / 2 days), one re-test | Contact form for anything custom |
| Eydle | AL1 $1,000–3,000 (general range) | Intake form |
| Bishop Fox, DEKRA, NCC, NetSentries, Prescient, ValueMentor | Not published | Sales contact |

The "$540" figure in the brief is out of date. The cheapest current
published price is $675.

**What the lab needs from us:**
- the app URL;
- a test studio login;
- the Gmail scopes;
- a data-flow diagram;
- a SAST scan: TAC accepts a locally run Fluid Attacks CSV instead of
  uploading source;
- a DAST scan against the app;
- a self-assessment questionnaire, which is about 1–2 days of work;
- fixes for anything they find, then a re-scan.

**Timeline:** Google's restricted review is quoted at "several weeks" to 6
weeks. CASA (about 2–3 weeks) runs inside that once Google asks for it.
Plan on **6–10 weeks** from submission to approval.

## 8. Does the plan still hold?

Yes, with these changes:

- **Calendar verification isn't a "now" step. It's done** (approved
  2026-08-25). There's nothing to submit, and resubmitting would only
  restart a review.
- **Gmail goes on the same app later, as planned.** It's a new verification
  request. Approved Calendar access keeps working while it's reviewed, as
  long as production never requests the Gmail scopes before approval. Use
  **incremental authorization**: request Gmail only from "Connect Gmail",
  never from the Calendar connect.
- **Any consent-screen edit triggers review.** Changing the support email to
  support@studio-cue.com (it's currently conor@flawlessiq.com) would reopen
  brand review. Make that change in the same submission as Gmail, not
  separately. The dropdown only offers the signed-in user's addresses and
  Google Groups they manage, so support@studio-cue.com has to be a Group you
  manage, or you add it by signing in as that account.
- **CASA naming and pricing have changed** (see section 7).
- **The AI answer has changed** (see section 5). Calendar data never reached
  Gemini; Gmail data will.
