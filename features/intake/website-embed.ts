/**
 * Putting StudioCue's inquiry form on a studio's own website.
 *
 * Gabe (2026-09-30), after forwarding, Gmail rules and Wix's notification
 * settings had each failed him: "Need to make them easy. I am pretty tech
 * savvy and couldn't get any of those to work… is there a html code we can
 * cut and paste to put on the studio's website?" Every forwarding route makes
 * a studio configure somebody else's product. This one is a paste: the form
 * itself, on their page, so an inquiry never needs forwarding at all.
 *
 * Two shapes, because builders differ in what they accept:
 *  - the form, framed in the page (`embedSnippet`, or `embedUrl` alone for a
 *    builder that embeds by address, like Wix's "Embed a site");
 *  - a button that opens it (`buttonSnippet`), for a builder or plan with no
 *    code block at all.
 *
 * Pure: no I/O. The origin is passed in so the studio copies the address it is
 * actually using.
 */

/** The message the embedded form posts to the page around it. */
export const EMBED_MESSAGE_TYPE = "studiocue:inquiry";

/** Tall enough for the longest step on a phone-width column, before it reports. */
export const EMBED_INITIAL_HEIGHT = 980;

function trimOrigin(origin: string): string {
  return origin.replace(/\/+$/, "");
}

/** The form's public address — the link a studio shares. */
export function inquiryUrl(origin: string, slug: string): string {
  return `${trimOrigin(origin)}/inquiry?studio=${encodeURIComponent(slug)}`;
}

/** The same form without its own studio bar, sized to sit inside a page. */
export function embedUrl(origin: string, slug: string): string {
  return `${inquiryUrl(origin, slug)}&embed=1`;
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** A frame id per studio, so two studios' forms on one page never collide. */
function frameId(slug: string): string {
  return `studiocue-inquiry-${slug.replace(/[^a-z0-9-]/gi, "")}`;
}

/**
 * The form in a frame, plus a few lines that let it grow and shrink with each
 * step and bring its top into view when the couple moves on. Without them a
 * fixed-height frame either scrolls inside itself or leaves a gap.
 */
export function embedSnippet(input: { origin: string; slug: string; studioName: string }): string {
  const origin = trimOrigin(input.origin);
  const id = frameId(input.slug);
  const title = escapeAttribute(`Inquire with ${input.studioName}`);
  return [
    `<iframe id="${id}" src="${escapeAttribute(embedUrl(origin, input.slug))}" title="${title}" loading="lazy" style="display:block;width:100%;max-width:640px;height:${EMBED_INITIAL_HEIGHT}px;margin:0 auto;border:0;"></iframe>`,
    `<script>`,
    `window.addEventListener("message", function (event) {`,
    `  if (event.origin !== "${origin}" || !event.data || event.data.type !== "${EMBED_MESSAGE_TYPE}") return;`,
    `  var frame = document.getElementById("${id}");`,
    `  if (!frame || event.source !== frame.contentWindow) return;`,
    `  if (event.data.height) frame.style.height = event.data.height + "px";`,
    `  if (event.data.scrollIntoView) frame.scrollIntoView({ behavior: "smooth", block: "start" });`,
    `});`,
    `</script>`,
  ].join("\n");
}

/** Readable on any background the studio's colour allows. */
function textOn(hex: string): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return "#ffffff";
  const value = parseInt(match[1]!, 16);
  const [r, g, b] = [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  // Relative luminance, WCAG's formula.
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  return luminance > 0.4 ? "#1a1a1a" : "#ffffff";
}

/** A button that opens the form in a new tab, in the studio's colour. */
export function buttonSnippet(input: {
  origin: string;
  slug: string;
  label?: string;
  color?: string | null;
}): string {
  const color = /^#[0-9a-f]{6}$/i.test(input.color ?? "") ? input.color! : "#1f3d33";
  const label = escapeAttribute(input.label?.trim() || "Check availability");
  return `<a href="${escapeAttribute(inquiryUrl(input.origin, input.slug))}" target="_blank" rel="noopener" style="display:inline-block;padding:14px 26px;border-radius:999px;background:${color};color:${textOn(color)};font:600 16px/1.2 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;text-decoration:none;">${label}</a>`;
}

export type EmbedBuilder = "wix" | "squarespace" | "wordpress" | "showit" | "other";

export type EmbedGuide = {
  key: EmbedBuilder;
  label: string;
  /** What to paste: the frame code, or the bare address (Wix's "Embed a site"). */
  paste: "code" | "url";
  steps: string[];
};

/**
 * Where the paste goes, per builder. Kept to the menu names each builder
 * shows, and to one route each — the one that works on the plans studios are
 * usually on. Where a plan might not allow code, the button is the fallback,
 * and the guide says so rather than leaving the studio stuck.
 */
export const EMBED_GUIDES: EmbedGuide[] = [
  {
    key: "wix",
    label: "Wix",
    paste: "url",
    steps: [
      "Open your site in the **Wix Editor** and go to your contact page.",
      "Click **Add Elements (+)** → **Embed Code** → **Embed a site**.",
      "Click **Enter Website Address**, paste the address below and click **Update**.",
      "Drag the box to the full width of your column and at least **980 px** tall, then **Publish**.",
    ],
  },
  {
    key: "squarespace",
    label: "Squarespace",
    paste: "code",
    steps: [
      "Edit your contact page and click **Add Block** where the form should go.",
      "Choose **Code**, paste the code below, and turn **Display Source** off.",
      "Click outside the block, then **Save**. If your plan won't add a Code block, use the button instead.",
    ],
  },
  {
    key: "wordpress",
    label: "WordPress",
    paste: "code",
    steps: [
      "Edit your contact page and add a **Custom HTML** block where the form should go.",
      "Paste the code below into the **Custom HTML** block.",
      "Click **Update**. If you use Elementor, drag in an **HTML** widget instead and paste the same code.",
    ],
  },
  {
    key: "showit",
    label: "Showit",
    paste: "code",
    steps: [
      "Open your contact page in Showit and choose **Add → Embed Code**.",
      "Paste the code below, and size the box to at least **980 px** tall.",
      "**Publish** your site.",
    ],
  },
  {
    key: "other",
    label: "Something else",
    paste: "code",
    steps: [
      "Look for a block called **Embed**, **HTML** or **Code** on your contact page.",
      "Paste the code below into it and **Publish**.",
      "No code block? Use the **button** on the next screen instead, or link any button on your site to your form's address.",
    ],
  },
];
