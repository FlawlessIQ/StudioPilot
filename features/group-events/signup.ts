/**
 * Group event sign-up (docs/group-event-signup-plan-2026-10-10.md).
 *
 * A sports or cheer day where each parent pays for their own athlete's
 * photos, mostly in cash (Conor, 2026-10-10). The studio sets 2–3 packages for
 * the event and which ways parents may pay; parents sign up from a link sent
 * ahead of time, or by scanning a QR code at the field, pick a package and
 * see how to pay. Their sign-up lands on the roster
 * (features/group-events/participants.ts) as it happens.
 *
 * Texting is the studio's own phone: StudioCue never sends a text (Conor,
 * 2026-10-10). Online payment is the studio's own pay link; a QuickBooks
 * invoice per parent comes later.
 *
 * Pure, and safe on both sides of the trust boundary: the public route
 * (app/api/public/event-signup/route.ts) and crmCommand both read it.
 * functions/src/group-events/signup.ts is a copy of everything below the
 * marker; tests/group-event-signup.test.ts fails on a drift.
 */

// --- shared with functions/src/group-events/signup.ts ---
import { z } from "zod";

/** The ways a studio can let parents pay for an event, in the order offered. */
export const EVENT_PAYMENT_METHODS = ["cash", "check", "venmo", "zelle", "pay_link"] as const;
export type EventPaymentMethod = (typeof EVENT_PAYMENT_METHODS)[number];

/** What a parent reads when choosing. */
export const EVENT_PAYMENT_LABEL: Record<EventPaymentMethod, string> = {
  cash: "Cash at the event",
  check: "Check at the event",
  venmo: "Venmo",
  zelle: "Zelle",
  pay_link: "Pay online now",
};

/** In a list for the studio and on the sign: "Pay by cash, check, Venmo". */
export const EVENT_PAYMENT_SHORT: Record<EventPaymentMethod, string> = {
  cash: "cash",
  check: "check",
  venmo: "Venmo",
  zelle: "Zelle",
  pay_link: "card online",
};

/** Paid at the field, so the roster says "pays on the day". */
export const PAID_AT_EVENT: ReadonlySet<EventPaymentMethod> = new Set(["cash", "check"]);

export const EVENT_SIGNUP_LIMITS = {
  minOptions: 1,
  maxOptions: 6,
  optionName: 80,
  optionDescription: 240,
  /** $5,000 for one athlete's photos: a typo guard, not a policy. */
  maxPriceCents: 500_000,
  venmoHandle: 40,
  zelleTo: 120,
  checkPayableTo: 120,
  payLinkUrl: 500,
  maxCapacity: 5000,
} as const;

export type EventOption = {
  id: string;
  name: string;
  priceCents: number;
  description: string | null;
};

export type EventSignupConfig = {
  options: EventOption[];
  methods: EventPaymentMethod[];
  venmoHandle: string | null;
  zelleTo: string | null;
  checkPayableTo: string | null;
  payLinkUrl: string | null;
  /** Taking sign-ups. A closed link shows "sign-up has closed". */
  open: boolean;
  closesAt: string | null;
  capacity: number | null;
  /** The link's token, once the studio has opened it (studio-only). */
  token: string | null;
};

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const text = (value: unknown, limit: number): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed ? trimmed.slice(0, limit) : null;
};

/** "@Studio-Name" or a venmo.com URL to "Studio-Name"; anything else, null. */
export function normaliseVenmoHandle(value: unknown): string | null {
  const raw = text(value, 120);
  if (!raw) return null;
  const handle = raw.replace(/^https?:\/\/(www\.)?venmo\.com\/(u\/)?/i, "").replace(/^@/, "").replace(/[/?#].*$/, "");
  return /^[A-Za-z0-9_-]{2,40}$/.test(handle) ? handle : null;
}

export function normalisePayLinkUrl(value: unknown): string | null {
  const raw = text(value, EVENT_SIGNUP_LIMITS.payLinkUrl);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && url.hostname.includes(".") ? url.toString() : null;
  } catch {
    return null;
  }
}

/** `project.groupEvent.signup`, as the exact shape; anything malformed is dropped. */
export function normaliseEventSignup(groupEvent: unknown): EventSignupConfig {
  const signup = record(record(groupEvent).signup);
  const options = (Array.isArray(signup.options) ? signup.options : [])
    .map(record)
    .map((option): EventOption | null => {
      const id = text(option.id, 40);
      const name = text(option.name, EVENT_SIGNUP_LIMITS.optionName);
      const price = Number(option.priceCents);
      if (!id || !name || !Number.isSafeInteger(price) || price < 0 || price > EVENT_SIGNUP_LIMITS.maxPriceCents) return null;
      return { id, name, priceCents: price, description: text(option.description, EVENT_SIGNUP_LIMITS.optionDescription) };
    })
    .filter((option): option is EventOption => option !== null)
    .slice(0, EVENT_SIGNUP_LIMITS.maxOptions);
  const venmoHandle = normaliseVenmoHandle(signup.venmoHandle);
  const zelleTo = text(signup.zelleTo, EVENT_SIGNUP_LIMITS.zelleTo);
  const payLinkUrl = normalisePayLinkUrl(signup.payLinkUrl);
  // A method the studio can't be paid by (no handle, no link) is never offered.
  const methods = (Array.isArray(signup.methods) ? signup.methods : [])
    .filter((method): method is EventPaymentMethod => (EVENT_PAYMENT_METHODS as readonly unknown[]).includes(method))
    .filter((method) => (method === "venmo" ? Boolean(venmoHandle) : method === "zelle" ? Boolean(zelleTo) : method === "pay_link" ? Boolean(payLinkUrl) : true));
  const capacity = Number(signup.capacity);
  const closesAt = text(signup.closesAt, 40);
  return {
    options,
    methods: [...new Set(methods)],
    venmoHandle,
    zelleTo,
    checkPayableTo: text(signup.checkPayableTo, EVENT_SIGNUP_LIMITS.checkPayableTo),
    payLinkUrl,
    open: signup.open === true,
    closesAt: closesAt && !Number.isNaN(Date.parse(closesAt)) ? closesAt : null,
    capacity: Number.isSafeInteger(capacity) && capacity > 0 ? Math.min(capacity, EVENT_SIGNUP_LIMITS.maxCapacity) : null,
    token: text(signup.token, 80),
  };
}

export type SignupState = "not_set_up" | "open" | "closed" | "full";

/** Whether a parent can sign up right now. */
export function signupState(config: EventSignupConfig, now: string, signedUp: number): SignupState {
  if (!config.token || !config.options.length || !config.methods.length) return "not_set_up";
  if (!config.open) return "closed";
  if (config.closesAt && Date.parse(config.closesAt) <= Date.parse(now)) return "closed";
  if (config.capacity !== null && signedUp >= config.capacity) return "full";
  return "open";
}

/** Paid at the field, or still to pay: the roster's status for a new sign-up. */
export function statusForMethod(method: EventPaymentMethod): "pay_on_day" | "unpaid" {
  return PAID_AT_EVENT.has(method) ? "pay_on_day" : "unpaid";
}

/** What a parent sends. Server-checked again against the event as it stands. */
export const eventSignupInputSchema = z.object({
  token: z.string().trim().min(16).max(80),
  parentName: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email().max(254),
  phone: z.string().trim().max(40).nullable().default(null),
  athleteName: z.string().trim().min(1).max(120),
  team: z.string().trim().max(80).nullable().default(null),
  optionId: z.string().trim().min(1).max(40),
  method: z.enum(EVENT_PAYMENT_METHODS),
  consent: z.literal(true),
  /** Hidden from people; a bot fills every field. */
  website: z.string().max(200).optional().default(""),
});
export type EventSignupInput = z.infer<typeof eventSignupInputSchema>;

/** The studio's settings for an event, as crmCommand accepts them. */
export const eventSignupSettingsSchema = z.object({
  options: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(40),
        name: z.string().trim().min(1).max(EVENT_SIGNUP_LIMITS.optionName),
        priceCents: z.number().int().min(0).max(EVENT_SIGNUP_LIMITS.maxPriceCents),
        description: z.string().trim().max(EVENT_SIGNUP_LIMITS.optionDescription).nullable().default(null),
      }),
    )
    .min(EVENT_SIGNUP_LIMITS.minOptions)
    .max(EVENT_SIGNUP_LIMITS.maxOptions),
  methods: z.array(z.enum(EVENT_PAYMENT_METHODS)).min(1).max(EVENT_PAYMENT_METHODS.length),
  venmoHandle: z.string().trim().max(120).nullable().default(null),
  zelleTo: z.string().trim().max(EVENT_SIGNUP_LIMITS.zelleTo).nullable().default(null),
  checkPayableTo: z.string().trim().max(EVENT_SIGNUP_LIMITS.checkPayableTo).nullable().default(null),
  payLinkUrl: z.string().trim().max(EVENT_SIGNUP_LIMITS.payLinkUrl).nullable().default(null),
  open: z.boolean(),
  closesAt: z.string().trim().max(40).nullable().default(null),
  capacity: z.number().int().min(1).max(EVENT_SIGNUP_LIMITS.maxCapacity).nullable().default(null),
});
export type EventSignupSettings = z.infer<typeof eventSignupSettingsSchema>;

/** Why the settings can't be saved as they are, or null. */
export function eventSignupSettingsProblem(settings: EventSignupSettings): string | null {
  if (settings.methods.includes("venmo") && !normaliseVenmoHandle(settings.venmoHandle)) return "EVENT_VENMO_HANDLE_REQUIRED";
  if (settings.methods.includes("zelle") && !text(settings.zelleTo, 200)) return "EVENT_ZELLE_REQUIRED";
  if (settings.methods.includes("pay_link") && !normalisePayLinkUrl(settings.payLinkUrl)) return "EVENT_PAY_LINK_INVALID";
  const ids = settings.options.map((option) => option.id);
  if (new Set(ids).size !== ids.length) return "EVENT_OPTIONS_INVALID";
  if (settings.closesAt && Number.isNaN(Date.parse(settings.closesAt))) return "EVENT_CLOSES_AT_INVALID";
  return null;
}

/** Dollars for parents: "$45" or "$45.50". */
export function eventPrice(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents % 100 ? 2 : 0,
  }).format(cents / 100);
}

/**
 * Venmo, opened to the studio with the amount and a note filled in. No
 * integration: the studio sees it in Venmo and marks it paid on the roster.
 */
export function venmoPayUrl(handle: string, amountCents: number, note: string): string {
  const params = new URLSearchParams({ txn: "pay", amount: (amountCents / 100).toFixed(2), note: note.slice(0, 100) });
  return `https://venmo.com/${encodeURIComponent(handle)}?${params.toString()}`;
}

/** The message a studio texts parents from its own phone. */
export function signupTextMessage(input: { studioName: string; eventName: string; url: string }): string {
  return `${input.studioName}: sign up for ${input.eventName} here — pick a package and how you’ll pay: ${input.url}`;
}

/** Opens Messages with the text written (iPhone and Android both read `body`). */
export function smsHref(message: string): string {
  return `sms:?&body=${encodeURIComponent(message)}`;
}

/** How a parent pays, in a sentence, for the confirmation screen and email. */
export function howToPay(method: EventPaymentMethod, config: Pick<EventSignupConfig, "venmoHandle" | "zelleTo" | "checkPayableTo">, studioName: string): string {
  switch (method) {
    case "cash":
      return `Pay ${studioName} in cash at the event. Show your confirmation number.`;
    case "check":
      return `Bring a check to the event${config.checkPayableTo ? `, payable to ${config.checkPayableTo}` : ""}. Show your confirmation number.`;
    case "venmo":
      return `Pay @${config.venmoHandle ?? ""} on Venmo. Put the athlete's name in the note.`;
    case "zelle":
      return `Send it by Zelle to ${config.zelleTo ?? studioName}. Put the athlete's name in the memo.`;
    case "pay_link":
      return `Pay online with ${studioName}'s secure payment page.`;
  }
}

/** A short code a parent shows at the field: 6 characters, no look-alikes. */
export const CONFIRMATION_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function confirmationCodeFrom(bytes: Uint8Array): string {
  return Array.from(bytes.slice(0, 6), (byte) => CONFIRMATION_ALPHABET[byte % CONFIRMATION_ALPHABET.length]).join("");
}

/** Emails pulled from a pasted list: commas, lines, spaces or a spreadsheet column. */
export function emailsFrom(text: string): { emails: string[]; rejected: string[] } {
  const parts = text
    .split(/[\s,;]+/)
    .map((part) => part.trim().replace(/^<|>$/g, "").toLowerCase())
    .filter(Boolean);
  const valid = (part: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(part);
  return { emails: [...new Set(parts.filter(valid))], rejected: parts.filter((part) => !valid(part)) };
}
