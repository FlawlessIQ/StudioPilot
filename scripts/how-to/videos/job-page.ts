import { defineHowTo } from "../lib/define";

/** Explainer: "job-page". Orient first, point before naming (Conor, 2026-09-30). */
export default defineHowTo({
  id: "job-page",
  title: "Follow one wedding from start to finish",
  start: { as: "owner", viewport: "desktop" },
  steps: [
    { do: [{ card: { eyebrow: "How to", title: "Follow one wedding", subtitle: "Everything about a job, in one place." } }, { wait: 2200 }] },
    {
      chapter: "Finding a job",
      say: "Let's look at a job. Open Jobs from the menu on the left. Each row is one wedding, with its date and what's next.",
      do: [
        { goto: "/studio" },
        { waitFor: { css: ".today-hero-go" } }, { wait: 800 },
        { spotlight: { css: ".ds-sidebar a.ds-nav-item[href='/studio/projects']" }, holdMs: 1600 },
        { wait: 800 },
        { click: { css: ".ds-sidebar a.ds-nav-item[href='/studio/projects']" } },
        { waitFor: { role: "heading", name: "Jobs" } },
        { spotlight: { css: ".crm-table" }, holdMs: 2400 },
      ],
    },
    {
      say: "Tap a couple's name to open their job.",
      do: [{ click: { text: "Maren & Diego Castillo", exact: true } }, { waitFor: { css: ".project-detail-header" } }],
    },
    {
      chapter: "Where it is",
      say: "Under the couple's name is a row of stages, from the enquiry to delivery. The highlighted one shows where this wedding is right now.",
      do: [{ wait: 400 }, { spotlight: { css: ".project-phase" }, holdMs: 3600 }],
      poster: true,
    },
    {
      chapter: "Your next move",
      say: "Below that, the big green card is your next move: the one thing to do on this job now. Its button takes you straight there.",
      do: [{ spotlight: { css: ".thread-next" }, holdMs: 3600 }],
    },
    {
      chapter: "The tabs",
      say: "The tabs just above hold the detail for each stage: Overview, Booking, Plan, and Delivery.",
      do: [{ spotlight: { css: ".project-workspace-nav" }, holdMs: 3400 }],
    },
    {
      chapter: "The journey",
      say: "On the right-hand side, the journey lists every step of the wedding, and ticks each one off as it's done.",
      do: [{ spotlight: { css: ".thread-minimap" }, holdMs: 3800 }],
    },
    {
      chapter: "Job history",
      say: "Back in the middle, Job history keeps the whole record. Log a call, add a task, or ask Cue a question about this job.",
      do: [{ spotlight: { css: ".job-history-strip" }, holdMs: 1800 }, { wait: 500 }, { spotlight: { css: ".thread-composer" }, holdMs: 3000 }],
    },
    {
      say: "Further down, anything StudioCue has drafted for this job waits under Prepared for you, ready to approve.",
      do: [{ scrollTo: { css: ".prepared-compact-row" } }, { spotlight: { css: ".prepared-compact-row" }, holdMs: 3000 }],
    },
    {
      say: "As the couple signs, pays, and fills things in, the job moves along by itself.",
      do: [{ scrollBy: -3000 }, { spotlight: { css: ".project-phase" }, holdMs: 2600 }],
    },
    { do: [{ card: { eyebrow: "Next", title: "Build and send a proposal" } }, { wait: 2600 }] },
  ],
});
