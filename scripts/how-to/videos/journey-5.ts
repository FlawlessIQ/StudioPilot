import { defineHowTo } from "../lib/define";

/** The journey film, chapter 5: the quiet months (docs/wedding-journey-video-plan-2026-10-02.md §3). */
export default defineHowTo({
  id: "journey-5",
  title: "One wedding, start to finish: the quiet months",
  start: { as: "owner", viewport: "desktop" },
  voice: "voice.journey.json",
  cast: { studio: "owner", couple: "ella.hart@studiohub.test" },
  steps: [
    {
      chapter: "The quiet months",
      on: "couple",
      layout: "phone",
      when: { at: 0.24, label: "11 months to go" },
      caption: { title: "What Ella sees", detail: "Her portal: the countdown, and what's next." },
      say: "Then come the quiet months. Ella's portal counts down to the day, and shows her what comes next, and when.",
      do: [{ goto: "/client" }, { waitFor: { css: ".kit-title" } }, { wait: 1500 }, { scrollTo: { css: "#journey-heading" } }, { spotlight: { css: ".kit-journey" }, holdMs: 3000 }],
    },
    { do: [{ story: "wedding-in:240" }] },
    {
      on: "studio",
      layout: "studio",
      when: { at: 0.3, label: "8 months to go" },
      say: "And on your side, there's nothing to do. StudioCue knows what's coming, and brings each thing to your Today screen on the day it's due.",
      do: [{ goto: "/studio/projects/{job}" }, { waitFor: { css: ".thread-minimap" } }, { wait: 800 }, { spotlight: { css: ".thread-minimap" }, holdMs: 4200 }],
    },
  ],
});
