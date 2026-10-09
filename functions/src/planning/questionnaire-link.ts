import type {
  DocumentData,
  DocumentReference,
  Firestore,
} from "firebase-admin/firestore";
import {
  invitationLinkFields,
  mintClientInvitation,
  normalizeInviteEmail,
} from "../client/invitation-mint.js";
import {
  preparePartnerSends,
  type PartnerSend,
} from "../client/partner-invitations.js";

/**
 * Where "Complete questionnaire" sends the couple.
 *
 * The questionnaire lives in the client portal, `/client/questionnaire`, which
 * is an authenticated route: signed out, AuthBoundary sends you to
 * /auth/login, and signed in without a `client` membership on this job the
 * portal API refuses with PROJECT_ACCESS_DENIED. A couple only gets that
 * membership by accepting a portal invitation. So a form sent to an inquiry —
 * a couple the studio has not invited, which is exactly when a studio sends
 * its event form before the consultation — went out with a button that
 * ended on a sign-in page for an account nobody had made.
 *
 * Proposals and agreements met this first and carry their own invitation
 * when the couple has no portal access (booking/proposals.ts,
 * contracts/commands.ts). The questionnaire does the same thing, with the
 * same invitation document (its id is derived from tenant, job and
 * email, so it is the one the Clients page and a later proposal would use)
 * and `next` set so accepting lands on the form.
 *
 * Minting a fresh token retires the link in any earlier invitation email for
 * this job — the same trade "Resend invitation" and the proposal send make,
 * and safe for the same reason: the couple is holding a newer email that works.
 */

export const QUESTIONNAIRE_PATH = "/client/questionnaire";

/**
 * Pure: whether the email needs an invitation in it.
 *
 * "portal" when the couple can already open the portal for this job, or when
 * there is nobody to attach an invitation to (no client contact or no email —
 * the worker could not send to them either, and fails the job on its own).
 */
export function questionnaireLinkPlan(input: {
  clientContactId: string;
  contactEmail: string;
  /** contacts/{id}.portalUserId — set when they accepted any invitation. */
  portalUserId: string;
  /** Their membership's projectIds, when they have one in this studio. */
  memberProjectIds: readonly string[];
  memberActive: boolean;
  projectId: string;
}): "portal" | "invite" {
  if (!input.clientContactId) return "portal";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.contactEmail.trim()))
    return "portal";
  // A portal account counts only if it opens *this* job. A couple who booked
  // with the studio before has portalUserId set from the old job, and their
  // membership does not list the new inquiry until they accept an invitation
  // for it (functions/src/client/invitations.ts, accept).
  if (
    input.portalUserId &&
    input.memberActive &&
    input.memberProjectIds.includes(input.projectId)
  )
    return "portal";
  return "invite";
}

export type QuestionnaireLink = {
  actionUrl: string;
  /** The invitation the email links to, to be written beside the email job. */
  invitationWrite: {
    reference: DocumentReference;
    data: DocumentData;
  } | null;
  /**
   * The partner's own copy, with their own link, when anyone's link is an
   * invitation (client/partner-invitations.ts). The caller marks its job
   * `soleRecipient: partnerSends.length > 0` and writes these with
   * `queuePartnerSends` beside it.
   */
  partnerSends: PartnerSend[];
};

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/**
 * Reads the job's couple and returns the link for a questionnaire email,
 * minting a portal invitation when they need one. The caller writes
 * `invitationWrite` (merge) in the same batch or transaction as the email job,
 * so neither exists without the other.
 */
export async function questionnaireLinkFor(
  db: Firestore,
  input: {
    tenantId: string;
    projectId: string;
    /** The project's clientContactIds, as stored. */
    clientContactIds: unknown;
    emailJobId: string;
    actorId: string;
    now: string;
    /** Where the link lands in the portal; the planning form unless said (shot-list-upload.ts). */
    path?: string;
  },
): Promise<QuestionnaireLink> {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "https://studiohub.app").replace(/\/$/, "");
  const path = input.path ?? QUESTIONNAIRE_PATH;
  const portalUrl = `${appUrl}${path}`;
  const clientContactId = Array.isArray(input.clientContactIds)
    ? text(input.clientContactIds[0])
    : "";
  if (!clientContactId) return { actionUrl: portalUrl, invitationWrite: null, partnerSends: [] };
  const contact = await db.doc(`contacts/${clientContactId}`).get();
  if (!contact.exists || contact.get("tenantId") !== input.tenantId)
    return { actionUrl: portalUrl, invitationWrite: null, partnerSends: [] };
  const contactEmail = normalizeInviteEmail(text(contact.get("email")));
  const portalUserId = text(contact.get("portalUserId"));
  const membership = portalUserId
    ? await db.doc(`memberships/${input.tenantId}_${portalUserId}`).get()
    : null;
  const memberProjectIds = Array.isArray(membership?.get("projectIds"))
    ? (membership?.get("projectIds") as unknown[]).filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  const plan = questionnaireLinkPlan({
    clientContactId,
    contactEmail,
    portalUserId,
    memberProjectIds,
    memberActive:
      Boolean(membership?.exists) &&
      membership?.get("status") === "active" &&
      membership?.get("role") === "client",
    projectId: input.projectId,
  });
  const partnerSends = await preparePartnerSends(db, (reference) => reference.get(), {
    tenantId: input.tenantId,
    projectId: input.projectId,
    clientContactIds: input.clientContactIds,
    primaryContactId: clientContactId,
    primaryEmail: contactEmail,
    primaryNeedsInvite: plan === "invite",
    primaryEmailJobId: input.emailJobId,
    appUrl,
    path,
    actorId: input.actorId,
    now: input.now,
  });
  if (plan === "portal") return { actionUrl: portalUrl, invitationWrite: null, partnerSends };

  const invitation = mintClientInvitation({
    tenantId: input.tenantId,
    projectId: input.projectId,
    email: contactEmail,
    appUrl,
    next: path,
  });
  const reference = db.doc(`clientInvitations/${invitation.invitationId}`);
  const existing = await reference.get();
  return {
    partnerSends,
    actionUrl: invitation.inviteUrl,
    invitationWrite: {
      reference,
      data: {
        id: invitation.invitationId,
        tenantId: input.tenantId,
        projectId: input.projectId,
        contactId: clientContactId,
        email: invitation.email,
        normalizedEmail: invitation.email,
        status: "pending",
        ...invitationLinkFields(invitation.tokenHash),
        expiresAt: invitation.expiresAt,
        acceptedAt: null,
        acceptedBy: null,
        revokedAt: null,
        lastSentAt: input.now,
        latestEmailJobId: input.emailJobId,
        sendCount: Number(existing.get("sendCount") ?? 0) + 1,
        createdAt: existing.get("createdAt") ?? input.now,
        updatedAt: input.now,
        createdBy: existing.get("createdBy") ?? input.actorId,
        updatedBy: input.actorId,
        archivedAt: null,
      },
    },
  };
}
