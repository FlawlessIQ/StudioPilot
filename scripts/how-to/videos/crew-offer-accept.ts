import { defineHowTo } from "../lib/define";

/** Explainer: "crew-offer-accept". Orient first, point before naming (Conor, 2026-09-30). */
export default defineHowTo({
  id: "crew-offer-accept",
  title: "Accept or decline a job",
  start: { as: "crew", viewport: "phone" },
  steps: [
    { do: [{ card: { eyebrow: "How to", title: "Accept or decline a job", subtitle: "For photographers working with a studio." } }, { wait: 2200 }] },
    {
      chapter: "Finding offers",
      say: "When a studio wants you for a job, you'll get an email, and the offer appears on your Today screen, under Needs you.",
      do: [{ goto: "/crew" }, { waitFor: { css: ".kit-title" } }, { wait: 1000 }, { spotlight: { css: "section[aria-label='Needs you']" }, holdMs: 3400 }],
      poster: true,
    },
    {
      say: "Tap the offer to open it.",
      do: [
        { spotlight: { css: "section[aria-label='Needs you'] a:has-text('New offer')" }, holdMs: 1400 },
        { click: { css: "section[aria-label='Needs you'] a:has-text('New offer')" } },
        { waitFor: { css: "h1.kit-title" } },
        { wait: 900 },
      ],
    },
    {
      chapter: "The offer",
      say: "At the top is the job and your role. Below that are the date and times, where it is, and the fee.",
      do: [{ spotlight: { css: "h1.kit-title" }, holdMs: 2200 }, { wait: 400 }, { spotlight: { css: "main .kit-list, main ul" }, holdMs: 3000 }],
    },
    {
      say: "Answer by tells you how long the offer stays open. After that, the studio may ask someone else.",
      do: [{ spotlight: { text: /Answer by/ }, holdMs: 3000 }],
    },
    {
      say: "Scroll down to What you'd do, to see exactly what the studio needs from you on the day.",
      do: [{ scrollTo: { text: /What you.d do/ } }, { spotlight: { text: /What you.d do/ }, holdMs: 3000 }],
    },
    {
      chapter: "Answering",
      say: "If you can do it, tap Accept at the bottom of the screen.",
      do: [
        { spotlight: { role: "button", name: "Accept", exact: true }, holdMs: 1800 },
        { click: { role: "button", name: "Accept", exact: true } },
        { wait: 2500 },
      ],
      pauseAfterMs: 900,
    },
    {
      say: "You're booked. The job moves to Jobs, and its day sheet appears once the studio shares the run of show. You can add it to your calendar too.",
      do: [{ wait: 600 }, { spotlight: { css: "main" }, holdMs: 3400 }],
    },
    {
      say: "If you can't make it, tap Decline instead. You can tell the studio why, so they know whether it was the date, the fee, or the job.",
      do: [{ spotlight: { css: ".kit-tabbar a:has-text('Jobs')" }, holdMs: 2600 }],
    },
    { do: [{ card: { eyebrow: "StudioCue", title: "That's the tour", subtitle: "Every screen has a How to button." } }, { wait: 2600 }] },
  ],
});
