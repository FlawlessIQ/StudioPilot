import { defineHowTo } from "../lib/define";

/** Explainer: "proposal". Orient first, point before naming (Conor, 2026-09-30). */
const section = (title: string) => ({ css: `.proposal-composer-section-body:has(h2:has-text('${title}'))` });

export default defineHowTo({
  id: "proposal",
  title: "Build and send a proposal",
  start: { as: "owner", viewport: "desktop" },
  steps: [
    { do: [{ card: { eyebrow: "How to", title: "Build and send a proposal", subtitle: "Package, price and dates, in one place." } }, { wait: 2200 }] },
    {
      chapter: "Starting a proposal",
      say: "Let's build a proposal. Open the couple's job. When they're ready for pricing, the big green card at the top says Prepare proposal.",
      do: [
        { goto: "/studio/projects/job-mcbride" },
        { waitFor: { css: ".thread-next-go" } },
        { wait: 800 },
        { spotlight: { css: ".thread-next" }, holdMs: 3000 },
      ],
    },
    {
      say: "Tap the button on that card to open the proposal.",
      do: [{ click: { css: ".thread-next-go" } }, { waitFor: { role: "heading", name: "Choose the client and event" } }, { wait: 600 }],
    },
    {
      chapter: "The package",
      say: "A proposal has three short parts. The first is the package they're booking. Each of your packages is listed here, with its price.",
      do: [{ spotlight: section("Choose the client and event"), holdMs: 3800 }],
      poster: true,
    },
    {
      say: "Tap Lock this package on the one they want. From that moment the price is fixed, so later changes to your packages won't affect it.",
      do: [
        { hover: { role: "button", name: "Lock this package", nth: 2 } },
        { wait: 600 },
        { click: { role: "button", name: "Lock this package", nth: 2 } },
        { wait: 1200 },
      ],
      pauseAfterMs: 900,
    },
    {
      say: "The dark card on the right keeps a running summary of the offer: the total, the tax, and the retainer that holds their date.",
      do: [{ spotlight: { css: ".proposal-composer-preview" }, holdMs: 4200 }],
    },
    {
      chapter: "The introduction",
      say: "The second part is a short introduction the couple will read. Tap Draft from what they told you to have one written from their inquiry, or write your own.",
      do: [
        { scrollTo: section("Frame the offer") },
        { spotlight: { role: "button", name: "Draft from what they told you" }, holdMs: 2400 },
        {
          type: {
            into: { css: "textarea" },
            text: "Erin and Cal, it was lovely to meet you both. Here's the Signature Collection we talked about, with room for everything on your list.",
          },
        },
      ],
    },
    {
      chapter: "The dates",
      say: "The third part sets the dates: when the proposal expires, and when the retainer and the final balance are due.",
      do: [{ scrollTo: section("Set the decision and payment dates") }, { spotlight: section("Set the decision and payment dates"), holdMs: 3800 }],
    },
    {
      chapter: "Approve and send",
      say: "Then tap Create draft. Nothing goes to the couple yet.",
      do: [
        { spotlight: { role: "button", name: "Create draft" }, holdMs: 1600 },
        { click: { role: "button", name: "Create draft" } },
        { wait: 900 },
        { cut: [{ waitFor: { role: "button", name: /Approve this proposal|Send for approval/ }, timeoutMs: 90000 }, { wait: 600 }] },
      ],
      pauseAfterMs: 900,
    },
    {
      say: "Check it over, then tap Approve this proposal.",
      do: [
        { spotlight: { role: "button", name: "Approve this proposal" }, holdMs: 1800 },
        { click: { role: "button", name: "Approve this proposal" } },
        { wait: 900 },
        { cut: [{ waitFor: { text: /Generating branded PDF|Branded PDF ready/ }, timeoutMs: 90000 }] },
        { wait: 1200 },
      ],
      pauseAfterMs: 1000,
    },
    {
      say: "StudioCue now makes a branded PDF of the proposal. It only takes a moment.",
      do: [
        { wait: 1800 },
        { cut: [{ waitFor: { text: "Branded PDF ready" }, timeoutMs: 120000 }] },
        { wait: 500 },
        { spotlight: { text: "Branded PDF ready" }, holdMs: 1800 },
      ],
    },
    {
      say: "Last, tick Ready to share with the client, and tap Send proposal.",
      do: [
        { click: { css: "label:has-text('Ready to share with the client') input" } },
        { wait: 600 },
        { spotlight: { role: "button", name: "Send proposal" }, holdMs: 1400 },
        { click: { role: "button", name: "Send proposal" } },
        { wait: 1500 },
        { cut: [{ reload: true }, { waitFor: { text: /Sent|Track the decision/ }, timeoutMs: 30000 }] },
      ],
      pauseAfterMs: 900,
    },
    {
      say: "The couple gets a branded email with a link to their portal, where they can accept the proposal, or ask for changes.",
      do: [{ wait: 3000 }],
    },
    { do: [{ card: { eyebrow: "Next", title: "Get it signed and the retainer paid" } }, { wait: 2600 }] },
  ],
});
