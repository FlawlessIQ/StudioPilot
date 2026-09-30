import { defineHowTo } from "../lib/define";

/** Explainer: features/help/explainers.ts → "today". */
export default defineHowTo({
  id: "today",
  title: "Work from Today",
  start: { as: "owner", viewport: "desktop" },
  steps: [
    {
      do: [{ card: { eyebrow: "How to", title: "Work from Today", subtitle: "Start each day here." } }, { wait: 2400 }],
    },
    {
      chapter: "Your inbox",
      say: "Today is where you start each day. It shows everything waiting on you, most urgent first. And if nothing's waiting, nothing is wrong.",
      do: [{ goto: "/studio" }, { waitFor: { css: ".today-hero" } }, { wait: 900 }],
      poster: true,
    },
    {
      say: "The headline is the single most urgent thing. Here, a payment is overdue, and one tap takes you straight to it.",
      do: [{ spotlight: { css: ".today-hero-copy" }, holdMs: 2600 }, { wait: 1400 }, { hover: { css: ".today-hero-go" } }],
    },
    {
      chapter: "Prepared for you",
      say: "Below it is Prepared for you: reminders, replies and next steps StudioCue has already drafted, each waiting for one decision.",
      do: [
        { scrollTo: { css: "section[aria-label='Ready for your approval']" } },
        { spotlight: { css: "section[aria-label='Ready for your approval']" }, holdMs: 3200 },
      ],
    },
    {
      say: "Tap Review to read one first.",
      do: [{ click: { role: "button", name: "Review", exact: true } }, { waitFor: { role: "dialog", name: /.+/ } }],
    },
    {
      say: "Approve it as it is, or edit it first. It only goes out when you say so.",
      do: [{ wait: 1600 }, { hover: { css: ".sheet-dialog button:has-text('Approve')" } }, { wait: 500 }, { click: { css: ".sheet-dialog button:has-text('Approve')" } }],
      pauseAfterMs: 900,
    },
    {
      chapter: "Only you can do this",
      say: "Further down are the decisions only you can make, sorted by how late they are. Each one opens right where you finish it.",
      do: [
        { scrollTo: { css: "section[aria-label='Needs you'] .today-lane-heading" } },
        { spotlight: { css: "section[aria-label='Needs you'] .today-lane-heading" }, holdMs: 2400 },
      ],
    },
    {
      say: "Anything waiting on someone else sits under In motion, and comes back to Today by itself when it needs you again.",
      do: [{ scrollBy: -2000 }, { spotlight: { css: ".today-rail-card.is-quiet" }, holdMs: 3000 }],
    },
    {
      chapter: "Help on every screen",
      say: "And every screen has a How to button, with the guide for exactly what you're looking at.",
      do: [{ click: { css: ".ds-topbar .how-to-trigger" } }, { wait: 1200 }],
      pauseAfterMs: 1200,
    },
    {
      do: [{ card: { eyebrow: "Next", title: "Answer a new inquiry" } }, { wait: 2600 }],
    },
  ],
});
