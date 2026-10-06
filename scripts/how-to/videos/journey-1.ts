import { defineHowTo } from "../lib/define";

/** The journey film, chapter 1: the inquiry (docs/wedding-journey-video-plan-2026-10-02.md §3). */
const form = (label: RegExp) => ({ css: `label:has-text("${label.source}") + * input, label:has-text("${label.source}") input` });

export default defineHowTo({
  id: "journey-1",
  title: "One wedding, start to finish: the inquiry",
  start: { as: "owner", viewport: "desktop" },
  voice: "voice.journey.json",
  cast: { studio: "owner", couple: "guest" },
  before: ["cast"],
  steps: [
    { do: [{ card: { eyebrow: "StudioCue", title: "One wedding, start to finish", subtitle: "What you, your couple and your crew each see." } }, { wait: 2600 }] },
    {
      chapter: "The inquiry",
      on: "couple",
      layout: "phone",
      when: { at: 0, label: "14 months to go" },
      caption: { title: "What Ella sees", detail: "The inquiry form on your website." },
      say: "A wedding takes a year or more to arrive. Let's follow one, from the first email to the album. It starts when Ella fills in the inquiry form on your website.",
      do: [
        { cut: [{ goto: "/inquiry?studio=alder-and-muse" }, { waitFor: { role: "heading", name: "Let’s start with you" } }, { wait: 500 }] },
        { wait: 600 },
        { type: { into: form(/First name/), text: "Ella" } },
        { type: { into: form(/Last name/), text: "Hart" } },
        { fill: { into: form(/Email/), value: "ella.hart@studiohub.test" } },
        { fill: { into: form(/Phone/), value: "617 555 0188" } },
        { click: { role: "button", name: "Wedding" } },
        { click: { role: "button", name: "Continue" } },
      ],
    },
    {
      on: "couple",
      say: "She tells you the date and the venue,",
      do: [
        { waitFor: { role: "heading", name: "Tell us about your day" } },
        { fill: { into: { css: "input[type='date']" }, value: "2027-06-12" } },
        { type: { into: { css: "input[placeholder='Venue name or address']" }, text: "Willow Creek Barn" } },
        { key: "Escape" },
        { fill: { into: form(/City/), value: "Concord" } },
        { fill: { into: form(/Estimated guests/), value: "140" } },
        { click: { role: "button", name: "Continue" } },
      ],
    },
    {
      on: "couple",
      say: "and what matters most to them. Then she sends it.",
      do: [
        { waitFor: { role: "heading", name: "What matters most?" } },
        { type: { into: { css: "textarea" }, text: "A relaxed barn wedding with lots of candid moments. Marcus's grandparents are flying in from Dublin!" } },
        { click: { role: "button", name: "A friend" } },
        { click: { css: "label:has-text('may contact me') input" } },
        { click: { role: "button", name: "Send inquiry" } },
        { wait: 2500 },
      ],
    },
    { do: [{ story: "reply-drafted" }] },
    {
      on: "studio",
      layout: "studio",
      when: { at: 0.02, label: "14 months to go" },
      say: "On your side, the inquiry lands on your Today screen, with a reply already written, in your voice, with a link for her to tell you more and book a call.",
      do: [
        { goto: "/studio" },
        { waitFor: { css: ".today-hero-go" } },
        { scrollTo: { css: ".today-card.has-reply:has-text('Ella')" } },
        { spotlight: { css: ".today-card.has-reply:has-text('Ella')" }, holdMs: 3000 },
        { spotlight: { css: ".today-card.has-reply:has-text('Ella') .today-inquiry-reply" }, holdMs: 3400 },
      ],
      poster: true,
    },
    {
      on: "studio",
      say: "Read it, change anything you like, and send.",
      do: [
        { hover: { css: ".today-card.has-reply:has-text('Ella') button:has-text('Send reply')" } },
        { wait: 500 },
        { click: { css: ".today-card.has-reply:has-text('Ella') button:has-text('Send reply')" } },
        { wait: 1500 },
      ],
      pauseAfterMs: 900,
    },
    { do: [{ story: "drain:undo" }] },
    {
      on: "couple",
      layout: "phone",
      caption: { title: "What Ella sees", detail: "Your reply, from your studio, within minutes." },
      say: "Ella gets it within minutes. And if she goes quiet, StudioCue drafts a follow-up on day three and day seven, for you to send the same way.",
      do: [{ email: { subject: /Willow Creek/, to: "ella.hart@studiohub.test" } }, { wait: 1500 }, { scrollBy: 300 }],
    },
  ],
});
