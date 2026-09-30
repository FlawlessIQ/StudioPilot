import { defineHowTo } from "../lib/define";

/** Explainer: "couple-sign". Orient first, point before naming (Conor, 2026-09-30). */
export default defineHowTo({
  id: "couple-sign",
  title: "Sign your agreement",
  start: { as: "uat-a@studiohub.test", viewport: "phone" },
  steps: [
    { do: [{ card: { eyebrow: "How to", title: "Sign your agreement", subtitle: "Read it, then sign with your name." } }, { wait: 2200 }] },
    {
      chapter: "Finding it",
      say: "Let's sign your agreement. You'll get an email with a link, or you can find it in your portal: tap Plan at the bottom of the screen.",
      do: [
        { goto: "/client" },
        { waitFor: { css: ".kit-tabbar" } },
        { wait: 900 },
        { spotlight: { css: ".kit-tabbar a:has-text('Plan')" }, holdMs: 1800 },
        { click: { css: ".kit-tabbar a:has-text('Plan')" } },
        { waitFor: { role: "heading", name: "Your plan" } },
      ],
    },
    {
      say: "Under Booking, tap Agreement.",
      do: [
        { spotlight: { css: "a.kit-row:has-text('Agreement'), a:has-text('Agreement')" }, holdMs: 1600 },
        { click: { css: "a.kit-row:has-text('Agreement'), a:has-text('Agreement')" } },
        { waitFor: { css: "h1.kit-title" } },
        { wait: 800 },
      ],
    },
    {
      chapter: "Reading it",
      say: "This is your agreement with your photographer, written from the proposal you accepted. Take your time and read it through.",
      do: [{ spotlight: { css: "h1.kit-title" }, holdMs: 2400 }, { scrollBy: 700 }, { wait: 1400 }, { scrollBy: 700 }],
      poster: true,
    },
    {
      say: "If there's anything you'd like changed, ask before you sign, using the link just above the sign button.",
      do: [{ scrollTo: { text: /Something to change\? Ask before you sign/ } }, { spotlight: { text: /Something to change\? Ask before you sign/ }, holdMs: 2800 }],
    },
    {
      chapter: "Signing",
      say: "When you're happy, tap Review and sign at the bottom of the screen.",
      do: [
        { spotlight: { role: "button", name: /Review & sign/ }, holdMs: 1600 },
        { click: { role: "button", name: /Review & sign/ } },
        { waitFor: { role: "dialog", name: /.+/ } },
        { wait: 800 },
      ],
    },
    {
      say: "Tick the box to agree to sign electronically, then type your full name. Your typed name is your signature.",
      do: [
        { click: { css: ".sheet-dialog input[type='checkbox']" } },
        { wait: 500 },
        { type: { into: { css: ".sheet-dialog input[type='text'], .sheet-dialog input:not([type])" }, text: "Harper Lane" } },
        { wait: 600 },
      ],
    },
    {
      say: "Then tap Sign agreement.",
      do: [
        { spotlight: { css: ".sheet-dialog button:has-text('Sign')" }, holdMs: 1400 },
        { click: { css: ".sheet-dialog button:has-text('Sign')" } },
        { wait: 3000 },
      ],
      pauseAfterMs: 1000,
    },
    {
      chapter: "Done",
      say: "That's it: your agreement is signed. A copy is emailed to you, and you can download it here any time. Next comes your retainer, which reserves your date.",
      do: [{ wait: 600 }, { spotlight: { css: "main" }, holdMs: 3600 }],
    },
    { do: [{ card: { eyebrow: "Next", title: "Accept or decline a job", subtitle: "For crew" } }, { wait: 2600 }] },
  ],
});
