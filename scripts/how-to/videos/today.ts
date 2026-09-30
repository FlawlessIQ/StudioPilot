import { defineHowTo } from "../lib/define";

/**
 * Explainer: features/help/explainers.ts → "today".
 *
 * Narration rules (Conor, 2026-09-30): open by orienting the viewer, and point
 * at each part — where it is, what it looks like — before naming or
 * explaining it. The first cut named "the headline" before anyone could see
 * which part that was.
 */
export default defineHowTo({
  id: "today",
  title: "Work from Today",
  start: { as: "owner", viewport: "desktop" },
  steps: [
    {
      do: [{ card: { eyebrow: "How to", title: "Work from Today", subtitle: "Your daily inbox in StudioCue." } }, { wait: 2200 }],
    },
    {
      chapter: "Finding Today",
      say: "Let's go through the Today tab. You'll find it at the top of the menu on the left.",
      do: [
        { goto: "/studio/projects" },
        { waitFor: { role: "heading", name: "Jobs" } },
        { spotlight: { css: ".ds-sidebar a[href='/studio']" }, holdMs: 2200 },
        { wait: 900 },
        { click: { css: ".ds-sidebar a[href='/studio']" } },
        { waitFor: { css: ".today-hero-go" } }, { wait: 800 },
      ],
    },
    {
      say: "Today is your inbox. It shows everything that's waiting on you, with the most urgent things first. And if nothing's waiting, nothing is wrong.",
      do: [{ wait: 600 }],
      poster: true,
    },
    {
      chapter: "The headline card",
      say: "Start with the big green card at the top. This is the headline card, and it always shows the one thing that most needs you right now.",
      do: [{ spotlight: { css: ".today-hero" }, holdMs: 3400 }],
    },
    {
      say: "Here, a couple's payment is overdue. The button on the card takes you straight to it.",
      do: [{ wait: 900 }, { hover: { css: ".today-hero-go" } }, { spotlight: { css: ".today-hero-go" }, holdMs: 2000 }],
    },
    {
      chapter: "Prepared for you",
      say: "Just below the headline card is a list called Prepared for you.",
      do: [
        { scrollTo: { css: "section[aria-label='Ready for your approval'] .today-lane-heading" } },
        { spotlight: { css: "section[aria-label='Ready for your approval'] .today-lane-heading" }, holdMs: 2200 },
      ],
    },
    {
      say: "Each card in this list is something StudioCue has already drafted for you, like a reminder, a reply, or a next step. Each one needs just one decision from you.",
      do: [{ wait: 500 }, { spotlight: { css: "section[aria-label='Ready for your approval']" }, holdMs: 4200 }],
    },
    {
      say: "To read a draft before deciding, tap Review on its card.",
      do: [
        { hover: { role: "button", name: "Review", exact: true } },
        { wait: 700 },
        { click: { role: "button", name: "Review", exact: true } },
        { waitFor: { role: "dialog", name: /.+/ } },
      ],
    },
    {
      say: "If it looks right, approve it as it is, or edit it first. Nothing goes to a couple until you say so.",
      do: [
        { wait: 2200 },
        { spotlight: { css: ".sheet-dialog button:has-text('Approve')" }, holdMs: 1600 },
        { hover: { css: ".sheet-dialog button:has-text('Approve')" } },
        { wait: 700 },
        { click: { css: ".sheet-dialog button:has-text('Approve')" } },
      ],
    },
    {
      say: "Once it's approved, it drops off your list.",
      do: [{ wait: 400 }, { spotlight: { css: "section[aria-label='Ready for your approval']" }, holdMs: 2200 }],
    },
    {
      chapter: "Only you can do this",
      say: "Keep scrolling, and you'll reach the things only you can decide, grouped by how late they are, starting with anything that's already late.",
      do: [
        { scrollTo: { css: "section[aria-label='Needs you'] .today-lane-heading" } },
        { spotlight: { css: "section[aria-label='Needs you'] .today-lane-heading" }, holdMs: 2200 },
        { wait: 600 },
        { spotlight: { css: "section[aria-label='Needs you'] .today-band" }, holdMs: 3000 },
      ],
    },
    {
      chapter: "In motion",
      say: "Now look over on the right-hand side, at the card called In motion. It counts the jobs that are waiting on someone else: a couple, a provider, or a date.",
      do: [{ scrollBy: -2000 }, { spotlight: { css: ".today-rail-card.is-quiet" }, holdMs: 4200 }],
    },
    {
      say: "There's nothing for you to do with those. Each one comes back to Today by itself when it needs you again.",
      do: [{ wait: 400 }],
    },
    {
      chapter: "Help on every screen",
      say: "Finally, see the How to button at the top of the screen? It's on every page, and it opens a guide to whatever you're looking at.",
      do: [
        { spotlight: { css: ".ds-topbar .how-to-trigger" }, holdMs: 2400 },
        { wait: 1600 },
        { click: { css: ".ds-topbar .how-to-trigger" } },
      ],
      pauseAfterMs: 1500,
    },
    {
      do: [{ card: { eyebrow: "Next", title: "Answer a new inquiry" } }, { wait: 2600 }],
    },
  ],
});
