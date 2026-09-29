import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  MAX_PREPARED_ACTIONS,
  STUDIO_ACTIONS,
  STUDIO_ACTION_IDS,
  catalogForModel,
  validatePreparedAction,
} from "../functions/src/ai/action-catalog.ts";

/**
 * Cue can prepare anything a studio can do (2026-09-29).
 *
 * The server's catalogue is what the model may choose from; the client's card
 * table is what each choice renders. The two are written in different
 * packages, so these tests are what keeps them the same list.
 */

const registry = readFileSync("components/ai/actions/prepared-actions.tsx", "utf8");
const cardIds = new Set(
  [...registry.slice(registry.indexOf("ACTION_CARDS")).matchAll(/^\s{2}([a-z_]+): [A-Z][A-Za-z]+,$/gm)].map(
    (match) => match[1]!,
  ),
);
const flowIds = STUDIO_ACTIONS.filter((spec) => spec.flow).map((spec) => spec.id);

test("every action the model can choose has a card, and every card an action", () => {
  const cardless = [...STUDIO_ACTION_IDS].filter((id) => !cardIds.has(id) && !flowIds.includes(id));
  assert.deepEqual(cardless, [], `no card for: ${cardless.join(", ")}`);
  const orphaned = [...cardIds].filter((id) => !STUDIO_ACTION_IDS.has(id));
  assert.deepEqual(orphaned, [], `card with no catalogue entry: ${orphaned.join(", ")}`);
});

test("the three conversational flows stay flows", () => {
  assert.deepEqual(
    Object.fromEntries(STUDIO_ACTIONS.filter((spec) => spec.flow).map((spec) => [spec.id, spec.flow])),
    { add_package: "select_package", send_questionnaire: "select_questionnaire", staff_crew: "crew_offer" },
  );
});

test("ids are unique and every one is described to the model", () => {
  assert.equal(STUDIO_ACTION_IDS.size, STUDIO_ACTIONS.length);
  const described = catalogForModel();
  for (const spec of STUDIO_ACTIONS) assert.ok(described.includes(`${spec.id}: `), spec.id);
});

/**
 * The parity this exists for. Each studio command endpoint's user-facing ops,
 * mapped to the card that reaches it — so a new op without a card is a
 * decision someone made, not one nobody noticed.
 */
test("the studio's commands are all reachable from a card", () => {
  const sources = [
    "components/ai/actions/job-actions.tsx",
    "components/ai/actions/booking-actions.tsx",
    "components/ai/actions/planning-actions.tsx",
    "components/ai/actions/studio-actions.tsx",
    "components/ai/flow-runner.tsx",
  ]
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");
  // Called directly by a card, or by the app panel a card embeds.
  const embedded: Record<string, string> = {
    createProject: "CreateProjectForm",
    createContact: "CreateContactForm",
    addProjectClient: "ProjectAddClient",
    updateContact: "ClientRecordActions|updateContact",
    record_acceptance: "RecordProposalAcceptance",
    recordSignedAgreement: "RecordSignedAgreement",
    recordRetainerPayment: "RecordRetainerPayment",
    recordFinalPayment: "RecordFinalPayment",
    approveRetainerException: "BookWithoutRetainer",
    importExistingBooking: "ExistingBookingForm",
    bringImportedBookingLive: "ImportedBookingBanner",
    prepareContract: "NativeContractStep",
    sendContract: "NativeContractStep",
    voidContract: "NativeContractStep",
    publishSchedule: "AiScheduleGenerator",
    setTimelineAuthority: "TimelineAuthorityPanel",
    createCoiRequest: "CoiWorkflowPanel",
    decideCoi: "CoiWorkflowPanel",
    sendCoiToVenue: "CoiWorkflowPanel",
    updateVendor: "VendorRecordActions",
    createCrewProfile: "CreateCrewProfileForm",
    updateCrewDirectoryEntry: "CrewRecordActions",
    setCrewCompliance: "CrewRecordActions",
    setCrewOfferSettings: "CrewOfferSettings",
    resolveCheckpoint: "ReadinessCheckpoints",
    recordDelivery: "DeliveryForm",
    completePostProductionStep: "PostProductionChecklist",
    updateAlbumStatus: "DeliveryCloseoutWorkspace",
    attestCloseoutRequirement: "DeliveryCloseoutWorkspace",
    closeProject: "DeliveryCloseoutWorkspace",
    inviteMember: "TeamManagement",
    updateMember: "TeamManagement",
    revokeInvitation: "TeamManagement",
    purgeProject: "DeleteJobPermanently",
    createPackage: "CreatePackageForm",
    updatePackage: "EditPackageForm|updatePackage",
    saveAgreementTemplate: "AgreementEditor",
    setContractAutoSend: "AgreementEditor",
    // Full-page editors: the card opens them (they overflow a chat column).
    createQuestionnaireTemplate: "/studio/questionnaires",
    updateQuestionnaireTemplate: "/studio/questionnaires",
    saveTemplateVersion: "/studio/settings/email-templates",
    activateTemplateVersion: "/studio/settings/email-templates",
    setConsultationSettings: "ConsultationAvailability",
    saveLifecycleSettings: "LifecyclePackPanel",
    setAutopay: "AutopaySettings",
    tenantBrandingCommand: "EmailBranding",
    tenantIdentityCommand: "StudioIdentitySettings",
    saveTimingRule: "TimingRuleEditor",
    requestExport: "DataControls",
    saveFormMapping: "InquiryForwardingSettings",
    inviteAssignment: "inviteAssignment",
    createCrewCascade: "createCrewCascade",
    selectPackage: "selectPackage",
    assignQuestionnaire: "assignQuestionnaire",
  };
  const direct = [
    "updateProject",
    "closeInquiry",
    "reopenInquiry",
    "keepInquiryOpen",
    "inquiryHeardElsewhere",
    "markLeadNotInquiry",
    "updateLead",
    "transitionProject",
    "archiveProject",
    "removePackage",
    "decidePackageRequest",
    "scheduleConsultation",
    "rescheduleConsultation",
    "cancelConsultation",
    "completeConsultation",
    "create_draft",
    "update_draft",
    "submit_for_approval",
    "approve",
    "send",
    "resend",
    "reissue",
    "return_to_draft",
    "revise_packages",
    "createRetainerInvoice",
    "runBookingGate",
    "lookupQuickBooksPayments",
    "shareRunOfShow",
    "revokeRunOfShowShare",
    "setInsuranceRequirement",
    "createVendor",
    "archiveVendor",
    "replyToConversation",
    "sendMessage",
    "markConversationRead",
    "inviteCrewProfile",
    "archiveCrewProfile",
    "waiveRequirement",
    "reviewAssignmentCloseout",
    "updateAssignmentPayment",
    "createTask",
    "completeTask",
    "confirmReview",
    "startProviderConnect",
  ];
  for (const op of direct) assert.ok(sources.includes(`"${op}"`) || sources.includes(`${op}(`), `no card runs ${op}`);
  for (const [op, reach] of Object.entries(embedded))
    assert.ok(reach.split("|").some((name) => sources.includes(name)), `no card reaches ${op} (via ${reach})`);
});

const context = {
  allowedProjectIds: new Set(["job-1", "job-archived"]),
  archivedProjectIds: new Set(["job-archived"]),
  scopedProjectId: null,
  ownerOrAdmin: true,
};

test("an action outside the catalogue is refused", () => {
  const result = validatePreparedAction({ action: "wire_money" }, context);
  assert.equal(result.ok, false);
});

test("a job the operator cannot see is refused, whatever the model says", () => {
  const result = validatePreparedAction({ action: "void_contract", projectId: "someone-elses-job" }, context);
  assert.deepEqual(result, { ok: false, reason: "that job is not one this operator can see" });
});

test("a job action with no job falls back to the page's job, and otherwise asks", () => {
  assert.equal(validatePreparedAction({ action: "send_proposal" }, context).ok, false);
  const scoped = validatePreparedAction({ action: "send_proposal" }, { ...context, scopedProjectId: "job-1" });
  assert.ok(scoped.ok && scoped.directive.projectId === "job-1");
});

test("an archived job takes only restore or delete", () => {
  assert.equal(validatePreparedAction({ action: "send_proposal", projectId: "job-archived" }, context).ok, false);
  assert.equal(validatePreparedAction({ action: "restore_job", projectId: "job-archived" }, context).ok, true);
});

test("settings and team changes need an owner or admin", () => {
  const coordinator = { ...context, ownerOrAdmin: false };
  assert.equal(validatePreparedAction({ action: "edit_agreement" }, coordinator).ok, false);
  assert.equal(validatePreparedAction({ action: "create_task", projectId: "job-1" }, coordinator).ok, true);
});

test("words are kept as words; malformed dates and times are dropped", () => {
  const result = validatePreparedAction(
    {
      action: "schedule_consultation",
      projectId: "job-1",
      date: "next tuesday",
      time: "25:99",
      text: "  zoom   please ",
      amountCents: 500000,
    },
    context,
  );
  assert.ok(result.ok);
  assert.equal(result.directive.date, null);
  assert.equal(result.directive.time, null);
  assert.equal(result.directive.text, "zoom please");
  assert.ok(!("amountCents" in result.directive), "no amount ever travels in a directive");
});

test("the tool gives the model no way to name an amount, a recipient or an id beyond the job", () => {
  const copilot = readFileSync("functions/src/ai/copilot.ts", "utf8");
  const start = copilot.indexOf('name: "prepare_action"');
  const declaration = copilot.slice(start, copilot.indexOf('name: "get_crew_roster"'));
  const parameters = [...declaration.matchAll(/^\s{8}([a-zA-Z]+): \{/gm)].map((match) => match[1]);
  assert.deepEqual(parameters.sort(), ["action", "date", "field", "projectId", "subject", "text", "time"]);
});

test("preparing writes nothing", () => {
  const copilot = readFileSync("functions/src/ai/copilot.ts", "utf8");
  const start = copilot.indexOf("const prepare = (toolArgs");
  const body = copilot.slice(start, copilot.indexOf("const { contents: retrievalContents", start));
  assert.ok(start > 0);
  assert.ok(!/db\.|batch\.|\.set\(|\.update\(|\.create\(/.test(body), "prepare_action must only record a card");
});

test("one answer prepares at most a few cards", () => {
  assert.equal(MAX_PREPARED_ACTIONS, 3);
});
