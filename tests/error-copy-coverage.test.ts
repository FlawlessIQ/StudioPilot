import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { errorCodeHasCopy } from "@/lib/ai/friendly-error";
import { crewErrorCodeHasCopy } from "@/lib/crew/public-error";
import { importErrorCodeHasCopy } from "@/lib/studio-import/command-client";

/**
 * The rule this file exists to hold: nobody is ever told "Try again" about a
 * failure the product understands.
 *
 * The walk of 2026-09-02 spent a page of effort discovering, by hand, that a
 * retainer percentage over 100 reported "The package could not be created.
 * Try again." — naming no field, no reason, and recommending the one action
 * guaranteed to fail identically. The cause was one absent map entry:
 * `INVALID_COMMAND`, which every command endpoint returns for any schema
 * failure, and which had no copy at all.
 *
 * Finding that took a walk. Finding the next one would take another walk. When
 * this test was written the server threw **311** distinct codes, 94 of them
 * from command endpoints a person can reach, against 80 the client could
 * render — so the walking would not have ended.
 *
 * Modelled on tests/manual-advance.test.ts, which holds "a studio owner is
 * never stuck" the same way: not by testing a bug, but by comparing what the
 * product can do against what it must cover, so the next gap fails here
 * instead of in front of a photographer.
 *
 * Adding a code is fine. Adding one that nobody can read is not: either write
 * the copy, or list it in GENERIC_ON_PURPOSE with the reason.
 */

const FUNCTIONS_SRC = join(process.cwd(), "functions", "src");

/**
 * Endpoints whose failures a **person** reads.
 *
 * Deliberately not every `onRequest` file. Webhooks and inbound mail handlers
 * answer a provider — SendGrid, Stripe, DocuSign, Zoom — and their status
 * codes are consumed by a retry policy, not a photographer. Requiring studio
 * copy for `WEBHOOK_SIGNATURE_INVALID` would be noise, and worse, it would
 * teach the next person that this list is noise.
 *
 * `saas/stripe.ts` is in, because it holds `billingCommand` alongside
 * `stripeWebhook`; the conservative reading covers both.
 */
const USER_FACING_HANDLERS = [
  "ai/actions.ts",
  "ai/communications.ts",
  "ai/copilot.ts",
  "ai/message-draft.ts",
  "ai/schedule.ts",
  "ai/timing-rules.ts",
  "auth/emails.ts",
  "booking/commands.ts",
  "booking/consultation-availability-query.ts",
  "booking/proposals.ts",
  "booking/public-scheduling.ts",
  "client/invitations.ts",
  "communications/commands.ts",
  "communications/lifecycle-settings.ts",
  "crew/commands.ts",
  "crew/invitations.ts",
  "crm/commands.ts",
  "crm/public-lead.ts",
  "integrations/commands.ts",
  "integrations/oauth.ts",
  "integrations/signing-templates.ts",
  "planning/commands.ts",
  "post-event/commands.ts",
  "saas/admin.ts",
  "saas/branding.ts",
  "saas/data-lifecycle.ts",
  "saas/memberships.ts",
  "saas/onboarding.ts",
  "saas/stripe.ts",
  "saas/support.ts",
  "studio-import/commands.ts",
  "workflow/commands.ts",
];

/**
 * Codes that correctly reach the generic sentence, each with the reason.
 *
 * Two honest kinds, and nothing else belongs here:
 *
 *  - **"We have a bug."** An invariant the studio cannot act on and did not
 *    cause. `CHECKPOINT_ID_FAILED` means our own id generation disagreed with
 *    itself; there is no useful instruction, and inventing one would imply the
 *    photographer did something wrong.
 *  - **"Not reachable by a person."** Thrown on a path only a scheduler,
 *    trigger or provider can enter, in a file that also serves people.
 *
 * A code that a studio *can* cause and *can* fix does not go here. If it is
 * tempting to add one, that is the test working.
 */
const GENERIC_ON_PURPOSE: Record<string, string> = {
  // Our own invariants. A studio cannot act on these and did not cause them.
  CHECKPOINT_ID_FAILED: "id generation disagreed with itself — our bug",
  INVALID_CHECKPOINT_DEPENDENCY:
    "a template declares a dependency key it does not contain — our bug, caught by tests/workflow-starter-templates.test.ts",
};

/**
 * The debt this test found on the day it was written: 2026-09-02.
 *
 * Deliberately **not** merged into GENERIC_ON_PURPOSE. That list is a claim
 * that the generic sentence is correct; this one is a claim that nobody has
 * looked yet. Mixing them would destroy the only thing that makes the first
 * list useful — 144 unexamined entries beside two examined ones teaches the
 * next reader to skim both.
 *
 * A ratchet, in three parts, all enforced below:
 *
 *  1. New code cannot join this list. Anything thrown that is not already
 *     here needs copy or an entry in GENERIC_ON_PURPOSE.
 *  2. Writing copy for one **requires deleting it from here**, so the number
 *     only falls.
 *  3. An entry no longer thrown anywhere fails too, so deletions tidy up
 *     after themselves.
 *
 * The value grouped with each code is the domain it comes from, so this reads
 * as a worklist rather than an inventory: booking and crm are the paths a
 * studio walks on its first job, and are worth writing first.
 */
const KNOWN_GAPS: Record<string, string> = {
  ACCEPTED_PROPOSAL_IS_FINAL: "booking",
  ACTION_RECEIPT_NOT_CANCELLABLE: "ai",
  ACTION_RECEIPT_NOT_FOUND: "ai",
  ACTION_RECEIPT_NOT_RETRYABLE: "ai",
  ACTIVATED_IMPORT_CANNOT_BE_CANCELLED: "studio-import",
  ADD_ON_NOT_FOUND: "crm",
  ALBUM_WORKFLOW_NOT_FOUND: "post-event",
  APPROVAL_PERMISSION_REQUIRED: "booking, communications",
  APP_CHECK_REQUIRED: "crm",
  ARCHIVE_HANDOFF_BLOCKED: "post-event",
  AUTHENTICATION_REQUIRED: "crm",
  AUTH_ACTION_CODE_MISSING: "auth",
  AUTOMATION_APPROVAL_ALREADY_DECIDED: "ai",
  AUTOMATION_APPROVAL_NOT_FOUND: "ai",
  BUSINESS_NAME_CONFIRMATION_REQUIRED: "saas",
  CASCADE_CANDIDATE_INVALID: "crew",
  CHECKPOINT_NOT_FOUND: "workflow",
  CLIENT_ALREADY_LINKED: "client",
  CLIENT_CONTACT_REQUIRED: "booking",
  CLIENT_EMAIL_REQUIRED: "booking, client",
  CLIENT_NOT_ASSOCIATED_WITH_PROJECT: "booking, client",
  CLIENT_OR_PROJECT_NOT_FOUND: "client",
  COI_DOCUMENT_MISSING: "planning",
  COI_INBOUND_DOMAIN_NOT_CONFIGURED: "planning",
  COI_NOT_APPROVED: "planning",
  COI_NOT_REVIEWABLE: "planning",
  COI_REQUIREMENT_NOT_FOUND: "planning",
  COMPLETED_EXPORT_REQUIRED: "saas",
  CONNECTION_NOT_FOUND: "integrations",
  CONSULTATION_NOT_CANCELLABLE: "booking",
  CONSULTATION_NOT_COMPLETABLE: "booking",
  CONSULTATION_NOT_FOUND: "booking",
  CONSULTATION_NOT_RESCHEDULABLE: "booking",
  CONTRACT_ALREADY_COMPLETED: "booking",
  CONTRACT_ALREADY_EXISTS: "booking",
  CONVERSATION_NOT_FOUND: "ai, communications",
  CREW_ALREADY_HAS_ACCOUNT: "crew",
  CREW_PLAN_CANDIDATES_MUST_BE_UNIQUE: "crew",
  CREW_PLAN_PROJECT_MISMATCH: "crew",
  DELETION_REQUEST_NOT_APPROVABLE: "saas",
  DELETION_REQUEST_NOT_CANCELLABLE: "saas",
  DELIVERY_NOT_FOUND: "post-event",
  DOCUMENT_PATH_MISMATCH: "crew",
  DRAFT_NOT_APPROVABLE: "communications",
  DRAFT_NOT_FOUND: "communications",
  DRAFT_NOT_READY_TO_SEND: "communications",
  DRAFT_RECIPIENT_REQUIRED: "communications",
  DUPLICATE_CASCADE_CANDIDATE: "crew",
  DUPLICATE_IMPORT_SOURCE: "studio-import",
  EMAIL_MISMATCH: "auth",
  EVENT_TYPE_MISMATCH: "workflow",
  EVIDENCE_REQUIRED: "workflow",
  EXPORT_NOT_READY: "saas",
  GOOGLE_CLOUD_PROJECT_REQUIRED: "integrations",
  IMPORT_ITEM_NOT_FOUND: "studio-import",
  IMPORT_ITEM_NOT_RETRYABLE: "studio-import",
  IMPORT_SESSION_CANCELLED: "studio-import",
  IMPORT_SESSION_INVALID: "studio-import",
  IMPORT_SESSION_NOT_FOUND: "studio-import",
  INQUIRY_FORM_UNAVAILABLE: "crm",
  INTERNAL_USER_LIMIT_REACHED: "saas",
  INVALID_BOOKING_STATE: "booking",
  INVALID_DATE_ANCHOR: "workflow",
  INVALID_INQUIRY: "crm",
  INVALID_INVITATION_ROLE: "saas",
  INVALID_SNOOZE_TIME: "ai",
  INVALID_TIME_RANGE: "booking",
  INVALID_WAIVER: "workflow",
  INVITATION_ALREADY_PENDING: "saas",
  INVITATION_ALREADY_USED: "client, crew, saas",
  INVITATION_EXPIRED: "client, crew, saas",
  INVITATION_NOT_FOUND: "client, crew, saas",
  INVITATION_NOT_REVOCABLE: "client, saas",
  INVITED_EMAIL_MISMATCH: "client, crew",
  JOB_NOT_FOUND: "saas",
  JOB_NOT_RERUNNABLE: "saas",
  LEAD_CONTACT_MISMATCH: "crm",
  LEAD_NOT_FOUND: "ai",
  LEAD_OR_PROJECT_REQUIRED: "ai",
  MEMBERSHIP_IDENTITY_MISMATCH: "saas",
  MEMBERSHIP_REQUIRES_MANUAL_REVIEW: "saas",
  MEMBERSHIP_ROLE_CONFLICT: "client, crew",
  MEMBER_NOT_EDITABLE: "saas",
  MISSING_DATE_ANCHOR: "workflow",
  MISSING_INFORMATION: "ai",
  NOT_FOUND: "planning",
  NO_PACKAGE_CHANGES: "crm",
  NO_RECIPIENT_EMAIL: "ai",
  OAUTH_CALLBACK_INVALID: "integrations",
  OAUTH_CALLBACK_URL_REQUIRED: "integrations",
  OAUTH_PROVIDER_NOT_CONFIGURED: "integrations",
  OAUTH_STATE_INVALID: "integrations",
  OAUTH_TOKEN_EXCHANGE_FAILED: "integrations",
  OPEN_PROPOSAL_EXISTS: "booking",
  OWNER_RECOVERY_NOT_ALLOWED: "saas",
  PACKAGE_ALREADY_SELECTED: "crm",
  PACKAGE_NOT_FOUND: "crm",
  PACKAGE_SNAPSHOT_INVALID: "booking",
  PACKAGE_SNAPSHOT_REQUIRED: "ai, booking",
  POST_EVENT_COMMAND_UNHANDLED: "post-event",
  PROJECT_ACCESS_DENIED: "workflow",
  PROJECT_CONTACT_REQUIRED: "ai, communications",
  PROJECT_NOT_FOUND: "ai, booking, communications, crm, workflow",
  PROJECT_NOT_IN_CONSULTATION: "booking",
  PROJECT_NOT_READY_FOR_PROPOSAL: "booking",
  PROJECT_OR_CONTACT_NOT_FOUND: "booking",
  PROJECT_VERSION_CONFLICT: "booking",
  PROPOSAL_DRAFT_CONFLICT: "booking",
  PROPOSAL_EXPIRATION_MUST_BE_FUTURE: "booking",
  PROPOSAL_NOT_FOUND: "booking",
  PROPOSAL_PDF_INVALID: "booking",
  PROPOSAL_PDF_NOT_READY: "booking",
  PROVIDER_DOES_NOT_SERVE_CAPABILITY: "integrations",
  PROVIDER_NOT_CONNECTED: "integrations",
  QUESTIONNAIRE_ASSIGNMENT_INVALID: "planning",
  QUESTIONNAIRE_TEMPLATE_NOT_FOUND: "planning",
  QUICKBOOKS_REALM_HOST_UNRESOLVED: "integrations",
  RATE_LIMITED: "crm",
  RECIPIENT_UNKNOWN: "communications",
  RESPONSE_NOT_FOUND: "planning",
  RETAINER_AMOUNT_NOT_FOUND: "booking",
  REVIEW_REQUEST_NOT_FOUND: "post-event",
  SCHEDULE_NOT_FOUND: "planning",
  SCHEDULING_LINK_EXPIRED: "booking",
  SECRET_MANAGER_CREATE_FAILED: "integrations",
  SECRET_MANAGER_DESTROY_FAILED: "integrations",
  SECRET_MANAGER_IDENTITY_UNAVAILABLE: "integrations",
  SECRET_MANAGER_WRITE_FAILED: "integrations",
  SEND_PERMISSION_REQUIRED: "booking",
  SIGNATURE_ATTESTATION_PERMISSION_REQUIRED: "booking",
  SIGNING_TEMPLATE_LIST_FAILED: "integrations",
  SUBCONTRACTOR_LIMIT_REACHED: "crew",
  SUPPORT_ACCESS_NOT_ACTIVE: "saas",
  SUPPORT_ACCESS_REQUIRED: "saas",
  TASK_NOT_FOUND: "workflow",
  TEMPLATE_NOT_FOUND: "communications",
  TIME_NO_LONGER_AVAILABLE: "booking",
  TIMING_RULE_NOT_FOUND: "planning",
  UNKNOWN: "ai",
  UNKNOWN_COMMAND: "booking, integrations",
  UNSUPPORTED_COMMAND: "crm",
  VERIFIED_EMAIL_REQUIRED: "client, crew, saas",
  WAIVER_PERMISSION_REQUIRED: "workflow",
  WORKFLOW_TEMPLATE_NOT_FOUND: "workflow",
};

/**
 * Helpers that build an error response, so their literals count as reachable.
 *
 * Not handlers themselves, and easy to miss because of it: the first draft of
 * this test scanned only `throw` statements in the handler list, and so failed
 * to detect `INVALID_COMMAND` — the exact code that motivated the whole file.
 * It is *returned*, not thrown, and from a shared helper rather than from the
 * endpoint. Deleting its copy left this test green, which was proved by
 * deleting it.
 */
const RESPONSE_HELPERS = ["security/invalid-command.ts"];

/**
 * Every way a code reaches a client from one file.
 *
 * Three shapes, all of them in use:
 *
 *   throw new Error("CODE")            — the common refusal
 *   throw new Error(`CODE:${detail}`)  — carries a field or record name, which
 *                                        DETAILED_BY_CODE renders
 *   response.status(400).json({ error: "CODE" })
 *
 * The last is why this does not simply match `throw`: 49 codes reach clients
 * through a response body, including every schema rejection in the product.
 */
function reachableCodes(source: string): string[] {
  const codes = new Set<string>();
  const patterns = [
    // Thrown, quoted or as a template literal with a trailing detail.
    /throw new Error\(\s*[`"]([A-Z][A-Z0-9_]+)(?::|[`"])/g,
    // Returned in a response body, or built into one by a helper.
    /\b(?:error|code)\s*:\s*[`"]([A-Z][A-Z0-9_]+)(?::|[`"])/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (match[1]) codes.add(match[1]);
    }
  }
  return [...codes];
}

/** Every code reachable from the endpoints and helpers a person can hit. */
function allReachableCodes(): Map<string, string> {
  const found = new Map<string, string>();
  for (const relative of [...USER_FACING_HANDLERS, ...RESPONSE_HELPERS]) {
    const source = readFileSync(join(FUNCTIONS_SRC, relative), "utf8");
    for (const code of reachableCodes(source)) {
      if (!found.has(code)) found.set(code, relative);
    }
  }
  return found;
}

/** Any of the three surfaces that render a code to a person. */
function hasCopyAnywhere(code: string): boolean {
  return (
    errorCodeHasCopy(code) ||
    crewErrorCodeHasCopy(code) ||
    importErrorCodeHasCopy(code)
  );
}

test("every failure a person can trigger says what went wrong", () => {
  const uncovered: string[] = [];
  for (const [code, relative] of allReachableCodes()) {
    if (hasCopyAnywhere(code)) continue;
    if (code in GENERIC_ON_PURPOSE) continue;
    if (code in KNOWN_GAPS) continue;
    uncovered.push(`${code}  (${relative})`);
  }
  assert.deepEqual(
    uncovered,
    [],
    `New codes reach a person as whichever generic sentence the calling form passed — usually "…could not be saved. Try again.", which is the one instruction guaranteed to fail identically.

Fix either way:
  • it is something they can act on  → add copy to FRIENDLY_BY_CODE (or
    DETAILED_BY_CODE, if the server can name the field or record) in
    lib/ai/friendly-error.ts — or the crew/import map for those surfaces
  • it means StudioCue has a bug     → add it to GENERIC_ON_PURPOSE in this
    file, with the reason

${uncovered.length} uncovered:
${uncovered.map((line) => `  ${line}`).join("\n")}`,
  );
});

test("the allowlist cannot outlive the codes it excuses", () => {
  const all = allReachableCodes();
  const stale = Object.keys(GENERIC_ON_PURPOSE).filter(
    (code) => !all.has(code),
  );
  assert.deepEqual(
    stale,
    [],
    `No longer thrown by any user-facing handler, so the excuse is dead weight — delete it from GENERIC_ON_PURPOSE:\n${stale.map((code) => `  ${code}`).join("\n")}`,
  );
});

test("the handler list still matches the request handlers on disk", () => {
  /**
   * The list above is hand-curated, because only a person can say whether an
   * endpoint answers a photographer or a provider. That curation goes stale
   * silently: a new command file would simply never be checked, which is the
   * failure mode this whole file exists to prevent.
   *
   * So the list is compared against reality, and a new `onRequest` file has to
   * be classified — into USER_FACING_HANDLERS, or into PROVIDER_FACING below
   * with its reason.
   */
  const PROVIDER_FACING = new Set([
    "index.ts",
    "booking/webhooks.ts",
    "booking/zoom-webhook.ts",
    "communications/inbound.ts",
    "communications/sendgrid-events.ts",
    "planning/inbound.ts",
    "post-event/inbound.ts",
  ]);

  const found: string[] = [];
  const walk = (directory: string, prefix = "") => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(join(directory, entry.name), relative);
        continue;
      }
      if (!entry.name.endsWith(".ts")) continue;
      const source = readFileSync(join(directory, entry.name), "utf8");
      if (source.includes("onRequest(")) found.push(relative);
    }
  };
  walk(FUNCTIONS_SRC);

  const classified = new Set([...USER_FACING_HANDLERS, ...PROVIDER_FACING]);
  const unclassified = found.filter((file) => !classified.has(file));
  assert.deepEqual(
    unclassified,
    [],
    `New HTTP handler(s) nobody has classified. Add each to USER_FACING_HANDLERS (a person reads its failures) or to PROVIDER_FACING in this test (a provider's retry policy does):\n${unclassified.map((file) => `  ${file}`).join("\n")}`,
  );
});

test("copy written for a known gap is removed from the list", () => {
  /**
   * Part 2 of the ratchet. Without this the list would stay at 136 for ever
   * while the codes on it quietly gained copy, and nobody could tell how much
   * of it was real — which is the same failure as the stale allowlist above,
   * one level up.
   */
  const done = Object.keys(KNOWN_GAPS).filter((code) => hasCopyAnywhere(code));
  assert.deepEqual(
    done,
    [],
    `These now have copy, so they are no longer gaps. Delete them from KNOWN_GAPS — the count is the point:\n${done.map((code) => `  ${code}`).join("\n")}`,
  );
});

test("known gaps that are no longer thrown are removed", () => {
  const all = allReachableCodes();
  const gone = Object.keys(KNOWN_GAPS).filter((code) => !all.has(code));
  assert.deepEqual(
    gone,
    [],
    `No user-facing handler throws these any more — delete them from KNOWN_GAPS:\n${gone.map((code) => `  ${code}`).join("\n")}`,
  );
});

test("a code is examined or unexamined, never both", () => {
  /**
   * The two lists mean opposite things — "we decided the generic sentence is
   * right" and "nobody has looked" — so an entry in both is a contradiction,
   * and the main test above would silently prefer the examined reading.
   */
  const both = Object.keys(GENERIC_ON_PURPOSE).filter(
    (code) => code in KNOWN_GAPS,
  );
  assert.deepEqual(
    both,
    [],
    `In both GENERIC_ON_PURPOSE and KNOWN_GAPS. Decide which, and delete the other:\n${both.map((code) => `  ${code}`).join("\n")}`,
  );
});
