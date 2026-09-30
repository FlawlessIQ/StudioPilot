import { defineHowTo } from "../lib/define";

/** Explainer: "tour". Orient first, point before naming (Conor, 2026-09-30). */
const nav = (href: string) => ({ css: `.ds-sidebar a.ds-nav-item[href='${href}']` });

export default defineHowTo({
  id: "tour",
  title: "A tour of StudioCue",
  start: { as: "owner", viewport: "desktop" },
  steps: [
    { do: [{ card: { eyebrow: "How to", title: "A tour of StudioCue", subtitle: "Where everything lives." } }, { wait: 2200 }] },
    {
      chapter: "The menu",
      say: "Let's take a quick tour of StudioCue. Everything starts from the menu down the left-hand side of the screen.",
      do: [{ goto: "/studio" }, { waitFor: { css: ".today-hero-go" } }, { wait: 1200 }, { spotlight: { css: ".ds-nav" }, holdMs: 3200 }],
      poster: true,
    },
    {
      chapter: "Today",
      say: "At the top of the menu is Today. It's your inbox: everything that needs a decision from you, with the most urgent things first.",
      do: [{ spotlight: nav("/studio"), holdMs: 1800 }, { wait: 1200 }, { spotlight: { css: ".today-main" }, holdMs: 3000 }],
    },
    {
      chapter: "Inquiries",
      say: "Just below it is Inquiries. This is everyone who's asked about a date but hasn't booked yet.",
      do: [
        { spotlight: nav("/studio/leads"), holdMs: 1400 },
        { wait: 700 },
        { click: nav("/studio/leads") },
        { waitFor: { role: "heading", name: "Inquiries" } },
      ],
    },
    {
      say: "The tabs along the top sort them by stage, from new, through the consultation and proposal, to signing.",
      do: [{ spotlight: { css: ".crm-tabs" }, holdMs: 3000 }, { wait: 800 }, { spotlight: { css: ".inquiry-pipeline-table" }, holdMs: 2600 }],
    },
    {
      chapter: "Jobs",
      say: "Once a couple books, their wedding moves to Jobs. Each row is one wedding.",
      do: [
        { spotlight: nav("/studio/projects"), holdMs: 1400 },
        { wait: 700 },
        { click: nav("/studio/projects") },
        { waitFor: { role: "heading", name: "Jobs" } },
        { spotlight: { css: ".crm-table" }, holdMs: 2400 },
      ],
    },
    {
      say: "Open one, and you'll see that wedding's whole story in one place, and the one thing to do next.",
      do: [
        { click: { text: "Maren & Diego Castillo", exact: true } },
        { waitFor: { css: ".project-detail-header" } },
        { wait: 600 },
        { spotlight: { css: ".thread-next" }, holdMs: 2600 },
      ],
    },
    {
      chapter: "Cue",
      say: "Back in the menu, Cue is your assistant. Ask it anything about your studio, or ask it to do something, and it prepares the work for you to approve.",
      do: [
        { spotlight: nav("/studio/copilot"), holdMs: 1400 },
        { wait: 700 },
        { click: nav("/studio/copilot") },
        { waitFor: { css: ".cue-composer" } },
        { spotlight: { css: ".cue-composer" }, holdMs: 3000 },
      ],
    },
    {
      chapter: "Everything else",
      say: "Under More, you'll find your calendar, messages, clients and insights.",
      do: [
        { spotlight: nav("/studio/calendar"), holdMs: 900 },
        { spotlight: nav("/studio/messages"), holdMs: 900 },
        { spotlight: nav("/studio/clients"), holdMs: 900 },
        { spotlight: nav("/studio/reports"), holdMs: 900 },
      ],
    },
    {
      say: "And under Studio, the Library holds your packages and templates, and Studio settings holds everything else.",
      do: [{ spotlight: nav("/studio/library"), holdMs: 1600 }, { wait: 900 }, { spotlight: nav("/studio/settings"), holdMs: 1600 }],
    },
    {
      chapter: "Help",
      say: "Whenever you're not sure what to do, look for the How to button at the top of every screen. It opens a guide to whatever you're looking at.",
      do: [{ spotlight: { css: ".ds-topbar .how-to-trigger" }, holdMs: 2200 }, { wait: 1800 }, { click: { css: ".ds-topbar .how-to-trigger" } }],
      pauseAfterMs: 1500,
    },
    { do: [{ card: { eyebrow: "Next", title: "Set up your studio" } }, { wait: 2600 }] },
  ],
});
