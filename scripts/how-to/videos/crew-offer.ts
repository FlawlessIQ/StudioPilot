import { defineHowTo } from "../lib/define";

/** Explainer: "crew-offer". Orient first, point before naming (Conor, 2026-09-30). */
export default defineHowTo({
  id: "crew-offer",
  title: "Book your second shooter",
  start: { as: "owner", viewport: "desktop" },
  steps: [
    { do: [{ card: { eyebrow: "How to", title: "Book your second shooter", subtitle: "One offer at a time, until someone says yes." } }, { wait: 2200 }] },
    {
      chapter: "Finding it",
      say: "Let's book a second shooter. Open the job, choose the Plan tab along the top, then Crew for this job.",
      do: [
        { goto: "/studio/projects/job-okafor" },
        { waitFor: { css: ".project-workspace-nav" } },
        { wait: 800 },
        { spotlight: { css: ".project-workspace-nav a:has-text('Plan')" }, holdMs: 1600 },
        { click: { css: ".project-workspace-nav a:has-text('Plan')" } },
        { waitFor: { text: "Crew for this job" } },
        { wait: 600 },
        { spotlight: { text: "Crew for this job" }, holdMs: 1600 },
        { click: { text: "Crew for this job" } },
        { waitFor: { text: "Fill this role", exact: true } },
      ],
    },
    {
      say: "The green card at the top is where you fill a role. StudioCue ranks the people you work with by availability, clashes, travel and paperwork, and you decide the final order.",
      do: [{ wait: 600 }, { spotlight: { css: "section:has(> * :text-is('Fill this role')), div:has(> h1:text-is('Fill this role'))" }, holdMs: 4200 }],
      poster: true,
    },
    {
      say: "If you already know exactly who you want, tap I know who I want, and the job goes straight to that one person. Otherwise, let StudioCue rank your options.",
      do: [
        { spotlight: { role: "link", name: "I know who I want" }, holdMs: 2600 },
        { wait: 600 },
        { spotlight: { role: "link", name: "Rank my options" }, holdMs: 2200 },
      ],
    },
    {
      chapter: "The plan",
      say: "Below it, the plan is already filled in from the job: the role, the arrival and departure times, the rate, and what they'll cover.",
      do: [
        { scrollTo: { text: "Roles to fill, one per line" } },
        { spotlight: { text: "Roles to fill, one per line" }, holdMs: 1400 },
        { spotlight: { text: "Arrival", exact: true }, holdMs: 1200 },
        { spotlight: { text: "Event rate (USD)" }, holdMs: 1200 },
        { spotlight: { text: "Responsibilities, one per line" }, holdMs: 1600 },
      ],
    },
    {
      say: "Response window is how long each person has to answer, before the offer moves to the next name.",
      do: [{ spotlight: { css: "label:has-text('Response window')" }, holdMs: 2600 }],
    },
    {
      chapter: "The order",
      say: "Under Recommended order is everyone who fits, best match first. Use the arrows to change the order, or Exclude someone.",
      do: [
        { scrollTo: { text: "Recommended order" } },
        { spotlight: { text: "Recommended order" }, holdMs: 1600 },
        { spotlight: { role: "button", name: /Move .* up/ }, holdMs: 1200 },
        { spotlight: { role: "button", name: "Exclude" }, holdMs: 1400 },
      ],
    },
    {
      say: "It also flags anything still missing, like a W-9. Request paperwork asks them for it.",
      do: [{ spotlight: { role: "button", name: "Request paperwork" }, holdMs: 2600 }],
    },
    {
      chapter: "Sending offers",
      say: "Offers go out one at a time. If the first person declines, or doesn't answer in time, the next is asked. When it looks right, tap Approve crew plan and start.",
      do: [
        { spotlight: { css: "strong:has-text('One offer at a time')" }, holdMs: 2600 },
        { wait: 1200 },
        { spotlight: { role: "button", name: "Approve crew plan and start" }, holdMs: 1600 },
        { click: { role: "button", name: "Approve crew plan and start" } },
        { wait: 2500 },
      ],
      pauseAfterMs: 1000,
    },
    {
      say: "Jordan gets an email and answers from their phone. This page shows who's been asked, and who's accepted.",
      do: [{ scrollBy: -3000 }, { waitFor: { text: /Waiting on|Already out/ }, timeoutMs: 20000 }, { spotlight: { text: /Waiting on/ }, holdMs: 3000 }],
    },
    { do: [{ card: { eyebrow: "Next", title: "Deliver the gallery and close out" } }, { wait: 2600 }] },
  ],
});
