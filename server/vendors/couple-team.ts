import { createHash } from "node:crypto";
import { FieldValue, type DocumentSnapshot, type Firestore } from "firebase-admin/firestore";
import { resolvePlanningTimeline } from "@/features/planning/planning-timeline";
import { todayInZone } from "@/lib/format/event-date";
import {
  coupleVendorAnswer,
  coupleVendorAsk,
  coupleVendorKey,
  coupleVendorKinds,
  dedupeCoupleVendors,
  normalizeEmail,
  vendorSuggestionsFromAnswers,
  type CoupleVendorSubmission,
  type CoupleVendorTeamRecord,
  type CoupleVendorTeamView,
  type CoupleVendorView,
} from "@/features/vendors/couple-team";
import { crewVendorContactsFrom } from "@/features/vendors/team";
import type { VendorType } from "@/features/vendors/schema";

/**
 * The couple's side of their vendor team (features/vendors/couple-team.ts):
 * what is on it, and saving what they send. Through the portal route, which
 * has already checked they are a client on this job.
 *
 * What the couple sends replaces what the couple sent before — rows they
 * took out come off the team — and never touches the studio's own entries:
 * the studio's planner, or a florist it added, stays exactly as the studio
 * left it. A vendor the studio already has (same email) is linked, not
 * copied, and its directory details are left alone; a new one joins the
 * directory flagged `addedByClient`.
 *
 * Writes the same records the studio's vendor-team commands do
 * (functions/src/planning/vendor-team.ts): the entry, the vendor's
 * `projectIds`, the crew's view without the money, an audit event.
 */

type Row = Record<string, unknown>;
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const hash = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 32);
const stableId = (scope: string, tenantId: string, key: string) => `${scope}_${hash(`${tenantId}:${key}`)}`;
/** functions/src/planning/share-mint.ts `shareIdFor`. */
const shareIdFor = (tenantId: string, projectId: string, vendorId: string) =>
  `ros_share_${createHash("sha256").update(`${tenantId}:${projectId}:${vendorId}`).digest("hex").slice(0, 32)}`;

export const coupleVendorRecordPath = (projectId: string) => `clientVendorTeams/${projectId}`;

function formAnswers(responses: DocumentSnapshot[]): Array<{ label: string; value: unknown }> {
  const out: Array<{ label: string; value: unknown }> = [];
  for (const response of responses) {
    if (response.get("archivedAt") || response.get("status") === "withdrawn") continue;
    const answers = (response.get("answers") ?? {}) as Row;
    if (Array.isArray(answers)) continue;
    const sections = response.get("templateSnapshot.sections");
    for (const section of Array.isArray(sections) ? sections : []) {
      const fields = (section as { fields?: unknown } | null)?.fields;
      for (const field of Array.isArray(fields) ? fields : []) {
        const id = text((field as Row)?.id);
        const label = text((field as Row)?.label);
        if (id && label && typeof answers[id] === "string") out.push({ label, value: answers[id] });
      }
    }
  }
  return out;
}

function viewOf(entry: DocumentSnapshot): CoupleVendorView {
  return {
    entryId: text(entry.get("entryId")) || entry.id,
    category: (text(entry.get("category")) || "other") as VendorType,
    company: text(entry.get("company")),
    contactName: text(entry.get("contactName")),
    email: text(entry.get("email")) || null,
    phone: text(entry.get("phone")) || null,
    addedByCouple: entry.get("source") === "couple",
  };
}

export async function coupleVendorTeamFor(
  db: Firestore,
  input: { tenantId: string; projectId: string; now?: Date },
): Promise<CoupleVendorTeamView> {
  const [project, tenant, stored, team, responses] = await Promise.all([
    db.doc(`projects/${input.projectId}`).get(),
    db.doc(`tenants/${input.tenantId}`).get(),
    db.doc(coupleVendorRecordPath(input.projectId)).get(),
    db.collection("projectVendors").where("tenantId", "==", input.tenantId).where("projectId", "==", input.projectId).get(),
    db.collection("questionnaireResponses").where("tenantId", "==", input.tenantId).where("projectId", "==", input.projectId).get(),
  ]);
  if (!project.exists || project.get("tenantId") !== input.tenantId) throw new Error("PROJECT_NOT_FOUND");
  const record = stored.exists && stored.get("tenantId") === input.tenantId ? (stored.data() as CoupleVendorTeamRecord) : null;
  const planningFormSent = responses.docs.some(
    (response) => response.get("source") !== "inquiry_page" && !response.get("archivedAt") && response.get("status") !== "withdrawn",
  );
  const ask = coupleVendorAsk({
    project: project.data() ?? {},
    timeline: resolvePlanningTimeline(tenant.get("planningTimeline")),
    today: todayInZone(text(project.get("timezone")), input.now),
    planningFormSent,
  });
  // Booked vendors only: a florist the planner is still weighing up isn't
  // someone the couple has.
  const vendors = team.docs
    .filter((entry) => !entry.get("archivedAt") && entry.get("status") === "booked" && text(entry.get("company")))
    .map(viewOf)
    .sort((left, right) => Number(right.addedByCouple) - Number(left.addedByCouple) || left.company.localeCompare(right.company));
  return {
    ask,
    answer: coupleVendorAnswer(record),
    receivedAt: text(record?.receivedAt) || null,
    vendors,
    suggestions: vendorSuggestionsFromAnswers(formAnswers(responses.docs), vendors),
    kinds: coupleVendorKinds(tenant.get("trade")),
  };
}

export type CoupleVendorSaveResult = {
  team: CoupleVendorTeamView;
  added: number;
  updated: number;
  removed: number;
  /** Vendors the studio already had on the job: linked, not added twice. */
  alreadyListed: string[];
};

export async function submitCoupleVendorTeam(
  db: Firestore,
  input: {
    tenantId: string;
    projectId: string;
    uid: string;
    submission: CoupleVendorSubmission;
    now: string;
  },
): Promise<CoupleVendorSaveResult> {
  const { tenantId, projectId, uid, now } = input;
  const rows = input.submission.answer === "listed" ? dedupeCoupleVendors(input.submission.vendors) : [];
  const projectReference = db.doc(`projects/${projectId}`);
  const recordReference = db.doc(coupleVendorRecordPath(projectId));
  const emails = [...new Set(rows.map((row) => normalizeEmail(row.email)).filter(Boolean))];

  const outcome = await db.runTransaction(async (transaction) => {
    const [project, tenant, record, team] = await Promise.all([
      transaction.get(projectReference),
      transaction.get(db.doc(`tenants/${tenantId}`)),
      transaction.get(recordReference),
      transaction.get(db.collection("projectVendors").where("tenantId", "==", tenantId).where("projectId", "==", projectId)),
    ]);
    if (!project.exists || project.get("tenantId") !== tenantId) throw new Error("PROJECT_NOT_FOUND");
    const ask = coupleVendorAsk({
      project: project.data() ?? {},
      timeline: resolvePlanningTimeline(tenant.get("planningTimeline")),
      today: todayInZone(text(project.get("timezone")), new Date(now)),
      planningFormSent: true,
    });
    if (!ask.available) throw new Error("VENDOR_TEAM_NOT_ASKED");
    const offered = new Set<string>(coupleVendorKinds(tenant.get("trade")));
    if (rows.some((row) => !offered.has(row.category))) throw new Error("VENDOR_KIND_NOT_OFFERED");

    // Every read before the first write.
    const contactIds = (Array.isArray(project.get("clientContactIds")) ? (project.get("clientContactIds") as unknown[]) : [])
      .map(text)
      .filter(Boolean)
      .slice(0, 10);
    const [contacts, directoryMatches] = await Promise.all([
      contactIds.length ? transaction.getAll(...contactIds.map((id) => db.doc(`contacts/${id}`))) : Promise.resolve([]),
      Promise.all(
        Array.from({ length: Math.ceil(emails.length / 30) }, (_, index) =>
          transaction.get(
            db.collection("vendors").where("tenantId", "==", tenantId).where("email", "in", emails.slice(index * 30, index * 30 + 30)),
          ),
        ),
      ),
    ]);
    // One address, one role: the couple's own address is not a vendor's.
    const coupleEmails = new Set(contacts.map((contact) => normalizeEmail(contact.get("email"))).filter(Boolean));
    if (rows.some((row) => row.email && coupleEmails.has(normalizeEmail(row.email)))) throw new Error("VENDOR_EMAIL_IS_YOURS");

    const directoryByEmail = new Map<string, DocumentSnapshot>();
    for (const snapshot of directoryMatches)
      for (const vendor of snapshot.docs)
        if (!vendor.get("archivedAt")) directoryByEmail.set(normalizeEmail(vendor.get("email")), vendor);

    const live = team.docs.filter((entry) => !entry.get("archivedAt"));
    const coupleEntries = new Map(live.filter((entry) => entry.get("source") === "couple").map((entry) => [text(entry.get("entryId")) || entry.id, entry]));
    const studioVendorIds = new Set(live.filter((entry) => entry.get("source") !== "couple").map((entry) => text(entry.get("vendorId"))).filter(Boolean));

    type Planned = {
      entryId: string;
      vendorId: string;
      createVendor: boolean;
      updateVendorDetails: boolean;
      existing: DocumentSnapshot | null;
      row: (typeof rows)[number];
    };
    const planned: Planned[] = [];
    const alreadyListed: string[] = [];
    const candidateNewIds = rows.map((row) => stableId("vendor", tenantId, `couple:${coupleVendorKey(row)}`));
    const priorVendorIds = [...new Set([...coupleEntries.values()].map((entry) => text(entry.get("vendorId"))).filter(Boolean))];
    const [newIdDocs, priorVendors] = await Promise.all([
      candidateNewIds.length ? transaction.getAll(...candidateNewIds.map((id) => db.doc(`vendors/${id}`))) : Promise.resolve([]),
      priorVendorIds.length ? transaction.getAll(...priorVendorIds.map((id) => db.doc(`vendors/${id}`))) : Promise.resolve([]),
    ]);
    const priorVendorById = new Map(priorVendors.map((vendor) => [vendor.id, vendor]));

    for (const [index, row] of rows.entries()) {
      const key = coupleVendorKey(row);
      const existing =
        (row.entryId ? coupleEntries.get(row.entryId) : undefined) ??
        coupleEntries.get(stableId("pv", tenantId, `couple:${projectId}:${key}`)) ??
        null;
      const entryId = existing ? text(existing.get("entryId")) || existing.id : stableId("pv", tenantId, `couple:${projectId}:${key}`);
      const email = normalizeEmail(row.email);
      const inDirectory = email ? directoryByEmail.get(email) : undefined;
      const priorId = existing ? text(existing.get("vendorId")) : "";
      const prior = priorId ? priorVendorById.get(priorId) : undefined;
      // Theirs to change only when the couple made it and no other job uses it.
      const priorIsTheirs =
        Boolean(prior?.exists) &&
        prior!.get("tenantId") === tenantId &&
        prior!.get("addedByClient") === true &&
        !(Array.isArray(prior!.get("projectIds")) ? (prior!.get("projectIds") as unknown[]) : []).some((id) => id !== projectId);
      let vendorId: string;
      let createVendor = false;
      let updateVendorDetails = false;
      if (inDirectory && inDirectory.id !== priorId) vendorId = inDirectory.id;
      else if (priorId && (priorIsTheirs || normalizeEmail(prior?.get("email")) === email)) {
        vendorId = priorId;
        updateVendorDetails = priorIsTheirs;
      } else {
        const candidate = newIdDocs[index];
        vendorId = candidateNewIds[index]!;
        createVendor = !candidate?.exists;
        // The same couple-made vendor from another of this studio's jobs.
        if (candidate?.exists && candidate.get("tenantId") !== tenantId) throw new Error("VENDOR_NOT_FOUND");
      }
      if (studioVendorIds.has(vendorId)) {
        alreadyListed.push(row.company);
        continue;
      }
      if (planned.some((item) => item.vendorId === vendorId)) continue;
      planned.push({ entryId, vendorId, createVendor, updateVendorDetails, existing, row });
    }

    const keptEntryIds = new Set(planned.map((item) => item.entryId));
    const removed = [...coupleEntries.entries()].filter(([entryId]) => !keptEntryIds.has(entryId));
    const removedShares = removed.length
      ? await transaction.getAll(
          ...removed.map(([, entry]) => db.doc(`scheduleShares/${shareIdFor(tenantId, projectId, text(entry.get("vendorId")) || "none")}`)),
        )
      : [];

    // ── Writes ──
    let added = 0;
    let updated = 0;
    for (const item of planned) {
      const details = {
        company: item.row.company,
        contactName: item.row.contactName,
        email: item.row.email ? normalizeEmail(item.row.email) : null,
        phone: item.row.phone,
      };
      if (item.createVendor) {
        transaction.create(db.doc(`vendors/${item.vendorId}`), {
          id: item.vendorId,
          tenantId,
          projectId,
          projectIds: [projectId],
          ...details,
          type: item.row.category,
          website: null,
          address: null,
          notes: null,
          addedByClient: true,
          createdAt: now,
          updatedAt: now,
          createdBy: uid,
          updatedBy: uid,
          archivedAt: null,
        });
      } else {
        transaction.update(db.doc(`vendors/${item.vendorId}`), {
          projectIds: FieldValue.arrayUnion(projectId),
          ...(item.updateVendorDetails ? { ...details, type: item.row.category } : {}),
          updatedAt: now,
          updatedBy: uid,
        });
      }
      const priorVendorId = item.existing ? text(item.existing.get("vendorId")) : "";
      if (priorVendorId && priorVendorId !== item.vendorId) {
        transaction.update(db.doc(`vendors/${priorVendorId}`), { projectIds: FieldValue.arrayRemove(projectId), updatedAt: now, updatedBy: uid });
      }
      // The entry shows the vendor as the directory has them when the studio
      // already knew them, and as the couple wrote them otherwise.
      const directory = item.createVendor || item.updateVendorDetails ? null : directoryByEmail.get(normalizeEmail(item.row.email));
      const snapshot = directory
        ? {
            company: text(directory.get("company")) || details.company,
            contactName: text(directory.get("contactName")) || details.contactName || null,
            email: text(directory.get("email")) || details.email,
            phone: text(directory.get("phone")) || details.phone,
          }
        : { ...details, contactName: details.contactName || null };
      const reference = db.doc(`projectVendors/${projectId}_${item.entryId}`);
      if (item.existing) {
        transaction.update(reference, { category: item.row.category, vendorId: item.vendorId, ...snapshot, updatedAt: now, updatedBy: uid });
        updated += 1;
      } else {
        transaction.create(reference, {
          id: reference.id,
          entryId: item.entryId,
          tenantId,
          projectId,
          vendorId: item.vendorId,
          category: item.row.category,
          roleLabel: null,
          status: "booked",
          arrivalTime: null,
          loadInTime: null,
          strikeTime: null,
          contractReceived: false,
          coiReceived: false,
          costCents: null,
          balanceDueCents: null,
          balanceDueDate: null,
          tipCents: null,
          notes: null,
          ...snapshot,
          source: "couple",
          createdAt: now,
          updatedAt: now,
          createdBy: uid,
          updatedBy: uid,
          archivedAt: null,
        });
        added += 1;
      }
    }
    for (const [index, [, entry]] of removed.entries()) {
      transaction.delete(entry.ref);
      const vendorId = text(entry.get("vendorId"));
      if (vendorId) transaction.update(db.doc(`vendors/${vendorId}`), { projectIds: FieldValue.arrayRemove(projectId), updatedAt: now, updatedBy: uid });
      // Off the day, so their link to its schedule stops opening (vendor-team.ts removeEntry).
      const share = removedShares[index];
      if (share?.exists && share.get("tenantId") === tenantId && share.get("status") !== "revoked")
        transaction.update(share.ref, { status: "revoked", revokedAt: now, revokedReason: "removed_by_client", updatedAt: now, updatedBy: uid });
    }

    const answer = input.submission.answer;
    const fields = {
      id: projectId,
      tenantId,
      projectId,
      answer,
      count: planned.length,
      receivedAt: now,
      receivedBy: uid,
      updatedAt: now,
    };
    if (record.exists) transaction.update(recordReference, fields);
    else transaction.create(recordReference, { ...fields, studioSeenAt: null, createdAt: now });
    transaction.update(projectReference, { vendorTeamUpdatedAt: now });
    const auditId = `couple_vendor_team_${projectId}_${now.replace(/\D/g, "")}`;
    transaction.set(db.doc(`auditEvents/${auditId}`), {
      id: auditId,
      tenantId,
      projectId,
      actorId: uid,
      actorType: "client",
      action: "vendor_team.couple_listed",
      entityType: "clientVendorTeam",
      entityId: projectId,
      timestamp: now,
      before: record.exists ? { answer: record.get("answer") ?? null, count: record.get("count") ?? null } : null,
      after: { answer, count: planned.length, added, updated, removed: removed.length },
      ipAddress: null,
      userAgent: null,
      correlationId: auditId,
      automationRunId: null,
      providerEventId: null,
    });
    return { added, updated, removed: removed.length, alreadyListed };
  });

  // The crew's view of the job's vendors, from the team as it now stands.
  const entries = await db.collection("projectVendors").where("tenantId", "==", tenantId).where("projectId", "==", projectId).get();
  await db.doc(`crewVendorContacts/${projectId}`).set({
    id: projectId,
    tenantId,
    projectId,
    vendors: crewVendorContactsFrom(entries.docs.map((entry) => entry.data())),
    updatedAt: now,
  });
  return { ...outcome, team: await coupleVendorTeamFor(db, { tenantId, projectId, now: new Date(now) }) };
}
