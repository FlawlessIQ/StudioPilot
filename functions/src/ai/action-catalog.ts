/**
 * Everything a studio can do, as something Cue can prepare.
 *
 * Cue answered questions about every part of a job and could act on about nine
 * of them. Each new ability was a hand-written branch plus a rule somewhere in
 * an eighteen-thousand-character instruction, and the model reliably missed
 * rules buried there: `update_project` shipped (c6adfbd) and was never chosen.
 *
 * So acting is a tool now, the same shape as reading. When the operator asks
 * for something to be done, the model calls `prepare_action` with one of these
 * ids and the words the operator used. Nothing runs: the id becomes a card in
 * the chat, the card loads the real records, the operator fills anything that
 * is theirs to decide (every amount of money, every signature) and taps, and
 * the tap runs the same command the rest of the app runs, as that person, with
 * that command's own authorization. The model never supplies an id, an amount
 * or a recipient.
 *
 * The client's half — what each card loads, asks and runs — is
 * `features/ai/actions/`. `tests/cue-action-catalog.test.ts` holds the two
 * lists to the same ids.
 */

export type ActionScope = "project" | "studio";

export type ServerActionSpec = {
  id: string;
  /** When the model should choose it, in one line. */
  when: string;
  scope: ActionScope;
  /** Settings and team changes: owners and admins only. */
  ownerAdminOnly?: boolean;
  /**
   * The three conversational flows predate this catalog and stay as they are;
   * choosing one of these ids opens that flow.
   */
  flow?: "crew_offer" | "select_package" | "select_questionnaire";
};

export const STUDIO_ACTIONS: readonly ServerActionSpec[] = [
  // Inquiries and clients
  { id: "create_job", scope: "studio", when: "start a new job/project for a client (a new wedding, a booking taken by phone)" },
  { id: "edit_job", scope: "project", when: "change a job's name, event date, event type, venue, city or time zone — put the field in `field` and the new value in `text`" },
  { id: "mark_inquiry_lost", scope: "project", when: "an inquiry is lost, went cold, or the couple said no — close it (put their reason in `text` if given)" },
  { id: "inquiry_booked_elsewhere", scope: "project", when: "the couple booked another photographer — close the inquiry as lost" },
  { id: "heard_from_couple", scope: "project", when: "the couple got back to the studio another way (phone, text, in person) — restart follow-ups from today" },
  { id: "reopen_inquiry", scope: "project", when: "bring a lost or closed inquiry back" },
  { id: "close_lead", scope: "studio", when: "close an inquiry that has no job yet (it didn't book) — name it in `subject`, reason in `text`" },
  { id: "reopen_lead", scope: "studio", when: "reopen a closed inquiry that has no job — name it in `subject`" },
  { id: "restore_inquiry", scope: "studio", ownerAdminOnly: true, when: "bring back something marked 'not an inquiry' by mistake — name it in `subject`" },
  { id: "keep_inquiry_open", scope: "project", when: "stop follow-ups asking about a quiet inquiry and keep it open" },
  { id: "not_an_inquiry", scope: "studio", when: "an item held as 'Maybe an inquiry' is not one (spam, a vendor, a newsletter) — name it in `subject`" },
  { id: "confirm_inquiry", scope: "studio", when: "an item held as 'Maybe an inquiry' IS a real inquiry — name it in `subject`" },
  { id: "unignore_sender", scope: "studio", ownerAdminOnly: true, when: "see or undo the email senders StudioCue ignores because a message from them was marked 'not an inquiry' (e.g. the studio's website form stopped arriving)" },
  { id: "add_contact", scope: "studio", when: "add a person (client, planner, parent) to the studio's contacts" },
  { id: "edit_contact", scope: "project", when: "correct the couple's name, email or phone — say which in `field`, new value in `text`" },
  { id: "archive_contact", scope: "studio", ownerAdminOnly: true, when: "archive a client / take a contact off the working list (their jobs are over) — name in `subject`" },
  { id: "restore_contact", scope: "studio", ownerAdminOnly: true, when: "restore / un-archive an archived client — name in `subject`" },
  { id: "add_client_to_job", scope: "project", when: "add a second client (partner, parent, planner) to a job" },
  { id: "invite_couple_to_portal", scope: "project", when: "send the couple their portal invitation / resend the portal link" },
  { id: "revoke_portal_invite", scope: "project", when: "withdraw a couple's portal invitation" },
  { id: "move_job_stage", scope: "project", when: "move a job to a different stage by hand (e.g. back to Proposal, back to Planning, on hold) — the stage in `text`. Not for cancelling, marking lost, undoing a cancel or reopening a finished job" },
  { id: "cancel_job", scope: "project", when: "cancel a job / the wedding is off / call it off — their reason in `text`" },
  { id: "uncancel_job", scope: "project", ownerAdminOnly: true, when: "undo a cancel — the cancelled wedding is back on (owner only, within 30 days); why in `text`" },
  { id: "reopen_job", scope: "project", ownerAdminOnly: true, when: "reopen a delivered or closed job — the couple asked for a re-edit, or something needs fixing after closing (owner only); why in `text`" },
  { id: "archive_job", scope: "project", when: "archive / put away a job" },
  { id: "restore_job", scope: "project", when: "restore an archived job" },
  { id: "delete_job", scope: "project", ownerAdminOnly: true, when: "permanently delete a job and everything on it (test jobs, duplicates)" },
  // Consultations
  { id: "schedule_consultation", scope: "project", when: "book a consultation / call / meeting with the couple — date in `date`, time in `time`, 'zoom' or 'in person' in `text`" },
  { id: "reschedule_consultation", scope: "project", when: "move an existing consultation — new `date` and `time`" },
  { id: "cancel_consultation", scope: "project", when: "cancel a booked consultation" },
  { id: "complete_consultation", scope: "project", when: "mark a consultation as held, with notes in `text`" },
  { id: "mark_consultation_no_show", scope: "project", when: "the couple didn't turn up to / missed their consultation (a no-show) — then offer to invite them to pick another time" },
  { id: "reopen_consultation", scope: "project", when: "undo a consultation marked held or missed by mistake — reopen it" },
  { id: "rerun_booking_brief", scope: "project", when: "prepare the booking brief (consultation brief, package suggestion and proposal draft) again from new or changed consultation notes — anything new they said in `text`" },
  // Packages and proposals
  { id: "add_package", scope: "project", flow: "select_package", when: "choose a package, or add another package to a job (they want video too) — package name in `subject`" },
  { id: "change_booking", scope: "project", when: "change a booking the couple already signed or booked: move the wedding date, add or remove a package — date in `date`, package in `subject`" },
  { id: "resend_booking_change", scope: "project", ownerAdminOnly: true, when: "send a booking change (amendment) that is waiting for the couple's signature to them again / remind them to sign it" },
  { id: "swap_package", scope: "project", when: "replace a job's main package with a different one — package name in `subject`" },
  { id: "remove_package", scope: "project", when: "take a package off a job — package name in `subject`" },
  { id: "set_package_discount", scope: "project", when: "give, change or remove a discount on a job's package before the agreement goes out (10% off, $250 off) — package name in `subject`" },
  { id: "approve_package_request", scope: "project", when: "approve a couple's request (from their portal) to add a package" },
  { id: "decline_package_request", scope: "project", when: "decline a couple's request to add a package" },
  { id: "draft_proposal", scope: "project", when: "prepare an unsent proposal draft (a cover note in `text`)" },
  { id: "edit_proposal", scope: "project", when: "change a draft proposal's cover note, expiry or due dates" },
  { id: "send_proposal", scope: "project", when: "send the proposal to the couple" },
  { id: "resend_proposal", scope: "project", when: "send the proposal again (they lost it, it went to spam)" },
  { id: "correct_proposal", scope: "project", when: "fix a proposal that already went out (wrong email, wrong name) by issuing a corrected version" },
  { id: "record_proposal_acceptance", scope: "project", when: "the couple accepted the proposal in person / by phone / by email and the studio records it" },
  { id: "undo_acceptance", scope: "project", ownerAdminOnly: true, when: "undo / take back an acceptance recorded by mistake (wrong job, they hadn't really said yes) — the job goes back to Proposal; why in `text`" },
  { id: "remake_proposal_pdf", scope: "project", when: "make the proposal's PDF again (it failed or looks wrong)" },
  { id: "return_proposal_to_draft", scope: "project", when: "take a proposal awaiting approval back to draft" },
  { id: "discard_proposal_draft", scope: "project", when: "throw away / delete a draft proposal nobody has been sent, to start again" },
  { id: "withdraw_proposal", scope: "project", when: "withdraw / take back / cancel a proposal the couple was sent, so they can no longer accept it" },
  // Contract
  { id: "prepare_contract", scope: "project", when: "write/prepare the couple's contract (agreement) from the studio's template" },
  { id: "sign_and_send_contract", scope: "project", when: "the owner signs the contract and sends it to the couple — the owner signs on the card" },
  { id: "send_contract", scope: "project", when: "send the prepared contract to the couple for signature" },
  { id: "void_contract", scope: "project", when: "void / cancel a contract that went out (to change the packages, or it was wrong)" },
  { id: "resend_contract", scope: "project", ownerAdminOnly: true, when: "send the contract to the couple again / remind them to sign it now (they lost the email, it went to spam)" },
  { id: "share_signed_copy", scope: "project", when: "share the signed contract with the couple in their portal, or stop sharing it" },
  { id: "record_signed_contract", scope: "project", when: "the couple signed a paper or outside contract and the studio records the signature" },
  // Money
  { id: "create_retainer_invoice", scope: "project", when: "raise / send the retainer (deposit) invoice" },
  { id: "record_retainer_payment", scope: "project", when: "the couple paid the retainer/deposit outside StudioCue (check, cash, Venmo) — the operator types the amount" },
  { id: "send_final_balance", scope: "project", when: "send / raise the final balance invoice (the rest of what they owe) now, through QuickBooks or Stripe" },
  { id: "record_final_payment", scope: "project", when: "the couple paid the balance/final payment outside StudioCue — the operator types the amount" },
  { id: "approve_retainer_exception", scope: "project", when: "let a job book before the retainer is paid (an agreed exception)" },
  { id: "void_invoice", scope: "project", when: "void / cancel / take back an unpaid retainer or final invoice that's wrong or no longer owed (it's voided in QuickBooks or Stripe too) — 'retainer' or 'final' in `subject`, why in `text`" },
  { id: "record_partial_payment", scope: "project", when: "the couple paid part of (or the rest of) a retainer or final invoice already out with them — a part payment, an instalment, money towards the bill; it's recorded in QuickBooks or Stripe too — 'retainer' or 'final' in `subject`; the operator types the amount" },
  { id: "correct_payment", scope: "project", when: "fix a payment the studio recorded by mistake (wrong date, wrong amount, recorded on the wrong job, or it never arrived) — 'retainer' or 'final' in `subject`" },
  { id: "find_quickbooks_payments", scope: "project", when: "look up the couple's payments in QuickBooks" },
  // Booking
  { id: "confirm_booking", scope: "project", when: "confirm the booking / check whether the job can be booked now (signed + paid)" },
  { id: "bring_booking_live", scope: "project", when: "an imported booking should start emailing the couple (bring the couple in)" },
  { id: "import_booking", scope: "studio", ownerAdminOnly: true, when: "bring in a wedding already booked before StudioCue" },
  // Planning
  { id: "send_questionnaire", scope: "project", flow: "select_questionnaire", when: "send / assign the planning questionnaire to the couple — its name in `subject`" },
  { id: "resend_questionnaire", scope: "project", when: "remind the couple about / resend the questionnaire they have not sent back yet (the same form again, never a new copy)" },
  { id: "edit_questionnaire_answers", scope: "project", when: "change or correct the couple's questionnaire answers for them (they emailed or phoned a correction)" },
  { id: "reopen_questionnaire", scope: "project", ownerAdminOnly: true, when: "reopen a questionnaire the couple already sent back, so they can change their answers themselves" },
  { id: "withdraw_questionnaire", scope: "project", when: "withdraw / take back a questionnaire the couple has not sent back (sent by mistake, wrong form)" },
  { id: "draft_timeline", scope: "project", when: "draft the wedding-day timeline / schedule" },
  { id: "approve_timeline", scope: "project", when: "approve the drafted timeline (the studio approves by publishing it)" },
  { id: "publish_timeline", scope: "project", when: "publish the approved timeline to the couple and crew" },
  { id: "record_timeline_approval", scope: "project", when: "the couple approved the timeline (or asked for changes) by phone, email, text or in person — record their answer" },
  { id: "set_timeline_owner", scope: "project", when: "the planner owns the timeline, or the studio does — paste the planner's timeline in `text`" },
  { id: "share_run_of_show", scope: "project", when: "share the run of show with a vendor (planner, venue) — their name in `subject`" },
  { id: "stop_run_of_show_share", scope: "project", when: "stop sharing the run of show with a vendor" },
  { id: "reshare_run_of_show", scope: "project", when: "the timeline changed and vendors have the old version — send the new run of show to every vendor it was shared with" },
  { id: "set_insurance_required", scope: "project", when: "the venue requires proof of insurance (a COI)" },
  { id: "request_coi", scope: "project", when: "request a certificate of insurance from the studio's insurer for the venue" },
  { id: "decide_coi", scope: "project", when: "accept or reject a received certificate of insurance" },
  { id: "send_coi_to_venue", scope: "project", when: "send the approved certificate of insurance to the venue" },
  { id: "resend_coi", scope: "project", when: "a certificate of insurance request or certificate went out with wrong details or to the wrong venue address — correct it and send it again" },
  { id: "add_vendor", scope: "project", when: "add a vendor (planner, florist, DJ, venue coordinator) to a job — name in `subject`" },
  { id: "edit_vendor", scope: "project", when: "change a vendor's details on a job — name in `subject`" },
  { id: "remove_vendor", scope: "project", when: "remove a vendor from a job — name in `subject`" },
  // Messages
  { id: "reply_to_couple", scope: "project", when: "reply in the job's email thread with the couple — what to say in `text`" },
  { id: "approve_message", scope: "studio", ownerAdminOnly: true, when: "approve or decline a message a team member wrote that is waiting for the owner's approval" },
  { id: "mark_thread_read", scope: "project", when: "mark the couple's messages as read" },
  // Crew
  { id: "staff_crew", scope: "project", flow: "crew_offer", when: "staff a role, offer a job to crew, add a second shooter/videographer — person in `subject`" },
  { id: "add_crew_member", scope: "studio", when: "add a new photographer or videographer to the studio's crew roster — name in `subject`" },
  { id: "edit_crew_member", scope: "studio", when: "change a crew member's details, rate or trades — name in `subject`" },
  { id: "invite_crew_member", scope: "studio", when: "invite a crew member to the crew app — name in `subject`" },
  { id: "archive_crew_member", scope: "studio", when: "remove a crew member from the active roster — name in `subject`" },
  { id: "set_owner_shooting", scope: "project", ownerAdminOnly: true, when: "say whether the owner is shooting a job themselves or sending crew for every role (\"I'm not at the Smith wedding\") — `text` is \"yes\" if they are shooting, \"no\" if not" },
  { id: "withdraw_crew", scope: "project", ownerAdminOnly: true, when: "take a crew member off a job (or withdraw an offer) without replacing them — name in `subject`, their reason in `text`" },
  { id: "replace_crew", scope: "project", ownerAdminOnly: true, when: "a crew member can't do a job or should be swapped: take them off and offer the role to the next person on the list — name in `subject`" },
  { id: "approve_crew_plan", scope: "project", when: "approve and send the crew plan StudioCue prepared at booking, or plan the crew for several roles at once" },
  { id: "waive_crew_requirement", scope: "project", when: "waive a crew paperwork requirement (W-9, insurance) for someone on a job — name in `subject`" },
  { id: "record_crew_payment", scope: "project", when: "record that a crew member has been paid, or when they will be — name in `subject`" },
  { id: "review_crew_closeout", scope: "project", when: "approve a crew member's closeout (hours, files handed in) after the event — name in `subject`" },
  // Tasks
  { id: "create_task", scope: "project", when: "add a to-do on a job — the task in `text`, due date in `date`" },
  { id: "complete_task", scope: "project", when: "mark a task done — which one in `subject`" },
  { id: "edit_task", scope: "project", when: "change a task's title, due date (`date`), who it's for or priority — which one in `subject`" },
  { id: "reopen_task", scope: "project", when: "reopen a task marked done or cancelled by mistake / undo marking it done — which one in `subject`" },
  { id: "cancel_task", scope: "project", when: "cancel a task that no longer needs doing (it stays as a record) — which one in `subject`, why in `text`" },
  { id: "resolve_checkpoint", scope: "project", when: "mark a readiness item as handled by hand (it was done outside StudioCue) — which one in `subject`" },
  { id: "reopen_checkpoint", scope: "project", ownerAdminOnly: true, when: "reopen a readiness item marked done or waived by mistake — which one in `subject`" },
  // After the event
  { id: "record_delivery", scope: "project", when: "the gallery / photos / film were delivered — gallery link in `text`" },
  { id: "complete_editing_step", scope: "project", when: "mark a post-production step done (culling, editing, color), or untick one ticked by mistake — which in `subject`" },
  { id: "update_album", scope: "project", when: "update the album's status (selections received, design sent, couple approved or asked for changes, fulfilled), or put it back a step after a mistake" },
  { id: "replace_gallery_link", scope: "project", ownerAdminOnly: true, when: "a gallery or film link sent to the couple was wrong — take it back and send the right one (new link in `text`, which delivery in `subject`)" },
  { id: "confirm_review", scope: "project", when: "the couple left a review" },
  { id: "skip_review_requests", scope: "project", ownerAdminOnly: true, when: "don't ask this couple for a review / stop the review requests (they complained, or the studio asks in person) — not for a review they actually left" },
  { id: "close_job", scope: "project", when: "close out a finished job" },
  // Team
  { id: "invite_team_member", scope: "studio", ownerAdminOnly: true, when: "invite someone to the studio's team (an associate, an assistant) — email in `text`" },
  { id: "change_team_member", scope: "studio", ownerAdminOnly: true, when: "change a team member's role or remove them — name in `subject`" },
  { id: "revoke_team_invite", scope: "studio", ownerAdminOnly: true, when: "withdraw a pending team invitation — name or email in `subject`" },
  // Studio settings
  { id: "create_package", scope: "studio", ownerAdminOnly: true, when: "add a new package to the studio's price list" },
  { id: "edit_package", scope: "studio", ownerAdminOnly: true, when: "change a package's price, description or coverage — name in `subject`" },
  { id: "retire_package", scope: "studio", ownerAdminOnly: true, when: "stop offering a package — name in `subject`" },
  { id: "edit_agreement", scope: "studio", ownerAdminOnly: true, when: "change the studio's contract/agreement template" },
  { id: "edit_questionnaire_template", scope: "studio", ownerAdminOnly: true, when: "create or change a planning questionnaire template" },
  { id: "edit_email_template", scope: "studio", ownerAdminOnly: true, when: "change one of the studio's automatic email templates" },
  { id: "set_consultation_availability", scope: "studio", ownerAdminOnly: true, when: "change when consultations can be booked, their length, Zoom or in person" },
  // Governs the three lifecycle messages only (components/communications/
  // lifecycle-pack-panel.tsx). It promised reminders, follow-ups and review
  // requests, which this setting has never controlled (wave 3).
  { id: "set_automatic_emails", scope: "studio", ownerAdminOnly: true, when: "turn the schedule confirmation, final balance summary or day-before checklist on or off, or let them send without review — not review asks (skip_review_requests) or inquiry follow-ups" },
  { id: "set_contract_auto_send", scope: "studio", ownerAdminOnly: true, when: "choose whether contracts go out automatically after a proposal is accepted" },
  { id: "connect_integration", scope: "studio", ownerAdminOnly: true, when: "connect Google Calendar, Zoom, Dropbox, QuickBooks, Stripe or another app — which in `subject`" },
  { id: "set_autopay", scope: "studio", ownerAdminOnly: true, when: "turn automatic card payments for balances on or off" },
  { id: "edit_branding", scope: "studio", ownerAdminOnly: true, when: "change the studio's name, logo, colours or email sender name" },
  { id: "edit_workflow_template", scope: "studio", ownerAdminOnly: true, when: "create or change a custom workflow (the checklist and automations a job follows)" },
  { id: "set_insurance_settings", scope: "studio", ownerAdminOnly: true, when: "change the insurer/agent details and how certificates of insurance are requested and chased" },
  { id: "edit_add_on_library", scope: "studio", when: "add, change or archive an add-on in the studio's library (an extra sold on top of a package, like an engagement session or an extra hour)" },
  { id: "import_studio_materials", scope: "studio", ownerAdminOnly: true, when: "bring in the studio's existing templates, price lists, contracts or questionnaires from files or a website" },
  { id: "edit_timing_rules", scope: "studio", ownerAdminOnly: true, when: "change how long parts of the day take when timelines are drafted" },
  { id: "export_studio_data", scope: "studio", ownerAdminOnly: true, when: "export / download all of the studio's data" },
  { id: "set_crew_offer_settings", scope: "studio", ownerAdminOnly: true, when: "choose whether crew offers go out automatically on booking, and how long crew have to answer" },
  { id: "set_up_inquiry_capture", scope: "studio", ownerAdminOnly: true, when: "set up inquiry forwarding or teach StudioCue the studio's website contact form" },
  { id: "show_forwarding_address", scope: "studio", when: "show the studio's inquiry forwarding address" },
  { id: "manage_subscription", scope: "studio", ownerAdminOnly: true, when: "change the StudioCue plan, card or billing" },
] as const;

export const STUDIO_ACTION_IDS: ReadonlySet<string> = new Set(STUDIO_ACTIONS.map((spec) => spec.id));

export function actionSpec(id: string): ServerActionSpec | undefined {
  return STUDIO_ACTIONS.find((spec) => spec.id === id);
}

/** The model-facing catalogue, one line each, for the tool's description. */
export function catalogForModel(): string {
  return STUDIO_ACTIONS.map((spec) => `${spec.id}: ${spec.when}`).join("\n");
}

/** What the operator's words carried into a card. Never an id or an amount. */
export type PreparedActionDirective = {
  key: string;
  action: string;
  projectId: string | null;
  subject: string | null;
  text: string | null;
  field: string | null;
  date: string | null;
  time: string | null;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

const clean = (value: unknown, max: number): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed ? trimmed.slice(0, max) : null;
};

export type PrepareResult =
  | { ok: true; directive: Omit<PreparedActionDirective, "key">; spec: ServerActionSpec }
  | { ok: false; reason: string };

/**
 * Checks one `prepare_action` call. Deterministic and pure so it is tested
 * directly: the model's arguments are words, and the only things taken from
 * them are an id from a closed list, a project the caller may see, and short
 * strings the card shows back to the operator for confirmation.
 */
export function validatePreparedAction(
  args: Record<string, unknown>,
  context: {
    allowedProjectIds: ReadonlySet<string>;
    archivedProjectIds: ReadonlySet<string>;
    scopedProjectId: string | null;
    ownerOrAdmin: boolean;
  },
): PrepareResult {
  const id = typeof args.action === "string" ? args.action.trim() : "";
  const spec = actionSpec(id);
  if (!spec) return { ok: false, reason: `unknown action "${id}"` };
  if (spec.ownerAdminOnly && !context.ownerOrAdmin)
    return { ok: false, reason: "only the studio's owners and admins can do this — say so" };
  let projectId: string | null = null;
  if (spec.scope === "project") {
    const named = typeof args.projectId === "string" ? args.projectId.trim() : "";
    projectId = named || context.scopedProjectId;
    if (!projectId) return { ok: false, reason: "which job? pass a projectId from the overview" };
    if (!context.allowedProjectIds.has(projectId))
      return { ok: false, reason: "that job is not one this operator can see" };
    if (context.archivedProjectIds.has(projectId) && id !== "restore_job" && id !== "delete_job")
      return { ok: false, reason: "that job is archived — say so and offer restore_job" };
  }
  const date = clean(args.date, 10);
  const time = clean(args.time, 5);
  return {
    ok: true,
    spec,
    directive: {
      action: spec.id,
      projectId,
      subject: clean(args.subject, 120),
      text: clean(args.text, 2000),
      field: clean(args.field, 40),
      date: date && ISO_DATE.test(date) ? date : null,
      time: time && HH_MM.test(time) ? time : null,
    },
  };
}

/** How many cards one turn may prepare. */
export const MAX_PREPARED_ACTIONS = 3;
