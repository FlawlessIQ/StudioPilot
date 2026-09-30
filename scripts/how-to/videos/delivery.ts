import { defineHowTo } from "../lib/define";

/** Explainer: "delivery". Orient first, point before naming (Conor, 2026-09-30). */
export default defineHowTo({
  id: "delivery",
  title: "Deliver the gallery and close out",
  start: { as: "owner", viewport: "desktop" },
  steps: [
    { do: [{ card: { eyebrow: "How to", title: "Deliver the gallery", subtitle: "Send the photos, then close the job." } }, { wait: 2200 }] },
    {
      chapter: "The Delivery tab",
      say: "Let's deliver a couple's photos. Open their job, and choose Delivery from the tabs along the top.",
      do: [
        { goto: "/studio/projects/job-rivera" },
        { waitFor: { css: ".project-workspace-nav" } },
        { wait: 800 },
        { spotlight: { css: ".project-workspace-nav a:has-text('Delivery')" }, holdMs: 1600 },
        { click: { css: ".project-workspace-nav a:has-text('Delivery')" } },
        { waitFor: { role: "heading", name: "Send photos or a film" } },
        { wait: 600 },
      ],
    },
    {
      chapter: "Post-production",
      say: "At the top is the post-production checklist. Cards backed up is the one step that must be done before anything goes out. The rest simply track your progress.",
      do: [
        { spotlight: { css: "section:has(> * h2:text-is('Post-production')), .panel:has(h2:text-is('Post-production'))" }, holdMs: 2600 },
        { spotlight: { css: ".post-production-gates" }, holdMs: 2200 },
      ],
      poster: true,
    },
    {
      chapter: "The release",
      say: "Below it, under Send photos or a film, add what you're sending.",
      do: [{ scrollTo: { role: "heading", name: "Send photos or a film" } }, { spotlight: { role: "heading", name: "Send photos or a film" }, holdMs: 2200 }],
    },
    {
      say: "Paste the link to your gallery, and add its access code if it has one.",
      do: [
        { scrollTo: { css: "input[placeholder^='https']" } },
        { type: { into: { css: "input[placeholder^='https']" }, text: "https://alderandmuse.pic-time.com/camila-andres" } },
        { type: { into: { css: "label:has-text('Access code') input" }, text: "CASCADES26" } },
      ],
    },
    {
      say: "Downloads until is the date the couple is asked to save everything by.",
      do: [{ spotlight: { css: "label:has-text('Downloads until')" }, holdMs: 2600 }],
    },
    {
      chapter: "The couple's email",
      say: "Add a line from you if you like. Just below, you can see the email the couple will get.",
      do: [
        { type: { into: { css: "label:has-text('A line from you') textarea" }, text: "It was a joy to be part of your day. Enjoy every one of these." } },
        { wait: 400 },
        { spotlight: { css: ".delivery-email-preview, section:has(> .eyebrow:text-is('The couple’s email'))" }, holdMs: 3000 },
      ],
    },
    {
      say: "The review link is where they'll be asked for a review, a few days after this goes out.",
      do: [{ scrollTo: { css: "label:has-text('Review link')" } }, { spotlight: { css: "label:has-text('Review link')" }, holdMs: 2800 }],
    },
    {
      say: "Then tap Release and complete delivery.",
      do: [
        { spotlight: { role: "button", name: "Release and complete delivery" }, holdMs: 1600 },
        { click: { role: "button", name: "Release and complete delivery" } },
        { wait: 3000 },
      ],
      pauseAfterMs: 1000,
    },
    {
      chapter: "Delivered",
      say: "That's it. The couple gets one email, and everything lands in their portal. Back on the job, the stages now show Delivered, and the job history records the gallery going out.",
      do: [
        { waitFor: { css: ".project-phase" }, timeoutMs: 30000 },
        { wait: 600 },
        { spotlight: { css: ".project-phase" }, holdMs: 2800 },
        { spotlight: { css: ".job-history-strip" }, holdMs: 2600 },
      ],
    },
    {
      say: "Review requests follow three and ten days later. And once everything's settled, you close the job from the Delivery tab, under Closing the job.",
      do: [{ spotlight: { css: ".project-workspace-nav a:has-text('Delivery')" }, holdMs: 3000 }],
    },
    { do: [{ card: { eyebrow: "Next", title: "Your wedding portal", subtitle: "For couples" } }, { wait: 2600 }] },
  ],
});
