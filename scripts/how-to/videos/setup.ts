import { defineHowTo } from "../lib/define";

/** Explainer: "setup". Orient first, point before naming (Conor, 2026-09-30). */

export default defineHowTo({
  id: "setup",
  title: "Set up your studio",
  start: { as: "owner", viewport: "desktop" },
  steps: [
    { do: [{ card: { eyebrow: "How to", title: "Set up your studio", subtitle: "Seven questions, most answered in place." } }, { wait: 2200 }] },
    {
      chapter: "Finding setup",
      say: "Let's set up your studio. On the Today tab, look for the card that says Finish setting up your studio, and tap Continue setup.",
      do: [
        { goto: "/studio" },
        { waitFor: { css: ".today-hero-go" } }, { wait: 800 },
        { spotlight: { role: "link", name: /Continue setup/ }, holdMs: 2600 },
        { wait: 900 },
        { click: { role: "link", name: /Continue setup/ } },
        { waitFor: { role: "heading", name: /set up your studio/ } },
      ],
    },
    {
      say: "Setup is seven short questions. Each one says why it matters, and most can be answered right here on the page.",
      do: [{ spotlight: { css: ".setup-questions" }, holdMs: 3600 }],
      poster: true,
    },
    {
      chapter: "The questions",
      say: "The ones with a tick are already done. The first asks what you shoot: weddings, portraits, corporate or sports. It sets the words StudioCue uses with each client, and the types on your inquiry form.",
      do: [{ spotlight: { text: "What do you shoot?" }, holdMs: 3400 }],
    },
    {
      say: "The next asks how inquiries reach you, so every new client lands in StudioCue.",
      do: [{ spotlight: { text: "How do inquiries reach you?" }, holdMs: 2600 }],
    },
    {
      say: "Then, when clients can book a call with you. Tap Use Mon to Fri, nine to five, or choose your own hours.",
      do: [
        { spotlight: { text: "When can clients book a call?" }, holdMs: 2200 },
        { wait: 900 },
        { hover: { role: "button", name: /Use Mon/ } },
        { wait: 600 },
        { click: { role: "button", name: /Use Mon/ } },
      ],
      pauseAfterMs: 1000,
    },
    {
      say: "Further down, you'll tell StudioCue what you charge, how your clients sign, what you ask couples before the day, and who sends your insurance certificates.",
      do: [
        { scrollTo: { text: "What do you charge?" } },
        { spotlight: { text: "What do you charge?" }, holdMs: 1400 },
        { spotlight: { text: "How do your clients sign?" }, holdMs: 1400 },
        { spotlight: { text: "What do you ask couples before the day?" }, holdMs: 1400 },
        { spotlight: { text: "Who sends your certificates of insurance?" }, holdMs: 1800 },
      ],
    },
    {
      chapter: "Skip anything",
      say: "You can skip anything you're not ready for. StudioCue brings it back on Today when a job actually needs it, and every answer can be changed later in Studio settings.",
      do: [{ wait: 600 }, { spotlight: { css: ".ds-sidebar a.ds-nav-item[href='/studio/settings']" }, holdMs: 2600 }],
    },
    { do: [{ card: { eyebrow: "Next", title: "Put your inquiry form on your website" } }, { wait: 2600 }] },
  ],
});
