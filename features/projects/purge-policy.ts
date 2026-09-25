/**
 * Erasing a job and everything StudioCue holds about it.
 *
 * Every other "remove" in this product is reversible on purpose: archiving
 * takes a record out of the working list, cancelling ends the work and keeps
 * the reason, and `firestore.rules` refuses a client delete on every
 * collection. That is right for day-to-day use — a client is named on
 * proposals and messages, a collaborator on assignments and closeouts, and
 * deleting either would leave records that no longer make sense.
 *
 * It is not right for the one case a studio owner genuinely has: a wedding
 * that must leave the system entirely. A couple who asks to be forgotten, a
 * job imported twice, a test booking made while learning the product. For
 * those, "archived" is not an answer — the records are still there.
 *
 * So this is the deliberate exception, and it is built to be hard to reach and
 * impossible to do by accident: owner only, blocked while anyone is still
 * waiting on the job, and gated on the owner typing the job's own name.
 *
 * ## What it must never take with it
 *
 * The purge finds records by their `projectId`, which is exactly the set of
 * things that belong to this one wedding. Everything below is either shared
 * with other jobs or is the machinery that keeps the system honest, and is
 * listed here so the sweep can never reach it even if such a record one day
 * starts carrying a `projectId`.
 *
 * Pure and deterministic. Duplicated at functions/src/projects/purge-policy.ts;
 * tests/project-purge.test.ts keeps the copies identical.
 */

/**
 * Collections the sweep must skip, whatever they contain.
 *
 * - `commandExecutions` and `webhookEvents` are the idempotency ledgers. A
 *   command or a provider webhook that arrives twice is recognised by a row
 *   here; delete the row and the retry executes a second time.
 * - `publicRateLimits` is abuse control — clearing it hands the counter back.
 * - `memberships`, `users`, `tenants`, `subscriptions` and `usageCounters`
 *   are the account itself, not the job.
 * - `projectPurges` is the record of this operation, which must outlive it.
 */
export const PURGE_PROTECTED_COLLECTIONS: readonly string[] = [
  "commandExecutions",
  "webhookEvents",
  "publicRateLimits",
  "memberships",
  "users",
  "tenants",
  "subscriptions",
  "usageCounters",
  "featureFlags",
  "deletionRequests",
  "exportJobs",
  "projectPurges",
];

/**
 * Swept, but last, and by name rather than by the sweep.
 *
 * The job record is the handle on everything else: the owner's authority to
 * run this, the client contacts to consider, the name they have to type. A
 * purge that failed part way through having already deleted it would leave a
 * half-erased wedding that nothing could finish, because the next attempt
 * would answer PROJECT_NOT_FOUND. So it is destroyed only once everything it
 * points at is gone, and until then a retry can always pick the work back up.
 */
export const PURGE_DEFERRED_COLLECTIONS: readonly string[] = ["projects"];

export function purgeMaySweep(collection: string): boolean {
  return (
    !PURGE_PROTECTED_COLLECTIONS.includes(collection) &&
    !PURGE_DEFERRED_COLLECTIONS.includes(collection)
  );
}

/**
 * What survives, said plainly before the owner commits.
 *
 * Each of these is shared with the rest of the business, and a studio that
 * expected "delete everything" to mean "delete my videographer" would be
 * rightly alarmed. Stated as a list rather than a paragraph because it is the
 * half of the answer people skim for.
 */
export const PURGE_KEEPS: readonly string[] = [
  "Your crew — their directory entries, rates and availability. Only their assignments to this job are removed.",
  "Your vendors and venues. Only this job's insurance requests are removed.",
  "Your packages, questionnaires, workflows and email templates.",
  "Every other job, including other jobs for the same client.",
  // A signed agreement is deleted with the job like everything else, but the
  // couple was emailed their own copy when they signed, and no delete can
  // recall an email. Said here so an owner is not surprised later.
  "Your client's own copy of any agreement they signed — it was emailed to them when they signed.",
];

export type PurgeLine = { collection: string; label: string; count: number };

/**
 * Collection name → what a studio calls it.
 *
 * The preview is the whole safety mechanism, so it has to be readable: a list
 * headed `questionnaireResponses` tells an owner nothing about what they are
 * about to lose. Anything unnamed falls back to the collection name, which is
 * worse than a label and far better than being left out of the count.
 */
const LABELS: Record<string, { one: string; many: string }> = {
  projects: { one: "the job itself", many: "the job itself" },
  leads: { one: "enquiry", many: "enquiries" },
  consultations: { one: "consultation", many: "consultations" },
  proposals: { one: "proposal", many: "proposals" },
  packageSnapshots: { one: "package snapshot", many: "package snapshots" },
  contracts: { one: "agreement", many: "agreements" },
  contractSignatures: { one: "signature record", many: "signature records" },
  contractDrafts: { one: "agreement draft", many: "agreement drafts" },
  invoiceReferences: { one: "invoice", many: "invoices" },
  autopayCharges: { one: "payment attempt", many: "payment attempts" },
  paymentMethods: { one: "saved card", many: "saved cards" },
  schedules: { one: "run of show", many: "run of show versions" },
  scheduleShares: { one: "shared timeline", many: "shared timelines" },
  checkpoints: { one: "readiness check", many: "readiness checks" },
  readinessAssessments: { one: "readiness assessment", many: "readiness assessments" },
  workflowRuns: { one: "workflow run", many: "workflow runs" },
  automationRuns: { one: "automation run", many: "automation runs" },
  tasks: { one: "task", many: "tasks" },
  crewAssignments: { one: "crew assignment", many: "crew assignments" },
  crewCascades: { one: "crew cascade", many: "crew cascades" },
  crewStaffingPlans: { one: "staffing plan", many: "staffing plans" },
  crewBriefs: { one: "crew brief", many: "crew briefs" },
  crewMessages: { one: "crew message", many: "crew messages" },
  crewCalendarEvents: { one: "crew calendar event", many: "crew calendar events" },
  insuranceRequirements: { one: "insurance requirement", many: "insurance requirements" },
  insuranceRequests: { one: "certificate request", many: "certificate requests" },
  questionnaireResponses: { one: "questionnaire answer", many: "questionnaire answers" },
  messages: { one: "message", many: "messages" },
  conversations: { one: "conversation", many: "conversations" },
  communicationDrafts: { one: "prepared message", many: "prepared messages" },
  emailJobs: { one: "queued email", many: "queued emails" },
  documents: { one: "document", many: "documents" },
  deliveryRecords: { one: "delivery record", many: "delivery records" },
  deliveryDrafts: { one: "delivery draft", many: "delivery drafts" },
  galleryInboxes: { one: "gallery inbox", many: "gallery inboxes" },
  albumWorkflows: { one: "album", many: "albums" },
  albumReminders: { one: "album reminder", many: "album reminders" },
  reviewRequests: { one: "review request", many: "review requests" },
  postProductionRecords: { one: "post-production record", many: "post-production records" },
  projectCloseouts: { one: "closeout", many: "closeouts" },
  archiveHandoffs: { one: "archive handoff", many: "archive handoffs" },
  bookingOrchestrations: { one: "booking automation", many: "booking automations" },
  bookingGateRuns: { one: "booking gate run", many: "booking gate runs" },
  clientInvitations: { one: "portal invitation", many: "portal invitations" },
  aiActions: { one: "prepared action", many: "prepared actions" },
  aiInteractions: { one: "Cue interaction", many: "Cue interactions" },
  actionReceipts: { one: "action receipt", many: "action receipts" },
  auditEvents: { one: "audit entry", many: "audit entries" },
  notifications: { one: "notification", many: "notifications" },
  domainEvents: { one: "system event", many: "system events" },
};

export function purgeLineLabel(collection: string, count: number): string {
  const label = LABELS[collection];
  if (!label) return collection;
  return count === 1 ? label.one : label.many;
}

/**
 * Loudest first.
 *
 * An owner reads the top of this list and stops. "142 messages" and "3
 * invoices" belong above "1 system event", so the things that would hurt to
 * lose are the ones they actually see.
 */
export function orderPurgeLines(lines: readonly PurgeLine[]): PurgeLine[] {
  return [...lines]
    .filter((line) => line.count > 0)
    .sort(
      (left, right) =>
        right.count - left.count || left.label.localeCompare(right.label),
    );
}

export function purgeTotal(lines: readonly PurgeLine[]): number {
  return lines.reduce((total, line) => total + line.count, 0);
}

/**
 * Whether what they typed is the job's name.
 *
 * Case and spacing are forgiven — the name is on screen to be copied, and
 * failing somebody for a double space teaches them to paste without reading.
 * Nothing else is: the point of the gate is that the owner had to look at
 * which job this is and write it out.
 */
export function purgeConfirmationMatches(
  typed: string,
  projectName: string,
): boolean {
  const normalise = (value: string) =>
    value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
  const wanted = normalise(projectName);
  return wanted.length > 0 && normalise(typed) === wanted;
}

/** Why the server refused, in words the owner can act on. */
export const PURGE_REFUSALS: Record<string, string> = {
  PROJECT_PURGE_OWNER_ONLY:
    "Only the studio owner can permanently delete a job.",
  PROJECT_PURGE_NAME_MISMATCH:
    "That is not the job's name. Type it exactly as it appears above.",
  PROJECT_HAS_LIVE_CREW:
    "Someone is still waiting on this job. Cancel it first — that ends the offers and tells them why — then delete it.",
  PROJECT_NOT_FOUND: "That job could not be found. It may already be deleted.",
};
