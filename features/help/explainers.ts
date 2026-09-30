import type { Explainer } from "./types";

/**
 * The written guides behind each screen's "How to" button.
 *
 * Every **bold** phrase is a label the screen really shows, spelled the way
 * it spells it — tests/help-content.test.ts fails when one no longer exists
 * in the source, so a renamed button can't leave a guide describing the old
 * one. Plan: docs/how-to-videos-plan-2026-09-30.md (§2a lists the rest).
 */
export const EXPLAINERS: readonly Explainer[] = [
  // ── Studio ────────────────────────────────────────────────────────────
  {
    id: "tour",
    title: "A tour of StudioCue",
    summary: "The four places that do most of the work, and where everything else lives.",
    audience: "studio",
    stage: "getting-started",
    routes: ["/studio/help", "/studio/help/example"],
    video: "tour",
    purpose:
      "StudioCue runs your studio from the first inquiry to the final gallery. Four places in the menu do most of the work.",
    steps: [
      "**Today** is your inbox: everything that needs a decision, most urgent first. Drafts StudioCue has written wait under **Prepared for you** — **Approve** them as they are, or **Review** them first.",
      "**Inquiries** holds everyone who hasn't booked yet, by stage — **New**, **Talking**, **Consult**, **Proposal**, **Signing** — and shows whose move it is.",
      "**Jobs** holds every booked wedding. Open one to see its whole story and **Your next move**.",
      "**Cue** is your assistant. Ask it to draft an email, prepare a proposal or tell you what's outstanding — it prepares, you approve.",
      "**Calendar**, **Messages**, **Clients** and **Insights** sit under **More** on a phone. Your packages and templates live in **Library**.",
    ],
    next: "Every screen has a **How to** button at the top. It opens the guide for whatever you're looking at.",
    goodToKnow: [
      "Nothing reaches a client until you approve it, apart from the few routine emails you choose to send automatically.",
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
      "Work through **Prepared for you** — replies, reminders and bills StudioCue has drafted. **Approve** sends one as written; **Review** opens it so you can edit it first.",
      "For a new inquiry, read the **Reply ready** draft and tap **Send reply**, or **Edit** it first. If it isn't really an inquiry, tap **Not an inquiry**.",
      "Then clear what's under **Only you can do this** — the decisions StudioCue can't make for you. Each one opens where you finish it.",
      "When a couple goes quiet, you'll be asked to **Close — went quiet** or **Keep it open**.",
    ],
    next: "Anything waiting on someone else sits under **In motion** and comes back to Today by itself when it needs you again.",
    goodToKnow: [
      "**Handled for you** lists what StudioCue did without you, so you can always check.",
      "A reply only includes a booking link once your consultation hours are set.",
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
      "Inquiries holds everyone who's asked about a date but hasn't booked. A confirmed inquiry with a date becomes a job straight away, so nothing slips.",
    steps: [
      "Open **Inquiries**. **Open** shows everyone still in play; the other tabs split them by stage, from **New** to **Signing**. **Your move** marks the ones waiting on you.",
      "Answer from **Today**: StudioCue drafts a reply to each new inquiry. Read it, then **Send reply**. It includes a link where the couple can add details and pick a consultation time.",
      "Unsure emails arrive as **Maybe an inquiry** — tap **Yes, an inquiry** or **Not an inquiry**.",
      "No answer? A follow-up is drafted on day 3 and day 7, ready for **Send follow-up**.",
      "If it doesn't book, open the job, choose **Close inquiry** and pick why — **Went quiet**, **Booked someone else**, **Budget** and so on.",
    ],
    next: "Once they book a consultation the inquiry moves to **Consult**, and a proposal comes next. When they sign and pay the retainer, it leaves Inquiries for **Jobs**.",
    goodToKnow: [
      "**Preview inquiry form** shows the form couples fill in. Put its link on your website and every submission lands here.",
      "Inquiries by email, The Knot or WeddingWire can be forwarded in — **Copy address** and forward to it from your inbox.",
      "A closed inquiry reopens by itself if the couple writes again.",
    ],
    terms: ["inquiry", "inquiry-link", "forwarding-address", "consultation", "lost"],
  },
  {
    id: "proposal",
    title: "Build and send a proposal",
    summary: "Package, extras, price and payment dates — drafted for you, approved by you, sent in one tap.",
    audience: "studio",
    stage: "inquiry-to-booking",
    routes: ["/studio/proposals", "/studio/proposals/**"],
    alsoOn: ["/studio/booking"],
    video: "proposal",
    purpose:
      "A proposal is what a couple sees before they book: the package, any extras, the price and the payment dates. You build it, approve it, then send it.",
    steps: [
      "On the job's **Booking** tab choose **Prepare the proposal**, or start from the proposals list with **New proposal**.",
      "Under **Choose the client and event**, check the couple and the package they're booking.",
      "Under **Frame the offer**, tap **Draft from what they told you** for an introduction written from their inquiry, then make it yours.",
      "Set **Proposal expires**, **Retainer due** and **Final balance due**, then **Create draft**. Nothing is sent yet.",
      "Add an album or other extra with **Add from your library**, or **Write one for this couple**.",
      "Check it over, **Approve this proposal**, tick **Ready to share with the client** and **Send proposal**.",
    ],
    next: "The couple gets a branded email with the proposal and a link to their portal, where they **Accept proposal** or **Request changes**. Once they accept, signing the agreement is their next step.",
    goodToKnow: [
      "Team members who aren't an owner or admin see **Send for approval** instead.",
      "Need to change it after sending? **Correct and re-issue** sends a new version.",
      "Accepted by phone or email? **Record the acceptance**.",
    ],
    terms: ["proposal", "package", "add-on", "retainer", "final-balance"],
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
      "Once it's signed, **Create retainer invoice**. The couple pays it online.",
      "Signed or paid outside StudioCue? **Record the signature** or **Record the payment**. Booking without a retainer? **Confirm the booking without a retainer**.",
      "Under **Confirm booking**, tap **Check and confirm**. When **Automatic confirmation is active**, it confirms by itself.",
    ],
    next: "The job turns Booked, moves from Inquiries to **Jobs**, and planning begins: questionnaire, crew and run of show.",
    goodToKnow: [
      "Recording a payment doesn't book the job by itself — confirm the booking to finish.",
      "With StudioCue signing, the couple is reminded to sign after 3 and 7 days.",
      "The retainer invoice goes through QuickBooks, so connect it first.",
    ],
    terms: ["agreement", "retainer", "booking-gate"],
  },
  {
    id: "job-page",
    title: "Follow one wedding from start to finish",
    summary: "Where a job is, the one thing to do next, and everything that's happened.",
    audience: "studio",
    stage: "every-day",
    routes: ["/studio/projects", "/studio/projects/*", "/studio/projects/new"],
    alsoOn: ["/studio/planning", "/studio/delivery"],
    video: "job-page",
    purpose:
      "Every client has one job: their whole story in one place, from inquiry to closeout. Open it from **Jobs** or from any card on Today.",
    steps: [
      "Open **Jobs** and pick a wedding. **Active** and **Archived** split them, and the chips filter by type.",
      "The track along the top shows where it is: **Enquiry**, **Booking**, **Preparation**, **The day**, **Delivery**.",
      "Start with **Your next move** — the one thing to do now. **Nothing for you right now** means it's waiting on someone else.",
      "Drafts for this job wait under **Prepared for you**, ready to approve.",
      "The tabs — **Overview**, **Booking**, **Plan**, **Delivery** — hold each stage's detail.",
      "Keep the record in **Job history**: **Log a call**, **Ask Cue** about the job, or **Add a task**.",
    ],
    next: "As the couple signs, pays and fills things in, the job moves along the track by itself.",
    goodToKnow: [
      "**Edit job** changes the date, venue or type; **Add a client** adds a second contact.",
      "A new client? **Create project** starts a job from their message.",
      "Weddings booked before StudioCue? **Import bookings** brings them in without emailing anyone.",
    ],
    terms: ["job", "readiness"],
  },

  // ── Couple ────────────────────────────────────────────────────────────
  {
    id: "couple-tour",
    title: "Your wedding portal",
    summary: "Where everything between booking and your photos happens.",
    audience: "couple",
    stage: "getting-started",
    routes: ["/client", "/client/plan", "/client/project"],
    video: "couple-tour",
    purpose:
      "This is your wedding portal. Everything between booking and your photos happens here, and your photographer sees what you do straight away.",
    steps: [
      "**Home** shows the countdown to your day and **Your next step** — the one thing to do now. Tap its button to do it.",
      "**Your journey** lists every step from booking to your photos, ticking off as each is done.",
      "**Plan** keeps everything in one list: your proposal, your agreement, **Payments**, your questionnaire and your timeline.",
      "**Messages** is a chat with your photographer, and **Files** holds anything they've shared with you.",
    ],
    next: "When your photographer needs something from you, you'll get an email with a link straight back here.",
    goodToKnow: ["**Your studio is on it** means there's nothing for you to do right now."],
    terms: ["couple-journey", "couple-retainer", "couple-final-balance"],
  },

  // ── Crew ──────────────────────────────────────────────────────────────
  {
    id: "crew-tour",
    title: "Find your jobs and accept offers",
    summary: "Offers, your schedule and everything for the day, on your phone.",
    audience: "crew",
    stage: "getting-started",
    routes: ["/crew", "/crew/**"],
    video: "crew-offer-accept",
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
];

const byId = new Map(EXPLAINERS.map((guide) => [guide.id, guide]));

export function explainer(id: string): Explainer | undefined {
  return byId.get(id);
}
