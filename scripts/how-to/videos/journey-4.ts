import { defineHowTo } from "../lib/define";

/** The journey film, chapter 4: the crew (docs/wedding-journey-video-plan-2026-10-02.md §3). */
export default defineHowTo({
  id: "journey-4",
  title: "One wedding, start to finish: the crew",
  start: { as: "owner", viewport: "desktop" },
  voice: "voice.journey.json",
  cast: { studio: "owner", crew: "crew" },
  steps: [
    {
      chapter: "Your crew",
      on: "studio",
      layout: "studio",
      when: { at: 0.22, label: "12 months to go" },
      say: "Their package has two photographers, so the next job is your second shooter. Open the Plan tab, then Crew for this job.",
      do: [
        { goto: "/studio/projects/{job}" },
        { waitFor: { css: ".project-workspace-nav" } },
        { wait: 600 },
        { click: { css: ".project-workspace-nav a:has-text('Plan')" } },
        { waitFor: { text: "Crew for this job" } },
        { wait: 400 },
        { click: { text: "Crew for this job" } },
        { waitFor: { text: "Fill this role", exact: true } },
      ],
    },
    {
      on: "studio",
      say: "StudioCue ranks the people you work with, by availability, clashes, travel and paperwork. Approve the plan, and the offer goes to your first choice.",
      do: [
        { wait: 600 },
        { scrollTo: { text: "Recommended order" } },
        { spotlight: { text: "Recommended order" }, holdMs: 2600 },
        { scrollTo: { role: "button", name: "Approve crew plan and start" } },
        { click: { role: "button", name: "Approve crew plan and start" } },
        { wait: 2500 },
      ],
      pauseAfterMs: 800,
    },
    { do: [{ story: "drain" }] },
    {
      on: "crew",
      layout: "phone",
      caption: { title: "What Jordan sees", detail: "Your second shooter, on their phone." },
      say: "Jordan, your second shooter, gets the offer on their phone: the date, the times, the place and the fee.",
      do: [
        { goto: "/crew" },
        { waitFor: { css: ".kit-title" } },
        { wait: 800 },
        { click: { css: "section[aria-label='Needs you'] a:has-text('New offer')" } },
        { waitFor: { css: "h1.kit-title" } },
        { wait: 1400 },
      ],
    },
    {
      on: "crew",
      say: "One tap to accept.",
      do: [{ click: { role: "button", name: "Accept", exact: true } }, { wait: 2500 }],
      pauseAfterMs: 800,
    },
    { do: [{ story: "drain" }] },
    {
      on: "studio",
      layout: "split",
      caption: { title: "Jordan" },
      say: "And on the job, the role is filled. If they'd said no, or not answered within a day, the offer would have moved to the next name by itself.",
      do: [
        { goto: "/studio/projects/{job}" },
        { waitFor: { css: ".job-history-strip" } },
        { scrollTo: { css: ".job-history-strip" } },
        { spotlight: { css: ".job-history-strip" }, holdMs: 3200 },
      ],
    },
  ],
});
