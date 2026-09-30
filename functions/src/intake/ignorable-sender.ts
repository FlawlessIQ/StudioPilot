import { builderFor, isPlatformAddress } from "./form-email.js";

/**
 * Whether "not an inquiry" may teach capture to ignore a sender for good.
 *
 * Ignoring is learned per sender, and capture drops every later message from
 * a learned sender without asking (intake/capture.ts). That is right for a
 * newsletter. It is a silent, permanent loss when the sender is the address
 * every real inquiry arrives from: a studio's own website form (Wix,
 * Squarespace, WordPress… all mail from one notification address), a
 * marketplace, or the studio's own mailbox when it forwards by hand. One tap
 * on one odd submission would have stopped the studio's inquiries arriving,
 * with nothing on any screen to say so.
 *
 * So those senders are never learned, whatever the studio chose — only that
 * one message is filed away. Deliberately conservative: a no-reply sender
 * that is just a newsletter will be asked about again, which costs a tap; a
 * form address wrongly learned costs every inquiry after it.
 */
export type SenderProtection =
  /** Nothing to learn. */
  | "no_sender"
  /** The couple's own address — a manual forward or a reply, not a list. */
  | "the_couple"
  /** A website form builder or wedding marketplace — it carries every inquiry. */
  | "form_or_marketplace"
  /** A no-reply / notification address: how website forms send. */
  | "notification_address"
  /** The studio's own mailbox, or another at its own domain. */
  | "studio_address";

/**
 * Form services beyond the ones capture already recognises by name
 * (form-email.ts BUILDER_SENDERS / isPlatformAddress). Their notifications
 * carry inquiries, so they are never learned either.
 */
const FORM_SERVICE_DOMAINS =
  /@(.*\.)?(typeform\.com|formspree\.io|hsforms\.(com|net)|hubspot\.com|honeybook\.com|dubsado\.com|17hats\.com|tave\.com|cognitoforms\.com|wufoo\.com|formstack\.com|zoho\.com|zohoforms\.com|paperform\.co|tally\.so|webflow\.com|netlify\.com|godaddy\.com|secureserver\.net|weebly\.com|square\.site|squareup\.com|jimdo\.com|carrd\.co|formsite\.com|jotform\.(com|us)|google\.com|wpforms\.com|gravityforms\.com|elementor\.com|studio-cue\.com|studiohub\.app)$/i;

/** Personal mailbox providers: a shared domain here says nothing about the studio. */
const SHARED_MAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "ymail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "zoho.com",
]);

const domainOf = (email: string): string => email.slice(email.lastIndexOf("@") + 1).toLowerCase();

export function senderProtection(input: {
  sender: string | null | undefined;
  /** The lead's own email, when it has one. */
  leadEmail?: string | null;
  /** How capture read the message: "unknown" when it was not a known form. */
  formBuilder?: string | null;
  /** The studio's own mailboxes (communications/inbound.ts studioMailboxes). */
  studioAddresses: readonly string[];
}): SenderProtection | null {
  const sender = (input.sender ?? "").trim().toLowerCase();
  if (!sender || !sender.includes("@")) return "no_sender";
  if (sender === (input.leadEmail ?? "").trim().toLowerCase()) return "the_couple";
  const studio = input.studioAddresses.map((address) => address.trim().toLowerCase());
  if (studio.includes(sender)) return "studio_address";
  const studioDomains = new Set(
    studio.map(domainOf).filter((domain) => domain && !SHARED_MAIL_DOMAINS.has(domain)),
  );
  if (studioDomains.has(domainOf(sender))) return "studio_address";
  if (
    (input.formBuilder && input.formBuilder !== "unknown") ||
    builderFor(sender, "", "") !== "unknown" ||
    FORM_SERVICE_DOMAINS.test(sender)
  )
    return "form_or_marketplace";
  if (isPlatformAddress(sender)) return "notification_address";
  return null;
}

/** Why a sender was kept, in the studio's words. */
export function senderProtectionReason(protection: SenderProtection): string {
  switch (protection) {
    case "studio_address":
      return "It's one of your own addresses, so your forwarded inquiries keep arriving.";
    case "form_or_marketplace":
      return "It's a website form or marketplace address that your real inquiries come from too.";
    case "notification_address":
      return "It's a no-reply form address, and real inquiries may come from it too.";
    case "the_couple":
      return "It's the person's own address.";
    default:
      return "There was no sender to ignore.";
  }
}
