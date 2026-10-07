import type {
  DocumentData,
  DocumentReference,
  DocumentSnapshot,
  Firestore,
  SetOptions,
} from "firebase-admin/firestore";
import {
  invitationLinkFields,
  mintClientInvitation,
  normalizeInviteEmail,
} from "./invitation-mint.js";

/**
 * A portal link for every client on the job, not only the first.
 *
 * A wedding is usually two people, and the email worker copies every client
 * contact on the job onto client mail (operations/jobs.ts, partnerRecipients).
 * But a proposal, agreement, booking change or questionnaire sent to a couple
 * without portal access carries an *invitation*, and an invitation is bound to
 * one address: acceptance checks the signed-in email against the invitation's
 * (client/invitations.ts, accept). So the partner copied on the email was
 * handed the first client's link, signed in as themselves, and was refused
 * with INVITED_EMAIL_MISMATCH.
 *
 * The fix keeps that binding — the safer of the two options. Widening
 * acceptance to "any client on the job" would let one token, which was never
 * delivered to every such address (a contact added later, or past the
 * worker's cap of three), claim a portal for an address it does not prove.
 * Instead each partner gets their own invitation (its id derived from their
 * own email, so minting one never replaces another's token) and their own
 * email carrying their own link. Acceptance is unchanged: the identity must be
 * the invited address of a contact on the job, and the membership opens only
 * this job.
 *
 * When a send needs any invitation, it goes as one email per person, each
 * marked `soleRecipient` so the worker does not also copy the others onto it
 * (they would get a second, wrong link). When nobody needs one, nothing
 * changes: one email, copied to the partners, with the plain portal link
 * that works for all of them.
 */

/** Mirrors the worker's cap on partners copied onto one email. */
export const MAX_PARTNER_SENDS = 3;

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export type PartnerContactRecord = {
  id: string;
  tenantId?: unknown;
  email?: unknown;
  displayName?: unknown;
  firstName?: unknown;
  lastName?: unknown;
  portalUserId?: unknown;
};

export type PartnerRecipient = {
  contactId: string;
  email: string;
  name: string;
  portalUserId: string;
};

/**
 * Pure: the other clients on a job a send should also reach, in the job's
 * order — every contact after the addressed one, in this studio, with an
 * address that isn't the addressed one's (or another partner's), at most
 * MAX_PARTNER_SENDS.
 */
export function partnerRecipientsFor(input: {
  tenantId: string;
  clientContactIds: unknown;
  primaryContactId: string;
  primaryEmail: string;
  contacts: readonly PartnerContactRecord[];
}): PartnerRecipient[] {
  const ids = Array.isArray(input.clientContactIds)
    ? input.clientContactIds.filter((id): id is string => typeof id === "string" && id !== "")
    : [];
  const seen = new Set([normalizeInviteEmail(input.primaryEmail)]);
  const partners: PartnerRecipient[] = [];
  for (const id of ids) {
    if (id === input.primaryContactId) continue;
    const contact = input.contacts.find((candidate) => candidate.id === id);
    if (!contact || contact.tenantId !== input.tenantId) continue;
    const email = normalizeInviteEmail(text(contact.email));
    if (!EMAIL.test(email) || seen.has(email)) continue;
    seen.add(email);
    const name =
      text(contact.displayName) ||
      `${text(contact.firstName)} ${text(contact.lastName)}`.trim();
    partners.push({ contactId: id, email, name, portalUserId: text(contact.portalUserId) });
  }
  return partners.slice(0, MAX_PARTNER_SENDS);
}

/**
 * Pure: whether a partner can already open this job in the portal — a portal
 * account whose active client membership lists this job. A partner who booked
 * with the studio before has a portal account that does not open this one.
 */
export function partnerHasPortalAccess(input: {
  portalUserId: string;
  membership: { exists: boolean; status?: unknown; role?: unknown; projectIds?: unknown } | null;
  projectId: string;
}): boolean {
  if (!input.portalUserId || !input.membership?.exists) return false;
  return (
    input.membership.status === "active" &&
    input.membership.role === "client" &&
    Array.isArray(input.membership.projectIds) &&
    input.membership.projectIds.includes(input.projectId)
  );
}

/**
 * Pure: one email for everyone (the worker copies the partners on) or one
 * each. One each only when someone's link is an invitation: a shared email
 * would hand everyone the addressed client's.
 */
export function sendSeparately(input: {
  primaryNeedsInvite: boolean;
  partners: ReadonlyArray<{ needsInvite: boolean }>;
}): boolean {
  return (
    input.partners.length > 0 &&
    (input.primaryNeedsInvite || input.partners.some((partner) => partner.needsInvite))
  );
}

/** One partner's own copy of a send. */
export type PartnerSend = {
  contactId: string;
  email: string;
  name: string;
  actionUrl: string;
  invitationWrite: { reference: DocumentReference; data: DocumentData } | null;
};

/** The id of a partner's copy of an email job: stable, so a retry is the same job. */
export const partnerEmailJobId = (primaryEmailJobId: string, index: number) =>
  `${primaryEmailJobId}_partner_${index + 1}`;

/**
 * Read the job's other clients and decide each one's link, minting their own
 * invitation where they need one. `read` is `transaction.get` inside a
 * transaction (call it before any write) or a plain document read otherwise.
 *
 * Returns nothing when the send should stay one shared email.
 */
export async function preparePartnerSends(
  db: Firestore,
  read: (reference: DocumentReference) => Promise<DocumentSnapshot>,
  input: {
    tenantId: string;
    projectId: string;
    clientContactIds: unknown;
    primaryContactId: string;
    primaryEmail: string;
    /** Whether the addressed client's own link is an invitation. */
    primaryNeedsInvite: boolean;
    primaryEmailJobId: string;
    appUrl: string;
    /** Where accepting lands, and the portal link for a partner already in. */
    path: string;
    actorId: string;
    now: string;
  },
): Promise<PartnerSend[]> {
  const ids = Array.isArray(input.clientContactIds)
    ? input.clientContactIds.filter(
        (id): id is string => typeof id === "string" && id !== "" && id !== input.primaryContactId,
      )
    : [];
  if (!ids.length) return [];
  const contacts = await Promise.all(ids.slice(0, 8).map((id) => read(db.doc(`contacts/${id}`))));
  const partners = partnerRecipientsFor({
    tenantId: input.tenantId,
    clientContactIds: input.clientContactIds,
    primaryContactId: input.primaryContactId,
    primaryEmail: input.primaryEmail,
    contacts: contacts
      .filter((contact) => contact.exists)
      .map((contact) => ({ id: contact.id, ...(contact.data() ?? {}) })),
  });
  if (!partners.length) return [];
  const memberships = await Promise.all(
    partners.map((partner) =>
      partner.portalUserId
        ? read(db.doc(`memberships/${input.tenantId}_${partner.portalUserId}`))
        : Promise.resolve(null),
    ),
  );
  const planned = partners.map((partner, index) => {
    const membership = memberships[index];
    return {
      partner,
      needsInvite: !partnerHasPortalAccess({
        portalUserId: partner.portalUserId,
        membership: membership
          ? {
              exists: membership.exists,
              status: membership.get("status"),
              role: membership.get("role"),
              projectIds: membership.get("projectIds"),
            }
          : null,
        projectId: input.projectId,
      }),
    };
  });
  if (!sendSeparately({ primaryNeedsInvite: input.primaryNeedsInvite, partners: planned })) return [];

  const minted = planned.map(({ partner, needsInvite }) =>
    needsInvite
      ? mintClientInvitation({
          tenantId: input.tenantId,
          projectId: input.projectId,
          email: partner.email,
          appUrl: input.appUrl,
          next: input.path,
        })
      : null,
  );
  const existing = await Promise.all(
    minted.map((invitation) =>
      invitation ? read(db.doc(`clientInvitations/${invitation.invitationId}`)) : Promise.resolve(null),
    ),
  );
  return planned.map(({ partner }, index) => {
    const invitation = minted[index];
    const prior = existing[index];
    const emailJobId = partnerEmailJobId(input.primaryEmailJobId, index);
    return {
      contactId: partner.contactId,
      email: partner.email,
      name: partner.name,
      actionUrl: invitation ? invitation.inviteUrl : `${input.appUrl}${input.path}`,
      invitationWrite: invitation
        ? {
            reference: db.doc(`clientInvitations/${invitation.invitationId}`),
            data: {
              id: invitation.invitationId,
              tenantId: input.tenantId,
              projectId: input.projectId,
              contactId: partner.contactId,
              email: invitation.email,
              normalizedEmail: invitation.email,
              status: "pending",
              ...invitationLinkFields(invitation.tokenHash),
              expiresAt: invitation.expiresAt,
              acceptedAt: null,
              acceptedBy: null,
              revokedAt: null,
              lastSentAt: input.now,
              latestEmailJobId: emailJobId,
              sendCount: Number(prior?.get("sendCount") ?? 0) + 1,
              createdAt: prior?.get("createdAt") ?? input.now,
              updatedAt: input.now,
              createdBy: prior?.get("createdBy") ?? input.actorId,
              updatedBy: input.actorId,
              archivedAt: null,
            },
          }
        : null,
    };
  });
}

/**
 * Pure: each partner's own copy of the addressed client's email job — the
 * same email, to them, with their own link, and copied to nobody.
 *
 * `proposalId` and `invoiceId` are left off: the worker and the delivery
 * webhook mark the proposal (or bill) sent, opened or failed from the job that
 * carries them, and that is the addressed client's.
 */
export function partnerEmailJobs(
  primaryJob: Record<string, unknown> & { id: string },
  sends: readonly PartnerSend[],
): Array<{ id: string; data: Record<string, unknown> }> {
  const { proposalId: _proposalId, invoiceId: _invoiceId, ...shared } = primaryJob;
  void _proposalId;
  void _invoiceId;
  return sends.map((send, index) => {
    const id = partnerEmailJobId(primaryJob.id, index);
    return {
      id,
      data: {
        ...shared,
        id,
        contactId: send.contactId,
        recipient: send.email,
        recipientName: send.name || null,
        actionUrl: send.actionUrl,
        soleRecipient: true,
        partnerOfEmailJobId: primaryJob.id,
      },
    };
  });
}

/** A transaction or a batch: both create and set the same way. */
export type SendWriter = {
  create(reference: DocumentReference, data: DocumentData): unknown;
  set(reference: DocumentReference, data: DocumentData, options: SetOptions): unknown;
};

/**
 * Write the partners' email jobs and invitations beside the addressed
 * client's, in the same transaction or batch, so none exists without the
 * others. The caller marks its own job `soleRecipient: sends.length > 0`.
 */
export function queuePartnerSends(
  db: Firestore,
  writer: SendWriter,
  primaryJob: Record<string, unknown> & { id: string },
  sends: readonly PartnerSend[],
): void {
  for (const job of partnerEmailJobs(primaryJob, sends)) {
    writer.create(db.doc(`emailJobs/${job.id}`), job.data);
  }
  for (const send of sends) {
    if (send.invitationWrite)
      writer.set(send.invitationWrite.reference, send.invitationWrite.data, { merge: true });
  }
}
