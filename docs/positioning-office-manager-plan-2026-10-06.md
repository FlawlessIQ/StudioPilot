# Positioning: Cue, your studio's office manager (plan, 2026-10-06)

**Status (2026-10-06): phases 1–4 live on studio-cue.com** — 0e90a257 (site),
90e41c7a (in-app copy), 5d8930a9 (top-bar fix). IndexNow sent for the new and
changed pages. Still open: phase 5 (payment chasing on the backlog, tap to
send; proposal follow-up; forwarded-inquiry acknowledgement), phase 6 (morning
handoff), phase 7 (outbound), and Gabe's quote (drafts below, not published).
**Phase 5 started 2026-10-06 with payment chasing** (tap to send; see
`docs/production-status.md` → Open). Proposal follow-up and forwarded-inquiry
acknowledgement are next.
Google: ask Search Console to index `/office-manager` and
`/virtual-assistant-for-photographers` (IndexNow doesn't reach Google).

## Decisions (Conor + Gabe, 2026-10-06)

Gabe has already pitched this framing to photographers and it landed well.

1. **Cue is the hire. StudioCue is the company.** "Meet Cue, your studio's office manager."
2. **The title is "office manager".** Not "assistant": every app calls its AI an assistant now. "Office manager" says Cue owns the work instead of answering questions about it.
3. **Couples never see Cue.** Every message goes out in the studio's name and voice, and Cue never poses as a person.
4. **Prices stay at $150 / $299.** Comparing the cost with hiring someone is a *website angle*. No plan renames and no price change.

## Why this frame

- **A feature comparison loses.** Next to HoneyBook, Dubsado and 17hats, a feature table makes StudioCue "another CRM, but $150". Those are tools the photographer still has to run.
- **A hire is a purchase people already understand.** Measured against an assistant, $150 is cheap; measured against a CRM, it is expensive. The frame changes what the price is compared with.
- **The product already works this way.** "AI prepares, human approves" is how a good office manager treats the owner. Gabe: "I review it and send it."
- **It travels beyond photography.** Gabe says the flow is generic to wedding vendors (DJs, videographers, makeup). "Office manager" carries over to them; "photography OS" doesn't.

## Positioning statement (internal, not for publishing)

> For photographers who lose their week to admin, **Cue is the office manager that comes with StudioCue**. It answers new inquiries, sends the paperwork, chases the insurance certificate, lines up the crew and keeps couples on schedule, at any hour, and it brings the owner only what needs their say. Unlike a CRM, the photographer doesn't have to run it. Unlike a hire, it costs $150 a month and works every weekend.

**The promise in one line:** *Works around the clock. Waits for you on what matters.*

## What we can honestly claim (code-verified 2026-10-06)

The "24/7" half of the promise only holds if every duty we call automatic really runs with nobody there. The audit below is a summary; evidence paths are in the session's audit and in `features/marketing/cue-duties.ts` once Phase 1 builds it.

### A: Cue does it on its own, at any hour
- **Inquiries:** turns a web-form inquiry into a job and checks the date. Acknowledges the couple and alerts the studio. Captures inquiries forwarded from the studio's inbox once forwarding is set up. Warns when inquiries stop arriving.
- **Consultations:** the couple books, moves or cancels the call themselves, and the confirmation goes out (needs availability set).
- **Signing:** reminds the couple to sign on day 3 and day 7. Sends the signed copy. Tells the studio the couple signed.
- **Booking:** raises and emails the retainer after signing (QuickBooks). Records the payment. Books the job: "You're booked" email, calendar event, Dropbox folders.
- **Final balance:** raises the final invoice 28 days out (deposit jobs). Marks invoices overdue. Asks for a billing address when QuickBooks tax needs one. Charges a saved card if the studio opted in to autopay.
- **Planning:** fills forms from what the job already knows, sends form reminders, updates the crew brief from the answers, locks the details 4 weeks out and asks the couple to confirm (weddings).
- **Crew:** when someone declines or doesn't answer, offers the next person (checked every 15 minutes). Adds a calendar hold on yes. Sends the call-time reminder 2 days out. Withdraws crew if the job is cancelled.
- **Insurance (COI):** chases the agent every 3 days, then daily in the last week. Takes in the certificate, reads it, checks it against what the venue requires. Records the venue's acknowledgement.
- **Wedding week and after:** the week-before note to the couple, the reminder before a gallery expires, review asks (portal on day 3, email on day 10), and album reminders on days 7 and 14.

### B: Cue prepares it, the owner taps once
- First personal reply to an inquiry, and follow-ups on days 3, 7 and 14
- The "ahead of our call" note, and the brief, package suggestion and proposal draft after a consultation
- Crew offers when a job books (A if `autoOfferOnBooking` is on)
- Asking the agent for a COI (A if set to auto), and sending it to the venue (always a person)
- The schedule confirmation, final-balance summary letter and day-before checklist (each can be switched to send on its own)
- Ready answers to a couple's questions about paying, the balance, arrival time and the gallery, plus a drafted reply to anything else
- Around 110 actions Cue can prepare from chat

### Don't imply these (not built)
- **Chasing money.** There are no overdue-payment reminders and no follow-up on a proposal nobody has answered. The `final_payment_reminder` and `package_follow_up` templates exist but nothing sends them.
- **Answering a couple on its own.** Every reply needs a tap.
- **Reading or sending from the studio's own Gmail or Outlook.** Calls, voicemail and SMS aren't handled either.
- **Acknowledging forwarded inquiries.** Only web-form inquiries get one.
- **Pricing, discounts, signing, rescheduling the event, paying crew, closing a job.**
- **Anything creative:** editing, culling, album design, releasing a gallery.

### Already on the site and not true
- Homepage, "Getting paid": **"From yes to paid in full, without chasing."** Invoices go out by themselves, but nothing chases a late payment; the studio resends from QuickBooks. Either reword it in Phase 2 or make it true in Phase 5.

## Site copy (drafts)

### Homepage

**Hero**
- Eyebrow: *For wedding photographers*
- H1: **Meet Cue, your studio's office manager.**
  - Option B to test later: "You shoot. Cue runs the office."
- Sub: *Cue answers new inquiries, sends the paperwork, chases the insurance certificate, lines up your crew and keeps your couples on schedule, day and night. Anything that matters waits for your yes.*
- Proof chips: unchanged (trial, card, setup questions).

**1. "While you were shooting"**, a new section and the centrepiece. It's a timestamped log of one Saturday, built only from A duties:

> **Saturday, while you shot the Harts' wedding**
> - 9:42 am: New inquiry from Priya & Sam for June 14. The date is free. Acknowledged them, told you, drafted your reply.
> - 11:05 am: Reminded the Okafors to sign their agreement (day 3).
> - 1:30 pm: Marcus passed on the Lee wedding. Offered it to Dana.
> - 2:15 pm: Chased your agent for Willow Creek's certificate.
> - 4:50 pm: Dana said yes. Added it to her calendar.
> - 6:20 pm: The certificate arrived. $500,000 of cover where the venue needs $1,000,000, so it's flagged for you.
> - 8:00 pm: Sent next week's couple their week-before note. Call times went to the crew.
>
> **Waiting for you on Monday: 4 things.** Your reply to Priya & Sam · the certificate · the Lees' schedule confirmation · a couple's question about the balance.

It closes with: *Seven things done. Four waiting. None of them needed you on a Saturday.*

**2. The job description.** This replaces "It prepares. You approve." and folds in `CueDoesCueNever`:

> **Position:** Office manager · **Hours:** All of them · **Reports to:** You
> **Duties:** Inquiries · Paperwork and signing · Getting paid · Crew · Venues and insurance · The wedding week · After the wedding
> **Will never:** Sign for you · Record a payment · Change who can see what · Mark a job ready · Touch your photos

**3. "Starts by asking. Earns the keys."** This is the trust dial (`features/messaging/trust-dial.ts`):
> *On day one, every message waits for you. Approve the same kind three times without changing a word and Cue offers to just send it. Money, signatures and anything Cue wrote itself always wait.*

**4. Film / journey:** "Watch Cue run one wedding, inquiry to album." The film itself stays as it is.

**5. Paid / COI / readiness:** re-voiced with Cue as the subject ("Cue gets the certificate the venue asks for"). Change the "without chasing" claim (see above).

**6. Hire vs CRM vs Cue** (new, a small table):

| | Hire an assistant | A CRM | Cue |
|---|---|---|---|
| Who does the work | They do, once trained | You do | Cue does; you approve |
| Hours | Their hours | Yours | All of them |
| Knows your workflow | After months | Only what you set up | From your contract, packages and forms on day one |
| Cost | $1,500+/month part-time | $40–80/month, plus your time | $150/month |

Check the $1,500 and $40–80 figures before publishing. Use a cited wage source (BLS) or soften to "a part-time hire".

**7. Pricing angle** (price unchanged): *"$150 a month buys about seven hours of an assistant. Cue works all 720."* Keep "Price the operation, not every client" as the sub-line.

**8. New FAQs**
- **Is Cue a person?** No. Cue is software: AI for the drafting and fixed rules for everything that counts. It works at any hour and never pretends to be someone.
- **Will my couples know about Cue?** Everything goes out from your studio, in your voice. Couples deal with you.
- **What if Cue gets something wrong?** Anything Cue writes waits for you. Routine reminders only send by themselves when you've switched them on.
- **Does Cue touch my photos?** Never. Cue runs the office; the creative work is yours.

**9. Closing CTA:** **"Your office manager can start today."** *Start free. Cue has the first reply drafted before you've finished your coffee.*

### Everywhere else

| Surface | Change |
|---|---|
| `app/layout.tsx` default title/OG | "StudioCue · Photography Operations OS" → "StudioCue · The office manager for photography studios" |
| `components/seo/brand-schema.tsx` `BRAND_DESCRIPTION`, `public/llms.txt` | Lead with Cue as the office manager; keep the never-does line |
| `app/about/page.tsx` | "What it does" becomes the role, not the software |
| `app/features/page.tsx` | "Cue drafts. You decide." becomes grouped by duty (the job description) |
| `app/pricing/page.tsx` | Add the hire comparison line |
| Wedding / corporate / sports pages | Hero: "Cue runs the office for your [weddings / corporate work / sports days]". Body sections stay |
| `app/for-clients/page.tsx` | **No Cue.** The couple's page talks about the studio only |
| `app/for-crew/page.tsx` | Crew page: Cue may stay out too (crew deal with the studio). Check with Gabe |
| OG images (`scripts/marketing/og-images.ts`) | Re-render home/pricing/features cards with the new headline |

### New pages
- **`/office-manager`**: the full job description, the Saturday log and the comparison. It becomes the canonical "what Cue does" page.
- **`/virtual-assistant-for-photographers`** (SEO): people search for this phrase. Frame Cue as "what a virtual assistant does, without the onboarding, hours or turnover". Link it from the footer and sitemap, and run IndexNow after rollout.

## In the product (same promise, inside the app)

Copy and small changes first:
- **Cue's description:** "the assistant inside StudioCue" → "your office manager" in the Cue pillar empty state, help glossary and how-to guides. Sweep by claim, not by directory: screens keep asserting old wording long after it changes.
- **Setup:** "Show Cue how you work." Importing the contract, packages and forms is handing over the binder.
- **Auto-send settings:** rename the page to **"What Cue can do without asking"**. It already exists; it just isn't presented as delegation.
- **The AI review queue:** rename to **"Waiting on you"**.

Bigger changes that make the frame real:
- **A morning handoff on Today:** "Since yesterday, Cue handled 7 things. 4 need you," with the handled list collapsible. This needs a feed of A-class actions per tenant from `emailJobs` and audit events. Design it before building.
- **The end-of-day note:** `ai/daily-digest.ts` already exists but is opt-in and off. Present it as Cue's report to the owner. **Decision needed:** default it on for new studios?
- **Couple-facing guard:** test that "Cue" never appears in couple-facing templates, the portal or `for-clients`.

## Product gaps that weaken the promise (build these)

Ranked by how much an office manager is expected to do them:

1. **Chase late payments.** It's the first thing anyone expects an office manager to do. The `final_payment_reminder` template exists unused. Make it a B (prepared) by default, with A available through the trust dial.
2. **Follow up on a proposal nobody has answered.** The `package_follow_up` template exists unused. Same pattern as the inquiry follow-ups.
3. **Acknowledge inquiries that arrive by forwarded email.** Today only web-form inquiries get an acknowledgement.
4. **Day-before checklist wording.** It mentions dress and rings for every kind of job. This is a bug, and we already guard copy by job kind. Tracked separately.

Once 1 ships, the "without chasing" line becomes true and the Saturday log can add "Reminded the Parks their balance is due Friday."

## Outbound

- **Trial emails become "Cue's first two weeks."** Phase 3 of the video plan hasn't started, so this is the frame from the start. Day 0: "Cue starts today." Day 2: "What Cue did while you were out." Day 7: "Want Cue to stop asking about these?" (trust dial). Day 12: "Keep your office manager."
- **The film:** a 30–45 second cutdown, *"One Saturday,"* made from the existing journey takes (`scripts/how-to/cutdowns.ts`). Vertical versions for social.
- **Social series:** "While I was shooting," screenshots of the handled log from Conor's test studio.
- **Gabe:** ask for a new quote on record about the office-manager experience. `tests/marketing-claims.test.ts` requires his approval for any new quote.
- **Sales one-pager:** the job description as a PDF, for Gabe to hand to vendor friends.

## Guards (so the copy can't drift from the code)

- **`features/marketing/cue-duties.ts`:** a typed list of each duty with its class (A/B/C), whether it's on by default, and its evidence (function export name). The Saturday log, job description and FAQ read from it.
- **Extend `tests/marketing-claims.test.ts` to check:**
  - Every Saturday-log item is class A, and its export exists in `functions/src/index.ts`.
  - "Around the clock / 24/7 / while you sleep" appears only next to A duties.
  - "without chasing" / "chases payments" appears only once payment chasing ships.
  - "Cue" is absent from couple-facing copy.

## Phases

| # | Phase | Scope | Who |
|---|---|---|---|
| 1 | Words + guard | This doc, `cue-duties.ts`, claims tests | Claude |
| 2 | Homepage + site-wide | Hero, Saturday log, job description, trust dial, comparison, FAQ, CTA, metadata, llms/brand schema, about/features/pricing/vertical pages, OG cards, fix "without chasing" | Claude; Conor reviews on prod (desktop + phone) |
| 3 | New pages | `/office-manager`, `/virtual-assistant-for-photographers`, sitemap, IndexNow | Claude |
| 4 | In-product copy | Cue description, setup, "What Cue can do without asking", "Waiting on you", couple-facing guard | Claude |
| 5 | Close the gaps | Payment chasing, proposal follow-up, forwarded-inquiry acknowledgement | Claude; walk on prod |
| 6 | Morning handoff | Handled feed + Today header; digest default | Design first, then build |
| 7 | Outbound | Trial emails, "One Saturday" cutdown, social, one-pager, Gabe quote | Claude + Conor + Gabe |

Phases 2–4 can ship this week. Phase 5 makes the strongest claims true, so it should land before any paid push.

## Decisions, round 2 (Conor, 2026-10-06)

1. **Daily digest stays off** for now.
2. **Payment chasing goes on the backlog, tap to send** (see `docs/production-status.md` → Open). The homepage's "without chasing" is reworded, and a claims test forbids the claim until it ships.
3. **Only the studio hears about Cue.** Crew and couples deal with the studio, and a test keeps "Cue" off the client and crew pages.
4. **Gabe's quote:** draft options are below. **Nothing goes on the site until Gabe picks one and approves the exact words** (the claims test allows only his approved quote).
5. **A real wage, cited:** BLS median for secretaries and administrative assistants (SOC 43-6014), May 2025: **$22.86/hr, $47,540/yr** (`features/marketing/cue-duties.ts` `ASSISTANT_WAGE`). $150 ≈ 6½ hours.
6. **Go** on phases 1–4.

## Draft quotes for Gabe (to approve or rewrite; not published)

These are drafts written for Gabe to react to. They are **not** his words until he says them. Ask him to pick one, change it however he likes, or say it his own way.

- A. "It's like having an office manager who never goes home. I review it and send it."
- B. "I used to spend five or six hours of admin on every couple. Now Cue does it, and I just say yes."
- C. "On a wedding Saturday, Cue answers my inquiries and chases my certificates. Monday I tap send."
- D. "It feels like I hired someone. Someone who already knew how I run my weddings."

When he approves one, put it in `components/marketing/studio-proof.tsx` and update the allowed-quote assertion in `tests/marketing-claims.test.ts` in the same commit.

## Open questions (round 1, answered above)

1. **Daily digest:** default it on for new studios as Cue's end-of-day note?
2. **Payment chasing:** prepared (tap to send) by default, or automatic by default with the trust dial?
3. **Crew page:** do crew hear about Cue, or only the studio?
4. **Gabe:** a new on-record quote for the site?
5. **The hire comparison:** OK to show a wage figure (with a source), or keep it as "a part-time hire"?
