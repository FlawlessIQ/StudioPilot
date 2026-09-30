import { defineHowTo } from "../lib/define";

/** Explainer: "inquiry". Orient first, point before naming (Conor, 2026-09-30). */
const card = { css: ".today-card.has-reply" };

export default defineHowTo({
  id: "inquiry",
  title: "Answer a new inquiry",
  start: { as: "owner", viewport: "desktop" },
  steps: [
    { do: [{ card: { eyebrow: "How to", title: "Answer a new inquiry", subtitle: "Reply fast, without writing from scratch." } }, { wait: 2200 }] },
    {
      chapter: "Where inquiries arrive",
      say: "Let's answer a new inquiry. When a couple gets in touch, they show up in two places: in Inquiries, here in the menu, and on your Today tab.",
      do: [
        { goto: "/studio/leads" },
        { waitFor: { role: "heading", name: "Inquiries" } },
        { spotlight: { css: ".ds-sidebar a.ds-nav-item[href='/studio/leads']" }, holdMs: 2200 },
        { wait: 1200 },
        { spotlight: { css: ".inquiry-pipeline-table" }, holdMs: 2400 },
      ],
    },
    {
      say: "Hana Park is at the top. The words under her name, Your move, tell you she's waiting on you.",
      do: [{ spotlight: { text: "Hana Park", exact: true }, holdMs: 1800 }, { wait: 600 }, { spotlight: { text: /Your move/ }, holdMs: 2600 }],
      poster: true,
    },
    {
      chapter: "Reply from Today",
      say: "The quickest way to answer is from Today. Open it from the menu, and scroll down to Hana's card.",
      do: [
        { click: { css: ".ds-sidebar a.ds-nav-item[href='/studio']" } },
        { waitFor: { css: ".today-hero-go" } },
        { wait: 800 },
        { scrollTo: card },
        { spotlight: card, holdMs: 2600 },
      ],
    },
    {
      say: "StudioCue has already written a reply for you. It's right there on the card, under Reply ready.",
      do: [{ spotlight: { css: ".today-card.has-reply .today-inquiry-reply" }, holdMs: 3600 }],
    },
    {
      say: "It thanks her, answers her question, and includes a link where she can add her details and pick a time to talk.",
      do: [{ wait: 3000 }],
    },
    {
      say: "Want to change anything? Tap Edit. When it reads right, tap Send reply.",
      do: [
        { spotlight: { css: ".today-card.has-reply button:has-text('Edit')" }, holdMs: 1600 },
        { hover: { css: ".today-card.has-reply button:has-text('Edit')" } },
        { wait: 700 },
        { spotlight: { css: ".today-card.has-reply button:has-text('Send reply')" }, holdMs: 1400 },
        { hover: { css: ".today-card.has-reply button:has-text('Send reply')" } },
        { wait: 500 },
        { click: { css: ".today-card.has-reply button:has-text('Send reply')" } },
      ],
      pauseAfterMs: 1400,
    },
    {
      say: "That's it. The reply goes out from your studio, and Hana's inquiry moves along.",
      do: [{ wait: 800 }],
    },
    {
      chapter: "If they go quiet",
      say: "If a couple doesn't answer, StudioCue drafts a follow-up on day three and again on day seven, ready for you to send the same way.",
      do: [
        { click: { css: ".ds-sidebar a.ds-nav-item[href='/studio/leads']" } },
        { waitFor: { role: "heading", name: "Inquiries" } },
        { spotlight: { css: ".crm-tabs a:has-text('Talking')" }, holdMs: 2600 },
      ],
    },
    {
      say: "And if an inquiry doesn't book, close it and say why. It moves to Closed, and if the couple writes again, it reopens by itself.",
      do: [{ spotlight: { css: ".crm-tabs a:has-text('Closed')" }, holdMs: 3000 }],
    },
    { do: [{ card: { eyebrow: "Next", title: "Build and send a proposal" } }, { wait: 2600 }] },
  ],
});
