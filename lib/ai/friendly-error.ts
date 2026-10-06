import { projectStateLabel } from "@/features/projects/state-label";

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
  CONSULTATION_NOT_CANCELLABLE: "That consultation can't be canceled — it has already happened or been canceled.",
  CONSULTATION_NOT_COMPLETABLE: "That consultation can't be written up — it was canceled.",
  CONSULTATION_NOT_FOUND: "That consultation isn't there any more. Refresh and try again.",
  CONSULTATION_NOT_RESCHEDULABLE: "Only a consultation still to come can be moved.",
  INVALID_TIME_RANGE: "The end time has to be after the start time.",
  INVITATION_NOT_REVOCABLE: "That invitation can't be withdrawn — it has already been accepted, expired or withdrawn.",
  CLIENT_NOT_ASSOCIATED_WITH_PROJECT: "That client isn't on this job. Add them to the job first.",
  CLIENT_OR_PROJECT_NOT_FOUND: "That client or job isn't there any more. Refresh and try again.",
  // Every booking action can hit this (optimistic concurrency on the job).
  // The page is holding the old version, so "try again" alone repeats the
  // refusal; the booking page offers Refresh beside it (wave 3).
  PROJECT_VERSION_CONFLICT: "Someone changed this job a moment ago — refresh and try again.",
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
  // Thrown when the accepted proposal and its package both ask for no
  // retainer. "Check the package" pointed at something locked once the
  // agreement is out; the way through is to waive it (wave 3).
  RETAINER_AMOUNT_NOT_FOUND:
    "This booking has no retainer to record — the accepted proposal asks for none. If you're booking without one, use \"Booking without a retainer? Waive it\" on the booking page.",
  TASK_NOT_FOUND: "That task isn't there any more. Refresh and try again.",
  REVIEW_REQUEST_NOT_FOUND: "That review request isn't there any more. Refresh and try again.",
  CONVERSATION_NOT_FOUND: "That conversation isn't there any more. Refresh and try again.",
  RECIPIENT_UNKNOWN: "There's no email address to send this to. Add one to the client first.",
  PROJECT_CONTACT_REQUIRED: "That person isn't a client on this job.",
  NO_PACKAGE_CHANGES: "Nothing about the package changed, so there was nothing to save.",
  CREW_ALREADY_HAS_ACCOUNT: "They already have a crew account, so there's nothing to invite them to.",
  PROVIDER_NOT_CONNECTED: "That app isn't connected yet. Connect it under Integrations first.",
  OAUTH_PROVIDER_NOT_CONFIGURED: "That app can't be connected yet.",
  APPLE_CALENDAR_AUTH_FAILED:
    "iCloud didn't accept that Apple ID and app-specific password. Check the email, make a new app-specific password, and try again.",
  APPLE_APP_PASSWORD_FORMAT:
    "That isn't an app-specific password. It looks like abcd-efgh-ijkl-mnop — make one at account.apple.com, under Sign-In and Security. Don't use your Apple ID password.",
  APPLE_ID_INVALID: "Enter the email address you sign in to iCloud with.",
  APPLE_CALENDAR_NO_CALENDARS:
    "That iCloud account has no calendars StudioCue can read. Turn on Calendars in iCloud settings, then try again.",
  APPLE_CALENDAR_DISCOVERY_FAILED: "iCloud didn't answer as expected. Try again in a minute.",
  APPLE_CALENDAR_USES_APP_PASSWORD:
    "Apple Calendar connects with an app-specific password. Use the form on its card under Integrations.",
  CHECKPOINT_NOT_FOUND: "That readiness item isn't there any more. Refresh and try again.",
  MEMBER_NOT_EDITABLE: "That person's access can't be changed here — the owner's can't, and neither can your own.",
  INTERNAL_USER_LIMIT_REACHED: "Your plan has no seats left. Remove someone or change your plan first.",
  INVITATION_ALREADY_PENDING: "They already have an invitation waiting. Withdraw it to send a new one.",
  // The couple's questionnaire (planningCommand saveQuestionnaire).
  QUESTIONNAIRE_ALREADY_SUBMITTED:
    "You've already sent this to your studio. Message them if you'd like to change an answer.",
  RESPONSE_NOT_FOUND: "This questionnaire couldn't be found. Refresh and try again.",
  // Sending a questionnaire (planningCommand assignQuestionnaire): the job
  // or the form is gone, or the form is a draft or archived.
  QUESTIONNAIRE_ASSIGNMENT_INVALID:
    "That form can't be sent: it isn't active, or the job or form isn't there any more. Activate the form in the questionnaire library, then refresh and try again.",
  // The studio's side of a questionnaire after it went out (planningCommand
  // reopen/withdraw/resendQuestionnaire). QUESTIONNAIRE_WITHDRAWN can reach
  // the couple too, so it is worded for either.
  QUESTIONNAIRE_WITHDRAWN: "This questionnaire was withdrawn by the studio, so it can't be changed or sent.",
  QUESTIONNAIRE_ALREADY_REOPENED: "This questionnaire is already open for the couple to change.",
  QUESTIONNAIRE_NOT_RETURNED: "Only a questionnaire the couple has sent back can be reopened.",
  QUESTIONNAIRE_NOT_WITHDRAWABLE:
    "The couple has already sent this questionnaire back, so it can't be withdrawn. Edit their answers or reopen it instead.",
  QUESTIONNAIRE_ALREADY_RETURNED:
    "The couple has already sent this questionnaire back, so there's nothing to remind them about. Reopen it if they need to change an answer.",
  // Recording the couple's answer on a timeline (approveSchedule from the studio).
  SCHEDULE_SUPERSEDED: "A newer version of this timeline exists. Record their answer on the current one.",
  SCHEDULE_ALREADY_APPROVED: "The couple has already approved this version.",
  SCHEDULE_ANSWER_DETAILS_REQUIRED: "Say who gave the answer, how and when, then record it.",
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
  NOTHING_TO_CHANGE:
    "Nothing would change. Pick a new date, add or remove a package or extras, or write a one-off package.",
  AMENDMENT_NOT_FOUND: "That change isn't there any more. Refresh to see the booking as it stands.",
  // sendAmendment on a change that is already out; a withdrawn or signed one
  // has its own code below.
  AMENDMENT_NOT_DRAFT:
    "This change is already signed for the studio and with the couple. To nudge them, use Send it again on Change the booking.",
  AMENDMENT_WITHDRAWN:
    "That change was withdrawn, so it can't be sent or signed. Write up a new one on Change the booking if the booking still needs to change.",
  AMENDMENT_NOT_SENT:
    "This change hasn't gone to the couple yet. Sign it for the studio and send it first.",
  AMENDMENT_NOT_SIGNED:
    "The couple hasn't signed this change yet, so there's nothing to apply. It goes through as soon as they sign.",
  AMENDMENT_APPLY_FAILED:
    "The signed change still couldn't be applied, so the booking hasn't changed yet. Try again in a few minutes; if it keeps failing, contact support and we'll put it through.",
  // sendAmendment's own causes. These used to throw the contract's codes,
  // whose copy named steps a change doesn't have ("reissue the proposal").
  AMENDMENT_CHANGED:
    "The change was written up again while you were reading it. Read it once more, then sign and send.",
  AMENDMENT_FIELDS_MISSING:
    "Some details in the amended agreement are blank — a field on your agreement the job's records can't fill. Add it to the job (or to your agreement), then use Change it to write the change up again.",
  AMENDMENT_CLIENT_EMAIL_REQUIRED:
    "The couple has no email address on file, so the change has nowhere to go. Add one to their contact, then write the change up again.",
  AMENDMENT_RECORD_ONLY:
    "Signing in StudioCue isn't switched on for your studio, so record the couple's signature once they've signed it another way.",
  AMENDMENT_STALE:
    "The job changed after this was written up. Write the change up again so the couple signs what's true now.",
  // Not "being applied now": a signed change whose apply failed stayed signed
  // for good, and this told the studio to wait for something that wasn't
  // happening.
  AMENDMENT_ALREADY_SIGNED:
    "The couple has already signed this change, so it can't be withdrawn. If the booking hasn't taken it yet, open Change the booking and use Apply it again.",
  // The void it names exists since the money audit (wave 1): "Void this
  // invoice" on the booking page and on Invoices.
  INVOICE_ALREADY_RAISED:
    "An invoice has already been raised for the current total. Use \"Void this invoice\" on the job's Booking tab or on Invoices, then change the packages.",
  // Voiding a bill, correcting a payment (bookingCommand voidInvoice /
  // correctPaymentRecord / approveFinalInvoice).
  INVOICE_NOT_FOUND: "That invoice isn't there any more. Refresh and try again.",
  INVOICE_NOT_VOIDABLE: "That invoice is already voided, replaced or refused, so there's nothing to void.",
  INVOICE_HAS_PAYMENT:
    "Money has been paid on this invoice, so it can't be voided. If that payment was recorded by mistake, correct the payment instead; if it's real, refund it where it was paid.",
  INVOICE_VOID_PERMISSION_REQUIRED: "Only the studio's owners and admins can void an invoice.",
  PAYMENT_CORRECTION_PERMISSION_REQUIRED: "Only the studio's owners and admins can correct a payment.",
  PAYMENT_NOT_STUDIO_RECORDED:
    "This payment came from your invoicing app, so correct it there. StudioCue follows what it reports.",
  PAYMENT_AMOUNT_INVALID: "Enter the amount that actually arrived, in dollars and cents.",
  PAYMENT_EXCEEDS_INVOICE: "That's more than this invoice was for. Enter what was paid against it.",
  PARTIAL_PAYMENT_AT_PROVIDER:
    "This invoice lives in your invoicing app, which never saw this payment, so correct it to the full amount or to nothing paid. If only part arrived, correct it to nothing, then use Record a payment for what did — that records it in your invoicing app too.",
  // Recording a payment against a bill (bookingCommand recordInvoicePayment).
  PAYMENT_RECORD_PERMISSION_REQUIRED: "Only the studio's owners and admins can record a payment.",
  INVOICE_NOT_PAYABLE:
    "That invoice is already paid, voided or replaced, so there's nothing to record a payment against. Refresh to see where it is.",
  INVOICE_NOT_BILLED_YET:
    "That invoice hasn't reached the couple yet — it's still being created or held for review. Record the payment once it's out.",
  INVOICE_NOTHING_OWED: "Nothing is left to pay on that invoice.",
  PAYMENT_EXCEEDS_BALANCE: "That's more than is left to pay on this invoice. Enter what arrived, up to the balance.",
  FINAL_INVOICE_NOT_IN_REVIEW: "That final bill isn't waiting for review any more. Refresh to see where it is.",
  FINAL_AMOUNT_CHANGED:
    "The balance changed since this page loaded — a payment was recorded or a bill changed. Refresh and check the new amount before sending.",
  // A bill held in QuickBooks for the studio to check (bookingCommand sendHeldInvoice).
  INVOICE_HELD_FOR_TAX_CHECK:
    "This bill is already in QuickBooks, waiting for you to check the tax. Use Send with tax or Send without tax on it.",
  INVOICE_SEND_PERMISSION_REQUIRED: "Only the studio's owners and admins can send a bill held for review.",
  INVOICE_NOT_HELD: "That bill isn't waiting for you any more — it's been sent, voided or replaced. Refresh to see where it is.",
  INVOICE_ACTION_IN_PROGRESS: "QuickBooks is still working on your last choice for this bill. Give it a moment, then refresh.",
  RETAINER_HAS_NO_TAX: "A retainer never carries sales tax, so it's only ever sent as it stands.",
  BILLING_ADDRESS_NEEDED_FOR_TAX:
    "QuickBooks had no billing address to work the tax out from. Ask the couple for it, or add it on their client record and use Work the tax out again — or send it without tax.",
  QUESTIONNAIRE_TEMPLATE_INVALID:
    "A question is set to show, or suggest a time, from one that comes after it. Move it below that question or clear the rule.",
  DETAILS_LOCKED:
    "The final details have locked, so a change to a location or time goes to the studio as a request.",
  DETAILS_NOT_LOCKED: "The details aren't locked yet, so this can simply be changed on the form.",
  FIELD_NOT_LOCKABLE: "That answer isn't a location or time, so it can be changed directly.",
  DETAIL_CHANGE_UNCHANGED: "That's the same as what's on the form already.",
  DETAIL_CHANGE_NOT_FOUND: "That change request couldn't be found. Refresh to see where it stands.",
  DETAIL_CHANGE_NOT_PENDING: "That change was already answered. Refresh to see where it stands.",
  FINAL_DETAILS_CHANGED: "Something was updated since this opened. Here it is again — please check it once more.",
  FINAL_DETAILS_NOT_FOUND: "There are no final details to confirm yet.",
  FINAL_DETAILS_NAME_REQUIRED: "Type your full name to confirm.",
  CONSULTATION_PREP_STALE:
    "That call has moved or already happened, so this note isn't sent. A new one is prepared for the new time.",
  BILLING_ADDRESS_INVALID: "Check the street, city, state and ZIP code, then save it again.",
  BILLING_ADDRESS_NOT_ASKED: "Your studio doesn't need a billing address from you any more, so there's nothing to save.",
  BILLING_ADDRESS_CONTACT_NOT_FOUND:
    "We couldn't match your sign-in email to this booking. Reply to your studio's email with your billing address instead.",
  BILLING_ADDRESS_ON_FILE:
    "Their billing address is already on their client record, so there's nothing to ask. If a bill is waiting, use Work the tax out again.",
  BILLING_ADDRESS_REQUEST_PERMISSION_REQUIRED: "An owner or admin asks the couple for their billing address.",
  PROJECT_CANCELLED: "This job was called off, so StudioCue won't write to the couple about it.",
  CLIENT_EMAIL_MISSING: "There's no email on this couple's client record to send the request to. Add one, then ask again.",
  HELD_INVOICE_AMOUNT_CHANGED:
    "The bill changed since this page loaded. Refresh and check the new figures before sending.",
  // Editing a job's date (crmCommand updateProject).
  EVENT_DATE_LOCKED_AFTER_SIGNING:
    "The couple has signed, so the date is part of their agreement. Change it with \"Change the booking\" on the job, so the contract, crew invites and bills move with it.",
  EVENT_DATE_LOCKED_AGREEMENT_OUT:
    "The agreement out for signature states the current date. Withdraw it on the Booking tab first, then change the date and send it again.",
  PACKAGE_ALREADY_SELECTED:
    "This job already has a package. Open its proposal and use Packages to add another or swap it.",
  PACKAGE_ALREADY_ON_JOB: "That package is already on this job.",
  // createOneOffPackage: a package written for one couple (2026-10-01).
  ONE_OFF_PACKAGE_NEEDS_OWNER:
    "Only the studio owner or an admin can write a one-off package, because it sets a price. Ask one of them to add it.",
  ONE_OFF_PACKAGE_NEEDS_DETAIL:
    "Say what's included — one item per line, a little more than a word or two. Each line becomes a bullet on the proposal.",
  // updateOneOffPackage on a package that is (now) in the Library.
  NOT_THIS_JOBS_ONE_OFF:
    "That package is in your Library now, so it's edited there — and a Library edit doesn't change a price a couple was already quoted. Refresh to see it.",
  PACKAGE_CHANGE_NEEDS_APPROVER:
    "This job has a proposal priced from its packages, so an owner or admin changes them — the proposal is re-priced at the same time.",
  AGREEMENT_CHANGED_SINCE_PREPARED:
    "Your agreement changed since this contract was prepared. Update it so it uses your current wording, read it again, then sign and send.",
  // decideAiAction on work that is missing a decision only a person can make.
  AI_ACTION_HAS_BLOCKING_ISSUES:
    "This needs a decision from you first — StudioCue couldn't pick the package. Choose it on the booking brief and the draft follows.",
  AI_ACTION_NOT_APPROVED: "Approve this first, then it can go ahead.",
  // decideAiAction on work already decided — a second tap, a second tab. The
  // server refuses rather than send the couple the same email twice.
  AI_ACTION_ALREADY_DECIDED:
    "Already done — this was approved or put away a moment ago, so nothing was sent again.",
  // Cancel / Retry on a receipt in the AI queue (aiQueueCommand).
  ACTION_RECEIPT_NOT_FOUND: "That receipt isn't there any more. Refresh to see the latest.",
  ACTION_RECEIPT_NOT_CANCELLABLE: "That has already run or been canceled, so there's nothing to cancel.",
  ACTION_RECEIPT_NOT_RETRYABLE: "That can't be run again from here. Open the job to do it by hand.",
  // Retry / Leave it on Today's "An email did not send" card.
  EMAIL_JOB_NOT_FOUND: "That email isn't there any more. Refresh and try again.",
  EMAIL_JOB_NOT_RETRYABLE:
    "That email has already gone out, or is on its way, so there's nothing to retry.",
  // Undo on a just-sent reply (communicationsCommand cancelQueuedEmail).
  EMAIL_ALREADY_SENT: "Too late to undo — it has already gone. It shows in the thread.",
  EMAIL_NOT_UNDOABLE: "That email can't be called back. Only a message sent a moment ago can be undone.",
  EMAIL_UNDO_NOT_ALLOWED: "Only the person who sent it, or an owner or admin, can call it back.",
  // "Prepare the brief again" on the booking page (bookingCommand rerunBookingBrief).
  BOOKING_BRIEF_MOOT:
    "The proposal has already gone to the couple, or the job has moved on to it, so the brief no longer decides anything. Change the proposal instead.",
  BOOKING_BRIEF_ALREADY_PREPARING: "The brief is already being prepared. It will appear in a moment.",
  CONSULTATION_NOT_COMPLETED: "Write up the consultation first — the brief is prepared from its notes.",
  PACKAGE_REQUEST_NOT_AVAILABLE:
    "Your booking can't take another package right now — your agreement may already be on its way. Please message your studio.",
  // Sending the final bill by hand (bookingCommand sendFinalBalance).
  FINAL_INVOICE_ALREADY_OUT:
    "A final bill is already out for this job. Open Invoices to see where it is — void it there if it's wrong, then send a new one.",
  NOTHING_OWED: "Nothing is left to pay on this job, so there's no final bill to send.",
  FINAL_NEEDS_RETAINER_RECORD:
    "There's no retainer on this job, paid or waived, so the balance can't be worked out. If the couple paid one, record it on the booking page. If you're going ahead without one, record the balance as paid another way or bill it from your invoicing app.",
  FINAL_NO_PACKAGE: "This job has no package, so there's no total to bill against.",
  INVOICING_NOT_CONNECTED:
    "Connect QuickBooks or Stripe in Integrations to send the bill from StudioCue, or record the balance as paid another way.",
  FINAL_INVOICE_NOT_RAISED: "The final bill couldn't be raised. Open the job's invoices to check what's outstanding.",
  DATE_IN_PAST: "That date has already passed. Choose a date that's still to come.",
  PACKAGE_REQUEST_NOT_FOUND: "That request isn't there any more. Refresh and try again.",
  PACKAGE_LIMIT_REACHED: "A job can hold four packages at most. Remove one before adding another.",
  ADD_ON_NOT_FOUND: "That extra isn't in your library any more. Refresh and choose again.",
  CUSTOM_ADD_ON_INCOMPLETE: "Give the extra a name and a price.",
  PROPOSAL_IN_BOOKING_AGREEMENT: "This proposal went out inside a booking agreement. Withdraw the agreement on the job's Booking tab first, then change or resend the proposal.",
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
  // The studio's event form on that link (functions/src/intake/inquiry-form.ts).
  INQUIRY_FORM_REQUIRED: "Please fill out the studio's form first — they'd like your answers before the call.",
  PHONE_NUMBER_REQUIRED: "Add the best number to call you, so the studio can reach you at that time.",
  INQUIRY_FORM_INCOMPLETE: "A few questions marked Required still need an answer.",
  INQUIRY_FORM_NOT_AVAILABLE: "This form isn't available any more. You can go ahead and pick a time.",
  QUICKBOOKS_PAYMENTS_NOT_GRANTED:
    "QuickBooks hasn't given StudioCue permission to take payments yet. Reconnect QuickBooks for payments first. Your QuickBooks Payments application needs to be approved before that works.",
  AUTOPAY_UNAVAILABLE:
    "Saving a card isn't available for this booking right now. You can still pay with the invoice link.",
  PAYMENT_METHOD_NOT_FOUND:
    "That card is no longer saved. Refresh the page to see your payment details.",
  // A studio the StudioCue team suspended (Console → Suspend).
  STUDIO_SUSPENDED:
    "Your studio is paused by the StudioCue team, so this can't be done right now. Reply to our email or write to support@studio-cue.com.",
  // The StudioCue Console (functions/src/console/handlers). Read by the team.
  ACTION_LINK_NOT_ALLOWED: "Email buttons can only link into StudioCue. Choose one of the listed pages.",
  ALREADY_COMPED: "This studio is already comped.",
  ALREADY_SUSPENDED: "This studio is already suspended.",
  ASSIGNEE_NOT_ADMIN: "That person isn't a Console admin, so they can't be given this.",
  CANNOT_DISABLE_OWNER: "A Console owner's account can't be disabled from here.",
  CANNOT_TARGET_YOURSELF: "You can't do this to your own account. Ask another owner.",
  CODE_NOT_FOUND: "That code isn't there any more. Refresh the list.",
  CODE_TAKEN: "That code already exists in Stripe. Choose another.",
  COMPLETED_EXPORT_REQUIRED: "This studio's data export hasn't finished yet. Approve the deletion once it has.",
  COMP_END_MUST_BE_FUTURE: "Pick an end date after today, or choose no end date.",
  CONFIRMATION_NAME_MISMATCH: "The name you typed doesn't match the studio's name. Type it exactly as shown.",
  CONSOLE_COMMANDS_NOT_CONFIGURED: "Console actions aren't connected in this environment (no SaaS admin Functions URL). Nothing was changed.",
  CONSOLE_COMMAND_FAILED: "That didn't go through. Nothing was changed. Try again, and check Jobs or the logs if it keeps failing.",
  COUPON_NOT_STUDIOCUE: "That discount isn't one of StudioCue's, so it can't be applied here.",
  COUPON_NOT_VALID: "That discount has expired or been used up in Stripe. Pick another.",
  DELETION_REQUEST_NOT_APPROVABLE: "This deletion request isn't waiting for approval any more. Refresh to see where it stands.",
  EMAIL_ALREADY_VERIFIED: "Their email is already verified.",
  FEATURE_IS_LIVE: "That feature is in use by the product, so it can't be archived.",
  FEATURE_ON_FOR_ALL: "This feature is on for every studio. Switch it to Some studios first.",
  FEEDBACK_NO_CONTACT: "They asked not to be contacted about this feedback. Add an internal note instead.",
  FEEDBACK_NO_EMAIL: "There's no email address on this feedback to reply to.",
  FLAG_NOT_FOUND: "That flag isn't there any more.",
  ISSUE_NOT_FOUND: "That issue isn't there any more. Refresh and try again.",
  JOB_NOT_FOUND: "That job isn't there any more. Refresh the list.",
  JOB_NOT_RERUNNABLE: "That job isn't in a failed state any more, so there's nothing to rerun.",
  MEMBERSHIP_IDENTITY_MISMATCH: "Your membership on that studio belongs to another account. It needs fixing by hand.",
  MEMBERSHIP_REQUIRES_MANUAL_REVIEW: "Your membership on that studio isn't an active owner seat. It needs fixing by hand.",
  MERGE_SAME_ISSUE: "Pick a different issue to merge into.",
  NETWORK_UNAVAILABLE: "StudioCue couldn't be reached. Check your connection and try again.",
  NOTE_NOT_FOUND: "That note isn't there any more.",
  NOTE_NOT_YOURS: "Only the person who wrote a note, or a Console owner, can archive it.",
  NOT_COMPED: "This studio isn't comped.",
  NOT_SUSPENDED: "This studio isn't suspended.",
  NO_DISCOUNT: "This studio has no discount to remove.",
  NO_RECIPIENTS: "None of those studios has an owner email on record, so nothing was sent.",
  NO_STRIPE_SUBSCRIPTION: "This studio has no Stripe subscription yet.",
  OWNER_EMAIL_MISSING: "This studio's owner has no email on record.",
  OWNER_RECOVERY_NOT_ALLOWED: "You can only restore your own owner seat on a studio you created.",
  PERSON_HAS_NO_EMAIL: "This account has no email address.",
  PERSON_NOT_FOUND: "There's no account with that id or email.",
  PLAN_UNCHANGED: "That's the plan they're already on.",
  REPLACE_TAGS_ONE_STUDIO: "Tags can be replaced on one studio at a time. Use Add tags for several.",
  STRIPE_SUBSCRIPTION_ITEM_MISSING: "Stripe returned a subscription with no plan on it. Open it in Stripe to check.",
  STUDIO_IS_COMPED: "This studio is comped. End the comp first.",
  SUBSCRIPTION_NOT_EXTENDABLE: "A past-due or canceled subscription can't be given more trial time.",
  SUBSCRIPTION_NOT_FOUND: "This studio has no subscription record.",
  SUPPORT_ACCESS_NOT_ACTIVE: "That support session has already ended.",
  SUPPORT_ACCESS_REQUIRED: "Start a support session for this studio first.",
  SUPPORT_SUMMARY_FAILED: "The support summary couldn't be loaded. Try again.",
  TRIAL_END_MUST_BE_FUTURE: "Pick a trial end after today.",
  TRIAL_END_TOO_FAR: "Stripe allows a trial of up to two years from today.",
  ACTIVE_SUBSCRIPTION_REQUIRED:
    "Your trial hasn't started yet. Add a card under Studio settings → Subscription to start it, then try again. If your subscription lapsed, update your card there to reactivate.",
  GROUP_EVENT_NOT_ENABLED: "Turn on the roster for this job first.",
  PARTICIPANT_NOT_FOUND: "That person isn't on this roster any more. Refresh the page.",
  PARTICIPANT_PAID: "They've already paid, so they can't be canceled here. Refund them where you took the payment, then edit their entry.",
  PARTICIPANT_ALREADY_PAID: "Their payment is already recorded.",
  PARTICIPANT_CANCELLED: "They're canceled. Restore them first.",
  PARTICIPANT_EMAIL_REQUIRED: "Add their email to send a receipt, or record the payment without one.",
  SUBSCRIPTION_READ_ONLY:
    "This studio is read-only until billing is updated, so nothing can be sent or changed. The studio owner can update the card under Studio settings → Subscription; everything picks up again once payment goes through.",
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
  QUICKBOOKS_REALM_MISSING:
    "StudioCue doesn't know which QuickBooks company to use. Disconnect QuickBooks in Integrations and connect it again.",
  SALES_TAX_PERMISSION_REQUIRED: "Only a studio owner or admin can change whether a job is charged sales tax.",
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
  // A command endpoint's unexpected failure (functions/src/security/
  // command-errors.ts): logged server-side with its stack, never described to
  // the browser. Nothing the studio did caused it.
  INTERNAL:
    "Something went wrong on our side. It's been logged — please try again in a minute.",
  // The command endpoints' own identity refusals (functions/src/crm/
  // security.ts). Onboarding showed these raw (launch plan 2.5).
  AUTHENTICATION_REQUIRED: "Your session ended — sign in again, then try once more.",
  VERIFIED_EMAIL_REQUIRED: "Verify your email first — open the link we emailed you, then try again.",
  RATE_LIMITED: "That's a lot of tries in a short time. Wait a minute, then try again.",
  INVALID_COVERAGE_RANGE: "Coverage must end after it starts.",
  // A role refusal: every crmCommand FORBIDDEN is about who the person is in
  // the studio, not about a job — this used to say "for the selected project"
  // on screens that had none selected.
  FORBIDDEN: "You don't have permission to do this in this studio. Ask the studio owner or an admin.",
  // The Feedback button (functions/src/feedback).
  SCREENSHOT_INVALID: "The screenshot couldn't be sent. Remove it and try again.",
  SCREENSHOT_TOO_LARGE: "The screenshot is too large to send. Remove it, or attach a smaller image.",
  FEEDBACK_NOT_FOUND: "That feedback isn't there any more. Refresh the list.",
  PROJECT_ACCESS_DENIED:
    "This job isn't one you have access to. Ask the studio owner or an admin to add you to it, or to make the change.",
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
  // There was no "withdraw" anywhere when this said "settle or withdraw it",
  // so the studio was told to do something the product could not do.
  CREW_HAS_OPEN_ASSIGNMENT:
    "This collaborator still holds an assignment: they are booked on, or have an offer out for, a job. Open that job, choose Withdraw on their row under Your crew (they're emailed if they had accepted), then archive them.",
  ASSIGNMENT_NOT_WITHDRAWABLE:
    "That assignment is already over — declined, expired, withdrawn or completed — so there is nothing to withdraw.",
  ASSIGNMENT_NOT_FOUND:
    "That assignment is no longer on this job. Refresh to see who is on it now.",
  PROJECT_HAS_LIVE_CREW:
    "Someone is still waiting on this job — an offer out, or crew who said yes. Open the job to see who: Archive job and Delete this job permanently both list them and can withdraw them in the same step. Cancel it instead if the wedding is off.",
  CREW_IDENTITY_OWNED_BY_MEMBER:
    "They have their own account now, so their name and email are theirs to change. You can still update rate, specialties and areas.",
  CONTACT_NOT_FOUND: "That client record could not be found.",
  // Wave 3: undo. Each says what is in the way and what to do about it.
  CONTACT_ARCHIVED: "This client is archived. Restore them first, then edit their details.",
  NO_TASK_CHANGES: "Nothing about the task changed, so there was nothing to save.",
  TASK_CANCELLED: "That task was canceled. Reopen it first if it still needs doing.",
  TASK_ALREADY_COMPLETE: "That task is already done. Reopen it first to change it.",
  TASK_NOT_SETTLED: "That task is still open, so there's nothing to reopen.",
  TASK_ASSIGNEE_INVALID: "That person isn't an active member of your team. Pick someone who is, or a role.",
  CHECKPOINT_NOT_RESOLVED: "That readiness item isn't marked done or waived, so there's nothing to reopen.",
  PROPOSAL_NOT_ACCEPTED: "That proposal isn't accepted, so there's no acceptance to undo.",
  ACCEPTED_BY_SIGNING:
    "The couple accepted this by signing the booking agreement. Withdraw the agreement on the job's Booking tab instead.",
  PROJECT_PAST_ACCEPTANCE:
    "This job has moved on past the agreement, so its acceptance can't be undone. Use Change the booking, or cancel the job.",
  AGREEMENT_OUT_WITHDRAW_FIRST:
    "The agreement has already gone to the couple on the strength of this acceptance. Withdraw it on the job's Booking tab first, then undo the acceptance.",
  CONSULTATION_NOT_MARKABLE: "Only a booked consultation can be marked as missed.",
  CONSULTATION_NOT_STARTED: "That consultation hasn't started yet, so nobody has missed it.",
  CONSULTATION_NOT_REOPENABLE: "Only a consultation marked as held or missed can be reopened.",
  PROJECT_PAST_CONSULTATION:
    "This job has moved on past the consultation, so the consultation can't be reopened.",
  COI_NOTHING_CORRECTED: "Change the venue's details or the agent's email first — nothing was different to send.",
  COI_NOT_RESENDABLE: "This certificate isn't at a point where it can be sent again. Refresh to see where it is.",
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
    "Say why the job is on hold or canceled — at least a short sentence, so it makes sense later.",
  EVIDENCE_CONTROLLED_TRANSITION:
    "This step needs the record behind it, not a stage change — the job page links to where to enter it.",
  VERSION_CONFLICT:
    "Someone else changed this job while you were looking at it. Refresh and try again.",
  // Going back (Wave 3): undoing a cancel, reopening a finished job.
  OWNER_ONLY_MOVE:
    "Only the studio owner can undo a cancel or reopen a finished job, because it changes what the crew and the couple were told.",
  NOT_CANCELLED: "This job isn't canceled, so there's nothing to undo.",
  // The couple's proposal on a job the studio has paused or stopped.
  PROJECT_ON_HOLD:
    "This booking is on hold with the studio right now, so the proposal can't be accepted. Message the studio to pick it back up.",
  PROJECT_NOT_ACTIVE:
    "This booking is no longer active, so the proposal can't be accepted. Message the studio if you'd like to talk about it.",
  UNCANCEL_ORIGIN_UNKNOWN:
    "This job was canceled before StudioCue recorded where it stood, so it can't be brought back here. Create a new job for the couple instead.",
  UNCANCEL_WINDOW_PASSED:
    "A cancel can be undone for 30 days, and this one is older. Create a new job for the couple instead.",
  INQUIRY_NOT_DISMISSED: "This inquiry wasn't marked \u201cnot an inquiry\u201d, so there's nothing to restore.",
  LEAD_NOT_FOUND: "That inquiry isn't there any more. Refresh and try again.",
  HOLD_RESUME_NOT_ALLOWED:
    "A job on hold goes back to the stage it was held from. If it was booked, bring it back through the booking page so the signature and retainer are checked again.",
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
    "Cue isn't available for this workspace yet. Everything it reads is on the job itself.",
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
  COI_SELF_SERVE_UPLOAD_CORRECTION:
    "You make this certificate in your insurer's portal, so there's no agent to send it back to. Upload the corrected PDF instead.",
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
    "Nothing can be released until the cards are backed up. Check \"Cards backed up\" on this job's post-production checklist first.",
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
    "An album can't jump backwards. To undo the last step, use \"Put back\" on the album.",
  ALBUM_NOTHING_TO_UNDO:
    "This album is at its first step, so there is nothing to put back.",
  // Wave 2 corrections: a wrong link, an unticked step.
  DELIVERY_NOT_FOUND:
    "That delivery is no longer on this job. Refresh to see what was sent.",
  DELIVERY_ALREADY_REPLACED:
    "That link has already been replaced. Refresh to see the corrected one.",
  DELIVERY_LINK_UNCHANGED:
    "That's the link the couple already has. Paste the right one.",
  POST_PRODUCTION_STEP_NOT_UNDOABLE:
    "That step is set by another part of StudioCue, so it can't be unchecked here.",
  POST_PRODUCTION_STEP_NOT_COMPLETE:
    "That step isn't checked. Refresh to see the checklist as it is.",
  POST_PRODUCTION_BACKUP_RELEASED:
    "Something has already been released against this backup, so it stays checked.",
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
  // Thrown when the job isn't at "Contract pending": before the proposal is
  // accepted, or after the agreement is already signed.
  CONTRACT_NOT_READY:
    "This job isn't waiting for its agreement. An agreement goes out after the couple accepts the proposal and before it's signed — refresh the job to see which step it's on.",
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
    "This job already has an agreement out for signature. Open the Booking tab: withdraw that one first if it needs to change, or send it again to remind them.",
  CONTRACT_NOT_AWAITING_SIGNATURE:
    "This agreement isn't waiting for their signature any more — it was signed or withdrawn. Refresh the Booking tab to see where it stands.",
  AGREEMENT_PRICES_EXPIRED:
    "The prices in this booking agreement have passed their date, so the couple can't sign it. Withdraw it, and send a new one from the proposal.",
  SIGNED_COPY_NOT_EXPECTED:
    "Only an agreement the couple signed in StudioCue has a signed copy to make. Refresh the Booking tab.",
  // The couple's side of a withdrawn booking change (server/contracts/amendment-signing.ts).
  CHANGE_WITHDRAWN:
    "Your studio withdrew this change, so there's nothing to sign. Your booking stands exactly as it was.",
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
    "Type your name and check the box to let StudioCue sign and send for you.",
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
  CONSENT_REQUIRED: "Check the box to agree to sign electronically.",
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
  // A reply that wasn't JSON — usually an HTML error page from in front of
  // the function (an invoker 403, a timeout). The parser's own sentence
  // ("Unexpected token '<', \"<!DOCTYPE \"...") reads as prose but says nothing.
  [
    /unexpected token|is not valid json|unexpected end of json/i,
    "Something went wrong on our side. It's been logged — please try again in a minute.",
  ],
  [
    /evaluation error at L\d+|null value error/i,
    "Some records couldn't be loaded. Refresh to try again — if this keeps happening, contact support.",
  ],
];

const PREFIX_FALLBACKS: Array<[RegExp, string]> = [
  [/^VERTEX_AI_/, "We couldn't draft this. Try again."],
  [/^AI_/, "We couldn't draft this. Try again."],
  // APP_CHECK_REQUIRED and friends: the browser couldn't prove it is ours,
  // most often a content blocker or a stale tab.
  [
    /^APP_CHECK_/,
    "We couldn't verify this browser. Refresh the page and try again — if it keeps happening, pause any ad or content blocker for this site.",
  ],
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
  // The studio's inquiry form, refused whole with its reasons
  // (intake/inquiry-form-config.ts, validateInquiryFormConfig).
  INQUIRY_FORM_INVALID: (detail) =>
    detail
      ? `Your form wasn't saved. ${detail}`
      : "Your form wasn't saved. Check the types and questions, then save again.",
  /**
   * A stage move the job can't make, with where it can go.
   *
   * This said "That is not a move this job can make" and nothing else, so a
   * studio trying to take a booked job back to the proposal learned only
   * that it couldn't — not that a booking change or a cancel was the way.
   * The server sends `FROM>TO,TO`.
   */
  INVALID_TRANSITION: (detail) => {
    const [from = "", targets = ""] = detail.split(">");
    const names = targets
      .split(",")
      .filter(Boolean)
      .map((state) => projectStateLabel(state));
    if (["BOOKED", "PLANNING", "READY"].includes(from))
      return "A booked job doesn't go back to the proposal or the agreement. To change what the couple booked or the date, use Change the booking on the job; if the wedding is off, cancel the job.";
    if (["EVENT_COMPLETE", "POST_PRODUCTION"].includes(from))
      return "After the wedding a job only moves forward. Deliver it, then reopen it from the job page if the couple asks for a re-edit.";
    if (from === "ARCHIVED")
      return "This job is archived. Restore it from the job page first.";
    return names.length
      ? `From ${projectStateLabel(from)} this job can move to ${names.join(", ")}.`
      : "That is not a move this job can make from where it is now.";
  },
  // Moves with their own bookkeeping (state-machine.ts transitionRoute).
  TRANSITION_HAS_ITS_OWN_COMMAND: (detail) =>
    detail === "closeInquiry"
      ? "Use Close inquiry to mark it lost — it records why, and stops its follow-ups and reply drafts."
      : detail === "reopenInquiry"
        ? "Use Reopen inquiry to bring it back — it returns to the stage it closed from."
        : detail === "uncancelProject"
          ? "Use Undo the cancel on the job page (owner only). It returns the job to where it was canceled from."
          : detail === "reopenJob"
            ? "Use Move back on the job page (owner only) to reopen a finished job, with a reason."
            : "That move has its own step on the job page.",
  // Moving back to the proposal with the agreement still out.
  AGREEMENT_OUT: (detail) =>
    detail === "signed"
      ? "The couple has signed the agreement, so the job can't go back to the proposal. Use Change the booking to change what they booked."
      : detail === "provider"
        ? "The agreement is out through your signing app. Cancel it there first, then move the job back to the proposal."
        : "The agreement is out with the couple. Withdraw it on the job's Booking tab first, then move the job back to the proposal.",
  // Sending to a couple whose job says "stop" (post-event/client-outreach.ts):
  // an approved draft or a retried email. The detail is why.
  CLIENT_OUTREACH_STOPPED: (detail) =>
    detail === "put_away"
      ? "This job is put away, so nothing was sent to the couple. Bring the job back first if you still want to write to them."
      : detail === "automations_paused"
        ? "Messages to this couple are paused on the job, so nothing was sent. Bring them in on the job first."
        : detail === "cancelled"
          ? "This wedding is canceled, so nothing was sent to the couple."
          : "That job isn't there any more, so nothing was sent.",
  // A package change once an agreement is out. The remedy depends on which
  // agreement (functions/src/crm/commands.ts assertPackagesEditable); this
  // used to tell all three to "void it on the Booking tab".
  AGREEMENT_ALREADY_SENT: (detail) =>
    detail === "signed"
      ? "The agreement for these packages is signed, so a package change is a booking change the couple signs. Use Change the booking on the job."
      : detail === "provider"
        ? "The agreement for these packages went out through your signing app. Cancel it there first, then change the packages."
        : "The agreement has already gone to the couple for these packages. Withdraw it on the job's Booking tab first, then change the packages.",
  // Sending an agreement or a booking change again, within the hour. The
  // server says when the next one may go.
  RESEND_TOO_SOON: (detail) => {
    const at = new Date(detail);
    return Number.isNaN(at.valueOf())
      ? "It went to them less than an hour ago. Give them a little time, then send it again."
      : `It went to them less than an hour ago. Give them a little time — you can send it again after ${at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}.`;
  },
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
 * Whether a refusal was the job's version guard: the page is holding a job
 * that changed since it loaded, so the fix is a refresh, not a retry.
 */
export function isVersionConflict(caught: unknown): boolean {
  const message = caught instanceof Error ? caught.message : String(caught ?? "");
  const code = message.split(":")[0]?.trim() ?? "";
  return code === "PROJECT_VERSION_CONFLICT" || code === "VERSION_CONFLICT";
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

/**
 * A refused decision on prepared work, said for what the work was.
 *
 * AI_ACTION_ALREADY_DECIDED's copy reassures that "nothing was sent again",
 * which is the point when the work was an email — and odd when it was a task
 * or a booking step that sends nothing (UAT T36, 2026-10-01). The card knows
 * which it was; the server's code does not say.
 */
export function decisionError(
  caught: unknown,
  { sends }: { sends: boolean },
  fallback = "The decision could not be saved.",
): string {
  const message = caught instanceof Error ? caught.message : String(caught ?? "");
  if (!sends && message.split(":")[0]?.trim() === "AI_ACTION_ALREADY_DECIDED")
    return "Already done — this was approved or put away a moment ago, so it wasn't done twice.";
  return friendlyError(caught, fallback);
}
