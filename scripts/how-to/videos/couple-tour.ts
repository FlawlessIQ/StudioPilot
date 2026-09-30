import { defineHowTo } from "../lib/define";

/** Explainer: "couple-tour". Orient first, point before naming (Conor, 2026-09-30). */
const tab = (label: string) => ({ css: `.kit-tabbar a:has-text('${label}')` });

export default defineHowTo({
  id: "couple-tour",
  title: "Your wedding portal",
  start: { as: "client", viewport: "phone" },
  steps: [
    { do: [{ card: { eyebrow: "How to", title: "Your wedding portal", subtitle: "Everything from booking to your photos." } }, { wait: 2200 }] },
    {
      chapter: "Home",
      say: "Welcome to your wedding portal. Everything between booking and your photos happens here. Let's take a quick look around.",
      do: [{ goto: "/client" }, { waitFor: { css: ".kit-title" } }, { wait: 1200 }],
      poster: true,
    },
    {
      say: "At the top is the countdown to your day.",
      do: [{ spotlight: { css: "h1.kit-title" }, holdMs: 2400 }],
    },
    {
      chapter: "Your next step",
      say: "Just below, the highlighted card shows your next step: the one thing to do right now. Tap its button, and it takes you straight there.",
      do: [{ spotlight: { css: ".kit-card[data-tone='accent']" }, holdMs: 4200 }],
    },
    {
      chapter: "Your journey",
      say: "Scroll down, and you'll see Your journey: every step from booking to your photos, ticking off as each one is done.",
      do: [{ scrollTo: { css: "#journey-heading" } }, { spotlight: { css: ".kit-journey" }, holdMs: 4000 }],
    },
    {
      chapter: "The tabs",
      say: "Along the bottom of the screen are four tabs.",
      do: [{ spotlight: { css: ".kit-tabbar" }, holdMs: 2400 }],
    },
    {
      say: "Plan keeps everything in one list: your proposal, your agreement, payments, your questionnaire and your timeline.",
      do: [{ click: tab("Plan") }, { waitFor: { role: "heading", name: "Your plan" } }, { wait: 600 }, { spotlight: { css: "main" }, holdMs: 3400 }],
    },
    {
      say: "Messages is a chat with your photographer. Their replies come here, and to your email too.",
      do: [{ click: tab("Messages") }, { wait: 1800 }],
    },
    {
      say: "And Files holds everything they've shared with you, along with your signed agreement and your invoices.",
      do: [{ click: tab("Files") }, { wait: 1800 }],
    },
    {
      chapter: "Help",
      say: "Not sure what something means? Tap the question mark at the top of any screen for a short guide.",
      do: [{ spotlight: { css: ".kit-appbar .how-to-trigger" }, holdMs: 2000 }, { wait: 800 }, { click: { css: ".kit-appbar .how-to-trigger" } }, { wait: 1500 }],
      pauseAfterMs: 1400,
    },
    { do: [{ card: { eyebrow: "Next", title: "Sign your agreement" } }, { wait: 2600 }] },
  ],
});
