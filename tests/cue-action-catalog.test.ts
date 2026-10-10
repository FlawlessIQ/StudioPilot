import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
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
 * The parity this exists for, kept by discovery rather than by memory.
 *
 * The first version listed the commands a card reached by hand, and within
 * hours two features added seven studio commands it had never heard of
 * (insurance and delivery, 2026-09-29) — the list passed and Cue fell behind.
 * Now every command op in functions/src is found by reading the schemas, and
 * each one must be either reached by a card (the string named here appears
 * in a card's source or the panel it mounts) or listed as not a studio
 * action, with the reason. A new command fails here until someone decides.
 */
function discoverCommandOps(): Map<string, string> {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? walk(path) : path.endsWith(".ts") ? [path] : [];
    });
  const found = new Map<string, string>();
  const pattern =
    /(?:type|action):\s*z\.(?:literal\("(\w+)"\)|enum\(\[([^\]]+)\]\))\s*,\s*(?:\/\/[^\n]*\n\s*)*(?:tenantId|idempotencyKey|input|proposalId|projectId)\b/g;
  for (const file of walk("functions/src")) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(pattern)) {
      const names = match[1] ? [match[1]] : [...match[2]!.matchAll(/"(\w+)"/g)].map((name) => name[1]!);
      for (const name of names) if (!found.has(name)) found.set(name, file);
    }
  }
  return found;
}

/** Reached from Cue: a string that must appear in the cards or the panels they mount or open. */
const REACHED: Record<string, string> = {
  // Jobs, inquiries, clients
  createProject: "CreateProjectForm", createContact: "CreateContactForm", updateContact: "updateContact",
  archiveContact: "ClientRecordActions", addProjectClient: "ProjectAddClient", associateClientProject: "ProjectAddClient",
  updateProject: "\"updateProject\"", transitionProject: "\"transitionProject\"", archiveProject: "\"archiveProject\"",
  updateLead: "\"updateLead\"", markLeadNotInquiry: "\"markLeadNotInquiry\"", closeInquiry: "\"closeInquiry\"",
  removeIgnoredSender: "IgnoredSenders",
  reopenInquiry: "reopenInquiry", inquiryHeardElsewhere: "inquiryHeardElsewhere", keepInquiryOpen: "keepInquiryOpen",
  // Wave 3: going back.
  uncancelProject: "\"uncancelProject\"", reopenJob: "\"reopenJob\"", restoreInquiry: "\"restoreInquiry\"",
  invite: "type: \"invite\"", revoke: "type: \"revoke\"", status: "type: \"status\"",
  previewProjectPurge: "DeleteJobPermanently", purgeProject: "DeleteJobPermanently",
  // Packages and proposals
  createPackage: "CreatePackageForm", updatePackage: "\"updatePackage\"", selectPackage: "\"selectPackage\"",
  removePackage: "\"removePackage\"", decidePackageRequest: "\"decidePackageRequest\"",
  create_draft: "\"create_draft\"", update_draft: "\"update_draft\"", submit_for_approval: "\"submit_for_approval\"",
  approve: "\"approve\"", send: "\"send\"", resend: "\"resend\"", reissue: "\"reissue\"",
  return_to_draft: "\"return_to_draft\"", regenerate_pdf: "\"regenerate_pdf\"", revise_packages: "\"revise_packages\"",
  discard_draft: "\"discard_draft\"", withdraw: "op: \"withdraw\"",
  record_acceptance: "RecordProposalAcceptance",
  draftAmendment: "BookingAmendmentPanel", sendAmendment: "BookingAmendmentPanel",
  recordAmendmentSigned: "BookingAmendmentPanel", cancelAmendment: "BookingAmendmentPanel",
  resendAmendment: "BookingAmendmentPanel", retryAmendmentApply: "BookingAmendmentPanel",
  setPackageDiscount: "ProposalPackagesPanel",
  // Consultations, contract, money, booking
  scheduleConsultation: "\"scheduleConsultation\"", rescheduleConsultation: "\"rescheduleConsultation\"",
  cancelConsultation: "\"cancelConsultation\"", completeConsultation: "\"completeConsultation\"",
  setConsultationSettings: "ConsultationAvailability",
  prepareContract: "NativeContractStep", sendContract: "NativeContractStep", voidContract: "NativeContractStep",
  resendContract: "NativeContractStep", retrySignedCopy: "NativeContractStep",
  saveAgreementTemplate: "AgreementEditor", agreementDraftFromImport: "AgreementEditor", setContractAutoSend: "AgreementEditor",
  setSignedCopyShared: "SignedCopySharing", recordSignedAgreement: "RecordSignedAgreement",
  createRetainerInvoice: "\"createRetainerInvoice\"", recordRetainerPayment: "RecordRetainerPayment",
  recordFinalPayment: "RecordFinalPayment", sendFinalBalance: "FinalBalanceActions", approveRetainerException: "BookWithoutRetainer",
  voidInvoice: "<VoidInvoice", correctPaymentRecord: "<CorrectPayment", recordInvoicePayment: "<RecordInvoicePayment", approveFinalInvoice: "<ApproveFinalInvoice",
  // A bill held in QuickBooks for the tax check: send with or without tax.
  sendHeldInvoice: "<HeldInvoiceReview",
  // "Ask the couple for it" sits in the same review, when QuickBooks had no address.
  requestBillingAddress: "<HeldInvoiceReview",
  lookupQuickBooksPayments: "lookupQuickBooksPayments", runBookingGate: "\"runBookingGate\"",
  // "Don't charge sales tax on this job", on the final-bill card as on the booking page.
  setJobSalesTaxExempt: "JobSalesTax",
  previewExistingBookings: "ExistingBookingForm", importExistingBooking: "ExistingBookingForm",
  attachImportedSignedCopy: "ExistingBookingForm", bringImportedBookingLive: "ImportedBookingBanner",
  // Planning
  assignQuestionnaire: "\"assignQuestionnaire\"",
  // After it went out (questionnaire-response-actions.tsx, mounted by QuestionnaireCard).
  saveQuestionnaire: "QuestionnaireResponseActions", reopenQuestionnaire: "QuestionnaireResponseActions",
  withdrawQuestionnaire: "QuestionnaireResponseActions", resendQuestionnaire: "QuestionnaireResponseActions",
  approveSchedule: "RecordTimelineAnswer", refreshRunOfShowShares: "VendorReshareBanner",
  createQuestionnaireTemplate: "/studio/questionnaires", updateQuestionnaireTemplate: "/studio/questionnaires",
  // The inquiry event form is chosen on the same page (InquiryEventFormSetting).
  setInquiryEventForm: "/studio/questionnaires",
  saveTimingRule: "TimingRuleEditor", createVendor: "\"createVendor\"", updateVendor: "VendorRecordActions",
  archiveVendor: "\"archiveVendor\"", publishSchedule: "AiScheduleGenerator", setTimelineAuthority: "TimelineAuthorityPanel",
  setInsuranceRequirement: "\"setInsuranceRequirement\"", shareRunOfShow: "\"shareRunOfShow\"",
  revokeRunOfShowShare: "\"revokeRunOfShowShare\"",
  createCoiRequest: "CoiWorkflowPanel", decideCoi: "CoiWorkflowPanel", sendCoiToVenue: "CoiWorkflowPanel",
  approvePreparedCoi: "CoiWorkflowPanel", completeCoiDetails: "CoiWorkflowPanel", attachCoiUpload: "CoiWorkflowPanel",
  approveAndSendCoi: "CoiWorkflowPanel", saveCoiSettings: "CoiSettings",
  saveAddOn: "AddOnLibrary", setJobAddOns: "ProposalPackagesPanel",
  createOneOffPackage: "ProposalPackagesPanel",
  updateOneOffPackage: "ProposalPackagesPanel", saveOneOffToLibrary: "ProposalPackagesPanel",
  // Messages
  sendMessage: "\"sendMessage\"", replyToConversation: "\"replyToConversation\"",
  markConversationRead: "\"markConversationRead\"", approveMessage: "MessageApprovals", declineMessage: "MessageApprovals",
  // The undo on a held send, inside the reply card (components/communications/undo-send.tsx).
  cancelQueuedEmail: "UndoSend",
  saveTemplateVersion: "/studio/settings/email-templates", activateTemplateVersion: "/studio/settings/email-templates",
  sendTemplateTest: "/studio/settings/email-templates",
  resetTemplate: "/studio/settings/email-templates", previewTemplate: "/studio/settings/email-templates",
  getInquiryForwardingAddress: "InquiryForwardingAddress", getLeadCaptureSetup: "InquiryForwardingSettings",
  startCaptureTest: "InquiryForwardingSettings", saveFormMapping: "InquiryForwardingSettings",
  // The studio's own inquiry form, edited in the same settings panel (InquiryFormEditor).
  setInquiryForm: "InquiryForwardingSettings",
  // Crew
  createCrewProfile: "CreateCrewProfileForm", updateCrewDirectoryEntry: "CrewRecordActions",
  inviteCrewProfile: "\"inviteCrewProfile\"", archiveCrewProfile: "\"archiveCrewProfile\"",
  setCrewCompliance: "CrewRecordActions", submitCrewProfileDocument: "CrewRecordActions",
  inviteAssignment: "\"inviteAssignment\"",
  // "Book them now" on Cue's crew card (components/ai/flow-runner.tsx).
  assignDirectly: "\"assignDirectly\"", createCrewCascade: "\"createCrewCascade\"", createCrewPlan: "CrewCascadeWorkspace",
  setCrewOfferSettings: "CrewOfferSettings", waiveRequirement: "\"waiveRequirement\"",
  // The first-call order, set with the arrows on the Crew page (components/crew/crew-call-order.tsx).
  setCrewFirstCall: "CrewCallOrderPanel",
  completeRequirement: "CrewCascadeWorkspace", completeAssignment: "CrewCascadeWorkspace",
  reviewAssignmentCloseout: "\"reviewAssignmentCloseout\"", updateAssignmentPayment: "\"updateAssignmentPayment\"",
  withdrawAssignment: "withdrawCrew(",
  setOwnerShooting: "setOwnerShooting(",
  // What a makeup or hair trial settled, on the job's trial card (components/crew/trial-notes.tsx).
  setTrialNotes: "TrialNotes",
  // Tasks and workflows
  createTask: "\"createTask\"", completeTask: "\"completeTask\"", resolveCheckpoint: "ReadinessCheckpoints",
  createWorkflowTemplate: "CreateWorkflowForm",
  // After the event
  completePostProductionStep: "PostProductionChecklist", recordDelivery: "DeliveryForm",
  markDeliveryComplete: "DeliveryForm", discardDeliveryDraft: "DeliveryForm", markDeliveryDownloaded: "DeliveryForm",
  updateAlbumStatus: "DeliveryCloseoutWorkspace", prepareCloseout: "DeliveryCloseoutWorkspace",
  attestCloseoutRequirement: "DeliveryCloseoutWorkspace", closeProject: "DeliveryCloseoutWorkspace",
  confirmReview: "\"confirmReview\"",
  // Wave 2: corrections after the event.
  replaceDeliveryLink: "ReplaceDeliveryLink", skipReviewRequests: "\"skipReviewRequests\"",
  undoPostProductionStep: "PostProductionChecklist", revertAlbumStatus: "DeliveryCloseoutWorkspace",
  // Wave 3: undo for records.
  undo_acceptance: "\"undo_acceptance\"",
  updateTask: "\"updateTask\"", reopenTask: "\"reopenTask\"", cancelTask: "\"cancelTask\"",
  reopenCheckpoint: "ReadinessCheckpoints",
  markConsultationNoShow: "\"markConsultationNoShow\"", reopenConsultation: "\"reopenConsultation\"",
  rerunBookingBrief: "\"rerunBookingBrief\"",
  resendCoi: "CoiWorkflowPanel",
  // Team and studio
  inviteMember: "TeamManagement", revokeInvitation: "TeamManagement", updateMember: "TeamManagement",
  setAutopay: "AutopaySettings", setOutsideStep: "OutsideStepCard",
  setCapabilityProvider: "/studio/integrations", setContractTemplate: "/studio/integrations",
  setProviderTestMode: "/studio/integrations", setSignatureMode: "/studio/integrations",
  // Settings → Integrations → QuickBooks (components/integrations/quickbooks-settings.tsx).
  setBillingSettings: "/studio/integrations", setUpItems: "/studio/integrations", sendTestInvoice: "/studio/integrations",
  requestExport: "DataControls", requestDeletion: "DataControls", cancelDeletion: "DataControls",
  createCheckout: "/studio/subscription", createPortal: "/studio/subscription", confirmCheckout: "/studio/subscription",
  // Subscription → Refer a studio (components/saas/referral-card.tsx).
  referralStatus: "/studio/subscription", setVendorInvites: "/studio/subscription", previewCode: "/studio/subscription",
  createSession: "/studio/import", createSourceSession: "/studio/import", getSession: "/studio/import",
  getReview: "/studio/import", simulateSession: "/studio/import", reviewDraft: "/studio/import",
  splitDraft: "/studio/import", mergeDrafts: "/studio/import", activateSession: "/studio/import",
  rollbackAsset: "/studio/import", cancelSession: "/studio/import", retryItem: "/studio/import",
  // Cue's own approval cards (components/ai/ai-approval-queue.tsx, in every Cue answer)
  decideAiAction: "PreparedActions", snoozeAiAction: "PreparedActions", recordAiExecution: "PreparedActions",
  sendApprovedDraft: "PreparedActions", crew_offer: "FlowRunner", select_package: "FlowRunner", select_questionnaire: "FlowRunner",
};

/** Commands that are not a studio user's to take, and why. */
const NOT_A_STUDIO_ACTION: Record<string, string> = {
  // The couple's own acts, in their portal.
  markReviewOpened: "couple", accept: "couple or invitee", preview: "invitee", brand: "invitee whose link no longer opens",
  status_batch: "read by the clients list, not an act",
  // H2 one-send agreement: behind a per-studio platform flag until counsel has
  // seen the two-signature ceremony, so not offered through Cue yet.
  previewCombinedAgreement: "flagged: counsel review pending", sendCombinedAgreement: "flagged: counsel review pending",
  // A crew member's own acts, in the crew app.
  respondAssignment: "crew", setAvailability: "crew", updateAvailability: "crew", deleteAvailability: "crew",
  updateCrewProfile: "crew", acknowledgeCalendar: "crew", acknowledgeSchedule: "crew", submitAssignmentCloseout: "crew",
  submitRequirement: "crew", contactStudio: "crew",
  // Public pages, with no signed-in studio user.
  create_link: "public scheduling", availability: "public scheduling", book: "public scheduling",
  inquiry_preview: "public inquiry", inquiry_details: "public inquiry", inquiry_availability: "public inquiry",
  inquiry_book: "public inquiry", inquiry_cancel: "public inquiry",
  inquiry_form: "public inquiry", inquiry_form_save: "public inquiry",
  passwordReset: "sign-in", emailVerification: "sign-in", signInLink: "sign-in", previewInvitation: "invitee", acceptInvitation: "invitee",
  // StudioCue's own staff (platform admin), not a studio. The Console's
  // commands live in functions/src/console/handlers and are dispatched by
  // saasAdminCommand from a registry, so this scan doesn't see them; they are
  // never a studio's (tests/console-wiring.test.ts).
  setFeedbackStatus: "platform",
  // Feedback to the StudioCue team, from the Feedback button: what the studio
  // writes, in their own words, with a picture of the screen they were on.
  submitFeedback: "the Feedback button",
  // The system does these; no person asks for them.
  instantiateWorkflow: "runs at booking", recalculateReadiness: "readiness triggers",
  decideAutomationApproval: "automation approvals on Today", cancelReceipt: "action receipts on Today", retryReceipt: "action receipts on Today",
  retryEmailJob: "failed-email cards on Today", dismissEmailProblem: "failed-email cards on Today",
  refreshQuestionnairePrefill: "runs as a couple opens their form",
  requestDetailChange: "couple", decideDetailChange: "the change-request card on Today",
  setPlanningTimeline: "Settings → Planning timeline",
  // Own invoicing, Phase 0 (docs/own-invoicing-plan-2026-10-09.md). Cue
  // offers the per-job choice in Phase 6; until then it's on the booking page.
  setJobBillingMethod: "the booking page's How this job is billed",
  setStudioInvoiceSettings: "Settings → Invoices and payments",
  previewStudioInvoice: "Settings → Invoices and payments",
  // Own invoicing Phase 2: sent from Today's card and the booking page; Cue in Phase 6.
  sendStudioInvoice: "Today's invoice card and the booking page",
  createStudioDeposit: "the booking page's deposit panel",
  // Own invoicing Phase 5: deleting records is a typed, deliberate act on the
  // Invoices page — never something Cue prepares.
  deleteInvoiceRecords: "Invoices: delete a bill, or the job's records with its name typed",
  // The couple's own shot list (planning/shot-list-upload.ts): asked on its
  // day by the sweep, or "Ask now" on the job; seen from Today or the job.
  requestShotList: "the job's shot list card", markShotListSeen: "the shot list card on Today",
  // Group events Phase 1 (2026-10-04): the roster is worked on the job page,
  // often on the day at the venue. Not offered through Cue yet.
  setGroupEvent: "group events: the job page roster", addParticipant: "group events: the job page roster",
  updateParticipant: "group events: the job page roster", cancelParticipant: "group events: the job page roster",
  recordParticipantPayment: "group events: the job page roster",
  // Not offered: StudioCue has no signing provider (features/integrations/schema.ts offeredProviders).
  createEnvelope: "no signing provider is offered",
};

test("every studio command is reachable from Cue, or is said not to be a studio's", () => {
  const ops = discoverCommandOps();
  assert.ok(ops.size > 150, `found only ${ops.size} command ops — the discovery pattern has broken`);
  const sources = [
    ...readdirSync("components/ai/actions").map((name) => `components/ai/actions/${name}`),
    "components/ai/flow-runner.tsx",
    "components/ai/copilot-workspace.tsx",
  ]
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");
  const undecided = [...ops.keys()].filter((op) => !(op in REACHED) && !(op in NOT_A_STUDIO_ACTION));
  assert.deepEqual(
    undecided.map((op) => `${op} (${ops.get(op)})`),
    [],
    "new commands: give each a Cue card (and a REACHED entry), or say in NOT_A_STUDIO_ACTION why a studio never takes it",
  );
  const unreached = Object.entries(REACHED).filter(([, reach]) => !sources.includes(reach));
  assert.deepEqual(unreached.map(([op, reach]) => `${op} → ${reach}`), [], "a REACHED entry no card actually reaches");
  const stale = [...Object.keys(REACHED), ...Object.keys(NOT_A_STUDIO_ACTION)].filter((op) => !ops.has(op));
  assert.deepEqual(stale, [], "entries for commands that no longer exist");
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
