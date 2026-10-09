import { resolveTenantBrand } from "../branding/tenant-brand.js";
import { coverageRoleLabel, type CoverageRole } from "../packages/coverage.js";
import { tradeOf, tradeProfile } from "../trades/trades.js";
import {
  defaultEmailCopy,
  renderEmailTemplate,
  type EmailBrand,
  type EmailTemplateOverride,
} from "./email-templates.js";

/**
 * An email as a studio's client would get it, with sample details.
 *
 * The template editor used to show the same placeholder for every email ("A
 * thoughtful next step from {{studioName}}"), so a studio editing it had no
 * idea what StudioCue actually sends, or what their change would do — "I see
 * where but it doesn't let me adjust" (GR, 2026-10-08). This renders the real
 * thing: StudioCue's own wording, the studio's brand, and the studio's changes
 * when there are any.
 */

type Row = Record<string, unknown>;
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const SAMPLE_PROJECT = "Avery & Sam";
const SAMPLE_RECIPIENT = "Avery Stone";

/**
 * The crew role a sample offer names, in the studio's trade: a DJ editing the
 * crew offer was shown a "Second photographer" (trades.ts).
 */
function sampleRole(trade: unknown): string {
  const profile = tradeProfile(trade);
  if (profile.family === "photo") return "Second photographer";
  const label = coverageRoleLabel(profile.coverageRoles[0] as CoverageRole, 1);
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
}

/** Plausible values for every field a template reads, so each one renders whole. */
function sampleValues(zone: string, trade: unknown): Row {
  const url = "https://studio-cue.com/client";
  const role = sampleRole(trade);
  return {
    timezone: zone,
    // What the studio does, as the worker passes it (operations/jobs.ts), so
    // a DJ's preview reads as a DJ's client will get it.
    trade: tradeOf(trade),
    eventDate: "2027-06-12",
    projectName: SAMPLE_PROJECT,
    portalUrl: url,
    actionUrl: url,
    inviteUrl: "https://studio-cue.com/auth/client-invite?token=sample",
    destinationUrl: url,
    invoiceUrl: "https://studio-cue.com/client/payments",
    scheduleUrl: "https://studio-cue.com/client/schedule",
    galleryUrl: "https://studio-cue.com/client/deliveries",
    appUrl: "https://studio-cue.com",
    amountCents: 150000,
    balanceCents: 150000,
    totalCents: 450000,
    dueDate: "2027-05-15",
    expiresAt: "2026-11-15T23:59:59.000Z",
    startsAt: "2026-10-20T22:00:00.000Z",
    endsAt: "2026-10-20T22:30:00.000Z",
    format: "zoom",
    meetingUrl: "https://zoom.us/j/0000000000",
    role,
    arrivalAt: "2027-06-12T16:00:00.000Z",
    departureAt: "2027-06-13T02:00:00.000Z",
    callDate: "2027-06-12",
    locationName: "Hollow Oak Barn",
    locationAddress: "41 Ridge Road, Hopewell, NJ",
    venueName: "Hollow Oak Barn",
    runOfShowShared: true,
    jobs: [
      { date: "2027-06-12", jobName: SAMPLE_PROJECT, role, arrivalAt: "2027-06-12T16:00:00.000Z", locationName: "Hollow Oak Barn", timezone: zone },
      { date: "2027-08-21", jobName: "Jordan & Lee", role, arrivalAt: null, locationName: null, timezone: zone },
    ],
    message: "We're so excited — can't wait to talk!",
    customBody: "Thanks for getting in touch. Here's the next step.",
    customSubject: "A quick note from us",
  };
}

export function previewBrand(tenant: Row | undefined): EmailBrand {
  const brand = resolveTenantBrand(tenant, "Your studio");
  const emailBranding =
    typeof tenant?.emailBranding === "object" && tenant.emailBranding !== null
      ? (tenant.emailBranding as Row)
      : {};
  return {
    studioName: brand.brandName,
    productName: "StudioCue",
    accentColor: brand.primaryColor ?? "#35664a",
    logoUrl: brand.logoUrl ?? null,
    contactEmail: null,
    postalAddress: text(emailBranding.postalAddress) || null,
  };
}

export function previewEmail(
  tenant: Row | undefined,
  key: string,
  template: EmailTemplateOverride | null,
) {
  const zone = text(tenant?.timezone) || "America/New_York";
  const input = {
    key,
    brand: previewBrand(tenant),
    recipientName: SAMPLE_RECIPIENT,
    projectName: SAMPLE_PROJECT,
    values: sampleValues(zone, tenant?.trade),
  };
  const rendered = renderEmailTemplate({ ...input, template });
  return {
    subject: rendered.subject,
    html: rendered.html,
    defaults: defaultEmailCopy(input),
  };
}
