# Lead capture from the studio's inbox — plan (2026-09-25)

**The promise:** a couple fills in the contact form on the studio's website,
exactly as they do today. Within a minute, StudioCue has the inquiry as a lead
— names, date, venue, guest count, budget, what they want — with the date
already checked against the calendar and a reply drafted. The studio changes
nothing on its website and reviews one card instead of retyping an email.

HoneyBook is the only competitor found doing anything like this (a Gmail "lead
finder" for marketplace emails, auto-creating inquiries). Nobody documents
capturing *website contact-form* emails. That is the gap, and it is the one a
studio like GR Productions actually has: Wix contact form → Gmail.

---

## What exists, and what's missing

StudioCue already turns a forwarded email into a lead. It is a solid pipe with a
thin parser.

| Built | Missing or broken |
|---|---|
| Per-studio forwarding address `inquiries+<slug>.<sig>@inbound.studio-cue.com` → `sendgridInboundMessage` → `createForwardedLead`, idempotent on Message-ID (`functions/src/communications/inbound.ts:204-236`, `functions/src/crm/forwarded-lead.ts`) | Reads **only the plain-text part** — an HTML-only notification is quarantined as `EMPTY_BODY` (`inbound.ts:117, :219`) |
| Marketplace detection (The Knot, WeddingWire, Zola) | **Reply-To is ignored** — the one header most form builders set to the couple's address (`forwarded-inquiry.ts:178`) |
| Date-conflict check, missing-info, AI summary + reply draft (`ai-pdf.ts:24-138`) | Extracts name, email and one date only — **no phone, venue, city, partner, guest count, budget, services** (`forwarded-lead.ts:109-157`) |
| A full field extractor already exists for pasted emails — `generateIntake` / `project_intake` (`functions/src/ai/copilot.ts:1839-1914`) | …but it isn't wired to leads |
| Duplicate key computed | **Never queried** — a couple who submits twice becomes two leads (`forwarded-lead.ts:126`) |
| Convert lead → job | **Fails for a lead with no date** (`tenant-records.tsx:1389` vs `commands.ts:141`); **no way to edit a lead** at all |
| Reply drafts | Replies to a lead **don't thread back into StudioCue** — they land in the studio's personal inbox (`approved-communication.ts:31-49`) |
| Today card for a new inquiry | Says "From your inquiry form" even for a forwarded email (`features/today/inbox.ts:468`) |
| Google OAuth (Calendar, narrow scopes) | **No Gmail, no Microsoft code at all**; Google app verification still pending |
| — | A platform notification carrying `Auto-Submitted`/`Precedence: bulk` may be quarantined as `AUTOMATED` before it reaches the inquiry branch (`inbound.ts:197`) — inferred, untested |

## How StudioCue can see the mail — the constraint that shapes everything

| Route | What it costs us | What the studio does | Works for |
|---|---|---|---|
| **Forwarding** to our address (have it) | Nothing | Add one filter; StudioCue confirms Gmail's verification itself (proven by Docparser/Mailparser) | @gmail.com, most Google Workspace, Yahoo, iCloud. **Not** Microsoft 365 (external forwarding blocked by default since 2021) or reliably Outlook.com |
| **Microsoft Graph** `Mail.Read` + change notifications | Free publisher verification; **no security audit** | One-click "Connect Outlook" | Outlook.com, Microsoft 365 (some tenants need their admin to approve) |
| **Gmail API** `gmail.readonly` + `watch` | Google brand verification + **annual CASA security assessment** (~$540–$4,500/yr at an authorised lab, 3–8 weeks the first time). Every background read scope is "restricted" — there is no narrower option | One-click "Connect Gmail" | All Gmail |
| Unified APIs (Nylas, Unipile, Aurinko) | $2–5 per mailbox/month; Nylas's *shared* verified app needs an enterprise tier; with our own Google project **we still owe CASA** | One-click | All |

Two things follow:

1. **Forwarding ships first and covers Gabe today.** Gmail + a Wix form is the
   forwarding case exactly. The work is making setup take two minutes and making
   the parse excellent — which the API routes need anyway.
2. **Start Google verification now.** CASA is a calendar problem, not an
   engineering one, and Calendar verification is already overdue
   (`docs/build-progress.md:718`). Microsoft needs no audit and fills the one
   gap forwarding can't: Microsoft 365.

`gmail.send` is only *sensitive*, not restricted — so "reply from your own
Gmail address" is cheap once the brand is verified. That matters later.

---

## The experience

### 1. Connect — "Where do your inquiries arrive?" (two minutes, once)

Asked in setup, on Today while no inquiry has ever arrived, and in Studio
settings → Inquiries (the three surfaces the forwarding address already uses).

- StudioCue guesses from the studio's email domain (MX record): Gmail /
  Google Workspace / Microsoft 365 / Outlook.com / other.
- **Gmail (now):** "Forward your website's inquiries to StudioCue." A
  three-step card with the exact filter pre-written for their form builder
  (`from:(notifications@wix-forms.com)`), a button that opens Gmail's filter
  screen, and — the part that removes the friction — **StudioCue catches
  Gmail's forwarding confirmation email and confirms it for them**, showing a
  green tick live. No code to copy.
- **Gmail (after verification):** "Connect Gmail" — one click, no filter.
- **Outlook / Microsoft 365:** "Connect Outlook" — one click via Microsoft Graph.
- **Other:** the forwarding address, with instructions per provider.

### 2. Teach — "Send a test inquiry from your website"

The moment that makes it feel magical, and makes it correct:

- The studio submits their own website form once (or, with an API connection,
  StudioCue finds the last few form emails itself).
- StudioCue shows **what it read**: the form builder it recognised ("Wix form
  on grproductions.com"), each field it found, and which lead field it filled —
  *"'Big Day' → event date · 'Where' → venue · 'Tell us about you' → message"*.
- One tap to confirm, or fix a mapping. The mapping is saved per studio and per
  form, so every later email is read the same way.
- The test lead is marked as a test and never counts.

### 3. Capture — every inquiry, within a minute

For each incoming message:

1. **Is it an inquiry?** Known form senders (Squarespace, Wix, Showit,
   WordPress, Pixieset, marketplaces) and this studio's learned senders are
   captured outright. Anything else is scored by the model; confident →
   captured, unsure → a quiet "Maybe an inquiry" tray, never a false lead.
   Everything else is ignored and not kept.
2. **Who is it from?** Reply-To → the form's email field → From (only if it
   isn't a no-reply sender). The same rule for every route.
3. **Read everything.** Structured `Label: value` fields first (builder-specific
   parsers + the studio's saved mapping), then the existing intake extractor for
   free text — partner name, date, ceremony time, venue, city, guest count,
   budget, services (photo / video / both), how they heard about the studio.
   Every value carries its provenance: *form field* or *read from the message*.
4. **Already know them?** Same email, or same names + date → attach to the
   existing lead or job's thread instead of creating a duplicate.
5. **Do the obvious work.** Date-conflict check (exists), missing info (exists),
   AI summary + reply draft (exists) — now with far more to work from.

### 4. Review — one card, in Today

> **New inquiry · Emma Hart & James Cole**
> Saturday, June 12, 2027 · Wildflower Barn, Hudson NY · ~140 guests · Photo + video · Budget $6–8k
> ✓ Your date is free · From your Wix form, 2 minutes ago
> *Reply ready:* "Hi Emma, congratulations…"  **Send reply** · Edit · Not an inquiry

- Fields the model inferred (not read from a labelled form field) are subtly
  marked; tapping any field edits it in place.
- **Send reply** sends the drafted reply and starts a thread that comes back
  into StudioCue. Later, it sends *from the studio's own address* (Gmail send /
  Graph send).
- **Not an inquiry** removes it and teaches the classifier for this studio.
- On a phone this is a compact row that opens a review sheet (the established
  pattern — see `mobile-queues-must-be-compact`).
- From the lead: **Book a consultation** or **Create the job** — no retyping,
  and no dead end when the date is missing.

### 5. Trust — it keeps working, visibly

- Settings shows *"Last inquiry captured 2 hours ago from your Wix form."*
- If a connection lapses (Gmail watch not renewed, Graph subscription expired,
  forwarding filter deleted), or no form email has arrived for much longer than
  this studio's normal gap, the studio is told — in Today and by email. A capture
  pipe that fails silently is worse than none.
- On first connect via API: **"Found 6 inquiries from the last 30 days"** →
  review and import, so the studio's current pipeline comes across too
  (HoneyBook does 30 days).

## Privacy stance (and consent-screen copy)

- Forwarding mode: StudioCue only ever sees what the filter sends.
- API mode: StudioCue queries only for inquiry-like messages (known senders +
  the studio's saved senders) and stores **only messages it turns into
  leads**. Everything else is read, discarded, and never kept.
- Stated plainly at connect time and in the privacy policy. It is also what
  Google's Limited Use policy requires.

---

## Build plan

Ordered so that each phase ships value on its own and the expensive
dependency (Google CASA) runs in parallel.

### Phase 1 — A world-class forwarding path (≈1.5 weeks) — *covers Gabe*

Fix the pipe (all found in the code map above):
- Read the HTML part when there's no text part; stop `isAutomatedEmail`
  quarantining forwarded form notifications; use Reply-To.
- Builder parsers + fixtures from real notification emails: Squarespace
  (`form-submission@squarespace.info`, Reply-To set), Wix (reply-to often off →
  body), Showit (`noreply@showit.co`, `Label: value`), Contact Form 7 defaults,
  Pixieset, The Knot / WeddingWire. Fixtures from *real* emails, not samples
  (`fixtures-must-match-real-names`).
- Wire the existing intake extractor into forwarded leads; add the lead fields
  it produces (partner, phone, venue, city, guest count, budget, services,
  referral) with per-field provenance; relax `leadSchema` to what leads really
  are.
- Real duplicate detection (email, or names + date) → attach, don't duplicate.
- `updateLead` command + inline editing; convert without a date; Today card
  names the real source ("Your Wix form").
- Replies to a lead thread back into StudioCue (per-lead conversation +
  reply-to address), so the couple's answer lands in the lead.
- Setup: builder-aware filter instructions + **auto-confirm Gmail's forwarding
  verification** at the inbound address + the "send a test inquiry" teach step.
- Capture health: last-captured time; silence alert.

### Phase 2 — Connect Outlook (≈1.5 weeks + free publisher verification)

- Microsoft Graph delegated `Mail.Read` (+ `offline_access`); tokens in Secret
  Manager like every other provider.
- Change-notification subscription on the inbox (renew before the ~7-day
  limit, lifecycle notifications, delta query as the safety net).
- Same classify → parse → capture pipeline as Phase 1. Backfill 30 days on
  connect.
- Microsoft Partner Program + publisher verification (free), so work tenants
  don't block consent.

### Phase 3 — Connect Gmail (≈1.5 weeks build; 3–8 weeks calendar for Google)

- **Start now, in parallel:** Google brand verification + CASA with an
  authorised lab. Calendar scopes go into the same submission.
- `gmail.readonly` + `users.watch` via Pub/Sub, renewed daily; `history.list`
  catch-up; backfill 30 days.
- Until verification lands, Gmail studios stay on Phase 1 forwarding — which
  works — so nothing waits on Google.

### Phase 4 — Reply from the studio's own address (≈1 week)

- `gmail.send` (sensitive, not restricted) and Graph `Mail.Send`.
- Replies and the whole lead → booking conversation go out from the studio's
  real address and land in their Sent folder, while StudioCue keeps the thread.

## Decisions for you

| # | Decision | Recommendation |
|---|---|---|
| L1 | Start Google brand verification + CASA now (≈$540–$4,500/yr + a few days of our time) | **Yes** — it's the long pole, and Calendar needs verification anyway |
| L2 | Our own Google app, or a unified API (Nylas/Unipile) to skip our own audit | **Our own app.** Unipile's "use our CASA" is a vendor claim; Nylas's shared app needs an enterprise tier; both add a processor holding studios' mail tokens |
| L3 | Auto-create leads, or suggest them | **Auto-create** when the sender is a known form or marketplace (HoneyBook does); **suggest** when the model is unsure |
| L4 | Backfill on connect | **30 days**, reviewed before import |
| L5 | Microsoft before Gmail API | **Yes** — no audit, and it covers the one case forwarding can't |

## How we'll know it's world-class

- **Time to lead:** form submitted → lead in Today, median < 2 minutes.
- **Fields pre-filled:** ≥ 80% of the fields the form actually contained.
- **Corrections:** < 1 in 5 captured leads needs a field edited.
- **Capture rate:** 100% of form emails the studio received become leads or
  sit visibly in "Maybe an inquiry" — measured against the studio's own inbox
  on the pilot.
- **False leads:** < 1 in 50.
- **Setup:** a new studio connected in under 3 minutes, including the test
  inquiry.

## First pilot

GR Productions: Wix contact form → Gmail. Phase 1 alone covers it. Walk it on
production with a real submission of his form before calling it done
(`walk-it-on-prod-or-it-is-not-done`).
