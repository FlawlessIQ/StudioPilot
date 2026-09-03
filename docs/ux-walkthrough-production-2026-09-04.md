# Production click-through — findings

Walked on **studio-cue.com** from **2026-09-04**, following
`docs/production-click-through-plan-2026-09-04.md`. Production is live: real
Stripe (`sk_live_`), real SendGrid, real data.

Findings are gathered here as they are met and **not fixed until the walk is
complete**, per the plan. Each carries the plan step it was found at, the
pattern from `docs/ux-walkthrough-2026-09-02.md`, and blocks / doubt / friction.
A repeat of a fixed finding is marked **REGRESSION** and jumps the queue.
Anything a guard should have caught is marked **GUARD GAP**.

## Identities

| Role | Email | Studio / slug |
|---|---|---|
| Studio owner | conor+studio@flawlessiq.com | Harbour Light Photography · slug `harbour-light` (throwaway; delete after) |
| The couple | conor+couple@flawlessiq.com | — |
| Second shooter | conor@ad-helm.com — **not readable by me; Conor confirms crew emails** | — |

Studio owner password: `Walk-yRf6rMSeFGKeTH!` (throwaway production account — this repo is
private; rotate or delete the tenant when the walk is done).

Decisions: Stripe A7 via a **100%-off coupon** Conor creates in the live
dashboard beforehand; I pause at checkout. QuickBooks **connected** to a
sandbox company in B6 — Conor does the OAuth.

## Email log

Ticked as each arrives, with the time triggered and the time seen.

| Key | Step | Triggered | Seen | Notes |
|---|---|---|---|---|
| `email_verification` | A2 | 17:08:31Z | — | **Never sent** — App Check 403 in the automation browser (P2). |
| `password_reset` | H6 (run early, as the A2 recovery) | 17:20:32Z | 17:20:45Z | 13s. From `studio@studio-cue.com`, subject "Reset your StudioCue password". Sent from real Chrome; the automation pane could not send it (P2). |

## Findings

### P1 · Register form marks nothing as required · A1 · #8 · friction
All three fields (`name`, `email`, `password`) carry the `required` attribute
and none carries a visible mark. Same class as A7 (the package form); the
project form two clicks later does mark its fields. Low — every field is
required so there is nothing to distinguish — but it is the first form a new
studio meets and it sets the convention.

**Also checked at A1, holding:** `/start-trial` → 307 → `/auth/register`; copy
reads "own private studio", no "tenant"; App Check loads with no console
errors on production.


### P2 · One refused App Check exchange silences every command for a day, and the register screen says "sent" and "could not send" together · A2 · #5 · blocker-class (harness-triggered, product-owned)
Registering `conor+studio@flawlessiq.com` at 17:08:31Z created the Auth user
(17:08:40Z, `emailVerified: false`) and then showed, on one screen: "Check your
email · We sent a verification link to conor+studio@flawlessiq.com. Your
account was created, but we could not send the verification email." Nothing
arrived. No request ever reached the relay or `authEmailCommand`; no
`authEmailRequests`/`emailJobs` record exists for the address.

**Cause, from the console:** the App Check exchange returned **403** at
17:08:40Z (`appCheck/initial-throttle`), `getAppCheckToken()` threw before the
`fetch`, and `register-form.tsx`'s bare `catch` set state `"sent"` with the
failure message — so the "We sent…" heading from the success branch rendered
over "we could not send". The SDK then self-throttled for **24h**
(`appCheck/throttled`, still counting down at 17:16Z).

**What the 403 was, and was not.** Site key, app ID, Enterprise registration,
allowed domains (`studio-cue.com` listed), API enablement, and the grecaptcha
script all check out; a browser-origin command succeeded on prod at
2026-09-02T16:37Z and nothing in the bundle or headers changed since. The same
exchange from the shell with a bogus token returns the identical `"App
attestation failed."` — a *token* rejection — and reCAPTCHA's own metrics show
every prior assessment in the human buckets. Then the product's own recovery,
"Forgot password?" for the same address from an **established Chrome profile**,
went end-to-end at 17:20:32Z (relay 202, function 202, `emailJobs
password_reset succeeded`). Conclusion: reCAPTCHA Enterprise refused the
automation browser's token. Real studios are not locked out today.

**Why it is still a finding — three things the product owns:**
1. **36 browser callers** use `getAppCheckToken()`, which throws; only
   `getOptionalAppCheckToken` degrades. After one refused exchange the SDK
   throttles for 24h, so *every* command — register, sign-in email, proposals,
   crew, billing — fails from that browser for a day, and each caller
   improvises its own message. A studio on a flagged network (VPN, corporate
   proxy, a locked-down browser) hits exactly this with no route out and no
   sentence that says "your browser could not be verified — try another
   browser or network".
2. **Three callers swallow the error with a bare `catch`** —
   `register-form.tsx`, `forgot-password-form.tsx:43`,
   `accept-client-invitation.tsx:217`. The forgot-password one is deliberate
   (does not reveal whether an account exists) and fine; the register one
   reuses the success state and produces the contradiction above.
3. **The register failure copy points at "Forgot password?"** as the recovery
   for an unverified *new* account — a reset link does not verify an email,
   and the same throttled browser cannot send it anyway.

Verify-email → resend path: not yet exercised (needs a signed-in session).

**Regression check:** A2's fix (`59b31fa`, "your account was created" is
stated) held; what regressed is nothing — this branch was never walked on
production before.

### P3 · The platform's own account mail is dressed as a tenant's client mail · H6 · #5/#3 · friction
`password_reset` to the studio owner reads, top to bottom: "StudioCue · Powered
by StudioCue" — a "Client operations powered by StudioCue" strap (HTML) — "Hi
Conor, We received a request to reset the password for your StudioCue
account." — "Sent by StudioCue using StudioCue." A studio owner is not a
client, and a product powered by itself is the branding template's
`${studioName} … ${platform}` pair rendered with both slots set to StudioCue.
Auth mail (verification, reset, invitations before a tenant exists) needs a
platform voice, not the tenant one with the platform's name pasted in twice.

Also noted: the reset link is a SendGrid click-tracked URL
(`u57073990.ct.sendgrid.net/ls/click?upn=…`), not `studio-cue.com`. For a
one-time security link that reads as phishing-shaped to a careful person and
to some mail gateways, and gateways that pre-fetch links can consume it. Turn
click-tracking off for the auth templates.

Delivery itself: 13s, inbox, `IMPORTANT`. Sender `studio@studio-cue.com`.

### P4 · A studio owner whose verification mail never came has no way to ask for another · A3 · #4 · wall
`emailVerification` is sent from exactly two places: the register form and the
client-invitation acceptance (which has a "Resend verification email" button
for couples). There is no resend for a studio owner. After sign-in, the
onboarding form throws "Verify your email before creating a studio." and
offers nothing — no button, no link, no "we can send it again". Combined with
P2 (the first send can fail silently) the state is reachable on the first
minute of a trial and has no route out except the Firebase-default email or
support. The register failure copy sends them to "Forgot password?", which
does not verify an email.

**Seen as the owner sees it (17:3xZ, real Chrome):** sign-in succeeded and
landed on `/auth/onboarding` with no mention of the unverified email. Filling
the form and pressing "Start 14-day trial" produced one status box, "Verify
your email before creating a studio." — no resend, no link, no "sent to
<address>", no "check spam". The form stays filled and the button stays live,
so the natural next move is to press it again. Dead end on minute one.

**Bypass used (logged per plan §escape hatches):** `generateEmailVerificationLink`
via the Admin SDK, opened in the same browser. A real owner has no equivalent.

Where I stopped before the bypass: the throwaway owner is in exactly this state
(`emailVerified: false`, no mail). Next is a signed-in session so the wall is
seen as an owner sees it, then either a product route (none found in code) or
the admin-minted link, logged as a bypass per the plan.

### P5 · The verified screen thinks every new account was invited, and sends a signed-in owner back to sign-in · A3 · #5/#4 · friction
`/auth/verify-email` verified the code and said: "Email verified · Your
StudioCue account can now access its invited workspace or portal." A new
studio owner has no invitation, workspace or portal yet — the sentence is the
couple's/crew's. The only control is "Continue to sign in" →
`/auth/login?verified=1`, offered to a user who is already signed in in this
tab, while the link's `continueUrl` (`/auth/onboarding`) is ignored. The
owner's next step is the form they were just bounced from; the page should
say so and go there.
**Then:** `/auth/login?verified=1` rendered the plain sign-in form — no
"verified, sign in to continue" line (nothing reads the flag), and no use of
the session that was still alive: navigating by hand to `/auth/onboarding`
showed the form again, with my entries gone. An owner who obeys the screen
types their password a second time for nothing.

### P6 · "Sign in with your verified account first" for a session that is signed in · A4 · #5 · friction
Second submit of "Create your workspace", session alive (`/studio` was
redirecting to onboarding, which only a signed-in no-tenant user gets),
produced: "Sign in with your verified account first." `onboarding-form.tsx`
reads `auth.currentUser` **synchronously** at submit; on a fresh page load
Firebase restores the session asynchronously, so a submit that lands before
the restore sees `null` and the owner is told to sign in when they already
are. The sentence then sends them to do something that will not change
anything. The page has no auth gate of its own to wait on. Read the user from
the auth listener (or await `authStateReady()`), and if there truly is no
session, say "Your session ended — sign in again" rather than implying the
account is unverified.

### P7 · Workspace created, screen unchanged · A4 · #5/#4 · friction (double-submit risk)
"Start 14-day trial" succeeded (relay 200 → `tenantOnboardingCommand`
17:33:06Z, tenant + `studio_owner` membership, subscription `trialing` to
2026-09-17). The form then cleared and sat there — no redirect, no "Walk Studio
is ready", button live again. `onboarding-form.tsx` does `router.push("/studio")`,
so `/studio` must have bounced the brand-new tenant straight back to
`/auth/onboarding` (membership not yet visible to the boundary), which re-rendered
the empty form. Ten seconds later a hand navigation to `/studio` landed on Today.
An owner who sees the form again will press the button again; whether a
second `tenantOnboardingCommand` creates a second studio for the same user is
**not yet tested** — queued for the edits phase.

**A4 notes:** timezone is a fixed list of six (New York, Chicago, Denver, Los
Angeles, London, Sydney) — no Dublin, Paris, Toronto, Auckland; currency five.
Fields carry no required marks (see P1). The placeholder studio name "Alder &
Muse Photography" is the marketing testimonial's studio, which reads as a real
example rather than a hint — fine.

**A5 · Setup checklist, holding:** four questions, "1 of 4 answered", the
inquiry form already live with a preview link (`/inquiry?studio=walk-studio-928697cf`).
Two nits: the sidebar lights "Library" while on `/studio/setup`, and the tab
title is the generic "StudioCue · Photography Operations OS" where Today's is
"Today · StudioCue".
**A4 addendum:** Studio settings offers thirteen timezones (adds Phoenix,
Anchorage, Honolulu, Toronto, Vancouver, Dublin, Paris); onboarding offered
six. Same field, two lists — an Irish or Canadian studio picks the wrong one
at signup and finds the right one only if they open settings.

**A5 · email:** nothing arrived after the workspace was created, and nothing
exists to arrive — there is no welcome / trial-started template. Decision to
make: a "Walk Studio is ready — here is your inquiry link, and your trial ends
17 September" mail is the one message a new owner would keep. Logged as a
gap, not a defect.

### P8 · Subscription page speaks in tokens · A6 · #5 · friction
Header badge: "trialing · studio" — the Stripe status enum and the plan slug,
verbatim, to a studio owner. Should read "Free trial · Studio plan · ends
17 September".
**P8 addendum — no trial end date, anywhere.** The subscription page never
says when the trial ends; the components read no `trialEnd`/`currentPeriodEnd`
at all. The only date-bearing sentence on the page is Stripe's. The plan's
A6 check ("exactly 14 days from A5, in your timezone") cannot be made — the
number the owner most wants is absent. The four plan buttons are labelled by
product ("Studio monthly") rather than action ("Choose Studio monthly"); with
"Current" on the Studio card, "Studio monthly" under it reads as a status,
not a button.

**A7 · Checkout reached.** "Studio monthly" → live Stripe Checkout
(`cs_live_…`) in ~3s. Price and relay are configured. Stopped on Stripe's page;
no card entered by me.

### P9 · Stripe Checkout is branded "FlawlessIQ" · A7 · #5 · trust
Tab title "FlawlessIQ"; "By subscribing, you authorize **FlawlessIQ** to
charge you"; Link "Pay securely at FlawlessIQ". The Stripe account's public
business name is the parent company's, so the first money screen a studio
sees names a company they have never heard of. Stripe Dashboard → Settings →
Public details (name, and ideally a StudioCue statement descriptor and icon).
Not a code change, but it blocks a real launch.

### P10 · Checkout restarts the trial instead of honouring it · A7 · #3 · logic
Stripe's page: "14 days free · Then $250.00 per month starting September 17,
2026" — 14 days from *now*, because `buildStripeCheckoutParams` sends a fixed
`subscription_data[trial_period_days]` (`STRIPE_TRIAL_PERIOD_DAYS`) rather
than `subscription_data[trial_end]` = the tenant's `currentPeriodEnd`. Today
it coincides (workspace and checkout are 20 minutes apart). An owner who adds
a card on day 10 gets 24 free days and the in-app "trial ends" (were it shown,
P8) and Stripe's date disagree. Reverse case: an owner whose trial has
*expired* still gets 14 free days at checkout.

### P11 · Checkout does not know who is paying · A7 · #4 · friction
Email field empty — no `customer_email`/`customer` on the session for a
trialing tenant (no Stripe customer yet). The owner retypes the address
StudioCue already verified. Also offered as payment methods for a $250/month
SaaS subscription: Cash App Pay and Klarna — a Stripe Dashboard setting worth
trimming to card + Link + Apple/Google Pay.

**Coupon decision, revised:** Checkout has no promotion-code field
(`allow_promotion_codes` is not set) and the session carries no `discounts`,
so the 100%-off coupon cannot be applied here. It is also unnecessary: the
session starts a 14-day trial, so a card is collected and nothing is charged
until 17 September.

## Phase B · Setup

**B1 · Packages, holding:** all eleven fields carry a visible "Required" mark;
retainer 1000% is refused by the browser before submit (`max=100`, native
popover; nothing reached the server). Defaults are sensible (30%, 8 hours, 2
photographers, "Within 50 miles"). One nit: the refusal is the browser's
transient popover, so a submit from the bottom of a long form silently jumps
back up to the field with no persistent message.
**B1 · created:** "Full Day Wedding is ready · Clients can now be offered this
package in proposals" with a "View packages" button — a success screen that
says what changed and what to do next. Terms field ships a real default
("Subject to the completed studio agreement."), not a placeholder.
**B2 · Questionnaires, holding:** Wedding (20 fields), Corporate (14), Sports
(12), all `active` for a brand-new studio. Nits: the sidebar lights "Jobs"
while on `/studio/questionnaires` (it is reached from Library), and the tab
title is the generic product name.
**B3 · Availability, holding:** Mon–Fri 09:00–17:00 at 45 minutes ships as
the default; "Save availability" → "Consultation availability saved. Clients
booking a consultation will see these windows." Saturday/Sunday "Closed" with
an add link; "Block a specific date" present.
**B4 · Event-day phone, holding:** field present with its purpose under it
("Shown to crew on their event-day brief… Never shown to clients");
"Save studio details" → "Studio details saved." Server: see below.
Server after B3/B4: `eventDayPhone` = the typed number; audit events for the
tenant now read `tenant.created, package.created, tenant.identity_updated,
consultation.settings_updated`. (Earlier "auditEvents (empty)" in my notes was
my query ordering on a field the records lack — not a finding.)

**B5 · Integrations, first read:** Google Calendar, Zoom, Dropbox each "Ready
to connect · Connect" with a one-line purpose and the areas they feed; a
"Protected connection details" panel says sign-in details are encrypted and
never shown. OAuth consent is Conor's to grant — parked.

**B6 · QuickBooks — decision was "connect it" (sandbox).** OAuth consent is
Conor's to grant; parked with B5. Until then the "Invoicing & payment"
capability row reads "Connect a provider to enable this", which is the honest
empty state.
**B7 · Agreement template, holding (A25 regression check passed):** the
section leads with "No signing app is connected, so StudioCue does not send
agreements for you. Send your own and record the signature on each booking."
No "choose your agreement first / paste a template ID" block. Capability
routing lists Document signing, Invoicing & payment, Calendar, Video meetings,
File storage — each "Connect a provider to enable this" with a plain
one-liner. Honest empty state throughout.

**Parked for Conor (OAuth — I cannot enter credentials or grant consent):**
- **B5** Google Calendar + Zoom → Connect → OAuth, land back on Integrations "connected".
- **B6** QuickBooks → Connect → OAuth against the sandbox company.
Each is one "Connect" button on `/studio/integrations` (Google Calendar,
Zoom, then QuickBooks Online lower down). Any error copy on the callback is a
new error-copy finding.

**A7 · confirmed after checkout.** Card entered by Conor; subscription now
carries real Stripe IDs (`sub_…`, `cus_…`), status `trialing` (correct for a
trial with a card on file — the plan's "active" expectation was wrong; active
comes at trial end). The billing panel switched from "no billing to manage
yet" to **"Open customer portal"** — `createPortal` is wired.

### P8 (confirmed, persists after checkout) · No status detail even with a card
After checkout the header badge is still "trialing · studio", there is still
no trial-end date, and no "Current plan · Studio monthly · renews 17 September"
summary. The Studio card shows "Current" yet the four plan buttons ("Studio
monthly/annual", "Multi-Brand monthly/annual") remain live and unmarked, so an
owner who just paid still sees four buy buttons with no indication which one
they are on or when the trial converts.

**A7 · billing portal opened (createPortal verified).** Stripe's portal is
correct and complete: "Free trial ends Sep 17 · StudioCue Studio · $250.00 per
month · After your free trial ends on September 17, 2026, this service will
continue automatically," Mastercard on file, invoice history "Sep 3 · $0.00 ·
Paid" (trial, no charge). This is the reinforcement for P8: the trial-end date
StudioCue's own page hides is right here on the Stripe object as
`trial_end`/`current_period_end` — the app just does not read it. Portal tab is
branded "FlawlessIQ Billing" with "Return to FlawlessIQ" (P9 extends to the
portal). A8 (change cadence, watch `stripeWebhook` update the record) left for
Conor — it is a real subscription change; not mine to make.

## Phase C · Inquiry & consultation

**C1 · Inquiry submitted (public form), holding well.** `/inquiry?studio=<slug>`
is a genuinely good page: "WALK STUDIO · Let's make something worth
remembering", "Human reviewed", "Private by default", a live Places
autocomplete on Venue (works on the public page — App Check degrades
gracefully), a budget range, a bot-honeypot "Website" field, and a real
consent checkbox. On submit: "Inquiry received · Thank you. We'll be in touch
shortly. Your confirmation code is B708A9." Tab title is specific
("Photography inquiry · Walk Studio · StudioCue"), unlike the app's generic
titles.
**C2 · Acknowledgement email arrived (~1 min).** "Walk Studio received your
inquiry · Hi Maya, Walk Studio received your inquiry and will…" from
studio@studio-cue.com, branded "Walk Studio · Client operations powered by
StudioCue" — the correct tenant/platform pairing (contrast P3, where the same
strap named StudioCue twice because the sender *was* the platform). (Correction: an earlier note here claimed the acknowledgement was not in the
tenant's `emailJobs`; that was a bug in my query. It *is* tracked —
`inquiry_acknowledgement`, status `succeeded` — as is the reply
(`manual_message`).)
**C3 · Lead created:** one lead, Maya Ellison, status `new`, correct email.
Studio-side view: below.
**C3 · Studio-side, holding well (the north star working).** Today led with
"New inquiry — Maya Ellison · The Glasshouse, Montclair NJ · arrived today ·
Review & reply", plus a "Prepared for you · Reply to Maya Ellison · StudioCue
prepared this — you decide" card with Approve / Read it — AI prepares, human
approves. Lead detail: contact, event (Oct 24, venue, $8,000–$12,000,
Instagram), with Convert to project / Email client (mailto) / Call client
(tel). Confirmation code B708A9 is the lead id's tail
(`…a87d3fb708a9`), not a separate field — my earlier "confirmationCode
undefined" was a field-name mismatch, not a defect.

**Still parked for Conor:** B5 (Google Calendar + Zoom) and B6 (QuickBooks)
OAuth — `integrationConnections` still 0. C4 (book a consultation) is walkable
without them, but the Zoom meeting-link step needs B5. A8 (change cadence in
the Stripe portal, watch the webhook) also awaits Conor.

### P12 · A declined OAuth is reported as a broken one, and the provider is lost · B5 · #5 (new error-copy) · blocker for that provider
Connecting Google Calendar failed with the banner "The provider did not return
a valid authorization result. Start the connection again." Logs show Google
returned `?error=access_denied&state=…` (no `code`). The callback
(`functions/src/integrations/oauth.ts:503-505`) reads only `state` and `code`
and throws `OAUTH_CALLBACK_INVALID` when either is missing — it never inspects
`request.query.error`. Consequences:
1. **Wrong meaning.** `access_denied` is a *valid* provider response (consent
   declined, or the studio's Google account is not permitted for this OAuth
   app yet). The copy says the provider "did not return a valid authorization
   result" — the opposite of what happened — and tells the user to "start
   again", which loops if the cause is app config.
2. **Provider lost.** It throws before parsing `state`→`provider` (line 515),
   so `integration_oauth_failed` logs `provider: null, tenantId: null`. The
   `state` doc could resolve both; the handler should read the error, look up
   `state`, name the provider, and map `access_denied` to an actionable line
   ("Google didn't grant access — you may have declined, or this studio's
   Google account isn't allowed for this app yet. Check with your admin.").
This is the error-copy class the guard baselined on this route (4 codes);
`OAUTH_CALLBACK_INVALID` is being overloaded to cover a case it should not.

**Root cause of the denial (Conor's side, not code):** almost certainly the
Google Cloud OAuth consent screen is in *Testing* mode / unverified for the
Calendar scope, so the Google account used is not an allowed test user. Fix is
in Google Cloud console (add the account as a test user, or publish/verify the
app) — separate from the P12 handling bug.

**B5/B6 · Zoom + QuickBooks connected.** Both `integrationConnections`
`connected`. Consultation meeting links (Zoom) will work; Google Calendar sync
will not until the above is resolved. **CAUTION — QuickBooks connected to
Conor's LIVE company, not a sandbox** (a `realmId` is present). Invoice steps
in D/E would create *real* invoices there — either point QuickBooks at a
sandbox before D5/E9, or expect and then void real invoices. Flagged so we do
not silently bill through a live book.

### P13 · The "personalized" reply is not personalized, and leaks a raw placeholder · C2 · #5/#3 · quality (client-facing)
The AI-prepared inquiry reply (card titled "Personalized inquiry reply") is
strong in the body — it correctly names Oct 24, The Glasshouse in Montclair,
two shooters, candid family moments, the relaxed warm feel, late-afternoon
ceremony into evening reception, and invents no pricing/availability
("Grounded in the original inquiry"). But:
1. **Salutation:** opens "Dear Client," when the couple's names (Maya /
   Daniel) are on the same record and in the header. A "personalized" reply
   that will not say "Dear Maya" undercuts the feature's whole promise.
2. **Unfilled placeholder ships to the client:** it signs off "Warmly,
   **[Studio Name]**" — a literal template token, not "Walk Studio". Approving
   from Today ("Approve", one tap) would send "[Studio Name]" to the couple.
   AI/template output that reaches a client must never contain a raw slot; the
   studio name is known.
The Today card offers only Approve / Hide (no inline edit), so the fast path
sends the placeholder as-is; editing exists only via "Review, edit, or
approve" → `/studio/ai-queue`. Good adjacent work: "Before the consultation ·
The essential intake details are complete" and three specific, well-grounded
"Suggested questions".
**C2 · AI reply reviewed, edited, sent — the edit path works.** AI queue
("Prepared for you. Never decided for you.") offered Approve / Edit first /
Reject / Snooze / Dismiss at 93% confidence, with "Why StudioCue prepared
this". "Edit first" made subject and body editable; I corrected the P13
defects ("Dear Client"→"Dear Maya and Daniel", "[Studio Name]"→"Walk Studio"),
approved, then "Send reply now". The couple received it 18:52Z reading exactly
the edited text, branded "Walk Studio · powered by StudioCue" — so studio edits
persist through the send, not just the preview. Two-step is clear: Approve
creates the draft ("Approving runs create communication draft"), "Send reply
now" dispatches. Note: the lead status stayed `new` after the reply (did not
advance to a "replied/contacted" state) — plan expected the journey's "first
reply" to complete; to re-check on the studio view below.

## Phase C · consultation (cont.)

**C4 · Consultation booked (studio-side), Zoom works, calendar degrades
honestly.** From the project's "Schedule consultation" next-move, the studio
calendar offered availability-derived 45-min slots. Booking dialog pre-selected
the project and Zoom, and stated the truth: "Nothing is connected to put events
on your calendar… Connect Google Calendar" while "StudioCue will create meeting
links through Zoom." Booked Sept 4 10:00 ET; the record has a real Zoom join URL
(`us05web.zoom.us/j/…`), status `scheduled`, and the calendar footer reads
"Live calendar sync is unavailable right now — only internal bookings are
shown." Zoom integration verified end-to-end.

### P14 · A studio-booked consultation tells the client nothing · C4 · #4 · wall (client-facing)
When the studio books the consultation on the couple's behalf, **no
confirmation email is sent** — the tenant's `emailJobs` holds only
`inquiry_acknowledgement` and `manual_message`; there is no
`consultation_confirmation`. The record carries `reminderJobIds` (reminders may
fire later) but nothing at booking time tells the couple *when* the
consultation is or gives them the Zoom link. With Google Calendar disconnected
(P12) there is also no calendar invite. Net: a couple has a Sept 4 10:00 Zoom
call they will never know about. The `consultation_confirmation` template
exists and the self-book path (`public-scheduling.ts`) sends it — the
studio-direct booking path skips it. Booking someone a meeting must notify
them; send `consultation_confirmation` (time, timezone, join URL) on
studio-side booking too.
**C5 · Journey advanced on booking.** Booking the consultation moved the job to
"Talking" and checked Enquiry 3/3 (Inquiry received, First reply, Consultation);
next move is "Prepare proposal". A separate "complete with notes ≥20 chars" step
(plan C5) was not required — the booked consultation satisfied the Consultation
checkpoint. "Log a call" tab is available on the project for notes.

## Phase D · Proposal & booking

**D1 · Proposal built, holding well.** Builder leads with "The price you send
is the price they see" and "Price locked · Changing your package later won't
alter a proposal you have already sent" (the anti-drift language). Locked the
Full Day Wedding package ($4,500; retainer prefilled $1,350 = 30%; tax $0).
"Draft from the consultation" (AI) produced correctly personalized copy: "Dear
Maya Ellison, We are thrilled to present this proposal for your wedding
photography at The Glasshouse in Montclair, NJ on October 24, 2026…" — note it
got the name right, unlike the inquiry-reply drafter (P13), so P13 is specific
to that one drafter. Timing had sensible defaults (expires Sep 10, final
balance Oct 10). "Creating a draft does not notify the client. Approval is
required before sending."
**D2 · PDF built (cloud-run).** "Approve this proposal" → V1 preserved →
"Generating branded PDF" → "Branded PDF ready · Stored privately until this
proposal is sent" with an "Open PDF" link (real Firebase Storage URL). Right
rail honest: "Nothing is connected to send the agreement for signature… record
the signature on the booking" and "StudioCue will save and track invoices
through QuickBooks". Job link in the heading at every status (A17 holds).
**D3 · Proposal sent.** Status Sent, "Viewed · Not yet". Email arrived 19:01Z:
"Your proposal from Walk Studio · Powered by StudioCue", with the branded PDF
attached (`maya-ellison-wedding-proposal-v1.pdf`), a portal "Review proposal"
link, and "Accepting a proposal does not sign a contract or collect a payment.
Those steps remain separate." Correct branding and disclosure. (The portal link
is SendGrid click-tracked, same as P3.)

## Parked — needs a decision before continuing
- **D4a (couple accepts)** requires acting as the couple. The portal link
  authenticates `conor+couple@flawlessiq.com`; opening it in the owner's signed-in
  Chrome would switch identity there. Cleaner for Conor to open it, or accept
  that the owner session is replaced and re-signed after.
- **D6 (retainer invoice)** would create a **real invoice in Conor's live
  QuickBooks** (P-note: connected live, not sandbox). Do not run D6 until that
  is either pointed at a sandbox or explicitly accepted.

**D4a · Couple accepted (Conor opened the portal link).** Proposal went
sent → viewed → accepted; studio side moved to "Awaiting signature", journey
5/15, "Maya accepted the proposal" in job history.
**D5 · Signed agreement recorded (A25/A26/A27 all hold).** Contract page led
with "StudioCue has no signing app connected, so you send the agreement
yourself and record the signature here." Recorded (Maya Ellison, 2026-09-03,
"Signed PDF returned by email"). After: Contract "Signed", status "Signature
recorded against your name. The retainer is the next step." (advanced without
a reload — A26), evidence row "Signed elsewhere · recorded by you" (not a
hash — A27), project → "Awaiting deposit". Disclosure was clear: "records this
as your attestation, not a verified signature."

**D6 · Retainer invoice created in LIVE QuickBooks (per Conor's decision).**
"Create retainer invoice" queued a QuickBooks customer match + invoice; ~30s
later: Retainer "Sent", Amount $1,350.00, Balance $1,350.00, StudioCue invoice
no. SC-15F70B6D, QuickBooks `providerInvoiceId` **7**, banner "$1,350.00 still
owed · Due Sep 10 · Chase payment". Couple email arrived 19:27Z: "Retainer from
Walk Studio · Your retainer invoice is ready". **ACTION: Conor to void
QuickBooks invoice #7 in the live company.** Minor: the retainer-due shown is
Sep 10 (proposal expiry) though I set the proposal's retainer-due to Sep 20 —
the invoice due date did not follow the proposal field (worth a look, low
severity).

**D7 · Booking confirmed — the gate holds and copy is clean.** Recorded the
retainer paid (form disclosure: "does not mark it paid in QuickBooks — do that
there too, so the two agree"), which flipped Retainer → Paid and Booking →
"Ready to confirm". "Check and confirm" ("Nothing here can be talked into
skipping a step") → all three green (Signed / Paid / Confirmed), badge
**Booked**, message "Booking is confirmed · We're setting up the client portal,
the planning checklist, the calendar entry and the job folder — this takes a
minute. Nothing else is needed from you." No "project setup jobs" jargon (A29
holds).

### P15 · An optional provider (Dropbox) blocks post-booking setup and the client's booking confirmation · D7 · #? · P0 (production, integration-dependent)
The booking confirmed cleanly (badge Booked, `bookingCompletedAt` set, client
portal active), but **no `booking_confirmation` email reached the couple** —
the tenant's `emailJobs` holds only inquiry_acknowledgement, manual_message,
proposal_sent, retainer_invoice. Cause: the post-booking job
`providerJobs/booking_<projectId>` (type `complete_booking_side_effects`) has
ordered steps:
`["dropbox_folders", "production_calendar", "workflow", "checkpoints", "confirmation"]`
(`functions/src/booking/commands.ts:~1944`). **Dropbox is not connected**, so
step 1 throws `DROPBOX_NOT_CONNECTED`; `operationsTaskWorker` logs a
`studiocueOperationalError` and re-schedules — observed **4+ attempts retrying
every 30–60s since 19:33**, `status: retry_scheduled`, and it will keep
retrying. Dropbox / file storage is an **optional** provider (the Integrations
page shows File storage as "Connect a provider to enable this", not required),
yet the booking side-effects job hard-fails on it and never reaches the
`confirmation` step — so the single most reassuring client email in the whole
funnel ("you're booked") never sends. Also observed: `calendarEvents` = 0 (no
production calendar; Google Calendar is disconnected too, so that step would
also fail). `checkpoints` (12) and one `workflowRun` do exist, so some setup
ran, but the job as a whole never completes and the confirmation is stuck
behind the optional-provider failure.
**Fix direction:** each side-effect step must be independent and
non-fatal — an unconnected optional provider (file storage, calendar) should be
skipped with a note, never abort the job or block `confirmation`. Order the
client-facing confirmation so it cannot be gated by an optional integration,
and cap retries on a permanently-unsatisfiable precondition instead of looping
forever.
**Note:** this is exactly the class of bug a production walk exists to find —
invisible in the emulator/seed (no real providers) and invisible to the studio
(the UI said "Booked · Nothing else is needed from you" while the couple got
silence and a worker retried in a loop).
