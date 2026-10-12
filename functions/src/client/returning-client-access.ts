import { createHash } from "node:crypto";
import {
  FieldValue,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
} from "firebase-admin/firestore";
import { clientAutomationsPaused } from "../imports/existing-booking.js";

/**
 * A returning client opens their next job with the account they already have.
 *
 * A client's portal access is their membership in the studio
 * (`memberships/{tenantId}_{uid}`, role `client`), and the jobs it opens are
 * its `projectIds`. Only accepting an invitation ever added to that list
 * (client/invitations.ts, accept), and an invitation was minted only for a
 * contact with no portal account at all (`!portalUserId`). So a client who had
 * booked with the studio before was sent their new job's links with no
 * invitation and no access: Priya Shah, Jess Styles Bridal, 2026-10-12 — her
 * Sangeet's "Read and sign" opened her already-signed wedding agreement, and
 * nothing anywhere let her reach the Sangeet's.
 *
 * Now the job is added to the membership they already have, on the server,
 * whenever the studio sends them anything for it and whenever the job is made
 * or they are added to it (returning-client-access-trigger.ts). Only:
 *
 *   - for a contact in this studio, on this job, who has a portal account;
 *   - into that account's own membership in this studio (`userId` is theirs);
 *   - when that membership is an active client's. A revoked, suspended or
 *     missing one is left exactly as it is — never re-activated here — and
 *     the send falls back to the invitation it always carried, which the
 *     client has to accept themselves (and which cannot re-activate a revoked
 *     or suspended one either: client/invitations.ts, accept);
 *   - when the account was made for the address the contact has now. The
 *     studio can change a client's email (crm/commands.ts updateContact),
 *     and an account proved only the address it was accepted with — a job is
 *     never handed to it on the strength of an address someone else may now
 *     hold. The send invites the current address instead.
 *
 * And not from the job's own arrival when nobody at the studio has looked at
 * it yet: an inquiry that made itself a job (the public form, a captured
 * email — anyone who knows a client's address can send one), or an imported
 * booking still held quiet (ADR 0005). Those are given to the account by the
 * studio's first send for them, like any other job (automaticGrantHold).
 *
 * `arrayUnion`, so a second grant is a no-op, and each grant is audited once:
 * the membership is read in the same transaction that writes it.
 */

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const lowerText = (value: unknown) => text(value).toLowerCase();

/** How many of a job's clients are considered — the job's own list, capped. */
export const MAX_CLIENT_CONTACTS = 8;

export type ClientAccessPlan =
  /** The membership already opens this job. */
  | "already"
  /** An active client membership that lacks this job: add it. */
  | "grant"
  /** No portal account on the contact: the invitation path. */
  | "no_account"
  /** A portal account with no membership in this studio. */
  | "no_membership"
  /** Revoked, suspended, or anything but active: never re-activated here. */
  | "inactive"
  /**
   * The account was accepted with an address the contact no longer has: the
   * studio changed their email since. Never given a job on the old proof.
   */
  | "email_changed"
  /** The membership is someone else's, or not a client's. */
  | "not_client"
  /** The contact is missing or another studio's. */
  | "not_this_studio";

/**
 * Pure: what a job's client contact's existing portal account means for the
 * job — open already, to be granted, or (anything else) not usable, in which
 * case the caller sends an invitation as before.
 */
export function returningClientAccessPlan(input: {
  tenantId: string;
  projectId: string;
  contact: {
    exists: boolean;
    tenantId?: unknown;
    portalUserId?: unknown;
    email?: unknown;
    normalizedEmail?: unknown;
  } | null;
  membership: {
    exists: boolean;
    tenantId?: unknown;
    userId?: unknown;
    role?: unknown;
    status?: unknown;
    projectIds?: unknown;
    /** The address the account accepted its invitation with (invitations.ts). */
    email?: unknown;
  } | null;
}): ClientAccessPlan {
  if (!input.tenantId || !input.projectId) return "not_this_studio";
  if (!input.contact?.exists || input.contact.tenantId !== input.tenantId) return "not_this_studio";
  const uid = text(input.contact.portalUserId);
  if (!uid) return "no_account";
  const membership = input.membership;
  if (!membership?.exists) return "no_membership";
  // The document id already names tenant and user; the fields must agree, so
  // a mislabelled document can never be widened on someone else's behalf.
  if (
    membership.role !== "client" ||
    (membership.userId !== undefined && membership.userId !== uid) ||
    (membership.tenantId !== undefined && membership.tenantId !== input.tenantId)
  )
    return "not_client";
  // Accepting proved the address the contact had then (invitations.ts checks
  // the contact's email against the account's). If the studio has changed it
  // since, the account proves nothing about whoever holds the new one. The
  // contact's `email` is what accepting compares, so it is read first.
  const contactEmail = lowerText(input.contact.email) || lowerText(input.contact.normalizedEmail);
  const memberEmail = lowerText(membership.email);
  if (contactEmail && memberEmail && contactEmail !== memberEmail) return "email_changed";
  if (membership.status !== "active") return "inactive";
  return Array.isArray(membership.projectIds) && membership.projectIds.includes(input.projectId)
    ? "already"
    : "grant";
}

/**
 * The rule, read off the documents as stored. One place for the fields it
 * needs, so the server and the backfill (scripts/backfill-returning-client-
 * access.mts) can never read a different set.
 */
export function accessPlanFromSnapshots(input: {
  tenantId: string;
  projectId: string;
  contact: DocumentSnapshot;
  membership: DocumentSnapshot | null;
}): ClientAccessPlan {
  const { contact, membership } = input;
  return returningClientAccessPlan({
    tenantId: input.tenantId,
    projectId: input.projectId,
    contact: {
      exists: contact.exists,
      tenantId: contact.get("tenantId"),
      portalUserId: contact.get("portalUserId"),
      email: contact.get("email"),
      normalizedEmail: contact.get("normalizedEmail"),
    },
    membership: membership
      ? {
          exists: membership.exists,
          tenantId: membership.get("tenantId"),
          userId: membership.get("userId"),
          role: membership.get("role"),
          status: membership.get("status"),
          projectIds: membership.get("projectIds"),
          email: membership.get("email"),
        }
      : null,
  });
}

/**
 * Pure: a client membership someone turned off — revoked or suspended. Never
 * turned back on by anything a client is sent: not a grant here, and not an
 * invitation's accept (client/invitations.ts), which would otherwise write
 * `status: "active"` over it with every job it had.
 */
export const clientMembershipTurnedOff = (status: unknown): boolean =>
  status === "revoked" || status === "suspended";

/** Pure: whether a plan leaves the client able to open the job. */
export const accessOpensJob = (plan: ClientAccessPlan): boolean =>
  plan === "already" || plan === "grant";

export type ReturningClientEntry = {
  contactId: string;
  /** The contact's portal account, when it has one. */
  uid: string;
  plan: ClientAccessPlan;
};

export type ReturningClientAccess = {
  tenantId: string;
  projectId: string;
  entries: ReturningClientEntry[];
  /**
   * Whether this contact can open the job in the portal once the grants are
   * written. False for a contact that was not read (not on the job).
   */
  opens(contactId: string): boolean;
};

export function returningClientAccess(
  tenantId: string,
  projectId: string,
  entries: ReturningClientEntry[],
): ReturningClientAccess {
  return {
    tenantId,
    projectId,
    entries,
    opens: (contactId: string) =>
      entries.some((entry) => entry.contactId === contactId && accessOpensJob(entry.plan)),
  };
}

/** Pure: the job's client contact ids, as stored, de-duplicated and capped. */
export function jobClientContactIds(clientContactIds: unknown): string[] {
  return Array.isArray(clientContactIds)
    ? [...new Set(clientContactIds.filter((id): id is string => typeof id === "string" && id.trim() !== ""))].slice(
        0,
        MAX_CLIENT_CONTACTS,
      )
    : [];
}

/**
 * Read what each of a job's clients' portal accounts means for the job.
 * `read` is `transaction.get` inside a transaction (call it before any write),
 * or a plain document read otherwise. Writes nothing.
 */
export async function readReturningClientAccess(
  db: Firestore,
  read: (reference: DocumentReference) => Promise<DocumentSnapshot>,
  input: { tenantId: string; projectId: string; clientContactIds: unknown },
): Promise<ReturningClientAccess> {
  const ids = jobClientContactIds(input.clientContactIds);
  const contacts = await Promise.all(ids.map((id) => read(db.doc(`contacts/${id}`))));
  const memberships = await Promise.all(
    contacts.map((contact) => {
      const uid = contact.exists && contact.get("tenantId") === input.tenantId ? text(contact.get("portalUserId")) : "";
      return uid ? read(db.doc(`memberships/${input.tenantId}_${uid}`)) : Promise.resolve(null);
    }),
  );
  const entries = ids.map((contactId, index) => {
    const contact = contacts[index]!;
    return {
      contactId,
      uid: contact.exists ? text(contact.get("portalUserId")) : "",
      plan: accessPlanFromSnapshots({
        tenantId: input.tenantId,
        projectId: input.projectId,
        contact,
        membership: memberships[index] ?? null,
      }),
    };
  });
  return returningClientAccess(input.tenantId, input.projectId, entries);
}

/** A transaction or a batch: both update and create the same way. */
export type AccessWriter = {
  update(reference: DocumentReference, data: Record<string, unknown>): unknown;
  create(reference: DocumentReference, data: Record<string, unknown>): unknown;
};

/** Stable per grant, for the audit trail's correlation id. */
export const accessGrantKey = (tenantId: string, uid: string, projectId: string) =>
  `client_access_${createHash("sha256").update(`${tenantId}:${uid}:${projectId}`).digest("hex").slice(0, 32)}`;

/**
 * Write the grants a read found: the job added to each such membership, and
 * one audit event each. Nothing for any other plan. Returns how many.
 */
export function writeReturningClientAccess(
  db: Firestore,
  writer: AccessWriter,
  access: ReturningClientAccess,
  input: { actorId: string; now: string; reason: string },
): number {
  let granted = 0;
  const seen = new Set<string>();
  for (const entry of access.entries) {
    if (entry.plan !== "grant" || !entry.uid || seen.has(entry.uid)) continue;
    seen.add(entry.uid);
    const membership = db.doc(`memberships/${access.tenantId}_${entry.uid}`);
    writer.update(membership, {
      projectIds: FieldValue.arrayUnion(access.projectId),
      updatedAt: input.now,
      updatedBy: input.actorId,
    });
    const audit = db.collection("auditEvents").doc();
    writer.create(audit, {
      id: audit.id,
      tenantId: access.tenantId,
      projectId: access.projectId,
      actorId: input.actorId,
      actorType: "system",
      action: "client.project_access_granted",
      entityType: "membership",
      entityId: membership.id,
      timestamp: input.now,
      before: null,
      after: { projectId: access.projectId, contactId: entry.contactId, reason: input.reason },
      ipAddress: null,
      userAgent: null,
      correlationId: accessGrantKey(access.tenantId, entry.uid, access.projectId),
      automationRunId: null,
      providerEventId: null,
    });
    granted += 1;
  }
  return granted;
}

/**
 * Read and grant in a transaction of its own, for a caller that is not inside
 * one (a batch send, the email worker, the job trigger). Returns the access as
 * it stands once written.
 */
export async function ensureReturningClientAccess(
  db: Firestore,
  input: {
    tenantId: string;
    projectId: string;
    clientContactIds: unknown;
    actorId: string;
    now: string;
    reason: string;
  },
): Promise<ReturningClientAccess> {
  if (!jobClientContactIds(input.clientContactIds).length || !input.tenantId || !input.projectId)
    return returningClientAccess(input.tenantId, input.projectId, []);
  return db.runTransaction(async (transaction) => {
    const access = await readReturningClientAccess(db, (reference) => transaction.get(reference), input);
    writeReturningClientAccess(db, transaction, access, input);
    return access;
  });
}

/** The fields of a job the holds read. */
export type GrantHoldJob = {
  archivedAt?: unknown;
  deletedAt?: unknown;
  state?: unknown;
  origin?: unknown;
  clientAutomationsPausedAt?: unknown;
  clientPortalActive?: unknown;
};

export type AutomaticGrantHold =
  /** Archived or deleted. */
  | "put_away"
  /** Lost, or archived as a state: not a job the client is working on. */
  | "closed"
  /**
   * An inquiry that made itself a job, before the studio has done anything
   * with it (intake/convert.ts: origin "inquiry", state LEAD).
   */
  | "unconfirmed_inquiry"
  /** An imported booking still held quiet (ADR 0005). */
  | "quiet_import";

/**
 * Pure: why a job is not given to its clients' accounts on its own — by its
 * arrival (the trigger) or by the backfill — or null when it may be.
 *
 * Every hold is a job nobody at the studio has chosen to show a client yet.
 * The public inquiry form and inbox capture make a job from whatever anyone
 * typed, reusing the contact an address names: a stranger who knows a
 * returning client's email could otherwise put a job of their own invention
 * in that client's portal before the studio saw it. An imported booking
 * arrives quiet, and inviting the couple is the studio's separate choice
 * when it brings the booking live (ADR 0005). A held job still reaches the
 * account the moment the studio sends the client anything for it: every send
 * path grants, whatever this says.
 */
export function automaticGrantHold(project: GrantHoldJob | null): AutomaticGrantHold | null {
  if (!project || project.archivedAt || project.deletedAt) return "put_away";
  if (project.state === "LOST" || project.state === "ARCHIVED") return "closed";
  if (project.origin === "inquiry" && project.state === "LEAD") return "unconfirmed_inquiry";
  if (clientAutomationsPaused(project) || project.clientPortalActive === false) return "quiet_import";
  return null;
}

/**
 * Pure: which clients a write to a job newly put on it — every one on a new
 * job, the added ones on an existing job — so the trigger grants only on a
 * create or an assignment, not on every write a job sees. A job on hold
 * (automaticGrantHold) grants nothing: its first send does.
 */
export function clientsAddedToJob(
  before: { clientContactIds?: unknown; tenantId?: unknown } | null,
  after: ({ clientContactIds?: unknown; tenantId?: unknown } & GrantHoldJob) | null,
): string[] {
  if (!after || automaticGrantHold(after) || !text(after.tenantId)) return [];
  const now = jobClientContactIds(after.clientContactIds);
  const earlier = new Set(
    before && before.tenantId === after.tenantId ? jobClientContactIds(before.clientContactIds) : [],
  );
  return now.filter((id) => !earlier.has(id));
}
