import { defineHowTo } from "../lib/define";

/**
 * Explainer: "setup". Orient first, point before naming (Conor, 2026-09-30).
 *
 * v5 (2026-10-26) does the setup instead of touring it. A studio that paid
 * and left setup within a minute (Alex Knight, Oct 16) had been shown seven
 * questions and no way through them; v4 showed the same list. This one starts
 * from a studio that has just signed up (scripts/how-to/fresh-studio.mts) and
 * answers the questions that matter before a first booking: the kinds of work,
 * the form link, call hours, prices pasted and added, and the starter
 * agreement finished from its examples.
 */
const PRICE_LIST = [
  "Essential - $3,200",
  "6 hours of coverage, one photographer, online gallery with high-resolution downloads.",
  "",
  "Signature - $4,800",
  "8 hours of coverage, two photographers, engagement session, online gallery.",
  "",
  "Heirloom - $6,500",
  "10 hours of coverage, two photographers, engagement session, 10x10 heirloom album.",
  "",
  "Add-ons",
  "Extra hour of coverage - $400",
  "Second photographer - $600",
  "",
  "A 30% retainer reserves your date. The balance is due 30 days before the wedding.",
].join("\n");

export default defineHowTo({
  id: "setup",
  title: "Set up your studio",
  start: { as: "new@studiohub.test", viewport: "desktop" },
  from: "fresh-studio",
  steps: [
    { do: [{ card: { eyebrow: "How to", title: "Set up your studio", subtitle: "About ten minutes, start to finish." } }, { wait: 2200 }] },
    {
      chapter: "Where to start",
      say: "This is setup: seven short questions about how your studio runs. Each one says what it's needed for, and the one marked Next is where to start.",
      do: [
        { goto: "/studio/setup" },
        { waitFor: { css: ".setup-questions" } },
        { wait: 600 },
        { spotlight: { css: ".setup-questions" }, holdMs: 2400 },
        { spotlight: { text: /^Next ·/ }, holdMs: 2000 },
      ],
      poster: true,
    },
    {
      say: "First, what you shoot. Check every kind of event you take on, then save. Your inquiry form offers just these.",
      do: [
        { spotlight: { text: "What do you shoot?" }, holdMs: 1600 },
        { click: { role: "checkbox", name: "Family & portraits" } },
        { wait: 500 },
        { click: { role: "button", name: "Save", exact: true, nth: 0 } },
        { waitFor: { text: /Your inquiry form offers/ } },
        { wait: 800 },
      ],
    },
    {
      say: "Your inquiry form is already live. Copy its link and put it on your website or Instagram, and every new inquiry arrives here, filled in.",
      do: [
        { scrollTo: { text: "How do inquiries reach you?" } },
        { spotlight: { text: "How do inquiries reach you?" }, holdMs: 1800 },
        { click: { role: "button", name: /Copy your form link/ } },
        { wait: 1400 },
      ],
      pauseAfterMs: 1000,
    },
    {
      say: "Then, when clients can book a call with you. One tap sets Monday to Friday, nine to five.",
      do: [
        { scrollTo: { text: "When can clients book a call?" } },
        { spotlight: { text: "When can clients book a call?" }, holdMs: 1600 },
        { click: { role: "button", name: /Use Mon/ } },
        // The card folds to "Done" a moment after the save: let the page settle.
        { waitFor: { text: /Calls can be booked/ } },
        { wait: 1200 },
      ],
      pauseAfterMs: 900,
    },
    {
      chapter: "Your prices",
      say: "Now your prices. Tap Paste or upload your prices.",
      do: [
        { scrollTo: { text: "What do you charge?" } },
        { wait: 700 },
        { spotlight: { role: "link", name: /Paste or upload your prices/ }, holdMs: 1400 },
        { click: { role: "link", name: /Paste or upload your prices/ } },
        { waitFor: { role: "heading", name: "Add your prices" } },
      ],
    },
    {
      say: "Paste your price list just as you'd send it to a couple: each package and its price, any extras, and your retainer. Then tap Draft my packages.",
      do: [
        { click: { role: "tab", name: /Paste it/ } },
        { wait: 500 },
        { fill: { into: { css: "textarea" }, value: PRICE_LIST } },
        { wait: 1600 },
        { click: { role: "button", name: /Draft my packages/ } },
        { cut: [{ waitFor: { text: /packages StudioCue found/ }, timeoutMs: 90_000 }] },
      ],
    },
    {
      say: "StudioCue drafts a package for each one: the price, the hours, who you send, the retainer and the extras. Nothing is invented, and nothing is added until you say so.",
      do: [
        { scrollTo: { text: /packages StudioCue found/ } },
        { spotlight: { css: ".setup-package-list" }, holdMs: 5200 },
      ],
    },
    {
      say: "If it looks right, add them. Any detail can be changed later, on the package itself.",
      do: [
        { click: { role: "button", name: /Add these 3 packages/ } },
        { waitFor: { text: "3 packages added" }, timeoutMs: 30_000 },
        { wait: 1200 },
        { click: { role: "link", name: "Back to setup", nth: 1 } },
        { waitFor: { css: ".setup-questions" } },
      ],
    },
    {
      chapter: "Your agreement",
      say: "Next, your agreement. Every client's contract is written from it, with their details and the price they accepted filled in.",
      do: [
        { scrollTo: { text: "How do your clients sign?" } },
        { spotlight: { text: "How do your clients sign?" }, holdMs: 1600 },
        { click: { role: "link", name: /Set up your agreement/ } },
        { waitFor: { text: /Finish your agreement/ } },
      ],
    },
    {
      say: "The starter needs just three sections only you can write. Each one is a question, with an example to start from. Use it as it is, change it, or write your own.",
      do: [
        { spotlight: { css: ".starter-guide" }, holdMs: 2200 },
        { click: { role: "button", name: "Start from this example" } },
        { wait: 900 },
        { spotlight: { css: ".starter-guide-question textarea" }, holdMs: 1800 },
        { click: { role: "button", name: /Put it in your agreement/ } },
      ],
    },
    {
      say: "Do the same for the rest. Each answer goes straight into the agreement, so you can read it in the preview as you go.",
      do: [
        { wait: 600 },
        { click: { role: "button", name: "Start from this example" } },
        { wait: 700 },
        { click: { role: "button", name: /Put it in your agreement/ } },
        { wait: 900 },
        { click: { role: "button", name: "Start from this example" } },
        { wait: 700 },
        { click: { role: "button", name: /Put it in your agreement/ } },
        { waitFor: { text: "Every section is filled in" } },
      ],
    },
    {
      say: "When every section is filled in, read it through, then save it.",
      do: [
        { scrollTo: { role: "button", name: /Save your agreement/ } },
        { spotlight: { role: "button", name: /Save your agreement/ }, holdMs: 1200 },
        { click: { role: "button", name: /Save your agreement/ } },
        { waitFor: { text: /Saved as version 1/, nth: 0 }, timeoutMs: 30_000 },
      ],
      pauseAfterMs: 900,
    },
    {
      chapter: "You're ready",
      say: "Back on setup, your prices, call hours and agreement are done, and your client questionnaires are ready too. That's everything you need to answer your first inquiry and send a proposal.",
      do: [
        { goto: "/studio/setup" },
        { waitFor: { css: ".setup-questions" } },
        { wait: 600 },
        { spotlight: { css: ".setup-questions" }, holdMs: 4000 },
      ],
    },
    {
      say: "Anything you skip, StudioCue brings back on Today when a job needs it.",
      do: [{ spotlight: { css: ".ds-sidebar a.ds-nav-item[href='/studio']" }, holdMs: 2400 }],
    },
    { do: [{ card: { eyebrow: "You're set up", title: "Ready for your first inquiry" } }, { wait: 2600 }] },
  ],
});
