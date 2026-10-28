
/**
 * What a studio's people did, in words a person reads at a glance.
 *
 * The audit log names actions by their code ("package.created",
 * "contract.studio_signed_and_sent"). The Console's record showed those
 * humanized, or not at all, and filled "Recent" with the email worker's
 * "Communication provider accepted" instead (Conor, 2026-10-28: "can we get
 * more info for each account to see what their actions are"). Each action
 * has a line and an area, so a record can say both what happened and where a
 * studio spends its time. An unknown action still reads, humanized. Pure.
 */

export type ActionArea = "setup" | "inquiries" | "booking" | "planning" | "billing" | "messages" | "team" | "clients" | "other";

export const ACTION_AREA_LABELS: Record<ActionArea, string> = {
  setup: "Setup",
  inquiries: "Inquiries",
  booking: "Booking",
  planning: "Planning",
  billing: "Billing",
  messages: "Messages",
  team: "Team & crew",
  clients: "Clients",
  other: "Other",
};

const LABELS: Record<string, [string, ActionArea]> = {
  "tenant.identity_updated": ["Updated the studio's name or details", "setup"],
  "tenant.email_branding_updated": ["Updated email branding", "setup"],
  "tenant.lifecycle_messaging_updated": ["Changed automatic client emails", "setup"],
  "tenant.planning_checklist_updated": ["Edited the planning checklist", "setup"],
  "tenant.planning_timeline_updated": ["Set the planning timeline", "setup"],
  "tenant.crew_first_call_updated": ["Set crew first-call order", "setup"],
  "tenant.crew_offer_settings_updated": ["Changed crew offer settings", "setup"],
  "package.created": ["Created a package", "setup"],
  "package.updated": ["Edited a package", "setup"],
  "package.removed": ["Removed a package", "setup"],
  "package.add_ons_set": ["Set package add-ons", "setup"],
  "package.discount_set": ["Set a package discount", "setup"],
  "package.saved_to_library": ["Saved a package to the library", "setup"],
  "consultation.settings_updated": ["Set consultation hours", "setup"],
  "coi.settings_saved": ["Set up insurance certificates", "setup"],
  "agreement_template.version_saved": ["Saved an agreement template", "setup"],
  "message_template.version_created": ["Edited an email template", "setup"],
  "message_template.activated": ["Switched on an email template", "setup"],
  "message_template.reset_to_default": ["Reset an email template", "setup"],
  "workflow_template.created": ["Created a workflow", "setup"],
  "lead_capture.inquiry_form_saved": ["Saved the inquiry form", "setup"],
  "lead_capture.form_mapping_saved": ["Mapped a website form", "setup"],
  "lead_capture.inquiry_event_form_set": ["Chose the inquiry's event form", "setup"],
  "integration.connect": ["Connected an integration", "setup"],
  "integration.disconnect": ["Disconnected an integration", "setup"],
  "integration.signature_mode_set": ["Chose how clients sign", "setup"],
  "integration.contract_template_set": ["Chose the contract template", "setup"],
  "integration.capability_provider_set": ["Chose an integration provider", "setup"],
  "integration.outside_step_set": ["Set up an outside step", "setup"],
  "billing.settings_set": ["Changed billing settings", "billing"],
  "billing.invoice_settings_set": ["Changed invoice settings", "billing"],
  "billing.autopay_set": ["Set up autopay", "billing"],
  "billing.job_method_set": ["Chose how a job is billed", "billing"],
  "studio_import.session_created": ["Started an import", "setup"],
  "studio_import.source_session_created": ["Uploaded bookings to import", "setup"],
  "studio_import.session_activated": ["Finished an import", "setup"],
  "studio_import.session_cancelled": ["Canceled an import", "setup"],
  "booking.imported": ["Imported a booking", "booking"],
  "booking.import_updated": ["Updated an imported booking", "booking"],
  "booking.brought_live": ["Brought an imported booking live", "booking"],
  "booking.contract_details_added": ["Added details from a signed contract", "booking"],
  "lead.created": ["Added an inquiry by hand", "inquiries"],
  "lead.captured": ["Captured an inquiry from email", "inquiries"],
  "lead.converted": ["Turned an inquiry into a job", "inquiries"],
  "lead.not_inquiry": ["Marked an email as not an inquiry", "inquiries"],
  "lead.restored": ["Restored an inquiry", "inquiries"],
  "inquiry.details_submitted": ["Client filled in the inquiry form", "inquiries"],
  "consultation.invitation_sent": ["Invited a client to a call", "inquiries"],
  "consultation.cancelled_by_couple": ["Client canceled a call", "inquiries"],
  "project.created": ["Created a job", "booking"],
  "project.updated": ["Edited a job", "booking"],
  "project.state_changed": ["Moved a job to its next stage", "booking"],
  "project.booked": ["Booked a job", "booking"],
  "project.client_added": ["Added a client to a job", "booking"],
  "project.reopened": ["Reopened a job", "booking"],
  "project.uncancelled": ["Un-canceled a job", "booking"],
  "project.purged": ["Deleted a job", "booking"],
  "package.selected": ["Chose a job's package", "booking"],
  "package.one_off_updated": ["Edited a one-off package", "booking"],
  "proposal.created": ["Sent a proposal", "booking"],
  "proposal.acceptance_attested": ["Recorded a proposal as accepted", "booking"],
  "proposal.acceptance_undone": ["Undid a proposal acceptance", "booking"],
  "contract.studio_signed_and_sent": ["Signed and sent an agreement", "booking"],
  "contract.combined_studio_signed_and_sent": ["Signed and sent an agreement", "booking"],
  "contract.completed": ["Agreement fully signed", "booking"],
  "contract.resent": ["Resent an agreement", "booking"],
  "contract.voided": ["Voided an agreement", "booking"],
  "contract.signature_attested": ["Recorded a signature", "booking"],
  "booking.amendment_drafted": ["Drafted a booking change", "booking"],
  "booking.amendment_signed_by_studio_and_sent": ["Sent a booking change to sign", "booking"],
  "booking.amendment_applied": ["Booking change signed and applied", "booking"],
  "retainer.payment_attested": ["Recorded a retainer payment", "billing"],
  "installment.payment_attested": ["Recorded an installment payment", "billing"],
  "final_balance.payment_attested": ["Recorded the final payment", "billing"],
  "final_invoice.approved": ["Approved the final invoice", "billing"],
  "invoice.voided": ["Voided an invoice", "billing"],
  "invoice.deleted": ["Deleted an invoice", "billing"],
  "invoice.payment_corrected": ["Corrected a payment", "billing"],
  "schedule.published": ["Published a day plan", "planning"],
  "schedule.client_answer_recorded": ["Recorded a client's schedule answer", "planning"],
  "questionnaire.submitted_from_inquiry": ["Client sent a form", "planning"],
  "coi.requested": ["Requested an insurance certificate", "planning"],
  "coi.approved_and_sent": ["Sent an insurance certificate", "planning"],
  "coi.chase_sent": ["Chased an insurance certificate", "planning"],
  "vendor_team.timeline_sent": ["Sent the timeline to vendors", "planning"],
  "vendor_team.credits_sent": ["Sent vendor credits", "planning"],
  "closeout.requirement_attested": ["Closed out a requirement", "planning"],
  "checkpoint.reopened": ["Reopened a checkpoint", "planning"],
  "message.replied": ["Replied to a client", "messages"],
  "message.no_reply_needed": ["Marked a message as needing no reply", "messages"],
  "message.send_undone": ["Undid a send", "messages"],
  "message.approval_declined": ["Declined a drafted message", "messages"],
  "ai.message_drafted": ["Had Cue draft a message", "messages"],
  "ai.copilot_answered": ["Asked Cue a question", "messages"],
  "ai.schedule_drafted": ["Had Cue draft a schedule", "planning"],
  "membership.invited": ["Invited a team member", "team"],
  "membership.invitation_accepted": ["Team member joined", "team"],
  "membership.invitation_revoked": ["Withdrew a team invitation", "team"],
  "membership.updated": ["Changed a team member's access", "team"],
  "crew.invitation_accepted": ["Crew member joined", "team"],
  "crew.roster_invitation_accepted": ["Crew member joined the roster", "team"],
  "client.portal_activated": ["Client opened their portal", "clients"],
  "client.project_access_granted": ["Gave a client access to a job", "clients"],
  "client.invitation_revoked": ["Withdrew a client invitation", "clients"],
  "contact.updated": ["Edited a client's details", "clients"],
  "feedback.submitted": ["Sent StudioCue feedback", "other"],
};

export function describeAction(action: string): { label: string; area: ActionArea } {
  const known = LABELS[action];
  if (known) return { label: known[0], area: known[1] };
  const prefix = action.split(".")[0] ?? "";
  const area: ActionArea =
    ["package", "tenant", "integration", "lead_capture", "message_template", "agreement_template", "workflow_template", "studio_import", "consultation", "coi"].includes(prefix)
      ? "setup"
      : ["lead", "inquiry"].includes(prefix)
        ? "inquiries"
        : ["project", "proposal", "contract", "booking"].includes(prefix)
          ? "booking"
          : ["invoice", "billing", "retainer", "installment", "final_balance", "final_invoice", "participant"].includes(prefix)
            ? "billing"
            : ["schedule", "questionnaire", "vendor_team", "closeout", "checkpoint", "group_event"].includes(prefix)
              ? "planning"
              : ["message", "ai"].includes(prefix)
                ? "messages"
                : ["membership", "crew"].includes(prefix)
                  ? "team"
                  : ["client", "contact"].includes(prefix)
                    ? "clients"
                    : "other";
  return { label: humanize(action), area };
}

/** How many actions fell in each area since `since`, busiest first. */
export function actionAreas(actions: ReadonlyArray<{ action: string; at: string }>, since: string): Array<{ area: ActionArea; count: number }> {
  const counts = new Map<ActionArea, number>();
  for (const item of actions) {
    if (item.at < since) continue;
    const { area } = describeAction(item.action);
    counts.set(area, (counts.get(area) ?? 0) + 1);
  }
  return [...counts.entries()].map(([area, count]) => ({ area, count })).sort((a, b) => b.count - a.count);
}

/**
 * The system's own events, which say nothing about what the studio did: the
 * email worker's accepted/delivered/queued and the like. Hidden from a
 * studio's "Recent" so its people's actions are what shows.
 */
export function isSystemNoise(productEventName: string): boolean {
  return productEventName.startsWith("communication.");
}

function humanize(value: string): string {
  const spaced = value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_.-]+/g, " ").trim().toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
