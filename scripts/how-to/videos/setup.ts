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
 *
 * Narrated by Matilda with a quiet bed under her, and it opens on the title
 * and the page before anyone speaks (Conor, 2026-10-26: not straight into
 * talking, the woman's voice, more explanatory, a little music).
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
  voice: "voice.journey.json",
  music: "calm",
  steps: [
    { do: [{ card: { eyebrow: "How to", title: "Set up your studio", subtitle: "About ten minutes, start to finish." } }, { wait: 3600 }] },
    // A breath on the page before the first word.
    {
      chapter: "Where to start",
      // The load is cut, so the card gives way to the page, not a spinner.
      do: [{ cut: [{ goto: "/studio/setup" }, { waitFor: { css: ".setup-questions" } }, { wait: 900 }] }, { wait: 2200 }],
    },
    {
      say: "This is setup. It's seven short questions about how your studio runs, and you can answer most of them right here on this page. Each one says what it's needed for, so you know what matters now and what can wait. Start with the one marked Next.",
      do: [
        { spotlight: { css: ".setup-questions" }, holdMs: 3400 },
        { spotlight: { text: /^Next ·/ }, holdMs: 2000 },
      ],
      poster: true,
    },
    {
      say: "First, tell StudioCue what you shoot. Check every kind of event you take on, then tap Save. Your inquiry form will offer just these, and each kind of job gets its own steps and its own words.",
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
      say: "Next, how inquiries reach you. Your inquiry form is already live. Copy its link and put it on your website, your Instagram bio or your email signature. Every inquiry that comes in through it lands in StudioCue, filled in, with a reply drafted for you.",
      do: [
        { scrollTo: { text: "How do inquiries reach you?" } },
        { spotlight: { text: "How do inquiries reach you?" }, holdMs: 1800 },
        { click: { role: "button", name: /Copy your form link/ } },
        { wait: 1400 },
      ],
      pauseAfterMs: 1000,
    },
    {
      say: "Then choose when clients can book a call with you. One tap sets Monday to Friday, nine to five, or you can choose your own hours. Clients pick a time themselves, so there's no back and forth.",
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
      say: "Now your prices. These become the packages you offer in every proposal. Tap Paste or upload your prices.",
      do: [
        { scrollTo: { text: "What do you charge?" } },
        { wait: 700 },
        { spotlight: { role: "link", name: /Paste or upload your prices/ }, holdMs: 1400 },
        { click: { role: "link", name: /Paste or upload your prices/ } },
        { waitFor: { role: "heading", name: "Add your prices" } },
      ],
    },
    {
      say: "You don't need to retype anything. Paste your price list just as you'd send it to a couple: each package and its price, any extras, and your retainer. Then tap Draft my packages.",
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
      say: "StudioCue reads the list and drafts a package for each one: the price, the hours, who you send, the retainer and the extras. Check each card. Nothing is invented, and nothing is added until you say so.",
      do: [
        { scrollTo: { text: /packages StudioCue found/ } },
        { spotlight: { css: ".setup-package-list" }, holdMs: 5200 },
      ],
    },
    {
      say: "If it all looks right, add them. You can change any detail later, on the package itself. Then head back to setup.",
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
      say: "Next, your agreement. This is the contract every client signs. StudioCue writes each one from it, with the client's details and the price they accepted already filled in, and they sign it online.",
      do: [
        { scrollTo: { text: "How do your clients sign?" } },
        { spotlight: { text: "How do your clients sign?" }, holdMs: 1600 },
        { click: { role: "link", name: /Set up your agreement/ } },
        { waitFor: { text: /Finish your agreement/ } },
      ],
    },
    {
      say: "If you have your own contract, you can upload it here. Or finish StudioCue's starter. It needs just three sections that are yours to write, and each one is a simple question with an example to start from. Use the example as it is, change it to suit you, or write your own.",
      do: [
        { spotlight: { css: ".starter-guide" }, holdMs: 2200 },
        { click: { role: "button", name: "Start from this example" } },
        { wait: 900 },
        { spotlight: { css: ".starter-guide-question textarea" }, holdMs: 1800 },
        { click: { role: "button", name: /Put it in your agreement/ } },
      ],
    },
    {
      say: "Do the same for the other sections. Each answer goes straight into your agreement, and you can read the whole thing in the preview as you go.",
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
      say: "When every section is filled in, read it through once, then save it.",
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
      say: "Back on setup, your prices, call hours and agreement are all done, and your client questionnaires are ready too. That's everything you need to answer your first inquiry and send a proposal.",
      do: [
        { cut: [{ goto: "/studio/setup" }, { waitFor: { css: ".setup-questions" } }, { wait: 900 }] },
        { spotlight: { css: ".setup-questions" }, holdMs: 4000 },
      ],
    },
    {
      say: "Anything you skip isn't lost. StudioCue brings it back on Today when a job actually needs it, and every answer can be changed later.",
      do: [{ spotlight: { css: ".ds-sidebar a.ds-nav-item[href='/studio']" }, holdMs: 2400 }],
    },
    { do: [{ card: { eyebrow: "You're set up", title: "Ready for your first inquiry" } }, { wait: 3600 }] },
  ],
});
