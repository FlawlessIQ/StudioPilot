# Prompt: start Google OAuth verification for StudioCue

Copy everything below the line into the AI that will do this. It is written to
be self-contained. It expects to work in the Google Cloud Console in a browser
where Conor is signed in, with Conor available to approve anything that costs
money, is sent to Google, or changes a setting.

---

You are helping me (Conor Lawless, owner of FlawlessIQ, which makes StudioCue)
get StudioCue's Google OAuth app verified by Google. Work in the Google Cloud
Console where I'm signed in. Read and report before you change anything, and
ask me before any step that submits something to Google, costs money, or
changes a setting. Never enter or reveal passwords, keys or client secrets.

## What StudioCue is

StudioCue (https://studio-cue.com) is software for wedding and event
photography studios: inquiries, proposals, contracts, scheduling, crew and
delivery. Each studio connects its own Google account.

- **Google Cloud project:** `studiohub-prod` (project number `988256939236`).
  The OAuth client used for Google sign-in to studio calendars is the one whose
  client ID starts with `988256939236-`. Do **not** create a new OAuth client:
  studios' existing connections depend on this one.
- **App name on the consent screen:** StudioCue
- **Homepage:** https://studio-cue.com
- **Privacy policy:** https://studio-cue.com/privacy — it already contains a
  Google API Services User Data Policy / Limited Use statement and a "Google
  Calendar data" section describing the two scopes below.
- **Terms of service:** https://studio-cue.com/terms
- **Authorized domain:** `studio-cue.com`
- **OAuth redirect URI in use:** `https://studio-cue.com/api/integrations/oauth/callback` (don't change it)
- **Support and developer contact email:** support@studio-cue.com (check with me
  before changing whatever is currently set)

## What's true today (verify each)

- The app appears to be **published** ("In production"), not in Testing: a
  studio's Calendar connection from August 27 still refreshed on September 22,
  and Testing-mode tokens die after 7 days. Confirm on the **Audience** page.
- Our internal docs say the brand and Calendar scopes were **never submitted
  for verification**. Confirm on the **Verification Center** page.
- Scopes the app requests today (both "sensitive"):
  - `https://www.googleapis.com/auth/calendar.freebusy`: read free/busy
    intervals only, to offer clients consultation times when the studio is
    genuinely free.
  - `https://www.googleapis.com/auth/calendar.events.owned`: create, update and
    delete events on calendars the studio owns, so booked consultations and
    weddings appear on the studio's own calendar. We deliberately don't request
    `calendar.readonly` or `calendar.events`.

## What I want done

### Stage 1: now

1. **Report the current state.** Go to Google Auth Platform for `studiohub-prod`
   and tell me:
   - user type (External/Internal) and publishing status;
   - brand verification status;
   - the scopes listed on Data Access;
   - any pending action or rejection in the Verification Center;
   - any messages from Google Trust & Safety you can see;
   - whether `studio-cue.com` is verified in Google Search Console under an
     owner of this project.
2. **Fix gaps before submitting** (ask me first):
   - app logo (square, 120×120 px);
   - homepage, privacy and terms links;
   - authorized domain;
   - support email.
   If domain ownership isn't verified, walk me through Search Console
   verification for `studio-cue.com`. Don't change DNS yourself.
3. **Prepare the Calendar scope submission.**
   - Draft a justification for each scope from the descriptions above, in
     Google's format.
   - Draft a demo-video shot list: the OAuth consent screen with the client ID
     visible in the URL; connecting Google Calendar in StudioCue (Studio
     settings → Integrations); offering consultation times (free/busy); a booked
     consultation appearing on the studio's calendar; disconnecting.
   - I'll record it. It must be uploaded as an unlisted YouTube video.
4. **Show me the full submission, then submit it** only after I say yes: brand
   verification plus the two Calendar scopes.

### Stage 2: prepare, don't submit

We're building a feature that captures inquiries from a studio's own inbox, and
later replies from the studio's own address. It will need:

- `https://www.googleapis.com/auth/gmail.readonly` (**restricted**): watch the
  studio's inbox (`users.watch` via Pub/Sub, `history.list`) and read *only*
  inquiry-like messages, meaning website contact-form notifications and wedding
  marketplace inquiries, to turn them into leads. Everything that isn't turned
  into a lead is not stored.
- `https://www.googleapis.com/auth/gmail.send` (**sensitive**): send a reply
  to a lead from the studio's own address, only when the studio approves it.

Don't add these scopes to the consent screen yet. Google rejects scopes the app
can't yet demonstrate, and the feature isn't built. Instead:

5. **Draft the restricted-scope justification** for `gmail.readonly`: why no
   narrower scope works (every background read scope is restricted; the
   add-on scopes only read an open message), what's read, what's stored, and
   retention.
   Also draft the Limited Use statement and a new "Email connections" section
   for our privacy policy. Give me both as text; I'll publish them.
6. **Research CASA** (Cloud Application Security Assessment) for us:
   - current Google requirements and assurance levels;
   - which authorised labs offer the cheapest suitable assessment (TAC
     Security's AL1/Tier 2 package has been quoted at ~$540–$1,800/year);
   - what they need from us: scanner access, questionnaire, time;
   - realistic timeline.
   Get a quote if that can be done without committing us. **Don't pay for
   anything.**
7. **Confirm the plan still holds:** calendar verification now, restricted
   Gmail scopes added later to the same app, and CASA requested by Google
   after that submission. Flag anything that changed in Google's current docs.

## Don't

- Create, delete or rotate OAuth clients or secrets.
- Change redirect URIs or authorized JavaScript origins.
- Move the app back to Testing.
- Change the user type.
- Change IAM or billing.
- Add Gmail scopes.
- Submit anything to Google without my explicit yes.
- Pay for anything.

## Give me back

A short report:

1. What the console shows now.
2. What you changed (with my approval).
3. What's submitted and when to expect a response.
4. The drafts: Calendar scope justifications, video shot list, Gmail
   justification, privacy-policy text, CASA summary with quotes.
5. **What I need to do next**, as a numbered list.
