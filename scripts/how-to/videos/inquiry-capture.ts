import { defineHowTo } from "../lib/define";

/** Explainer: "inquiry-capture". Orient first, point before naming (Conor, 2026-09-30). */
export default defineHowTo({
  id: "inquiry-capture",
  title: "Put your inquiry form on your website",
  start: { as: "owner", viewport: "desktop" },
  steps: [
    { do: [{ card: { eyebrow: "How to", title: "Put your inquiry form on your website", subtitle: "Every inquiry, straight into StudioCue." } }, { wait: 2200 }] },
    {
      chapter: "Finding it",
      say: "Let's get your inquiries coming straight into StudioCue. Open Studio settings from the menu on the left, then choose Inquiry capture.",
      do: [
        { goto: "/studio/settings" },
        { spotlight: { css: ".ds-sidebar a.ds-nav-item[href='/studio/settings']" }, holdMs: 1800 },
        { wait: 900 },
        { spotlight: { text: "Inquiry capture", exact: true }, holdMs: 1600 },
        { click: { text: "Inquiry capture", exact: true } },
        { waitFor: { role: "heading", name: "Inquiry capture" } },
      ],
    },
    {
      say: "At the top is your StudioCue address. Anything sent or forwarded to it becomes an inquiry, with a reply drafted for you.",
      do: [{ wait: 400 }, { spotlight: { css: ".capture-address" }, holdMs: 3400 }],
      poster: true,
    },
    {
      chapter: "Four ways in",
      say: "Below it are four ways to bring inquiries in. The easiest is the first one: put StudioCue's own inquiry form on your website.",
      do: [{ spotlight: { css: ".capture-route >> nth=0" }, holdMs: 3000 }],
    },
    {
      say: "Tap it, pick the website builder you use, and copy the code into your site. No forwarding needed.",
      do: [
        { click: { css: ".capture-route >> nth=0" } },
        { waitFor: { role: "dialog", name: /.+/ } },
        { wait: 1600 },
      ],
      pauseAfterMs: 1200,
    },
    {
      say: "If you'd rather keep your own form, or you get inquiries by email, from The Knot or WeddingWire, the other three options forward them in instead.",
      do: [{ key: "Escape" }, { wait: 600 }, { spotlight: { css: ".capture-route >> nth=1" }, holdMs: 1400 }, { spotlight: { css: ".capture-route >> nth=2" }, holdMs: 1400 }, { spotlight: { css: ".capture-route >> nth=3" }, holdMs: 1600 }],
    },
    {
      chapter: "Test it",
      say: "When you're set up, tap Test and send yourself an inquiry, so you can see exactly how it arrives.",
      do: [{ spotlight: { role: "button", name: "Test", exact: true }, holdMs: 2400 }, { hover: { role: "button", name: "Test", exact: true } }],
    },
    {
      say: "From then on, every inquiry lands in Inquiries and on Today, with a reply drafted. The couple hears nothing until you send it.",
      do: [{ wait: 400 }, { spotlight: { css: ".ds-sidebar a.ds-nav-item[href='/studio/leads']" }, holdMs: 2600 }],
    },
    { do: [{ card: { eyebrow: "Next", title: "Answer a new inquiry" } }, { wait: 2600 }] },
  ],
});
