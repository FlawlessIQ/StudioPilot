import { defineHowTo } from "../lib/define";

/** The journey film, chapter 2: the consultation (docs/wedding-journey-video-plan-2026-10-02.md §3). */
export default defineHowTo({
  id: "journey-2",
  title: "One wedding, start to finish: the consultation",
  start: { as: "owner", viewport: "desktop" },
  cast: { studio: "owner", couple: "guest" },
  steps: [
    {
      chapter: "The consultation",
      on: "couple",
      layout: "phone",
      when: { at: 0.06, label: "13 months to go" },
      caption: { title: "What Ella sees", detail: "Her own page for this inquiry." },
      say: "Ella's link opens a page of her own. She adds a few details,",
      do: [
        { goto: "{inquiry}" },
        { waitFor: { css: "input[name=partnerName]" } },
        { wait: 600 },
        { type: { into: { css: "input[name=partnerName]" }, text: "Marcus Hart" } },
        { type: { into: { css: "input[name=ceremonyTime]" }, text: "4:30pm" } },
        { click: { role: "button", name: "Continue" } },
      ],
    },
    {
      on: "couple",
      say: "then picks a time to talk, from the hours you've opened.",
      do: [
        { waitFor: { role: "button", name: "Video call" } },
        { click: { role: "button", name: "Video call" } },
        { click: { role: "button", name: "2:00 PM", exact: true } },
        { wait: 500 },
        { click: { role: "button", name: /^Book / } },
        { wait: 2500 },
      ],
      pauseAfterMs: 900,
    },
    { do: [{ story: "drain" }] },
    // Behind the camera: the studio's calendar open, ready for the split below.
    { on: "studio", do: [{ cut: [{ goto: "/studio/calendar" }, { waitFor: { role: "heading", name: "Calendar" } }, { wait: 1500 }] }] },
    {
      on: "couple",
      layout: "split",
      caption: { title: "Ella" },
      say: "She gets a confirmation with the video link, and the call is in your calendar.",
      do: [{ email: { subject: /call|consultation/i, to: "ella.hart@studiohub.test" } }, { wait: 1200 }, { scrollBy: 260 }],
    },
    { do: [{ story: "call-tomorrow" }] },
    {
      on: "studio",
      layout: "studio",
      say: "The day before, StudioCue prepares a note for Ella: what she's told you so far, and what you'd like to talk about. One tap sends it.",
      do: [
        { goto: "/studio" },
        { waitFor: { css: ".today-hero-go" } },
        { scrollTo: { css: ".today-card:has-text('Ahead of the call')" } },
        { spotlight: { css: ".today-card:has-text('Ahead of the call')" }, holdMs: 3200 },
        { click: { css: ".today-card:has-text('Ahead of the call') button:has-text('Approve')" } },
        { wait: 1500 },
      ],
    },
    { do: [{ story: "drain:undo" }] },
    {
      on: "couple",
      layout: "phone",
      caption: { title: "What Ella sees", detail: "Ready for the call, before it starts." },
      say: "So by the time you talk, you both know what the call is for.",
      do: [{ email: { subject: /Ahead of our call/i, to: "ella.hart@studiohub.test" } }, { wait: 1200 }, { scrollBy: 300 }],
    },
  ],
});
