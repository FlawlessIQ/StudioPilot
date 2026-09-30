import { defineHowTo } from "../lib/define";

/** Explainer: "contract-retainer". Orient first, point before naming (Conor, 2026-09-30). */
const today = () => new Date().toISOString().slice(0, 10);

export default defineHowTo({
  id: "contract-retainer",
  title: "Get it signed and the retainer paid",
  start: { as: "owner", viewport: "desktop" },
  steps: [
    { do: [{ card: { eyebrow: "How to", title: "Get it signed and the retainer paid", subtitle: "Two things turn an inquiry into a booking." } }, { wait: 2200 }] },
    {
      chapter: "The Booking tab",
      say: "Let's get a couple booked. Open their job, and choose Booking from the tabs along the top.",
      do: [
        { goto: "/studio/projects/job-ferrante" },
        { waitFor: { css: ".project-workspace-nav" } },
        { wait: 800 },
        { spotlight: { css: ".project-workspace-nav" }, holdMs: 2000 },
        { click: { css: ".project-workspace-nav a:has-text('Booking')" } },
        { waitFor: { role: "heading", name: "Getting them booked" } },
      ],
    },
    {
      say: "A wedding is booked once two things are in: the signed agreement and the paid retainer. The row of three steps shows where this couple is: contract, retainer, then booking.",
      do: [{ scrollTo: { css: ".booking-progress" } }, { spotlight: { css: ".booking-progress" }, holdMs: 4600 }],
      poster: true,
    },
    {
      chapter: "The agreement",
      say: "Below it is the agreement. Once a couple accepts your proposal, it goes out for them to sign online. Here, one of them has signed so far.",
      do: [{ scrollTo: { css: ".booking-steps" } }, { spotlight: { css: ".booking-steps" }, holdMs: 4000 }],
    },
    {
      say: "StudioCue reminds them to sign, and moves on by itself the moment it's done.",
      do: [{ wait: 600 }],
    },
    {
      chapter: "The retainer",
      say: "Next is the retainer. Here's a couple who've signed, and whose retainer invoice has gone out.",
      do: [
        { goto: "/studio/booking?project=job-nowak" },
        { waitFor: { role: "heading", name: "Getting them booked" } },
        { wait: 600 },
        { scrollTo: { css: ".booking-progress" } },
        { spotlight: { css: ".booking-progress" }, holdMs: 2600 },
      ],
    },
    {
      say: "When they pay online, it's recorded here by itself. If they paid you another way, like a bank transfer, open Retainer paid outside StudioCue.",
      do: [
        { scrollTo: { text: "Retainer paid outside StudioCue? Record it" } },
        { spotlight: { text: "Retainer paid outside StudioCue? Record it" }, holdMs: 2200 },
        { wait: 900 },
        { click: { text: "Retainer paid outside StudioCue? Record it" } },
      ],
    },
    {
      say: "Add the date it arrived and how it was paid, then tap Record the payment.",
      do: [
        { fill: { into: { css: "input[name='paidAt']" }, value: today() } },
        { type: { into: { css: "input[name='method']" }, text: "Bank transfer" } },
        { wait: 400 },
        { click: { role: "button", name: "Record the payment" } },
        { wait: 2200 },
      ],
      pauseAfterMs: 1000,
    },
    {
      chapter: "Confirm the booking",
      say: "With the agreement signed and the retainer in, confirm the booking. Tap Check and confirm.",
      do: [
        { waitFor: { role: "button", name: "Check and confirm" }, timeoutMs: 30000 },
        { scrollTo: { role: "button", name: "Check and confirm" } },
        { spotlight: { role: "button", name: "Check and confirm" }, holdMs: 1800 },
        { click: { role: "button", name: "Check and confirm" } },
        { wait: 2500 },
      ],
      pauseAfterMs: 1200,
    },
    {
      say: "The job is booked. It moves from Inquiries to Jobs, and planning begins: the questionnaire, the crew, and the run of show.",
      do: [{ wait: 400 }, { spotlight: { css: ".booking-progress" }, holdMs: 3200 }],
    },
    { do: [{ card: { eyebrow: "Next", title: "Book your second shooter" } }, { wait: 2600 }] },
  ],
});
