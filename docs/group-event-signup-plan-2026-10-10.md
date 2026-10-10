# Group event sign-up — plan (2026-10-10)

**Ask (Conor, 2026-10-10):** a studio runs a sports/cheer day where each parent
pays for their own athlete's photos, mostly in cash. The studio:

- sets 2–3 packages for the event;
- sends sign-up links ahead of time (email, text) and/or has a **QR code at the
  field** that parents scan, pick a package and sign up in under a minute;
- chooses which ways parents can pay: cash, check, Venmo, or online (its own
  pay link, or QuickBooks if it wants), configured per studio and per event.

This is Phase 2 of `docs/group-events-design-2026-10-04.md`. It answers Gabe's
open questions Q3 (payment on the day: mostly cash, studio's choice of
methods) and Q4 (assumed one sign-up per athlete; a parent with two athletes
signs up twice — see Decisions).

## Status (2026-10-10)

Conor's answers: texts go from the studio's own phone only; a QuickBooks
invoice per parent comes later; the owner, admins, coordinators and the crew
assigned to the event take payment; one sign-up per athlete; no tax on event
prices.

Phases 1–3, plus Phase 4's own pay link, are built in 75523baa:

- **Event packages and payment methods:** `project.groupEvent.signup`
  (features/group-events/signup.ts), set from the roster's sign-up panel. This
  uses crmCommand `setGroupEventSignup`, `resetGroupEventLink` and
  `inviteGroupEventParents`.
- **The parent's page:** `/e/{token}`, backed by the public route
  `app/api/public/event-signup`. Each parent's order is at
  `/e/order/{orderToken}`, which keeps working after the link is replaced. The
  confirmation email gives the confirmation number and how to pay, with a
  Venmo or pay-link button.
- **Sharing:**
  - a QR code on screen
  - a printable sign at `/studio/projects/{id}/sign`
  - copy link
  - email invites from a pasted list, sending each parent the same link only once
  - "Text from your phone", through the share sheet or Messages
- **Field mode:**
  - for the studio at `/studio/projects/{id}/field`, and for crew at
    `/crew/field?project=`
  - a full-screen QR, the live roster and two-tap payments
  - the day's totals by method
  - crew can read the roster of their own event and can only record a payment
- **Also fixed:** parent mail never falls back to the job's client home. That
  link is the organiser's portal or inquiry page, and the Phase 1 receipt used
  it when it had no button of its own.

Still to do:
- A QuickBooks invoice per parent (Phase 4b).
- Phase 5: delivery and review per parent.
- A walk on production with a FlawlessIQ test event. It sends real email, so it
  needs Conor's OK.

## What exists (Phase 1, live since 2026-10-04)

- `eventParticipants`: parent, email, phone, athlete, team, package name,
  amount, status (`unpaid` / `pay_on_day` / `paid` / `cancelled`) and the
  payment (amount, method `cash` / `card` / `online` / `other`, when, who).
- The roster on the job page (`components/group-events/participant-roster.tsx`)
  with **record payment** and a `participant_receipt` email.
- Commands through `crmCommand`: `setGroupEvent`, `addParticipant`,
  `updateParticipant`, `cancelParticipant`, `recordParticipantPayment`.

Not there: event packages, a public sign-up page, links/QR, texting (StudioCue
sends email only), parent-chosen payment methods, Venmo/check as methods.

## The design

### 1. Event setup (studio, on the job)
`project.groupEvent` gains:
- `options[]`: 2–3 (max 6) packages for this event: `{ id, name, priceCents,
  description }`. Start from a library package or type one in. Copied onto each
  sign-up as it's made, so a later price change never alters a parent's order.
- `payment.methods[]`: which ways parents may pay, chosen from the studio's
  list: `cash`, `check`, `venmo`, `zelle`, `pay_link` (the studio's own link
  from Settings → Invoices and payments), `quickbooks` (only offered when
  QuickBooks is connected; see Phase 4). Defaults to cash + check.
- `payment.venmoHandle` (or taken from the studio's payment instructions).
- `signup`: `open` / `closed`, optional `closesAt`, optional `capacity`.
- One shareable **sign-up link** per event, `/e/{token}` (token hashed at rest,
  like the inquiry `/i/` links; revocable).

### 2. The parent's sign-up (public, phone-first, no account)
`/e/{token}`: the studio's name and logo, the event (date, venue), then:
1. **Your details:** parent name, email, mobile; athlete's name, team (optional).
2. **Pick a package:** the 2–3 options as large tappable cards with price.
3. **How you'll pay:** only the studio's chosen methods.
   - *Cash / check:* "Pay at the field. Show this screen."
   - *Venmo:* a button that opens Venmo to the studio with the amount and a
     note ("Athlete: Ava, Gold"). No integration: the studio marks it paid.
   - *Zelle:* the studio's Zelle line from its payment instructions.
   - *Pay online:* the studio's own pay link (Square/PayPal), or the QuickBooks
     invoice (Phase 4).
4. **Done:** a confirmation screen with the order, the amount and how to pay, a
   **confirmation number** to show at the field, and the same by email.

The only athlete details collected are a name and a team (Phase 1's minors
rule: no birthdate, no child's contact details). Parents tick a consent line
linking the studio's terms and StudioCue's privacy policy. The server creates
the `eventParticipant` (`source: "signup_link"`, status `unpaid`, or
`pay_on_day` for cash/check) with the chosen option and method. Each sign-up
is rate-limited per link and per IP, like the public inquiry form.

### 3. Getting the link to parents
On the event panel:
- **QR code:** large, on screen ("show this at the field"), plus a **printable
  sign** (event name, "Scan to order your photos", the QR, packages and prices).
- **Copy link.**
- **Email the link:** paste parents' emails (or a team list). Each gets a
  branded invite email with the link. No accounts are made, and duplicates are
  skipped.
- **Text the link:** from the studio's own phone. On a phone this opens the
  share sheet or Messages with the text written; on a desktop it copies the
  text. StudioCue does not send texts (see Decisions).

### 4. On the day: field mode
A full-screen view for the phone or tablet at the field:
- the QR (for walk-ups) and the live roster, with new sign-ups appearing as
  they land;
- each row shows the athlete, package, amount and how they chose to pay, with
  one-tap **Paid · Cash / Check / Venmo / Zelle** (the existing
  `recordParticipantPayment`, extended to those methods) and the receipt email;
- totals: collected today, by method; still owed;
- search by athlete or parent.

### 5. Online payment through QuickBooks (optional per studio)
When the studio turns it on for an event and QuickBooks is connected, "Pay
online" raises a QuickBooks invoice for that parent, through the existing
provider worker, and shows its pay link. It's held to a later phase because:
it's mostly cash (Conor), it needs a QuickBooks customer per parent, and these
invoices must stay out of the job's own billing — the job client's portal, the
final-balance sums and the ledger's job totals all read `invoiceReferences`.
They'd live as `participantInvoices`, or be clearly excluded by
`participantId`, decided when it's built.

## Phases
1. **Event packages + payment methods + the public sign-up page + confirmation
   email**: sign-ups appear on the roster live; methods extended to check,
   Venmo and Zelle.
2. **Sharing**: QR on screen + printable sign, copy link, email invites, text
   from your phone.
3. **Field mode**: full-screen QR + roster + one-tap payments + day totals.
4. **Pay online**: the studio's pay link first, then QuickBooks per parent.
5. *(From the design doc, not this ask:)* per-parent delivery and review asks.

Each phase ships with tests, a local walk of the parent flow on a phone
viewport, the layout guard, and a prod walk on a FlawlessIQ test event.

## Decisions for Conor
1. **Texting:** send from the studio's own phone (share sheet / Messages,
   recommended — free, no setup), or StudioCue sends texts itself (a texting
   provider, US carrier registration that takes weeks, per-message cost, opt-out
   handling)?
2. **QuickBooks per parent:** later, after cash/Venmo/pay-link ship
   (recommended), or in the first release?
3. **Who takes payment at the field:** owner/admin/coordinator plus the crew
   assigned to that event (recommended), or owners only?
4. **Two athletes, one parent:** one sign-up per athlete (recommended — each
   athlete's photos are sorted and delivered on their own), or one order
   holding several athletes?
5. **Tax:** event prices are what parents pay, no tax added (recommended for
   cash days), or the studio's sales tax added on top?
