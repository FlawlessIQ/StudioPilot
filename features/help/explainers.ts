import { glossaryTerm } from "./glossary";
import { helpTrade, inTradeWords, type Explainer, type ExplainerSource, type HelpTrade, type TradeLine, type TradeText } from "./types";
import { videoSuitsTrade } from "./videos";

/**
 * The written guides behind each screen's "How to" button.
 *
 * Every **bold** phrase is a label the screen really shows, spelled the way
 * it spells it — tests/help-content.test.ts fails when one no longer exists
 * in the source, so a renamed button can't leave a guide describing the old
 * one. Plan: docs/how-to-videos-plan-2026-09-30.md (§2a lists the rest).
 *
 * A DJ, a makeup artist and a hair stylist read the same guides in their own
 * words (types.ts, features/trades/trades.ts). Where a line differs, a
 * photographer's text is written out exactly as it was and the other trades'
 * follow it; a label whose wording depends on the trade is left unbolded for
 * them, since the screen builds it. A guide about something a trade doesn't
 * have (delivering a gallery) isn't offered to it at all.
 */

/** A photographer's own words, as written; every other trade has its own. */
const photographer = (t: HelpTrade) => t.has.family === "photo";
/** What the client is sent to book, mid-sentence: "proposal", or a makeup artist's "quote". */
const offer = (t: HelpTrade) => t.words.proposal.toLowerCase();
/** The offer is a proposal, so its buttons say so ("Send proposal"). */
const offerIsProposal = (t: HelpTrade) => t.words.proposal === "Proposal";

const GUIDES: readonly ExplainerSource[] = [
  // ── Studio ────────────────────────────────────────────────────────────
  {
    id: "tour",
    title: "A tour of StudioCue",
    summary: "The four places that do most of the work, and where everything else lives.",
    audience: "studio",
    stage: "getting-started",
    routes: ["/studio/help", "/studio/help/journey"],
    video: "tour",
    purpose:
      ({ has }) =>
        `StudioCue runs your studio from the first inquiry to ${has.delivery ? "the final gallery" : "the review after the day"}. Four places in the menu do most of the work.`,
    steps: [
      "**Today** is your inbox: everything that needs a decision, most urgent first. Drafts Cue has written wait under **Prepared for you** — **Approve** them as they are, or **Review** them first.",
      (t) =>
        photographer(t)
          ? "**Inquiries** holds everyone who hasn't booked yet, by stage — **New**, **Talking**, **Consult**, **Proposal**, **Signing** — and shows whose move it is."
          : "**Inquiries** holds everyone who hasn't booked yet, by stage from **New** to **Signing**, and shows whose move it is.",
      "**Jobs** holds every booked job. Open one to see its whole story and **Your next move**.",
      (t) =>
        `**Cue** is your office manager. Ask it to draft an email, prepare a ${offer(t)} or tell you what's outstanding. Cue prepares the work. You approve it.`,
      "**Calendar**, **Messages**, **Clients** and **Insights** sit under **More** on a phone. Your packages and templates live in **Library**.",
    ],
    next: "Every screen has a **How to** button at the top. It opens the guide for whatever you're looking at.",
    goodToKnow: [
      "Drafts wait for your approval. The exceptions are the routine emails you set to send automatically, and the ones your workflows send on schedule.",
      "Just starting? **Continue setup** on Today walks you through the essentials.",
    ],
    terms: ["today", "job", "inquiry", "cue", "prepared"],
  },
  {
    id: "today",
    title: "Work from Today",
    summary: "Start each day here: decide what's waiting, approve what's drafted, and leave the rest.",
    audience: "studio",
    stage: "every-day",
    routes: ["/studio"],
    alsoOn: ["/studio/notifications", "/studio/tasks", "/studio/tasks/**"],
    video: "today",
    purpose:
      "Today shows everything waiting on you, most urgent first, and keeps track of everything else. If nothing is waiting, nothing is wrong.",
    steps: [
      "Read the headline. It's the single most urgent thing; **You're all clear.** means nothing needs you.",
      "Work through **Prepared for you** — replies, reminders and bills Cue has drafted. **Approve** sends one as written; **Review** opens it so you can edit it first.",
      "For a new inquiry, read the **Reply ready** draft and tap **Send reply**, or **Edit** it first. If it isn't really an inquiry, tap **Not an inquiry**.",
      "Then clear what's under **Only you can do this** — the decisions Cue can't make for you. Each one opens where you finish it.",
      "When a client goes quiet, you'll be asked to **Close — went quiet** or **Keep it open**.",
    ],
    next: "Anything waiting on someone else sits under **In motion** and comes back to Today by itself when it needs you again.",
    goodToKnow: [
      "**Handled for you** lists what Cue did without you, so you can always check.",
      // A makeup artist or hair stylist has no call to book.
      ({ words, has }) =>
        has.consultation ? `A reply only includes a booking link once your ${words.consultation.toLowerCase()} hours are set.` : null,
    ],
    terms: ["today", "prepared", "inquiry"],
  },
  {
    id: "inquiry",
    title: "Answer a new inquiry",
    summary: "Reply fast, follow up without remembering to, and close the ones that don't book.",
    audience: "studio",
    stage: "inquiry-to-booking",
    routes: ["/studio/leads", "/studio/leads/*"],
    alsoOn: ["/studio"],
    video: "inquiry",
    purpose:
      "Inquiries holds everyone who's asked about a date but hasn't booked. A confirmed inquiry with a date becomes a job right away, so nothing slips.",
    steps: [
      "Open **Inquiries**. **Open** shows everyone still in play; the other tabs split them by stage, from **New** to **Signing**. **Your move** marks the ones waiting on you.",
      ({ words, has }) =>
        `Answer from **Today**: Cue drafts a reply to each new inquiry. Read it, then **Send reply**. It includes a link where the client can add details${has.consultation ? ` and pick a ${words.consultation.toLowerCase()} time` : ""}.`,
      "Unsure emails arrive as **Maybe an inquiry** — tap **Yes, an inquiry** or **Not an inquiry**.",
      "No answer? A follow-up is drafted on day 3 and day 7, ready for **Send follow-up**.",
      "If it doesn't book, open the job, choose **Close inquiry** and pick why — **Went quiet**, **Booked someone else**, **Budget** and so on.",
    ],
    next: (t) =>
      photographer(t)
        ? "Once they book a consultation the inquiry moves to **Consult**, and a proposal comes next. When they sign and pay the retainer, it leaves Inquiries for **Jobs**."
        : t.has.consultation
          ? `Once they book a ${t.words.consultation.toLowerCase()}, a ${offer(t)} comes next. When they sign and pay the retainer, it leaves Inquiries for **Jobs**.`
          : `Your ${offer(t)} comes next, with no call first. When they sign and pay the retainer, it leaves Inquiries for **Jobs**.`,
    goodToKnow: [
      "**Preview inquiry form** shows the form clients fill out. Put its link on your website and every submission lands here.",
      "Inquiries by email, The Knot or WeddingWire can be forwarded in — **Copy address** and forward to it from your inbox.",
      "A closed inquiry reopens by itself if the client writes again.",
    ],
    terms: ["inquiry", "inquiry-link", "forwarding-address", "consultation", "vibe-call", "beauty-quote", "lost"],
  },
  {
    id: "proposal",
    title: (t) => `Build and send a ${offer(t)}`,
    summary: "Package, extras, price and payment dates — drafted for you, approved by you, sent in one tap.",
    audience: "studio",
    stage: "inquiry-to-booking",
    routes: ["/studio/proposals", "/studio/proposals/**"],
    alsoOn: ["/studio/booking"],
    video: "proposal",
    purpose:
      (t) =>
        `A ${offer(t)} is what a client sees before they book: their packages, any extras, the price and the payment dates. You build it, approve it, then send it.`,
    steps: [
      // Unbolded: these buttons are named after the trade's offer ("New
      // quote"), so no one spelling is in the screen's source.
      (t) =>
        `On the job's **Booking** tab choose Prepare the ${offer(t)}, or start from the ${offer(t)}s list with New ${offer(t)}.`,
      "Under **Choose the client and event**, check the client and the packages they're booking.",
      "Under **Frame the offer**, tap **Draft from what they told you** for an introduction written from their inquiry, then make it yours.",
      ({ words }) =>
        `Set ${words.proposal} expires, **Retainer due** and **Final balance due**, then **Create draft**. Nothing is sent yet.`,
      (t) =>
        photographer(t)
          ? "Add an album or other extra with **Add from your library**, or **Write one for this couple**."
          : "Add an extra with **Add from your library**, or **Write one for this client**.",
      (t) =>
        offerIsProposal(t)
          ? "Check it over, **Approve this proposal**, check **Ready to share with the client** and **Send proposal**."
          : `Check it over and approve it, check **Ready to share with the client**, then send the ${offer(t)}.`,
    ],
    next: (t) =>
      offerIsProposal(t)
        ? "The client gets a branded email with the proposal and a link to their portal, where they **Accept proposal** or **Request changes**. Once they accept, signing the agreement is their next step."
        : `The client gets a branded email with the ${offer(t)} and a link to their portal, where they accept it or **Request changes**. Once they accept, signing the agreement is their next step.`,
    goodToKnow: [
      "Team members who aren't an owner or admin see **Send for approval** instead.",
      "Need to change it after sending? **Correct and re-issue** sends a new version.",
      "Accepted by phone or email? **Record the acceptance**.",
    ],
    terms: ["proposal", "beauty-quote", "package", "add-on", "retainer", "final-balance"],
  },
  {
    id: "contract-retainer",
    title: "Get it signed and the retainer paid",
    summary: "Send the agreement, raise the retainer, and confirm the booking.",
    audience: "studio",
    stage: "inquiry-to-booking",
    routes: ["/studio/booking", "/studio/contracts"],
    alsoOn: ["/studio/invoices", "/studio/projects/*"],
    video: "contract-retainer",
    purpose:
      "A job is booked when two things are in: the signed agreement and the paid retainer. Both happen on the job's **Booking** tab.",
    steps: [
      "Open the job's **Booking** tab. The strip at the top — **Contract**, **Retainer**, **Booking** — shows what's next.",
      "Send the agreement: **Prepare the contract**, type your name to sign for the studio, then **Sign & send**. With Dropbox Sign or Docusign connected, it's **Approve sequence & send**.",
      "Once it's signed, the deposit invoice follows: QuickBooks raises it on a job billed there; otherwise StudioCue drafts your own, ready to **Email it**.",
      "Signed or paid outside StudioCue? **Record the signature** or **Record the payment**. Booking without a retainer? **Confirm the booking without a retainer**.",
      "Under **Confirm booking**, tap **Check and confirm**. When **Automatic confirmation is active**, it confirms by itself.",
    ],
    next: "The job turns Booked, moves from Inquiries to **Jobs**, and planning begins: questionnaire, crew and run of show.",
    goodToKnow: [
      "Recording a payment doesn't book the job by itself — confirm the booking to finish.",
      "With StudioCue signing, the client is reminded to sign after 3 and 7 days.",
      "No QuickBooks? You bill it yourself — add how clients pay you under **Invoices and payments** in Studio settings.",
    ],
    terms: ["agreement", "retainer", "booking-gate"],
  },
  {
    id: "job-page",
    title: "Follow one job from start to finish",
    summary: "Where a job is, the one thing to do next, and everything that's happened.",
    audience: "studio",
    stage: "every-day",
    routes: ["/studio/projects", "/studio/projects/*", "/studio/projects/new", "/studio/planning"],
    video: "job-page",
    purpose:
      "Every client has one job: their whole story in one place, from inquiry to closeout. Open it from **Jobs** or from any card on Today.",
    steps: [
      "Open **Jobs** and pick a job. **Active** and **Archived** split them, and the chips filter by type.",
      ({ words }) =>
        `The track along the top shows where it is: **Inquiry**, **Booking**, **Preparation**, **The day**, **${words.afterPhase}**.`,
      "Start with **Your next move** — the one thing to do now. **Nothing for you right now** means it's waiting on someone else.",
      "Drafts for this job wait under **Prepared for you**, ready to approve.",
      // Nothing to deliver, no Delivery tab (project-workspace-nav.tsx).
      ({ has }) =>
        has.delivery
          ? "The tabs — **Overview**, **Booking**, **Plan**, **Delivery** — hold each stage's detail."
          : "The tabs — **Overview**, **Booking**, **Plan** — hold each stage's detail.",
      "Keep the record in **Job history**: **Log a call**, **Ask Cue** about the job, or **Add a task**.",
    ],
    next: "As the client signs, pays and fills things in, the job moves along the track by itself.",
    goodToKnow: [
      "**Edit job** changes the date, venue or type; **Add a client** adds a second contact.",
      "A new client? **New job** starts a job from their message.",
      "Jobs booked before StudioCue? **Import bookings** brings them in without emailing anyone.",
    ],
    terms: ["job", "readiness"],
  },

  {
    id: "setup",
    title: "Set up your studio",
    // A vendor answers four (setup-gaps.ts `setupOrderFor`): her forms come
    // preloaded and insurance waits until a venue asks.
    summary: (t) =>
      photographer(t)
        ? "Seven questions that get StudioCue ready for your first real inquiry."
        : "Four questions that get StudioCue ready for your first real inquiry.",
    audience: "studio",
    stage: "getting-started",
    routes: ["/studio/setup", "/studio/settings", "/studio/settings/*"],
    video: "setup",
    purpose:
      (t) =>
        photographer(t)
          ? "Setup asks seven questions: what you shoot, how inquiries reach you, when clients can book a call, what you charge, how clients sign, what you ask clients, and who sends your insurance certificates. Most are answered right on the page."
          : `Setup asks four questions: what you charge, when clients can book ${t.has.consultation ? "a call" : "a trial"}, how inquiries reach you, and how clients sign. Most are answered right on the page.`,
    steps: [
      "On Today, tap **Continue setup**. Each question says why it matters.",
      "**How do inquiries reach you?** Pick a route, from **On your website** to **Inbox rules**.",
      // A makeup artist or hair stylist is asked about trials (setup-conversation.tsx).
      ({ has }) =>
        `**When can clients book ${has.consultation ? "a call" : "a trial"}?** Tap **Use Mon–Fri, 9–5** or **Choose my own hours**, and **Connect Google Calendar** so busy times are never offered.`,
      "**What do you charge?** **Paste or upload your prices**, or **Add one by hand**.",
      "**How do your clients sign?** Set up your agreement in StudioCue, or tap **I send my own agreement**.",
      (t) => (photographer(t) ? "Finish with your questionnaire and **Who sends your certificates of insurance?**" : null),
    ],
    next: "Skip anything you like: StudioCue brings it back on Today when a job actually needs it. Change any answer later in **Studio settings**.",
    goodToKnow: [
      "Your studio's name, logo and email colors are in **Studio settings**, under **Studio details** and **Email branding**.",
    ],
    terms: ["forwarding-address", "consultation", "vibe-call", "beauty-trial", "agreement"],
  },
  {
    id: "import-bookings",
    title: "Bring in the jobs you've already booked",
    summary: "Import existing bookings one at a time or from a spreadsheet, without emailing anyone.",
    audience: "studio",
    stage: "getting-started",
    routes: ["/studio/projects/import"],
    purpose:
      "Bring in the jobs you booked before StudioCue, one at a time or from a spreadsheet, without anything going to the clients.",
    steps: [
      "Open **Jobs** and choose **Import bookings**.",
      "For one job, fill in **The couple**, **The event**, **The contract** and **Paid so far**, then **Check booking** and **Import booking**.",
      "For many, go to **A spreadsheet of bookings**. **Download a template** if you need one, **Choose a CSV file**, check the columns, then import.",
      "When you're ready to work with a client, open their job and tap **Bring this couple into StudioCue**.",
    ],
    next: "Imported jobs come in quiet: no emails, invoices or reminders reach the client until you bring them in. Inviting them to their portal is a separate checkbox.",
    goodToKnow: [
      "**Fill from QuickBooks** takes what's been paid from QuickBooks, matched by the client's email. Nothing in QuickBooks changes.",
      "Only owners and admins can import.",
    ],
    terms: ["quiet-import", "job"],
  },
  {
    id: "packages",
    title: "Add your packages, add-ons and price list",
    summary: (t) => `Set up what you sell once, and every ${offer(t)} draws on it.`,
    audience: "studio",
    stage: "getting-started",
    routes: ["/studio/packages", "/studio/packages/*", "/studio/library", "/studio/library/*", "/studio/import"],
    purpose: (t) =>
      `Packages are what you sell; add-ons are the extras. Set them up once and every ${offer(t)} draws on them.`,
    steps: [
      "Open **Library**, choose **Packages**, then **Create package**.",
      (t) =>
        photographer(t)
          ? "Set the **Base price (USD)**, the **Retainer type** — a percent, a fixed amount or per crew member — and who you send under **Photographers** and **Videographers**."
          : `Set the **Base price (USD)**, the **Retainer type** — a percent, a fixed amount or per ${t.words.member} — and how many ${t.words.crew} you send.`,
      (t) =>
        photographer(t)
          ? "Under **What this package delivers**, list the gallery, film or album and when each is due."
          : `List what's included, so every ${offer(t)} shows the client exactly what they're booking.`,
      "Add extras under **Add-ons** with **New add-on**, and check the ones a package should suggest.",
      "Already have a price list? **Open AI import studio** and **Upload files**. Nothing goes live until you activate it.",
    ],
    next: (t) =>
      `${t.words.proposal}s are built from your packages. Changing a package never changes the price on a ${offer(t)} or booking that already has it.`,
    goodToKnow: [
      "**Show this package to clients** lets clients ask for it from their portal. New and imported packages start with it off.",
      "Retire a package by turning off **Available to book**; past bookings keep it.",
    ],
    terms: ["package", "add-on", "coverage", "retainer"],
  },
  {
    id: "agreement",
    title: "Upload your contract",
    summary: "Turn your contract into a template StudioCue fills in for every client.",
    audience: "studio",
    stage: "getting-started",
    routes: ["/studio/contracts/agreement"],
    purpose:
      (t) =>
        `Your agreement is the contract template StudioCue writes each client's contract from, filling in names, dates, ${photographer(t) ? "coverage" : "what they booked"} and prices from the job.`,
    steps: [
      "From setup, choose **Set up your agreement**.",
      "**Upload your contract**. StudioCue reads it and turns names, dates and prices into fields, or you can write it in the editor.",
      "Insert details with the field buttons, like **Client names**, **Total price** or **Payment schedule (table)**. Use **+ Your own field** for anything else.",
      "Check the **Preview with sample details**, then **Save your agreement**.",
      // Unbolded: the editor names the setting after the trade's offer
      // ("When a quote is accepted"), so no one spelling is in its source.
      (t) =>
        `Choose what happens When a ${offer(t)} is accepted: StudioCue prepares the contract for you to send, or signs and sends it for you.`,
    ],
    next: (t) =>
      `Each accepted ${offer(t)} writes a contract from the latest version. Contracts already sent keep the version they were sent with.`,
    goodToKnow: [
      "A contract with one of your own fields still blank never sends by itself.",
      "Seeing **Not switched on yet**? Writing contracts in StudioCue is turned on per studio; ask StudioCue support.",
      "Prefer your own paperwork? Record the signature on the job's **Booking** tab instead.",
    ],
    terms: ["agreement", "proposal", "beauty-quote"],
  },
  {
    id: "invoices-and-payments",
    title: "Bill clients yourself",
    summary: "Send your own invoices from StudioCue — with or without QuickBooks — and keep track of what's paid.",
    audience: "studio",
    stage: "getting-started",
    routes: ["/studio/settings/invoices"],
    alsoOn: ["/studio/invoices"],
    purpose:
      "StudioCue can issue your invoices itself: numbered, with a PDF, emailed to the client with how to pay. With QuickBooks connected you choose job by job.",
    steps: [
      "Open **Studio settings** and choose **Invoices and payments**.",
      "Add how clients pay you — Zelle, checks, a pay link — and your business details. Tap **Save**.",
      "Tap **Preview a sample invoice** to see exactly what clients get.",
      "With QuickBooks, choose **Bill it myself** or **Bill through QuickBooks** on each job's **Booking** tab.",
      "When a bill is ready, Today shows it: **Email it**, or **I sent it myself**. Record the payment when it arrives.",
    ],
    next: "Every bill — yours and QuickBooks' — is on **Invoices**, with what's owed, what's late and a CSV for your bookkeeper.",
    goodToKnow: [
      "A deposit is never taxed; your sales tax goes on the bill that completes the price.",
      "You can delete an invoice record from **Invoices**; a paid one leaves a note that it was settled, with no amounts.",
    ],
    terms: ["retainer", "final-balance"],
  },
  {
    id: "inquiry-capture",
    title: "Put your inquiry form on your website",
    summary: "Get every inquiry into StudioCue automatically, from your website, your own form or your inbox.",
    audience: "studio",
    stage: "getting-started",
    routes: ["/studio/settings/inquiry-capture"],
    alsoOn: ["/studio/leads"],
    video: "inquiry-capture",
    purpose:
      "Get every inquiry into StudioCue automatically — from your website, your own form or your inbox — each with its date checked and a reply drafted.",
    steps: [
      "Open **Studio settings** and choose **Inquiry capture**.",
      "Easiest: **Put your inquiry form on your website**. Pick your website builder, copy the code and paste it in.",
      "Keeping your own form? Choose **Keep your own website form** and add **Your StudioCue address** as a second recipient.",
      "For The Knot, WeddingWire or email, use **Forward by hand**, or **Forward automatically from your inbox** with a Gmail filter or Outlook rule.",
      "Tap **Test** and send yourself a test inquiry. If a field lands in the wrong place, fix it and tap **Looks right**.",
    ],
    next: "Every inquiry lands in **Inquiries** and on Today with a reply drafted. The client hears nothing until you send it.",
    goodToKnow: ["Save **Your StudioCue address** as a contact so forwarding takes two taps."],
    terms: ["forwarding-address", "inquiry", "inquiry-link"],
  },
  {
    id: "integrations",
    title: "Connect your tools",
    summary: "Google Calendar, Zoom, Dropbox and QuickBooks — what each does in StudioCue.",
    audience: "studio",
    stage: "getting-started",
    routes: ["/studio/integrations"],
    purpose:
      "Connect the tools StudioCue works through: Google Calendar for availability, Zoom for calls, Dropbox for files and QuickBooks Online for invoices and payments.",
    steps: [
      "Open **Integrations**. Each tile says what StudioCue uses that tool for.",
      "Tap **Connect** and sign in to the tool.",
      "Use **Test** to check a connection, and **Manage** to see its activity or disconnect it.",
      "Read the summary line: **Not covered yet** lists jobs that nothing you've connected can do.",
      "For autopay, open the **Autopay** tab and follow its three steps.",
    ],
    next: "StudioCue starts using a tool as soon as it's connected: busy calendar times stop being offered, and invoices sync with QuickBooks.",
    goodToKnow: [
      "Sign-in details are encrypted and never shown in the browser.",
      "Autopay needs QuickBooks Payments, which Intuit approves for your business.",
    ],
    terms: ["autopay"],
  },
  {
    id: "cue",
    title: "Ask Cue, then approve",
    summary: "Ask your office manager anything, or ask it to do something. Cue prepares the work. You approve it.",
    audience: "studio",
    stage: "every-day",
    routes: ["/studio/copilot", "/studio/ai-queue"],
    purpose:
      "Cue is your studio's office manager. Ask it anything about your studio, or ask it to do something, and it prepares the work for you to approve.",
    steps: [
      "Open **Cue** and type into **Message Cue**, or pick a suggestion.",
      "Type a slash for a ready-made question, like /attention for today's priorities or /unpaid for balances owed.",
      "When Cue prepares something, it shows as a card. Nothing happens until you tap its button.",
      "Drafted emails wait under **Prepared for you** on Today and in **Waiting on you**: **Approve & send**, **Edit first**, **Reject** or **Dismiss**.",
      "**New conversation** starts afresh; earlier ones stay under **Pick up where you left off**.",
    ],
    next: "Cue answers from your studio's records and shows where each fact came from.",
    goodToKnow: [
      "**Reject** tells StudioCue the draft was wrong so it learns; **Dismiss** just means not now.",
      "Cue can never take a payment, sign anything or mark a job ready on its own.",
    ],
    terms: ["cue", "prepared"],
  },
  {
    id: "messages",
    title: "Message a client",
    summary: "Every conversation with your clients, with replies drafted when they write in.",
    audience: "studio",
    stage: "every-day",
    routes: ["/studio/messages"],
    purpose: "Messages holds every conversation with your clients, with a reply drafted for you when they write in.",
    steps: [
      "Open **Messages**. Conversations waiting on you are counted at the top.",
      "To start one, tap **New message**, choose the **Project** and **Client**, write it and tap **Send message**.",
      "When a client writes in, a reply is often ready: tap **Use this reply**, edit it, then **Send reply**. Or tap **Draft a reply**.",
      "Each message shows whether it was **Delivered**, **Opened** or **Did not arrive**.",
    ],
    next: "Clients read and answer in their portal and by email; their replies land back here.",
    goodToKnow: [
      "A coordinator's message about money, the contract or insurance waits for an owner under **Waiting for your approval**.",
      "Files a client attaches show inside their message.",
    ],
  },
  {
    id: "consultation",
    // A makeup artist or hair stylist has no sales call: the same hours book
    // their trials, and the final details call (components/studio/trade-words.ts).
    title: ({ words, has }) =>
      has.consultation ? `Book a ${words.consultation.toLowerCase()}` : `Book a ${(words.trial ?? "trial").toLowerCase()}`,
    summary: ({ has }) =>
      has.consultation
        ? "Set when clients can book a call, and see every call and event on one calendar."
        : "Set when clients can book a trial or a call, and see every booking and event on one calendar.",
    audience: "studio",
    stage: "inquiry-to-booking",
    routes: ["/studio/calendar", "/studio/settings/consultation-availability"],
    purpose: ({ words, has }) =>
      has.consultation
        ? `Set when clients can book a call with you, and see every ${words.consultation.toLowerCase()} and event on one calendar.`
        : "Set when clients can book a trial or a call with you, and see every trial, call and event on one calendar.",
    steps: [
      "Open **Calendar** and tap **Manage availability**.",
      "Choose **Closed by default** (only the hours you add) or **Open by default** (everything but the times you mark unavailable), then set your hours.",
      (t) =>
        photographer(t)
          ? "Under **How you meet**, pick **Video call**, **In person** or **Phone call**, and set the **Consultation length (minutes)**."
          : t.has.consultation
            ? "Under **How you meet**, pick **Video call**, **In person** or **Phone call**, and set how long each call lasts."
            : "Under **How you meet**, pick how calls happen, and set how long each one lasts. A trial is always in person.",
      ({ has }) =>
        has.consultation
          ? "Tap **Save availability**. Your first reply to each inquiry now carries a link where the client picks a time."
          : "Tap **Save availability**. Then invite a client from the trial card on their job, and they pick a time from your hours.",
      "To book one yourself, tap an open slot, **Book**, then **Confirm booking**.",
    ],
    next: ({ has }) =>
      has.consultation
        ? "Booked calls show on the calendar and on the job. **Move to…** or **Cancel** updates the invitation and any Zoom meeting."
        : "Booked trials and calls show on the calendar and on the job. **Move to…** or **Cancel** updates the invitation and any Zoom meeting.",
    goodToKnow: [
      "**Connect Google Calendar** and your busy times are never offered.",
      "A video call sends a Zoom link with the confirmation.",
    ],
    terms: ["consultation", "vibe-call", "beauty-trial", "inquiry-link"],
  },
  {
    id: "booking-change",
    title: "Change a booking after it's signed",
    summary: "A new date or a different package, signed by the client as an amendment.",
    audience: "studio",
    stage: "inquiry-to-booking",
    routes: [],
    alsoOn: ["/studio", "/studio/projects/*"],
    purpose:
      "Once a client has signed, a new date or a change of package is a booking change: they sign an amended agreement, and the job keeps its place.",
    steps: [
      "Open the job and choose **Change the booking**. If the client asked from their portal, Today shows **Write up the change**.",
      "Set the new **Wedding date**, or add or remove **Packages**. Check any **Calls with the couple** that should move too.",
      "Add **A note for the couple (optional)** and tap **Write up the change**. Nothing changes yet.",
      "Check the new total, read the amended agreement, sign with your name and tap **Sign & send to the couple**.",
      "Signed on paper? Tap **They signed it another way**, then **Record their signature**.",
    ],
    next: "The client signs in their portal. Until then their current agreement stands; when they sign, the job takes the change and what they've paid carries over.",
    goodToKnow: [
      (t) => `Before the agreement goes out, change packages on the ${offer(t)} instead, under **What they're booking**.`,
      "If money is owed and the event is close, a new final bill is raised.",
    ],
    terms: ["booking-change", "agreement"],
  },
  {
    id: "final-balance",
    title: "Collect the final balance",
    summary: "How the last bill goes out, what to do when it can't, and how autopay takes it for you.",
    audience: "studio",
    stage: "planning",
    routes: ["/studio/invoices"],
    alsoOn: ["/studio", "/studio/integrations"],
    purpose:
      "The final balance is what's left after the retainer. StudioCue bills it 28 days before the event when it can, and asks you on Today when it can't.",
    steps: [
      "Most final bills are raised by themselves 28 days before the event — in QuickBooks, or as your own invoice waiting on Today for you to send.",
      "When one can't — booked late, date moved, retainer recorded by hand — Today shows it. Tap **Send the final bill**.",
      "Paid by transfer, check or cash? Tap **Paid another way** and record it.",
      "See what's owed on **Invoices**. **Final invoice review** shows how each bill was worked out.",
      "Turn on autopay under **Integrations**, on the **Autopay** tab: clients save a card and the balance pays itself on its due date.",
    ],
    // A makeup artist or hair stylist is paid on the day (trades.ts).
    next: ({ has }) =>
      `The client gets the invoice by email and pays online. ${has.balanceDueDaysBefore > 0 ? `It's due ${has.balanceDueDaysBefore} days before the event.` : "It's due the morning of the event."}`,
    goodToKnow: [
      "Autopay needs QuickBooks Payments.",
      "A declined autopay card gets the invoice link and one retry three days later.",
    ],
    terms: ["final-balance", "retainer", "autopay"],
  },
  {
    id: "questionnaire",
    title: "Send the questionnaire",
    summary: "Collect names, timings and key moments from the client, with reminders sent for you.",
    audience: "studio",
    stage: "planning",
    routes: ["/studio/questionnaires", "/studio/questionnaires/*"],
    alsoOn: ["/studio/planning"],
    purpose:
      "Questionnaires collect what you need from the client — names, timings, the key moments — without long email threads.",
    steps: [
      "Open the job's **Plan** tab and choose **Client details**, or open **Questionnaires**.",
      "If StudioCue has a form for this kind of job, tap **Send the form**. Otherwise pick a template and **Assign questionnaire**.",
      "To start from ours, use **Make a copy** under Ready-to-use wedding forms. To build your own, choose **Build template**, add questions with **Add a question here** (and sections with **Add a section**), then **Save template**. Only **Active** templates can be sent.",
      "When the client sends it back, open it to read their answers and **What StudioCue noticed**.",
    ],
    next: "The client fills it in from their portal, with reminders before it's due (7, 3 and 1 days unless you change them on the form). The due date is worked out from the event date.",
    goodToKnow: [
      "Editing a template saves a new version; forms already sent keep their questions.",
      (t) =>
        photographer(t)
          ? "Questions marked **Crew see it** show up in your photographers' brief."
          : `Questions marked **Crew see it** show up in your ${t.words.crew}' brief.`,
      "Each question can show only after an earlier answer, or suggest a time from an earlier time — open **When it shows** under it. Moving a question above the one it depends on clears that rule, and the editor says so.",
    ],
  },
  {
    id: "run-of-show",
    title: ({ has }) => (has.chairSchedule ? "Build the getting-ready schedule and share it" : "Build the run of show and share it"),
    summary: "Draft the day's timeline, publish it to your crew and client, and share it with vendors.",
    audience: "studio",
    stage: "planning",
    routes: ["/studio/schedules", "/studio/schedules/*", "/studio/vendors"],
    alsoOn: ["/studio/planning"],
    purpose:
      "The run of show is the day's timeline. You draft it, the client approves it, and crew and vendors work from it.",
    steps: [
      "From the job's **Plan** tab choose **Open the run of show**, or tap **Generate schedule** on Schedules.",
      // A DJ lays out the night, a makeup artist or hair stylist the morning
      // (ai-schedule-generator.tsx).
      ({ has }) =>
        has.musicPlanner
          ? "Tap **Lay out the night** to build the running order from their Music & moments planner, with their songs and names on each line. Or fill in what you know and tap **Generate draft**."
          : has.chairSchedule
            ? "Tap **Lay out the morning** to build everyone's chair from their party list, worked back from when they need to be ready. Or fill in what you know and tap **Generate draft**."
            : "Fill in what you know — **Coverage starts**, **Ceremony time**, the locations — and tap **Generate draft**. Anything left blank is guessed and labeled.",
      "Adjust the items under **The day**. Check **What we assumed**, and ask the client about anything in **What we still need**.",
      "Tap **Publish reviewed schedule**.",
      "For vendors, open **Share run of show**, tap **Create share link** and send it to them.",
    ],
    next: "Accepted crew get it on their day sheet and are asked to confirm it; the client is asked to approve the parts meant for them. Each publish is a new version.",
    goodToKnow: [
      (t) =>
        photographer(t)
          ? "Your **Timing rules** — how long portraits take, the buffers — shape every draft once you approve them."
          : "Your **Timing rules** — how long each part takes, the buffers — shape every draft once you approve them.",
      "Vendors see only their own parts and shared items, never your notes.",
    ],
    terms: ["run-of-show", "mc-script", "getting-ready-schedule"],
  },
  {
    id: "crew-offer",
    title: (t) => (photographer(t) ? "Book your second shooter" : `Book another ${t.words.member}`),
    summary: "StudioCue ranks who to ask and offers the job one person at a time until someone accepts.",
    audience: "studio",
    stage: "planning",
    routes: ["/studio/crew", "/studio/crew/*"],
    alsoOn: ["/studio/planning", "/studio/projects/*"],
    video: "crew-offer",
    purpose:
      (t) =>
        `Book ${photographer(t) ? "second shooters" : t.words.crew} and assistants for a job. StudioCue ranks who to ask and offers the job to one person at a time until someone accepts.`,
    steps: [
      "Open the job's **Plan** tab and choose **Crew for this job**, or tap **Staff this job** on the job page.",
      "If offers were **Prepared when this job was booked**, check them and tap **Send these offers**.",
      "Otherwise choose **Rank my options**, set the roles, times, rate and **Response window**, then **Approve crew plan and start**.",
      "Know exactly who you want? Use **Already know who's working it?** at the top, or **I know who I want**: book them now, or **Send offer**.",
      "Nobody accepted? **Offer to someone else** starts a new round without asking the same people.",
    ],
    next: "Each person gets an email and answers from their phone. If they decline or the window runs out, the next name is asked.",
    goodToKnow: [
      "Before the day, crew send their W-9 and any insurance; you approve or waive each item.",
      "After the job, approve their hours and set **Payment status**. StudioCue doesn't pay anyone for you.",
    ],
    terms: ["crew-offer"],
  },
  {
    id: "coi",
    // Not "a venue's insurance certificate": it is the studio's own
    // certificate, naming the venue.
    title: "Send a venue your insurance certificate",
    summary: "Your agent issues it, StudioCue asks and follows up, and the venue gets it once you approve.",
    audience: "studio",
    stage: "planning",
    routes: ["/studio/insurance"],
    alsoOn: ["/studio/planning"],
    purpose:
      "Many venues want a certificate of insurance — proof of your liability cover, naming them — before the day. StudioCue asks your insurance agent for it, follows up, checks it, and sends it on once you've approved it.",
    steps: [
      "Once, in **Studio settings** → **Insurance**, save your agent's email and choose how far StudioCue goes: **Prepare it**, **Send it** or **Off**.",
      "Say the venue needs one: the client answers on your inquiry form, or tap **Yes, it does** under **Venue & insurance** on the job's **Plan** tab.",
      "60 days before the event, StudioCue asks your agent — or, on **Prepare it**, puts **Send the COI request to your agent** on Today for you.",
      "Your agent replies with the PDF and it comes straight back to the job. StudioCue checks it against the venue's requirements and flags any differences.",
      "Read it, then tap **Approve & send to venue** — or **Ask agent to correct**.",
    ],
    next: "StudioCue follows up with your agent every 3 days, up to 4 times, then tells you on Today. Once the venue has the certificate, the readiness checkpoint is checked off.",
    goodToKnow: [
      "StudioCue flags possible problems, but you always decide whether a certificate is right.",
      "The venue's wording is remembered: the next job there needs no typing.",
    ],
    video: "coi",
    terms: ["coi"],
  },
  {
    id: "readiness",
    title: "Know the job is ready",
    summary: "The checklist every booked job clears before the day, and the event-day brief.",
    audience: "studio",
    stage: "planning",
    routes: ["/studio/readiness", "/studio/event-day"],
    purpose:
      "Readiness is the checklist a booked job must clear before the day. Most items check themselves off as records arrive; the judgment calls are yours.",
    steps: [
      "Open **Event readiness** to see each job's **Score**, what's **Blocking** and what's **Overdue**.",
      "Open a job to see its **Readiness checkpoints**. Items settle themselves when the record arrives: a signature, a payment, an accepted offer.",
      "For a judgment call, tap **Mark done** and say how you know. To skip one, tap **Waive** and say why.",
      "On the day, open **Event day** for the venue, the run of show and who's working, and **Ask the event brief** anything.",
    ],
    next: "Your reasons are saved to the audit log under your name, and readiness shows them as your call rather than something StudioCue saw.",
    goodToKnow: ["A job counts as ready only when every required checkpoint is settled."],
    terms: ["readiness", "checkpoint"],
  },
  {
    id: "delivery",
    // Only a trade that delivers something after the day (trades.ts): no
    // other trade has the Delivery tab this describes.
    offered: ({ has }) => has.delivery,
    title: "Deliver the gallery and close out",
    summary: "Send the finished photos or film, then close the job once everything reconciles.",
    audience: "studio",
    stage: "after-the-wedding",
    routes: ["/studio/delivery", "/studio/post-production", "/studio/post-production/*"],
    video: "delivery",
    purpose: "Send the finished photos or film to the client, then close the job once everything reconciles.",
    steps: [
      "Open the job's **Delivery** tab. Check **Cards backed up** first; nothing is released before it.",
      "Under **This release**, add each item: **What it is**, the **Link**, any **Access code**, and **Downloads until**.",
      "Or forward your gallery host's “ready” email to the job, then **Read the link and code**.",
      "Add your **Review link**, then **Release to the couple**.",
      "When everything is in, use **Close and archive** under **Closing the job**. Anything that happened elsewhere can be vouched for with **Mark as done**.",
    ],
    next: "The client gets one email with a button for each item and their codes, and everything lands in their portal. Review requests follow 3 and 10 days later.",
    goodToKnow: [
      "Films have no download deadline; WeTransfer links last 7 days.",
      "Only owners and admins can close a job.",
    ],
    terms: ["closeout"],
  },
  {
    id: "reviews",
    // The asks are scheduled by releasing the final delivery. A trade with
    // nothing to deliver asks from the job instead ("Draft the review
    // request", features/journey/steps.ts), so this guide isn't theirs.
    offered: ({ has }) => has.delivery,
    title: "Ask for a review",
    summary: "Two asks after delivery, which stop as soon as the client has left one.",
    audience: "studio",
    stage: "after-the-wedding",
    routes: ["/studio/reviews"],
    purpose:
      "Review requests ask each client for a review after their final delivery, then stop as soon as they've left one.",
    steps: [
      "Add your review link when you release the final delivery; it's needed then.",
      "StudioCue asks twice: a note in the client's portal 3 days after delivery, then an email at 10 days.",
      "Open **Review requests** to see what's scheduled and what's gone out.",
      "When the client taps **I've left my review**, or you confirm it, the remaining asks are canceled.",
    ],
    next: "Nothing is sent for a job that's been archived, canceled or kept quiet since delivery.",
    goodToKnow: ["Want to ask in your own words? Ask Cue to **Draft a review request**."],
  },
  {
    id: "insights",
    title: "Read your Insights",
    summary: "Bookings, money, where inquiries come from, and what StudioCue handled for you.",
    audience: "studio",
    stage: "admin",
    routes: ["/studio/reports", "/studio/reports/**"],
    purpose:
      "Insights shows how the studio is doing: bookings, money, where inquiries come from, and what StudioCue handled for you.",
    steps: [
      "Open **Insights**, set the **Report range**, and narrow by **Project type** if you like.",
      "Read the top line: **Booked jobs**, **Average readiness**, **Invoiced** and **Outstanding**.",
      "**Where inquiries come from** shows which sources turn into bookings.",
      "**Where inquiries stop becoming bookings** shows the step where clients drop off.",
      "**What StudioCue handled for you** counts the approvals, sends and time saved.",
    ],
    next: "Use **Export CSV** or **Print** to share it. For your books, **Invoices** has a CSV of every bill.",
    goodToKnow: ["The range filters jobs by their event date, and inquiries by the date they arrived."],
  },
  {
    id: "people",
    title: "Clients, crew, team and vendors",
    summary: "Where each kind of person lives in StudioCue, and how to add them.",
    audience: "studio",
    stage: "admin",
    routes: ["/studio/clients", "/studio/clients/*", "/studio/crew/new"],
    alsoOn: ["/studio/vendors", "/studio/crew", "/studio/team"],
    purpose: "Clients, crew, team and vendors each have their own list, one tap apart.",
    steps: [
      "Open **Clients**. Along the top are **Clients**, **Crew**, **Team** and **Vendors**.",
      "**Add client** creates a contact. Their email becomes their portal login.",
      "**Crew** are freelancers you offer jobs to. **Add crew member** emails them an invite to set their availability and send their papers.",
      "**Team** are people who sign in to help run your studio.",
      "**Vendors & venues** are saved against a job: **Add vendor**, choosing the job they're working.",
    ],
    next: "Clients usually arrive by themselves from inquiries, so you'll rarely add one by hand.",
    goodToKnow: ["Adding a crew member doesn't put them on a job; offers come from each job's crew plan."],
  },
  {
    id: "team",
    title: "Invite your team",
    summary: "Add the people who help run your studio, and choose what each can do.",
    audience: "studio",
    stage: "admin",
    routes: ["/studio/team"],
    purpose: "Invite the people who help run your studio, and choose what each of them can do.",
    steps: [
      "Open **Clients**, then **Team** along the top.",
      "Under **Add someone to your studio**, enter a **Name** and **Email** and pick a **Role**.",
      "Tap **Send invitation**. They get an email, and you can also copy the **Invitation link**.",
      "Change a role any time from the **Role** menu on their row. **Suspend** pauses their access; **Remove** ends it.",
    ],
    next: "They join once they accept, and see only what their role allows.",
    goodToKnow: [
      "Only the studio owner can manage the team.",
      "Crew are freelancers you offer jobs to: add them under **Crew**, not here.",
    ],
    terms: ["studio-roles"],
  },
  {
    id: "automations",
    title: "Workflows and automatic emails",
    summary: "The checkpoints and emails every booked job gets, and which emails wait for you.",
    audience: "studio",
    stage: "admin",
    routes: [
      "/studio/workflows",
      "/studio/workflows/**",
      "/studio/automations",
      "/studio/settings/automatic-drafts",
      "/studio/settings/email-templates",
    ],
    purpose:
      "Workflows set the checkpoints and automatic emails every booked job gets. **What Cue can do without asking** and email templates decide how routine emails are written and sent.",
    steps: [
      "Open **Library**, choose **Workflow templates**, then **Create workflow**.",
      "Name it, pick the **Event type**, and choose the **Starting checkpoints** — the milestones every job must reach, dated back from the event.",
      "Review **Starting automations**. Email automations go to the client on schedule without a draft to approve, so uncheck any you'd rather send yourself.",
      "Set **Availability** to publish it for new jobs, then **Create workflow**.",
      "In **Studio settings**, **What Cue can do without asking** sets whether each routine email waits for you (**Review each time**) or Cue sends it on its own (**Send automatically**).",
    ],
    next: "New jobs of that type get the workflow when they're booked. **Automation runs** shows each time an automation ran and whether it worked.",
    goodToKnow: [
      "Publishing under the same name replaces the old version; jobs already running keep theirs.",
      "To change an email's words, open **Studio settings** → **Email templates**, pick the email, and **Save & use**. Your words go above StudioCue's unless you choose to replace them; **Back to StudioCue's wording** undoes it.",
    ],
    terms: ["workflow", "checkpoint", "readiness"],
  },
  {
    id: "subscription",
    title: "Your plan and billing",
    summary: "What you're on, what you're using, and where to change your card.",
    audience: "studio",
    stage: "admin",
    routes: ["/studio/subscription"],
    purpose: "See your plan and what you're using against it, change plan, and manage how you pay.",
    steps: [
      "Open **Studio settings** and choose **Plan & billing**.",
      "Check **Internal users**, **AI actions · current month** and **Active subcontractors** against your plan.",
      "Compare plans under **Plans** and switch when you need more room.",
      "Update your card or get your invoices with **Open customer portal**.",
    ],
    next: "Changes take effect right away. Payment details stay with Stripe; StudioCue never sees your card.",
    goodToKnow: ["Each AI task, like drafting a message or reading an import, counts as one AI action. There's also a daily cap."],
  },

  // ── Couple ────────────────────────────────────────────────────────────
  {
    id: "couple-tour",
    title: "Your portal",
    summary: ({ has }) =>
      has.delivery ? "Where everything between booking and your photos happens." : "Where everything between booking and your day happens.",
    audience: "couple",
    stage: "getting-started",
    routes: ["/client", "/client/plan", "/client/project"],
    video: "couple-tour",
    purpose:
      ({ words, has }) =>
        `This is your portal. Everything between booking and ${has.delivery ? "your photos" : "your day"} happens here, and your ${words.provider} sees what you do right away.`,
    steps: [
      "**Home** shows the countdown to your day and **Your next step** — the one thing to do now. Tap its button to do it.",
      ({ has }) =>
        `**Your journey** lists every step from booking to ${has.delivery ? "your photos" : "the day and after"}, checking off as each is done.`,
      ({ words }) =>
        `**Plan** keeps everything in one list: your ${words.proposal.toLowerCase()}, your agreement, **Payments**, your ${words.detailsForm ?? "questionnaire"} and your timeline.`,
      ({ words }) => `**Messages** is a chat with your ${words.provider}, and **Files** holds anything they've shared with you.`,
    ],
    next: ({ words }) => `When your ${words.provider} needs something from you, you'll get an email with a link straight back here.`,
    goodToKnow: ["**Your studio is on it** means there's nothing for you to do right now."],
    terms: ["couple-journey", "couple-retainer", "couple-final-balance"],
  },
  {
    id: "couple-proposal",
    title: "Choose your package and accept",
    summary: ({ words }) =>
      `Read your ${words.provider}'s offer, pick your ${words.coverage.toLowerCase()}, and accept it — or ask for changes.`,
    audience: "couple",
    stage: "inquiry-to-booking",
    routes: ["/client/proposal", "/client/package"],
    purpose:
      ({ words }) =>
        `Your ${words.proposal.toLowerCase()} is your ${words.provider}'s offer: your package, any extras, the total and when each payment is due. Nothing is charged when you accept.`,
    steps: [
      (t) =>
        photographer(t)
          ? "If you're asked to **Choose your coverage**, tap a package, check any **Add-ons** you want, then **Confirm**. Your price is fixed from then on."
          : "If you're asked to choose your package, tap one, check any **Add-ons** you want, then **Confirm**. Your price is fixed from then on.",
      (t) =>
        offerIsProposal(t)
          ? "Open **Your proposal** and read **What's included** and the **Payment plan**."
          : `Open your ${offer(t)} and read **What's included** and the **Payment plan**.`,
      (t) =>
        offerIsProposal(t)
          ? "Happy with it? Tap **Accept proposal**, then **Confirm acceptance**."
          : "Happy with it? Accept it, then tap **Confirm acceptance**.",
      "Something to change? Tap **Request changes**, say what you'd like, then **Send change request**.",
    ],
    next: "Your agreement comes next — by email, and under **Your agreement** here. Paying the retainer after you sign is the last step to reserve your date.",
    goodToKnow: [
      "Accepting doesn't sign anything or take a payment; those are separate, secure steps.",
      (t) => `Want something extra later? **Add to your booking** asks your studio, and they send you an updated ${offer(t)}.`,
      "If your studio sent one booking agreement instead, you accept by signing it: tap **Review & sign the agreement**.",
    ],
    terms: ["couple-retainer", "couple-final-balance"],
  },
  {
    id: "couple-sign",
    title: "Sign your agreement",
    summary: "Read your contract and sign it online with your typed name.",
    audience: "couple",
    stage: "inquiry-to-booking",
    routes: ["/client/contract"],
    video: "couple-sign",
    purpose:
      ({ words }) =>
        `Your agreement is your contract with your ${words.provider}. You read it and sign it right here; your typed name is your signature.`,
    steps: [
      "Open **Your agreement** from the email, or from **Plan**.",
      "Read it through. Anything to change? Tap **Something to change? Ask before you sign**.",
      "Tap **Review & sign**, check the box to sign electronically, and type your full name.",
      ({ words }) =>
        `Tap **Sign agreement**. If it comes in two parts — the terms, then your ${words.coverage.toLowerCase()} and price — you type your name for each and tap **Sign both parts**.`,
    ],
    next: "A signed copy is emailed to you, and **Download signed copy** keeps it here. The retainer invoice comes next; paying it reserves your date.",
    goodToKnow: [
      "If your studio changes your date or package later, you'll see **A change to sign** here. Your original agreement stands until you sign it.",
    ],
    terms: ["couple-agreement", "couple-booking-change", "couple-retainer"],
  },
  {
    id: "couple-pay",
    title: "Pay, and save a card for the final balance",
    summary: "See what's due, pay securely, and let the final balance pay itself.",
    audience: "couple",
    stage: "planning",
    routes: ["/client/payments"],
    purpose:
      "Your payments page shows every invoice for your booking and what's due next. You pay on your payment provider's own secure page; StudioCue never sees your card.",
    steps: [
      "Open **Your payments** from the email, or from **Plan**.",
      "Tap the pay button on what's due. It opens your studio's secure payment page — or the invoice says how to pay them.",
      "Come back here afterwards. The page checks for your payment by itself, or tap **Check payment status**.",
      "**Schedule** lists every invoice, soonest first, and which are paid.",
      "If you see **Pay your final balance automatically**, tap **Save a card** and your final balance is charged on its due date.",
    ],
    next: "Your studio sees your payment right away. Paying the retainer reserves your date.",
    goodToKnow: [
      "A declined automatic charge is tried once more 3 days later. You can **Remove card** any time before.",
    ],
    terms: ["couple-retainer", "couple-final-balance", "couple-autopay"],
  },
  {
    id: "couple-questionnaire",
    title: ({ words }) => `Fill out your ${words.detailsForm ?? "questionnaire"}`,
    summary: ({ words }) => `Tell your ${words.provider} what they need to plan your day. Answers save as you go.`,
    audience: "couple",
    stage: "planning",
    routes: ["/client/questionnaire"],
    purpose:
      ({ words }) =>
        `Your ${words.provider} uses your ${words.detailsForm ?? "questionnaire"} to plan the day: the names, the timings and the moments that matter to you.`,
    steps: [
      ({ words }) =>
        words.detailsForm
          ? `Open your ${words.detailsForm} from the email, or from **Plan**.`
          : "Open **Your questionnaire** from the email, or from **Plan**.",
      "Answer section by section and tap **Next section**. Answers save as you type.",
      "Need a break? **Finish later: your answers are kept.**",
      "On the last step, **Review answers**, then **Send answers**. Required questions need an answer first.",
    ],
    next: ({ words }) => `Your ${words.provider} has your answers right away. To change one after sending, just message them.`,
    goodToKnow: [
      ({ words }) => `Some answers may already be filled in from what you told your ${words.provider}. You can change them.`,
    ],
  },
  {
    id: "couple-day",
    title: "Your timeline, files and messages",
    summary: ({ words }) => `Check your timeline for the day, message your ${words.provider}, and find every file.`,
    audience: "couple",
    stage: "planning",
    routes: ["/client/schedule", "/client/messages", "/client/documents"],
    purpose:
      ({ words }) =>
        `As your date gets close, your timeline, your files and your messages with your ${words.provider} all live here.`,
    steps: [
      "Open **Your timeline** from **Plan**. When it says **Ready for you to check**, look through the times.",
      "All good? Tap **Approve timeline**. Something off? Tap **Ask about this** on that time, or **Ask for changes**.",
      (t) =>
        `**Messages** is a chat with your ${t.words.provider}; their replies come here and to your email. You can attach ${photographer(t) ? "photos" : "pictures"} and files.`,
      "**Files** keeps everything shared with you, plus your signed agreement and your invoices.",
    ],
    next: (t) =>
      photographer(t)
        ? "Your photographer and crew plan the day from the version you approve. If it changes, you'll get a new version to check."
        : `Your ${t.words.provider} and their team plan the day from the version you approve. If it changes, you'll get a new version to check.`,
    goodToKnow: [
      "Times are shown in the event's time zone.",
      "A week before the day you'll get an email with a link straight to your timeline.",
    ],
    terms: ["couple-timeline"],
  },
  {
    id: "couple-photos",
    // Only a client of a trade that delivers something after the day.
    offered: ({ has }) => has.delivery,
    title: "Get your photos",
    summary: "Open your gallery, save everything, approve your album and share a review.",
    audience: "couple",
    stage: "after-the-wedding",
    routes: ["/client/delivery", "/client/reviews"],
    purpose:
      "After the day, your photos — and your film, if it's part of your package — arrive here, with everything you need to open and keep them.",
    steps: [
      "Open **Your photos** from the email, or from **Plan**.",
      "Tap **Copy** beside the access code, then **Open your gallery** and paste it when it asks.",
      "Download and back everything up before access closes; the date is on the card. Then tap **I've downloaded everything**.",
      "Having an album? Choose photos in your gallery, tap **I've sent my selections**, then **Approve design** or **Ask for changes**.",
      "Loved it? **Would you share a few words?** links to your studio's review page. Tap **I've left my review** once you've posted it.",
    ],
    next: "Once you approve your album design, it's made exactly as shown.",
    goodToKnow: [
      "“I've downloaded everything” only tells your studio; it doesn't download anything or change your access.",
      "Access closed? Tap **Ask for access**.",
    ],
  },

  // ── Crew ──────────────────────────────────────────────────────────────
  {
    id: "crew-tour",
    title: "Find your jobs and accept offers",
    summary: "Offers, your schedule and everything for the day, on your phone.",
    audience: "crew",
    stage: "getting-started",
    routes: ["/crew", "/crew/**"],
    purpose:
      "This is where a studio sends you work. Offers, your schedule and everything for the day are here, made for your phone.",
    steps: [
      "New offers appear on **Today**. Open one for the date, the job and the fee.",
      "Tap **Accept**, or **Decline offer** and tell the studio why.",
      "**Jobs** lists the jobs you've accepted. Open one to prep: read the checklist and send anything the studio asks for.",
      "On the day, **Open the day sheet** for where to be and when, your role, who to call and the running order.",
      "**Calendar** is where you mark the dates you're not free; **Me** holds your profile.",
    ],
    next: "After the event, send your hours and expenses from the job so the studio can pay you.",
    goodToKnow: ["Questions about a job? **Message the studio** from the job itself."],
    terms: ["crew-offer-crew", "day-sheet"],
  },
  {
    id: "crew-offer-accept",
    title: "Accept or decline a job",
    summary: "Everything you need to decide on an offer, and how to answer it.",
    audience: "crew",
    stage: "every-day",
    routes: ["/crew/pending"],
    video: "crew-offer-accept",
    purpose: "An offer is a studio asking you to work a date. Everything you need to decide is in the offer itself.",
    steps: [
      "Open the offer from the email, or from **Today**.",
      "Check the date and times, the fee and **What you'd do**.",
      "Answer before the **Answer by** time; after that the offer closes and the studio may ask someone else.",
      "Tap **Accept**. Or tap **Decline**, pick a reason if you like, and tap **Decline offer**.",
    ],
    next: "An accepted job moves to **Jobs**, and its day sheet appears once the studio shares the run of show. **Add to my calendar** saves the date.",
    goodToKnow: ["Your reason for declining is optional. It just tells the studio whether it was the date, the fee or the job."],
    terms: ["crew-offer-crew"],
  },
  {
    id: "crew-day",
    title: "Prep and your day sheet",
    summary: "What the studio needs before the day, and everything to work from on it.",
    audience: "crew",
    stage: "planning",
    routes: ["/crew/jobs", "/crew/prep", "/crew/schedule"],
    purpose:
      "Before the day, the job page tells you what the studio needs from you. On the day, your day sheet has everything to work from.",
    steps: [
      "Open **Jobs** and pick the job. The **Checklist** lists what the studio needs: paperwork, gear and the run of show.",
      "Send documents with **Take a photo** or **Choose a file**. The studio checks each one.",
      "Confirm gear with **I'll bring it**, and notes with **Got it**.",
      "Open the **Day sheet**: **Where**, **Who to call**, **Your role** and the **Running order**.",
      "At the bottom, tap **I've read version** so the studio knows you've read the latest.",
    ],
    next: "If the studio changes the run of show, the version number goes up and you'll be asked to confirm again.",
    goodToKnow: [
      "Two days before, you'll get an email with your call time, where to be and a link to the day sheet.",
      "The day sheet is saved on your phone, so it opens with no signal.",
      ({ has }) =>
        has.delivery
          ? "Only your own paperwork is here. You never see the client's contract, invoices or photos."
          : "Only your own paperwork is here. You never see the client's contract or invoices.",
    ],
    terms: ["call-time", "crew-checklist", "day-sheet"],
  },
  {
    id: "crew-closeout",
    title: "Send your hours and expenses",
    summary: "After a job, tell the studio your hours, costs and file links so they can pay you.",
    audience: "crew",
    stage: "after-the-wedding",
    routes: ["/crew/closeout"],
    purpose: "After a job, send your hours, expenses and links to your files so the studio can pay you.",
    steps: [
      "Open **Hours and expenses** from the job, or from **Today**.",
      "Check **Started** and **Finished**. Add **Extra time** only if you worked past the agreed wrap.",
      "Add costs with **Add an expense**, and links to your files with **Add a link**.",
      "Tap **Send to the studio**.",
    ],
    next: "The studio reviews it and schedules your payment; the date shows here. If they need a fix you'll see **Changes asked** with their note — update it and send again.",
    goodToKnow: ["Links need to start with https://.", "Travel and setup count as extra time only if the studio said so."],
    terms: ["crew-closeout"],
  },
  {
    id: "crew-availability",
    title: "Your availability and profile",
    summary: "Tell studios when you can work, and keep your details and papers up to date.",
    audience: "crew",
    stage: "admin",
    routes: ["/crew/availability", "/crew/account"],
    purpose: "Tell studios when you can work, and keep your profile and papers up to date so they can offer you jobs.",
    steps: [
      "Open **Calendar** and tap a day. Choose **I'm free**, **Maybe** or **I'm away**, then **Save**.",
      "To mark a run of days, fill in **Through (optional)**.",
      (t) =>
        photographer(t)
          ? "In **Me**, fill in **Your work** — what you shoot, where, and your gear — and your **Contact** details."
          : "In **Me**, fill in **Your work** — what you do, where, and what you bring — and your **Contact** details.",
      "Under **Your papers**, send your **W-9** and **Certificate of insurance**.",
      "Tap **Save changes**.",
    ],
    next: "Studios see your dates when they staff a job. Marking a day never books you; only accepting an offer does.",
  },
];

const text = (value: TradeText, t: HelpTrade): string => inTradeWords(typeof value === "function" ? value(t) : value, t);
const lines = (list: readonly TradeLine[], t: HelpTrade): string[] =>
  list
    .map((line) => (typeof line === "function" ? line(t) : line))
    .filter((line): line is string => line !== null)
    .map((line) => inTradeWords(line, t));

/** A guide in a trade's words, with only the words and the video that read right for it. */
function inTrade(source: ExplainerSource, t: HelpTrade): Explainer {
  const guide: Explainer = {
    id: source.id,
    title: text(source.title, t),
    summary: text(source.summary, t),
    audience: source.audience,
    stage: source.stage,
    routes: source.routes,
    purpose: text(source.purpose, t),
    steps: lines(source.steps, t),
  };
  if (source.alsoOn) guide.alsoOn = source.alsoOn;
  if (source.next !== undefined) guide.next = text(source.next, t);
  if (source.goodToKnow) guide.goodToKnow = lines(source.goodToKnow, t);
  // A word the trade doesn't have is left out. An id the glossary doesn't
  // know stays, so tests/help-content.test.ts still catches a typo.
  if (source.terms) guide.terms = source.terms.filter((id) => !glossaryTerm(id) || glossaryTerm(id, t.trade));
  if (source.video && videoSuitsTrade(source.video, t.trade)) guide.video = source.video;
  return guide;
}

/**
 * Every guide, in a photographer's words: the website's /how-to pages, the
 * sitemap and the video pipeline, none of which has a studio behind it.
 */
export const EXPLAINERS: readonly Explainer[] = GUIDES.map((source) => inTrade(source, helpTrade()));

const byTrade = new Map<string, readonly Explainer[]>();

/** The guides a studio of this trade gets, in its words. A missing trade is a photographer's. */
export function explainersFor(trade?: unknown): readonly Explainer[] {
  const t = helpTrade(trade);
  let guides = byTrade.get(t.trade);
  if (!guides) {
    guides = GUIDES.filter((source) => !source.offered || source.offered(t)).map((source) => inTrade(source, t));
    byTrade.set(t.trade, guides);
  }
  return guides;
}

/** A guide by id, in the trade's words; undefined when there's none, or the trade doesn't get it. */
export function explainer(id: string, trade?: unknown): Explainer | undefined {
  return explainersFor(trade).find((guide) => guide.id === id);
}
