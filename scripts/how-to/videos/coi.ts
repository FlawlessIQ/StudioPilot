import { defineHowTo } from "../lib/define";

/**
 * Explainer: "coi". The certificate of insurance a venue asks for, from
 * asking your agent to the venue having it — on the Harts' wedding, so it
 * matches the journey film. Starts from journey chapter 6 (planning).
 */
const agent = "certificates@hartleyrowe.example";
const venue = "events@willowcreekbarn.example";

export default defineHowTo({
  id: "coi",
  title: "Certificates of insurance, handled",
  start: { as: "owner", viewport: "desktop" },
  cast: { studio: "owner", couple: "guest" },
  from: "journey-6",
  steps: [
    { do: [{ card: { eyebrow: "How to", title: "Certificates of insurance, handled", subtitle: "From your agent to the venue, without the back and forth." } }, { wait: 2400 }] },
    {
      chapter: "Set it up once",
      on: "studio",
      layout: "studio",
      say: "Most venues won't let you shoot without a certificate of insurance naming them. StudioCue gets it for you. First, tell it who sends your certificates. Open Studio settings, then Insurance.",
      do: [
        { goto: "/studio/settings/insurance" },
        { waitFor: { role: "heading", name: "Certificates of insurance" } },
        { wait: 600 },
        { spotlight: { text: "How do you get certificates of insurance?" }, holdMs: 2200 },
      ],
    },
    {
      on: "studio",
      say: "Add your agent's email. Then choose how far StudioCue goes: prepare each request for you to approve, or send it as soon as it's time.",
      do: [
        { click: { text: "My insurance agent or broker emails them" } },
        { type: { into: { role: "textbox", name: /Agent.s name/ }, text: "Jo Hartley" } },
        { fill: { into: { role: "textbox", name: /^Agency/ }, value: "Hartley & Rowe Insurance Agency" } },
        { type: { into: { role: "textbox", name: /Agent.s email/ }, text: agent } },
        { scrollTo: { text: "How far StudioCue goes on its own" } },
        { spotlight: { text: "How far StudioCue goes on its own" }, holdMs: 1800 },
        { click: { text: "Prepare it — I approve each request before it goes to my agent" } },
        { click: { role: "button", name: "Save insurance settings" } },
        { wait: 1500 },
      ],
    },
    {
      chapter: "The venue needs one",
      on: "studio",
      say: "On the wedding, open Venue and insurance, and say the venue needs a certificate. Couples can tell you this on your inquiry form, too.",
      do: [
        { goto: "/studio/insurance?project={job}" },
        { waitFor: { text: "Does this venue require a certificate?" } },
        { scrollTo: { text: "Does this venue require a certificate?" } },
        { spotlight: { text: "Does this venue require a certificate?" }, holdMs: 1800 },
        { click: { role: "button", name: "Yes, it does" } },
        { wait: 1500 },
      ],
    },
    { do: [{ story: "wedding-in:58" }, { story: "scheduler:planning/coi-chase-scheduler.ts#coiChaseScheduler" }] },
    {
      chapter: "Asking your agent",
      on: "studio",
      when: { at: 0.48, label: "8 weeks to go" },
      say: "Eight weeks out, the request is ready on your Today screen, with the venue as certificate holder and the date it's needed by.",
      do: [
        { goto: "/studio" },
        { waitFor: { css: ".today-hero-go" } },
        { scrollTo: { css: ".today-card:has-text('COI')" } },
        { spotlight: { css: ".today-card:has-text('COI')" }, holdMs: 2600 },
        { click: { css: ".today-card:has-text('COI') a, .today-card:has-text('COI') button" } },
        { wait: 2500 },
      ],
    },
    {
      on: "studio",
      say: "The first time, it asks for the venue's legal name and address, and remembers them for the next wedding there. Save, and check the request,",
      do: [
        { scrollTo: { role: "button", name: "Save and continue" } },
        { fill: { into: { role: "textbox", name: /Venue.s legal name/ }, value: "Willow Creek Barn LLC" } },
        { type: { into: { css: "input[placeholder='Venue street address']" }, text: "400 Old Mill Rd, Concord, MA 01742" } },
        { key: "Escape" },
        { type: { into: { role: "textbox", name: /Venue.s email for the certificate/ }, text: venue } },
        { click: { role: "button", name: "Save and continue" } },
        { waitFor: { role: "button", name: "Send to your agent" }, timeoutMs: 20000 },
        { wait: 600 },
      ],
    },
    {
      on: "studio",
      say: "then send it to your agent.",
      do: [{ spotlight: { role: "button", name: "Send to your agent" }, holdMs: 1200 }, { click: { role: "button", name: "Send to your agent" } }, { wait: 2000 }],
    },
    { do: [{ story: "drain" }] },
    {
      on: "couple",
      layout: "phone",
      caption: { eyebrow: "Your insurance agent", title: "What your agent gets", detail: "Everything the certificate needs, in one email." },
      say: "Your agent gets everything the certificate needs, and a reply address of its own, so the PDF comes straight back to this wedding. If they go quiet, StudioCue follows up every few days, and tells you if it gets nowhere.",
      do: [{ email: { subject: /Certificate of insurance request/i, to: agent } }, { wait: 1500 }, { scrollBy: 260 }, { wait: 1200 }],
    },
    { do: [{ story: "coi-arrives:short" }] },
    {
      chapter: "Checking it",
      on: "studio",
      layout: "studio",
      when: { at: 0.5, label: "7 weeks to go" },
      say: "When the certificate comes back, StudioCue reads it and checks it against what the venue asked for. Here, it's caught a problem: the liability limit is half what the venue requires.",
      do: [
        { goto: "/studio/insurance?project={job}" },
        { waitFor: { text: "General liability limit" }, timeoutMs: 20000 },
        { scrollTo: { text: "General liability limit" } },
        { spotlight: { text: "General liability limit" }, holdMs: 3200 },
      ],
      poster: true,
    },
    {
      on: "studio",
      say: "Say what needs fixing, and ask your agent to correct it.",
      do: [
        { type: { into: { css: "textarea" }, text: "The venue needs $1,000,000 each occurrence. Please reissue." } },
        { click: { role: "button", name: "Ask agent to correct" } },
        { wait: 2000 },
      ],
    },
    { do: [{ story: "drain" }, { story: "coi-arrives:ok" }] },
    {
      on: "studio",
      say: "The corrected certificate comes back the same way. Nothing flagged this time, but you still read it yourself: StudioCue never decides a certificate is good enough. Approve it,",
      do: [
        { cut: [{ reload: true }, { waitFor: { text: "Nothing flagged" }, timeoutMs: 20000 }, { wait: 600 }] },
        { scrollTo: { text: "Nothing flagged" } },
        { spotlight: { text: "Nothing flagged" }, holdMs: 2600 },
        { type: { into: { css: "textarea" }, text: "Checked against the venue's contract. All good." } },
      ],
    },
    {
      on: "studio",
      say: "and it goes to the venue.",
      do: [{ click: { role: "button", name: /Approve & send to venue/ } }, { wait: 2500 }],
    },
    { do: [{ story: "drain:undo" }] },
    {
      on: "couple",
      layout: "phone",
      caption: { eyebrow: "The venue", title: "What the venue gets", detail: "The approved certificate, from your studio." },
      say: "The venue gets the approved certificate from your studio, with the event date. When they reply to say they have it, that's recorded too.",
      do: [{ email: { subject: /Approved certificate/i, to: venue } }, { wait: 2500 }],
    },
    { do: [{ story: "coi-acknowledged" }] },
    {
      chapter: "Done",
      on: "studio",
      layout: "studio",
      say: "On the wedding, the certificate is ticked off, and it's one less thing to think about before the day.",
      do: [
        { goto: "/studio/insurance?project={job}" },
        { waitFor: { text: /Venue acknowledged|The venue confirmed/ }, timeoutMs: 20000 },
        { scrollTo: { text: /Venue acknowledged|The venue confirmed/ } },
        { spotlight: { text: /Venue acknowledged|The venue confirmed/ }, holdMs: 3000 },
      ],
    },
    { do: [{ card: { eyebrow: "StudioCue", title: "Certificates of insurance, handled.", subtitle: "Your agent, the check, the venue — in one place." } }, { wait: 3000 }] },
  ],
});
