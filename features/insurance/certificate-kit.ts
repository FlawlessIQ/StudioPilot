/**
 * The certificate kit: everything a studio types into its insurer's website
 * to make a certificate of insurance, in the order the form asks for it.
 *
 * Studios insured online (Hiscox, NEXT, Thimble) make their own certificates;
 * none of the three offers a connection a partner can make them through
 * (checked 2026-10-14), so the form stays a person's job. This is what makes
 * it two minutes: the venue's address split the way every certificate form
 * splits it — street, city, state, ZIP, where we handed over one line — and a
 * button to the insurer's own certificate page.
 *
 * Pure: the job's insurance page renders it, and tests pin it.
 */

export type Insurer = "hiscox" | "next" | "thimble" | "other";

export const INSURERS: Record<Insurer, { label: string; url: string | null }> = {
  hiscox: {
    label: "Hiscox",
    url: "https://www.hiscox.com/small-business-insurance/liability-insurance/certificate-of-insurance",
  },
  // The customer portal: Certificate → Create Custom Certificate.
  next: { label: "NEXT", url: "https://portal.nextinsurance.com/" },
  thimble: { label: "Thimble", url: "https://app.thimble.com/" },
  other: { label: "your insurer", url: null },
};

export function isInsurer(value: unknown): value is Insurer {
  return typeof value === "string" && value in INSURERS;
}

/**
 * Where "Open …" goes: the studio's own link when it saved one (its insurer
 * is not one of ours, or it uses a different page), else the insurer's.
 */
export function insurerLink(settings: Record<string, unknown> | null | undefined): {
  label: string;
  url: string | null;
} {
  const chosen = settings?.insurer;
  const insurer: Insurer = isInsurer(chosen) ? chosen : "other";
  const portal = settings?.portalUrl;
  const own = typeof portal === "string" && /^https:\/\//.test(portal) ? portal : null;
  return { label: INSURERS[insurer].label, url: own ?? INSURERS[insurer].url };
}

export type SplitAddress = { street: string; city: string; state: string; zip: string };

/**
 * "120 Main St, Suite 4, Springfield, NJ 07081, USA" as the four boxes of a
 * certificate form. An address it can't read whole stays whole, in Street.
 */
export function splitUsAddress(address: string): SplitAddress {
  const parts = address
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  while (parts.length && /^(usa|us|united states( of america)?)$/i.test(parts[parts.length - 1]!)) parts.pop();
  const whole = { street: parts.join(", "), city: "", state: "", zip: "" };
  if (parts.length < 3) {
    // "Springfield NJ 07081" with no comma before the state.
    const last = parts.length === 2 ? parts[1]!.match(/^(.+?)\s+([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/) : null;
    return last ? { street: parts[0]!, city: last[1]!, state: last[2]!, zip: last[3]! } : whole;
  }
  const tail = parts[parts.length - 1]!.match(/^([A-Z]{2})(?:\s+(\d{5}(?:-\d{4})?))?$/);
  if (!tail) return whole;
  return {
    street: parts.slice(0, -2).join(", "),
    city: parts[parts.length - 2]!,
    state: tail[1]!,
    zip: tail[2] ?? "",
  };
}

export type KitField = { label: string; value: string };

/**
 * The fields in form order. Empty ones are left out rather than shown blank,
 * so a venue that asked for no special wording shows no wording line.
 */
export function certificateKitFields(input: {
  holder: string;
  venueAddress: string;
  venueName: string;
  eventDateLabel: string;
  service: string;
  additionalInsuredWording?: string | null;
}): KitField[] {
  const address = splitUsAddress(input.venueAddress);
  const what = input.service ? `${input.service.charAt(0).toUpperCase()}${input.service.slice(1)}` : "Services";
  const description = [what, input.venueName ? `at ${input.venueName}` : "", input.eventDateLabel ? `on ${input.eventDateLabel}` : ""]
    .filter(Boolean)
    .join(" ");
  return [
    { label: "Certificate holder", value: input.holder },
    { label: "Street", value: address.street },
    { label: "City", value: address.city },
    { label: "State", value: address.state },
    { label: "ZIP", value: address.zip },
    { label: "Description of operations", value: description },
    { label: "Additional insured wording", value: input.additionalInsuredWording?.trim() ?? "" },
  ].filter((field) => field.value);
}

/**
 * Whether a certificate already sent to this venue covers a new date: it
 * names no event date of its own, its holder is the venue, and the policy on
 * it runs past the new date. Then the studio re-sends it instead of making
 * another (repeat venues are most of a wedding photographer's year).
 */
export function certificateCovers(input: {
  extractedEventDate?: unknown;
  policyExpirationDate?: unknown;
  eventDate: string;
}): boolean {
  if (typeof input.extractedEventDate === "string" && input.extractedEventDate.trim()) return false;
  const ends = typeof input.policyExpirationDate === "string" ? input.policyExpirationDate.slice(0, 10) : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ends)) return false;
  return ends >= input.eventDate.slice(0, 10);
}
