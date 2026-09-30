/**
 * Plain-English rendering for AI command failures.
 *
 * Design rule: the UI never shows raw validation output, provider names, or
 * error dumps. Known short codes map to friendly copy; anything unrecognized
 * (long text, JSON, stack fragments) collapses to a calm generic message.
 */

const FRIENDLY_BY_CODE: Record<string, string> = {
  // Reachable from Cue's prepared-action cards (components/ai/actions).
  APPROVAL_PERMISSION_REQUIRED: "Only the studio's owners and admins can approve this.",
  DRAFT_NOT_APPROVABLE: "That message has already been approved, declined or sent.",
  DRAFT_NOT_FOUND: "That message isn't there any more. Refresh and try again.",
  CONSULTATION_NOT_CANCELLABLE: "That consultation can't be cancelled — it has already happened or been cancelled.",
  CONSULTATION_NOT_COMPLETABLE: "That consultation can't be written up — it was cancelled.",
  CONSULTATION_NOT_FOUND: "That consultation isn't there any more. Refresh and try again.",
  CONSULTATION_NOT_RESCHEDULABLE: "Only a consultation still to come can be moved.",
  INVALID_TIME_RANGE: "The end time has to be after the start time.",
  INVITATION_NOT_REVOCABLE: "That invitation can't be withdrawn — it has already been accepted, expired or withdrawn.",
  CLIENT_NOT_ASSOCIATED_WITH_PROJECT: "That client isn't on this job. Add them to the job first.",
  CLIENT_OR_PROJECT_NOT_FOUND: "That client or job isn't there any more. Refresh and try again.",
  PROJECT_VERSION_CONFLICT: "The job changed a moment ago. Try again — it will use the latest.",
  PROPOSAL_PDF_NOT_READY: "The proposal's PDF isn't ready yet. Open the proposal to make it, then send.",
  PROPOSAL_PDF_INVALID: "The proposal's PDF didn't come out right. Open the proposal and make it again.",
  OPEN_PROPOSAL_EXISTS: "This job already has a proposal in progress. Open it instead of starting another.",
  PROJECT_NOT_READY_FOR_PROPOSAL: "A proposal is made once the job is past the first inquiry and before it books.",
  PACKAGE_SNAPSHOT_REQUIRED: "Choose a package for the job first; the proposal is priced from it.",
  PROPOSAL_DRAFT_CONFLICT: "Someone saved this draft a moment ago. Refresh to see their change, then edit again.",
  PROPOSAL_EXPIRATION_MUST_BE_FUTURE: "The offer has to stay open until a date after today.",
  SEND_PERMISSION_REQUIRED: "Only the studio's owners and admins can send a proposal.",
  PROJECT_NOT_IN_CONSULTATION: "Consultation notes are recorded while the job is at the consultation stage.",
  INVALID_BOOKING_STATE: "This job isn't waiting to be booked.",
  RETAINER_AMOUNT_NOT_FOUND: "The retainer amount couldn't be found on the job's package. Check the package, then try again.",
  TASK_NOT_FOUND: "That task isn't there any more. Refresh and try again.",
  REVIEW_REQUEST_NOT_FOUND: "That review request isn't there any more. Refresh and try again.",
  CONVERSATION_NOT_FOUND: "That conversation isn't there any more. Refresh and try again.",
  RECIPIENT_UNKNOWN: "There's no email address to send this to. Add one to the client first.",
  PROJECT_CONTACT_REQUIRED: "That person isn't a client on this job.",
  NO_PACKAGE_CHANGES: "Nothing about the package changed, so there was nothing to save.",
  CREW_ALREADY_HAS_ACCOUNT: "They already have a crew account, so there's nothing to invite them to.",
  PROVIDER_NOT_CONNECTED: "That app isn't connected yet. Connect it under Integrations first.",
  OAUTH_PROVIDER_NOT_CONFIGURED: "That app can't be connected yet.",
  CHECKPOINT_NOT_FOUND: "That readiness item isn't there any more. Refresh and try again.",
  MEMBER_NOT_EDITABLE: "That person's access can't be changed here — the owner's can't, and neither can your own.",
  INTERNAL_USER_LIMIT_REACHED: "Your plan has no seats left. Remove someone or change your plan first.",
  INVITATION_ALREADY_PENDING: "They already have an invitation waiting. Withdraw it to send a new one.",
  // The couple's questionnaire (planningCommand saveQuestionnaire).
  QUESTIONNAIRE_ALREADY_SUBMITTED:
    "You've already sent this to your studio. Message them if you'd like to change an answer.",
  RESPONSE_NOT_FOUND: "This questionnaire couldn't be found. Refresh and try again.",
  // The couple's album (postEventCommand updateAlbumStatus).
  ALBUM_STEP_NOT_AVAILABLE:
    "Your album has moved on since this page opened. Refresh to see where it is now.",
  // The couple's timeline (planningCommand approveSchedule).
  SCHEDULE_NOT_FOUND: "This timeline couldn't be found. Refresh to see the latest from your studio.",
  SCHEDULE_NOT_IN_REVIEW:
    "This version isn't waiting for your answer any more. Refresh to see the latest from your studio.",
  // Changing a job's packages (selectPackage / removePackage / revise_packages).
  PACKAGES_LOCKED_AFTER_SIGNING:
    "The agreement is signed, so a package change is a booking change the couple signs. Use Change the booking on the job.",
  // Changing a signed booking (bookingCommand draftAmendment / sendAmendment / …).
  AMENDMENT_NOT_AVAILABLE:
    "This job can't take a booking change at this stage. Changes open once the agreement is signed and close after the wedding.",
  AMENDMENT_ALREADY_SENT:
    "A change is already with the couple. Wait for them to sign it, or withdraw it before writing another.",
  AMENDMENT_NEEDS_ACCEPTED_PROPOSAL:
    "This job has no accepted proposal to change. Send and sign the booking first.",
  NOTHING_TO_CHANGE: "Nothing would change. Pick a new date or different packages.",
  AMENDMENT_NOT_FOUND: "That change isn't there any more. Refresh to see the booking as it stands.",
  AMENDMENT_NOT_DRAFT: "That change has already gone to the couple. Refresh to see where it is.",
  AMENDMENT_RECORD_ONLY:
    "Signing in StudioCue isn't switched on for your studio, so record the couple's signature once they've signed it another way.",
  AMENDMENT_STALE:
    "The job changed after this was written up. Write the change up again so the couple signs what's true now.",
  AMENDMENT_ALREADY_SIGNED: "The couple has already signed this change. It's being applied now.",
  AGREEMENT_ALREADY_SENT:
    "The agreement has already gone to the couple for these packages. Void it on the Booking tab first, then change the packages.",
  INVOICE_ALREADY_RAISED:
    "An invoice has already been raised for the current total. Void it first, then change the packages.",
  PACKAGE_ALREADY_SELECTED:
    "This job already has a package. Open its proposal and use Packages to add another or swap it.",
  PACKAGE_ALREADY_ON_JOB: "That package is already on this job.",
  PACKAGE_REQUEST_NOT_AVAILABLE:
    "Your booking can't take another package right now — your agreement may already be on its way. Please message your studio.",
  DATE_IN_PAST: "That date has already passed. Choose a date that's still to come.",
  PACKAGE_REQUEST_NOT_FOUND: "That request isn't there any more. Refresh and try again.",
  PACKAGE_LIMIT_REACHED: "A job can hold four packages at most. Remove one before adding another.",
  ADD_ON_NOT_FOUND: "That extra isn't in your library any more. Refresh and choose again.",
  CUSTOM_ADD_ON_INCOMPLETE: "Give the extra a name and a price.",
  PROPOSAL_ACCEPTED_BY_SIGNING: "This proposal is accepted by signing your booking agreement. Open the agreement to review and sign it.",
  COMBINED_AGREEMENT_NOT_ENABLED: "Sending the terms and prices together isn't switched on for your studio.",
  PROPOSAL_NOT_SENDABLE: "This proposal has already been answered or replaced. Refresh to see its latest version.",
  PACKAGE_NOT_ON_JOB: "That package isn't on this job any more. Refresh and try again.",
  LAST_PACKAGE_ON_JOB: "A job needs at least one package. Use Swap to change it instead.",
  // Closing and reopening an inquiry (crmCommand closeInquiry / reopenInquiry).
  INQUIRY_NOT_FOUND: "That inquiry couldn't be found. Refresh and try again.",
  INQUIRY_NOT_CLOSABLE: "This couple has booked, so it's a job now rather than an inquiry to close.",
  INQUIRY_NOT_CLOSED: "This inquiry is already open.",
  // The couple's inquiry link (functions/src/intake/inquiry-link.ts).
  EVENT_DATE_REQUIRED: "Add your wedding date first, so the studio can check it's free.",
  FORMAT_NOT_OFFERED: "Please choose one of the ways the studio meets.",
  INQUIRY_LINK_NOT_FOUND: "This link isn't working. Reply to the studio's email and they'll send a new one.",
  INQUIRY_LINK_CLOSED: "This inquiry is closed. Reply to the studio's email if you'd like to pick it back up.",
  INQUIRY_PAST_CONSULTATION: "You've already spoken with the studio, and your proposal is on its way. Reply to their email to talk again.",
  QUICKBOOKS_PAYMENTS_NOT_GRANTED:
    "QuickBooks hasn't given StudioCue permission to take payments yet. Reconnect QuickBooks for payments first. Your QuickBooks Payments application needs to be approved before that works.",
  AUTOPAY_UNAVAILABLE:
    "Saving a card isn't available for this booking right now. You can still pay with the invoice link.",
  PAYMENT_METHOD_NOT_FOUND:
    "That card is no longer saved. Refresh the page to see your payment details.",
  ACTIVE_SUBSCRIPTION_REQUIRED:
    "Your trial hasn't started yet. Add a card under Studio settings → Subscription to start it, then try again. If your subscription lapsed, update your card there to reactivate.",
  AI_OUTPUT_INVALID:
    "The draft didn't pass our checks, so nothing was saved. Try again — a fresh attempt usually works.",
  AI_SCHEDULE_FAILED: "We couldn't draft this schedule. Try again.",
  /**
   * Deliberately a refusal rather than a degraded draft.
   *
   * Drafting a reply without the message it answers produced a plausible,
   * finished-looking note that addressed nothing the client had asked. Saying
   * so is better than handing the studio that to approve.
   */
  CONVERSATION_HISTORY_UNAVAILABLE:
    "We couldn't read this conversation, so there's nothing to base a reply on. Refresh and try again — the draft would have missed what they actually asked.",
  // Cue reading a signed agreement. The attachment is read once and deleted,
  // so a missing one almost always means it was already read — attaching it
  // again is the fix either way.
  ATTACHMENT_NOT_FOUND:
    "Cue couldn't find that file — it may already have been read. Attach it again.",
  ATTACHMENT_PATH_MISMATCH:
    "Cue couldn't match that file to your upload. Attach it again.",
  SIGNATURE_ATTESTATION_PERMISSION_REQUIRED:
    "Only a studio owner or admin can record a signature. Ask one of them to record it.",
  RETAINER_EXCEPTION_PERMISSION_REQUIRED:
    "Only a studio owner or admin can waive a retainer, because it goes on record as their decision.",
  RETAINER_EXCEPTION_NOT_READY:
    "A retainer can only be waived once the contract is signed and the booking is waiting on the retainer.",
  QUICKBOOKS_NOT_CONNECTED:
    "QuickBooks isn't connected. Connect it in Integrations to fill payments from it, or enter them yourself.",
  BOOKING_IMPORT_PERMISSION_REQUIRED:
    "Only a studio owner or admin can import bookings, because importing one records that its contract was signed and its payments made.",
  NOT_AN_IMPORTED_BOOKING:
    "This job wasn't imported, so there's nothing to bring in — it's already live in StudioCue.",
  IMPORTED_CONTRACT_NOT_FOUND:
    "This job has no imported contract to attach a signed copy to.",
  SIGNED_COPY_ALREADY_ATTACHED:
    "A signed copy is already attached to this booking.",
  SIGNED_COPY_PATH_MISMATCH:
    "That file couldn't be attached to this booking. Upload it again from the job.",
  AI_QUOTA_EXCEEDED:
    "Your workspace has used its included AI drafts for this period. Review your plan to add more.",
  NO_PUBLISHED_RUN_OF_SHOW:
    "Publish the run of show first, then you can share it with vendors.",
  SHARE_NOT_FOUND: "There's no active share for this vendor yet.",
  PLANNER_TIMELINE_UNREADABLE:
    "We couldn't find any times in that. Paste the planner's timeline with one moment per line, like \"3:30 PM Ceremony\".",
  ENTITLEMENT_EXCEEDED:
    "Your workspace has used its included AI drafts for this period. Review your plan to add more.",
  INVALID_REQUEST:
    "Something about this request didn't look right. Refresh and try again.",
  INVALID_COVERAGE_RANGE: "Coverage must end after it starts.",
  FORBIDDEN: "You don't have permission to do this for the selected project.",
  // A coordinator acting on a project outside their assigned list. Distinct
  // from FORBIDDEN, which is about the role; this is about the job.
  PROJECT_NOT_PERMITTED:
    "This job is not one of yours. Ask an owner or admin to add you to it, or to make the change for you.",
  // The inquiry already became a job. Say which way is forward.
  ACCEPTANCE_PERMISSION_REQUIRED:
    "Only a studio owner or admin can record an acceptance taken outside StudioCue.",
  PROJECT_NOT_AWAITING_ACCEPTANCE:
    "This job is not waiting on a proposal decision, so there is nothing to record.",
  PROPOSAL_ACTION_NOT_ALLOWED:
    "That is not something this proposal can do from its current status.",
  // Archiving a client, vendor or collaborator. Both "has live work" refusals
  // are deliberate — see features/records/archive.ts.
  // The studio's own identity. The public address is the one with a cost
  // attached — see features/tenants/identity.ts.
  PUBLIC_SLUG_TAKEN:
    "Another studio already uses that inquiry address, or used to. Try a different one.",
  PUBLIC_SLUG_INVALID:
    "Use three or more lowercase letters, numbers and hyphens, without a hyphen at either end.",
  IDENTITY_UPDATE_FAILED:
    "Your studio details could not be saved. Try again, and contact support if it keeps failing.",
  TENANT_NOT_FOUND: "This studio workspace could not be found.",
  // A collaborator you already have. Email is the identity, because it is what
  // the invitation is sent to and what they sign in with.
  CREW_EMAIL_ALREADY_IN_DIRECTORY:
    "Someone with that email is already in your directory. Open their entry instead of adding a second one.",
  CREW_EMAIL_ARCHIVED_IN_DIRECTORY:
    "You removed someone with that email from your directory. Show archived collaborators and return them, so their history stays on one record.",
  CONTACT_HAS_LIVE_PROJECT:
    "This client has a job that is still live. Close, cancel or finish it first.",
  CREW_HAS_OPEN_ASSIGNMENT:
    "This collaborator still holds an assignment. Settle or withdraw it first.",
  PROJECT_HAS_LIVE_CREW:
    "Someone is still waiting on this job. Cancel it — that ends the offers and records why — or settle them first.",
  CREW_IDENTITY_OWNED_BY_MEMBER:
    "They have their own account now, so their name and email are theirs to change. You can still update rate, specialties and areas.",
  CONTACT_NOT_FOUND: "That client record could not be found.",
  ACCEPTED_PROPOSAL_IS_FINAL:
    "This proposal has been accepted, so it cannot be changed. Start a new one if the details need to move.",
  PROPOSAL_ALREADY_SUPERSEDED:
    "A corrected copy of this proposal already exists. Open the newest version.",
  CLIENT_ALREADY_ON_PROJECT:
    "That person is already on this job.",
  PROJECT_ARCHIVED:
    "This job is archived, so it cannot be edited. Restore it first if you need to change it.",
  PROJECT_NOT_FOUND:
    "That job could not be found. It may have been deleted, or you may not have access to it.",
  // Permanently deleting a job. The bar is deliberately higher than archiving:
  // there is nothing to restore afterwards. See features/projects/purge-policy.ts.
  PROJECT_PURGE_OWNER_ONLY:
    "Only the studio owner can permanently delete a job. Archiving it takes it out of your working list without destroying anything.",
  PROJECT_PURGE_NAME_MISMATCH:
    "That is not the job's name. Type it exactly as it appears above the box.",
  PROJECT_PURGE_PREVIEW_UNAVAILABLE:
    "Development preview: nothing can be deleted here.",
  PROJECT_PURGE_FAILED:
    "The job could not be deleted. Some of its records may already be gone — run the delete again to finish it, and contact support if it keeps failing.",
  VENDOR_NOT_FOUND: "That vendor record could not be found.",
  CREW_PROFILE_NOT_FOUND: "That collaborator could not be found.",
  // Billing. The server names the cause precisely and the client used to drop
  // it, so every one of these arrived as "Billing could not be opened."
  STRIPE_CUSTOMER_NOT_FOUND:
    "Stripe has no customer for this studio yet — choose a plan to set up billing, then the portal will open.",
  STRIPE_NOT_CONFIGURED:
    "Billing isn't connected for this workspace yet. Contact support and we'll finish the setup.",
  STRIPE_PRICE_NOT_CONFIGURED:
    "That plan has no price configured yet. Contact support before trying again.",
  STRIPE_REQUEST_FAILED:
    "Stripe couldn't complete that request. Try again in a moment.",
  PLAN_REQUIRED: "Choose a plan and a billing period first.",
  BILLING_COMMAND_FAILED:
    "Billing couldn't be reached. Try again, and contact support if it keeps failing.",
  INTERRUPTION_REASON_REQUIRED:
    "Say why the job is on hold or cancelled — at least a short sentence, so it makes sense later.",
  EVIDENCE_CONTROLLED_TRANSITION:
    "This step needs the record behind it, not a stage change — the job page links to where to enter it.",
  VERSION_CONFLICT:
    "Someone else changed this job while you were looking at it. Refresh and try again.",
  INVALID_TRANSITION:
    "That is not a move this job can make from where it is now.",
  BALANCE_ATTESTATION_PERMISSION_REQUIRED:
    "Only a studio owner or admin can record a payment taken outside StudioCue.",
  BALANCE_NOT_READY:
    "This job is not at a stage where a balance can be recorded — it has to be booked first.",
  BALANCE_AMOUNT_NOT_FOUND:
    "We couldn't work out the balance from the accepted proposal. Check the payment schedule on it.",
  FINAL_INVOICE_NOT_FOUND:
    "The balance invoice we were about to settle has gone. Reconcile the closeout and try again.",
  LEAD_NOT_CONVERTIBLE:
    "This inquiry has already been converted — open the job it became.",
  CLIENT_NOT_FOUND:
    "We couldn't find the client record for this inquiry. Add the client, then convert.",
  METHOD_NOT_ALLOWED: "Something about this request didn't look right. Refresh and try again.",
  FUNCTION_ACCESS_DENIED:
    "The studio server refused this request — usually a deploy still settling. Try again in a minute; if it keeps happening, contact support.",
  FUNCTION_UPSTREAM_UNAVAILABLE:
    "The studio server didn't answer properly. Try again in a minute; if it keeps happening, contact support.",
  /**
   * Both used to stop at "isn't switched on", naming no remedy and no
   * alternative — and the schedule generator has one, built for exactly this:
   * "Build it myself" starts a draft with no model involved, and the whole
   * page is otherwise arranged around the button that just failed. The studio
   * had filled in coverage, ceremony, reception, three locations and a
   * constraints note before finding out.
   */
  VERTEX_AI_SCHEDULE_NOT_CONFIGURED:
    "AI drafting isn't available for this workspace — use \u201cBuild it myself\u201d to start the run of show from what you have entered.",
  VERTEX_AI_COPILOT_NOT_CONFIGURED:
    "The assistant isn't available for this workspace yet. Everything it reads is on the job itself.",
  VERTEX_AI_EMPTY_OUTPUT: "We couldn't draft this. Try again.",
  GOOGLE_RUNTIME_IDENTITY_UNAVAILABLE: "We couldn't draft this. Try again.",
  // Cue's catch-all. Anything the provider or the runtime throws that is not
  // already a code arrives here rather than as its own exception text — a
  // studio was being shown the words "fetch failed". See copilot.ts.
  AI_COPILOT_UNAVAILABLE:
    "Cue couldn't reach its model just now. Nothing was changed — ask again in a moment, and contact support if it keeps happening.",

  /**
   * Booking attestations refusing for a reason worth reading.
   *
   * These carry real information and used to reach the user verbatim. The
   * sweep that routed raw exception messages through this map turned them
   * into "The payment could not be recorded", which is calm and useless: the
   * walk of 2026-08-26 hit RETAINER_INVOICE_ALREADY_EXISTS and the screen
   * gave no hint that a standing invoice was the obstacle. A collapsed
   * message is only an improvement when the code says nothing.
   */
  /**
   * Delivery and closeout refusing for a reason worth reading. Same lesson as
   * the booking codes below: the walk of 2026-08-26 pressed "Record and release
   * delivery" on a job at Shot and read only "Delivery could not be recorded",
   * when the code said exactly what was wrong.
   */

  PROJECT_NOT_CLOSEABLE:
    "This job isn't at a stage where it can be closed. It needs to be delivered first.",
  CLOSEOUT_REQUIREMENT_NEEDS_EVIDENCE:
    "This one can't be vouched for. The signed agreement and the final balance need real evidence — record the signature or the payment on the booking instead.",
  CLOSEOUT_ATTESTATION_PERMISSION_REQUIRED:
    "Only the studio owner or an admin can vouch for closeout evidence.",
  CLOSEOUT_REQUIREMENT_ALREADY_MET:
    "The records already cover this one, so there is nothing to vouch for.",
  CLOSEOUT_REQUIREMENT_NOT_FOUND:
    "That closeout requirement is no longer on this job. Reconcile the evidence again to refresh it.",
  CLOSEOUT_ALREADY_COMPLETED:
    "This job is already closed out.",
  CLOSEOUT_NOT_FOUND:
    "No closeout has been prepared for this job yet. Reconcile the evidence first.",
  POST_PRODUCTION_NOT_FOUND:
    "Post-production hasn't opened for this job yet. It starts when the job moves to editing.",
  POST_PRODUCTION_DEPENDENCY_INCOMPLETE:
    "An earlier step has to be done first. The checklist shows which one.",
  DELIVERY_ITEMS_REQUIRED: "Add at least one link to release.",
  REVIEW_DESTINATION_REQUIRED:
    "This release completes delivery, and the review asks need somewhere to point. Add your review link under \"Review asks, album and studio defaults\".",
  // Certificates of insurance (H3).
  COI_AGENT_EMAIL_REQUIRED: "Add your insurance agent's email — here, or once in Settings → Insurance.",
  COI_VENUE_EMAIL_REQUIRED: "Add the venue's email so the certificate has somewhere to go.",
  COI_DIAL_OWNER_ONLY: "Only the studio owner can change how far StudioCue goes on its own with certificates.",
  COI_UPLOAD_MUST_BE_PDF: "Upload the certificate as a PDF.",
  COI_UPLOAD_TOO_LARGE: "That PDF is over 12 MB. Export a smaller copy and try again.",
  COI_REQUEST_NOT_ACCEPTING: "This certificate has already moved on. Refresh to see where it is.",
  COI_NOT_PREPARED: "This request has already gone to your agent. Refresh to see where it is.",
  COI_DETAILS_NOT_NEEDED: "This request already has the venue's details. Refresh to see where it is.",
  COI_NOT_REVIEWABLE: "This certificate has already been decided. Refresh to see where it is.",
  NOTHING_DELIVERED_YET: "Nothing has gone to the couple yet, so there's no delivery to complete. Release something first.",
  PROJECT_NOT_IN_POST_PRODUCTION:
    "This job hasn't started post-production yet. Move it on from the job page, then record the gallery.",
  DELIVERY_ALREADY_RECORDED:
    "This delivery has already been recorded, so nothing was sent twice. Refresh to see it.",
  /**
   * Named from the code, not from the page. The delivery page says StudioCue
   * "checks the balance, the contract and the crew before anything reaches the
   * couple", and the gate checks none of those — it requires the backup,
   * editing and gallery-ready steps on the post-production record. Copy that
   * describes the wrong check is worse than no copy.
   */
  DELIVERY_GATE_BLOCKED:
    "Nothing can be released until the cards are backed up. Tick \"Cards backed up\" on this job's post-production checklist first.",
  DELIVERY_URL_MUST_USE_HTTPS:
    "The gallery link has to start with https:// so the couple's photographs are not sent over an open connection.",
  DELIVERY_DRAFT_INVALID:
    "Some of the gallery details didn't look right. Check the link, the access code and the dates.",
  /**
   * Named the wrong three things, and named them as a guess.
   *
   * The reconciler checks eight — contract, balance, schedule, delivery,
   * album, review ask, crew, insurance — and this reported a disjunction of
   * three, so the studio was handed a guessing game while five were dropped
   * from consideration. Worse, none of the three was the actual reason:
   * `PROJECT_NOT_READY_FOR_CLOSEOUT` is thrown when the project has not
   * reached DELIVERED (functions/src/post-event/commands.ts:806), which is a
   * single, checkable condition. `CLOSEOUT_BLOCKED` is the one that means
   * requirements are outstanding.
   */
  PROJECT_NOT_READY_FOR_CLOSEOUT:
    "Closeout opens once the gallery has been delivered. Record the delivery first.",
  ALBUM_STATUS_REGRESSION:
    "An album can't go backwards. Refresh to see where this one actually is.",
  ALBUM_CREATIVE_AUTHORITY_REQUIRED:
    "Only the studio owner or a lead photographer can make this album decision.",

  /**
   * Kept for older clients. Recording a payment against a standing invoice now
   * settles that invoice instead of refusing, so this should not be reached
   * from the current booking screen.
   */
  RETAINER_INVOICE_ALREADY_EXISTS:
    "This retainer is already settled. Refresh the booking page to see where the job stands.",
  RETAINER_INVOICE_NOT_FOUND:
    "That retainer invoice could not be found. Refresh the booking page and try again.",
  SIGNED_CONTRACT_REQUIRED:
    "The signed agreement comes first. Record the signature, then the retainer.",
  RETAINER_NOT_READY:
    "This job isn't waiting on a retainer yet. Refresh the booking page to see which step it is actually on.",
  RETAINER_ATTESTATION_PERMISSION_REQUIRED:
    "Only the studio owner or an admin can record a payment by hand.",
  PACKAGE_SNAPSHOT_NOT_FOUND:
    "The locked package for this job could not be found, so there is no price to record against.",
  CONTRACT_NOT_READY:
    "The accepted proposal must be ready before a contract can be sent.",
  ACCEPTED_PROPOSAL_REQUIRED:
    "The client needs to accept the proposal before the agreement can go out.",

  /** StudioCue's own contracts — functions/src/contracts and the portal's signing route. */
  NATIVE_SIGNING_NOT_ENABLED:
    "Writing and signing contracts in StudioCue isn't switched on for your studio yet. Send your agreement the way you do today and record the signature.",
  AGREEMENT_TEMPLATE_REQUIRED:
    "Set up your agreement first — StudioCue writes each contract from it. Open Contracts → Your agreement.",
  AGREEMENT_HAS_PLACEHOLDER_TEXT:
    "Some sections still say \"[Replace with …]\". Put your own terms there before saving — that text would go to your clients.",
  AGREEMENT_TEMPLATE_NOT_FOUND:
    "That agreement could not be found. Refresh the page and open it again.",
  AGREEMENT_PERMISSION_REQUIRED:
    "Only the studio owner or an admin can change the studio's agreement.",
  IMPORTED_AGREEMENT_EMPTY:
    "The imported agreement has no text StudioCue could read. Paste your agreement into the editor instead.",
  CONTRACT_SIGNING_PERMISSION_REQUIRED:
    "Only the studio owner or an admin can sign contracts for the studio.",
  CONTRACT_DRAFT_NOT_FOUND:
    "There's no prepared contract to send. Prepare it again from the job.",
  CONTRACT_CHANGED:
    "The job's details changed since this contract was prepared. Prepare it again, read it once more, then send.",
  CONTRACT_FIELDS_MISSING:
    "Some details in the contract are still blank. Fill them in, then send.",
  CLIENT_EMAIL_REQUIRED:
    "The client has no email address on the accepted proposal, so the contract has nowhere to go. Add one to the client and reissue the proposal.",
  CONTRACT_ALREADY_COMPLETED:
    "This job's agreement is already signed.",
  CONTRACT_ALREADY_EXISTS:
    "An agreement is already out for this job. Withdraw it first if it needs to change.",
  SIGNED_COPY_NOT_FILED:
    "This contract's signed copy isn't filed yet, so there's nothing to share. Attach the signed copy first.",
  CONTRACT_NOT_FOUND:
    "That agreement could not be found. Refresh the booking page.",
  NOT_A_STUDIOCUE_CONTRACT:
    "That agreement went out through a signing app, so it is managed there.",
  SIGNED_CONTRACT_CANNOT_BE_VOIDED:
    "A signed agreement can't be withdrawn — it's the record of what you both agreed. A change needs a new agreement.",
  CONTRACT_NOT_VOIDABLE:
    "Only an agreement that is out for signature can be withdrawn.",
  AUTO_SEND_CONSENT_REQUIRED:
    "Type your name and tick the box to let StudioCue sign and send for you.",
  CONTRACT_NOT_SENT: "Your studio hasn't sent this agreement yet.",
  CONTRACT_ALREADY_SIGNED: "This agreement is already signed.",
  CONTRACT_VOIDED: "Your studio withdrew this agreement. They'll send a new one.",
  PROJECT_NOT_AWAITING_SIGNATURE:
    "This agreement isn't waiting for a signature right now. Message your studio if that seems wrong.",
  SIGNER_NOT_A_CLIENT: "Only the client named on this agreement can sign it.",
  WRONG_SIGNER:
    "This agreement is addressed to a different email address. Sign in with the email your studio sent it to.",
  DOCUMENT_CHANGED:
    "The agreement was updated while you were reading it. Read the latest version before signing.",
  CONSENT_REQUIRED: "Tick the box to agree to sign electronically.",
  CONSENT_OUTDATED:
    "The terms for signing electronically were updated. Reload the page, read them, and sign again.",
  NAME_REQUIRED: "Type your full name as your signature.",

  /**
   * Capability resolution refusing to guess.
   *
   * These used to be silent: with nothing connected, signing fell back to
   * DocuSign and queued a request against an account that did not exist,
   * so the studio learned about it from a failed provider job rather than
   * from the button they pressed. Each of these names the actual fix.
   */
  SIGNING_NO_CONNECTED_PROVIDER:
    "No signing app is connected, so the agreement can't go out for signature. Connect Dropbox Sign in Studio settings, then try again.",
  SIGNING_AMBIGUOUS_MULTIPLE_PROVIDERS:
    "More than one signing app is connected, so StudioCue doesn't know which should send the agreement. Choose one in Studio settings.",
  SIGNING_SELECTED_PROVIDER_NOT_CONNECTED:
    "The signing app you chose isn't connected any more. Reconnect it in Studio settings, or choose another.",
  INVOICING_NO_CONNECTED_PROVIDER:
    "No invoicing app is connected, so the retainer invoice can't be raised. Connect QuickBooks in Studio settings, then try again.",
  INVOICING_AMBIGUOUS_MULTIPLE_PROVIDERS:
    "More than one invoicing app is connected, so StudioCue doesn't know which should raise the invoice. Choose one in Studio settings.",
  INVOICING_SELECTED_PROVIDER_NOT_CONNECTED:
    "The invoicing app you chose isn't connected any more. Reconnect it in Studio settings, or choose another.",
};

/**
 * Infrastructure failures whose raw text reads as prose and therefore slips
 * past looksHumanWritten. "Firebase client configuration is incomplete:
 * apiKey, authDomain, projectId…" is a deployment problem, not something a
 * photographer can act on.
 */
const FRIENDLY_BY_PHRASE: Array<[RegExp, string]> = [
  [
    /firebase client configuration is incomplete/i,
    "This workspace isn't fully configured yet, so live records can't load. Your studio administrator can finish the setup.",
  ],
  [
    /missing or insufficient permissions/i,
    "You don't have access to these records. Ask your studio owner to check your role.",
  ],
  [
    /failed to fetch|fetch failed|network ?error|load failed/i,
    "We couldn't reach the server. Check your connection and try again.",
  ],
  // Firestore security-rules evaluation dumps ("evaluation error at L386:22
  // for 'get' … Null value error.") read as prose to looksHumanWritten but
  // are plumbing, never something a photographer can act on.
  [
    /evaluation error at L\d+|null value error/i,
    "Some records couldn't be loaded. Refresh to try again — if this keeps happening, contact support.",
  ],
];

const PREFIX_FALLBACKS: Array<[RegExp, string]> = [
  [/^VERTEX_AI_/, "We couldn't draft this. Try again."],
  [/^AI_/, "We couldn't draft this. Try again."],
];

/**
 * Codes that arrive as `CODE:detail`, where the detail is the whole point.
 *
 * The flat code map answers with one fixed sentence, which is right for most
 * failures and wrong for the two most common. A schema rejection knows which
 * field it rejected and a dependency refusal knows which step it is waiting
 * on; both used to land as a generic line that named neither, so
 * "The package could not be created. Try again." was the entire report on a
 * retainer percentage over 100, and "That checkpoint could not be updated."
 * was the entire report on a checkpoint whose prerequisite was outstanding.
 *
 * "Try again" is also the one instruction guaranteed to fail identically.
 * These say what to change instead.
 */
const DETAILED_BY_CODE: Record<string, (detail: string) => string> = {
  // A booking change to a date another job holds. The server names the job.
  DATE_TAKEN: (detail) =>
    detail
      ? `${detail.trim()} already has that date. Choose "We can cover both" if you can, or pick another date.`
      : 'Another job already has that date. Choose "We can cover both" if you can, or pick another date.',
  // Every command endpoint returns this for any schema failure, so it is the
  // most-hit error in the product and had no entry at all.
  // Importing existing bookings: both carry the sentence the server wrote,
  // naming the couple and the date, which is more useful than any generic one.
  BOOKING_IMPORT_INVALID: (detail) =>
    detail || "Something about this booking needs fixing before it can be imported.",
  BOOKING_ALREADY_IN_STUDIOCUE: (detail) =>
    detail
      ? `${detail} Open that job instead of importing it again.`
      : "This booking is already in StudioCue. Open that job instead of importing it again.",
  // Reachable only if a turn is reported after its record has gone, or from a
  // stale tab. Nothing is lost but the report itself.
  // A studio turning its own AI off, not a fault. Says who can undo it.
  AI_PAUSED_BY_STUDIO: () =>
    "AI features are switched off for this studio. An owner can turn them back on in Studio settings.",
  // The day's burst cap, not the month's allowance — so the wording has to
  // make clear that waiting fixes it and nothing has been lost.
  AI_DAILY_QUOTA_EXCEEDED: () =>
    "That is today's AI limit reached. It resets overnight, and your monthly allowance is unaffected.",
  INTERACTION_NOT_FOUND: () =>
    "That answer is no longer on file, so the report could not be attached to it.",
  INVALID_COMMAND: (detail) =>
    detail
      ? `Check ${detail} — that value wasn't accepted.`
      : "Something on this form wasn't accepted. Check the values and try again.",
  // The reconciler knows which requirements are outstanding; it used to say
  // "something on the closeout list is still open" and send the studio to go
  // and find out.
  CLOSEOUT_BLOCKED: (detail) =>
    detail
      ? `Still open: ${detail}. Vouch for anything that happened off StudioCue.`
      : "Something on the closeout list is still open. Reconcile the evidence to see which.",
  DEPENDENCIES_INCOMPLETE: (detail) =>
    detail
      ? `Settle "${detail}" first — this step waits on it.`
      : "Another step has to be settled before this one.",
};

/** True when a message is safe, human-authored copy rather than a code or dump. */
const looksHumanWritten = (message: string) =>
  message.length > 0 &&
  message.length <= 200 &&
  !message.includes("{") &&
  !message.includes("[") &&
  !/^[A-Z0-9_:.]+$/.test(message) &&
  /[a-z]/.test(message);

export function friendlyAiError(
  caught: unknown,
  fallback = "We couldn't draft this. Try again.",
): string {
  const message = caught instanceof Error ? caught.message : String(caught ?? "");
  const [rawCode, ...rest] = message.split(":");
  const code = rawCode?.trim() ?? "";
  // Everything after the first colon, so a detail may itself contain one.
  const detail = rest.join(":").trim();
  const detailed = DETAILED_BY_CODE[code];
  if (detailed) return detailed(detail);
  if (FRIENDLY_BY_CODE[code]) return FRIENDLY_BY_CODE[code];
  for (const [pattern, copy] of FRIENDLY_BY_PHRASE)
    if (pattern.test(message)) return copy;
  for (const [pattern, copy] of PREFIX_FALLBACKS)
    if (pattern.test(code)) return copy;
  if (looksHumanWritten(message)) return message;
  return fallback;
}

/**
 * Whether this code resolves to copy a studio can read, or falls through to
 * whatever generic sentence the calling form happened to pass.
 *
 * Exported for `tests/error-copy-coverage.test.ts`, which holds the rule that
 * every failure a person can trigger says what went wrong. It answers with the
 * *same* logic `friendlyAiError` uses — the code maps and the prefix
 * fallbacks — rather than a second list that would drift from it. A test that
 * re-implemented the lookup could pass while the product still said
 * "Try again".
 */
export function errorCodeHasCopy(code: string): boolean {
  if (Object.hasOwn(DETAILED_BY_CODE, code)) return true;
  if (Object.hasOwn(FRIENDLY_BY_CODE, code)) return true;
  return PREFIX_FALLBACKS.some(([pattern]) => pattern.test(code));
}

/**
 * Same rules, general name. Non-AI surfaces (booking evidence, records
 * panels) show these notices too and must not leak plumbing either.
 */
export function friendlyError(
  caught: unknown,
  fallback = "Something went wrong. Try again.",
): string {
  return friendlyAiError(caught, fallback);
}
