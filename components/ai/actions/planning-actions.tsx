"use client";

import { useState } from "react";
import { CalendarRange, ClipboardList, Copy, Mail, MailOpen, ShieldAlert, Store } from "lucide-react";
import { parseQuestionnaireSections } from "@/features/questionnaires/client-form";
import { statusLabel } from "@/features/format/status-label";
import { QuestionnaireResponseActions } from "@/components/planning/questionnaire-response-actions";
import { RecordTimelineAnswer } from "@/components/planning/record-timeline-answer";
import { VendorReshareBanner } from "@/components/planning/vendor-reshare-banner";
import { sendPlanningCommand } from "@/lib/planning/command-client";
import { sendCommunicationsCommand } from "@/lib/communications/command-client";
import { sendOutcomeCopy } from "@/lib/communications/send-outcome";
import { AiScheduleGenerator } from "@/components/planning/ai-schedule-generator";
import { CoiWorkflowPanel } from "@/components/planning/coi-workflow-panel";
import { TimelineAuthorityPanel } from "@/components/planning/timeline-authority-panel";
import { VendorRecordActions } from "@/components/planning/vendor-record-actions";
import { MessageApprovals } from "@/components/communications/message-approvals";
import {
  ActionShell,
  Actions,
  Blocked,
  Done,
  Embedded,
  Form,
  Loading,
  Notice,
  SelectField,
  SubjectPicker,
  TextAreaField,
  TextField,
  arr,
  contactName,
  jobName,
  onJob,
  primaryContact,
  str,
  useIsOwnerOrAdmin,
  useJob,
  useRecords,
  useRunner,
  useSubjectChoice,
  type ActionCardProps,
  type Rec,
} from "./action-kit";
import { OwnerOnly } from "./job-actions";

const notFound = (title: string) => (
  <ActionShell title={title}>
    <Blocked>I couldn&apos;t find that job.</Blocked>
  </ActionShell>
);

/** Draft, edit and publish the day's timeline: the schedule builder itself. */
export function TimelineCard({ action }: ActionCardProps) {
  const { job, loading } = useJob(action.projectId);
  const titles: Record<string, string> = {
    draft_timeline: "Draft the timeline",
    approve_timeline: "Approve and publish the timeline",
    publish_timeline: "Publish the timeline",
  };
  const title = `${titles[action.action]} · ${jobName(job)}`;
  if (loading) return <ActionShell title={title}><Loading /></ActionShell>;
  if (!job) return notFound(title);
  return (
    <ActionShell
      detail="Built from their questionnaire, the job's packages and your timing rules. You edit it; publishing sends it to the crew and, for anything shared, to the couple."
      icon={<CalendarRange size={15} />}
      title={title}
    >
      <Embedded>
        <AiScheduleGenerator initialProjectId={job.id} />
      </Embedded>
    </ActionShell>
  );
}

/**
 * The couple's questionnaire after it went out: remind, correct, reopen,
 * withdraw. The same panel the response page mounts, opened on one action.
 */
export function QuestionnaireCard({ action }: ActionCardProps) {
  const { job, loading } = useJob(action.projectId);
  const responses = useRecords("questionnaireResponses");
  const ONLY: Record<string, "edit" | "reopen" | "resend" | "withdraw"> = {
    resend_questionnaire: "resend",
    edit_questionnaire_answers: "edit",
    reopen_questionnaire: "reopen",
    withdraw_questionnaire: "withdraw",
  };
  const only = ONLY[action.action];
  const titles: Record<string, string> = {
    resend_questionnaire: "Remind them about their questionnaire",
    edit_questionnaire_answers: "Change their questionnaire answers",
    reopen_questionnaire: "Reopen their questionnaire",
    withdraw_questionnaire: "Withdraw their questionnaire",
  };
  const live = onJob(responses, action.projectId).filter((response) => !response.archivedAt);
  const options = live.map((response) => ({
    id: response.id,
    name: str(response.templateName) || "Questionnaire",
    detail: str(response.status) ? statusLabel(response.status) : undefined,
  }));
  const choice = useSubjectChoice(action.subject, options);
  const title = `${titles[action.action] ?? "Their questionnaire"} · ${jobName(job)}`;
  if (loading || !responses) return <ActionShell title={title}><Loading /></ActionShell>;
  if (!job) return notFound(title);
  const response = live.find((item) => item.id === choice.chosen) ?? null;
  return (
    <ActionShell
      detail={
        only === "resend"
          ? "The same form, emailed again — never a second copy."
          : only === "reopen"
            ? "They can change their answers and send it back; the crew keep the last answers until then."
            : only === "withdraw"
              ? "Only a form they have not sent back. They stop seeing it."
              : "Your changes are recorded as yours. A sent-back form stays sent back."
      }
      icon={<ClipboardList size={15} />}
      title={title}
    >
      {!options.length ? (
        <Blocked>This job has no questionnaire out. Ask me to send one.</Blocked>
      ) : (
        <SubjectPicker {...choice} noun="questionnaire" options={options} subject={action.subject} />
      )}
      {response ? (
        <Embedded>
          {/* The panel refreshes the records itself; the new status arrives
              through `responses`, and its own notice says what happened. */}
          <QuestionnaireResponseActions
            key={response.id}
            onChanged={() => undefined}
            only={only}
            response={response}
            sections={parseQuestionnaireSections(
              response.templateSnapshot && typeof response.templateSnapshot === "object"
                ? (response.templateSnapshot as Rec).sections
                : undefined,
            )}
          />
        </Embedded>
      ) : null}
    </ActionShell>
  );
}

/** The couple said yes (or "not quite") on the phone: the studio records it. */
export function RecordTimelineApprovalCard({ action }: ActionCardProps) {
  const { job, loading } = useJob(action.projectId);
  const contacts = useRecords("contacts");
  const title = `Record their answer on the timeline · ${jobName(job)}`;
  if (loading || !contacts) return <ActionShell title={title}><Loading /></ActionShell>;
  if (!job) return notFound(title);
  return (
    <ActionShell detail="Who said so, how and when is kept with it. Only the newest version can take an answer." icon={<CalendarRange size={15} />} title={title}>
      <Embedded>
        <RecordTimelineAnswer coupleName={contactName(primaryContact(job, contacts))} projectId={job.id} />
      </Embedded>
    </ActionShell>
  );
}

/** Every vendor still on an older timeline gets the current one. */
export function ReshareRunOfShowCard({ action }: ActionCardProps) {
  const { job, loading } = useJob(action.projectId);
  const shares = useRecords("scheduleShares");
  const schedules = useRecords("schedules");
  const title = `Send vendors the new timeline · ${jobName(job)}`;
  if (loading || !shares || !schedules) return <ActionShell title={title}><Loading /></ActionShell>;
  if (!job) return notFound(title);
  const newest = onJob(schedules, job.id).sort((a, b) => Number(b.version ?? 0) - Number(a.version ?? 0))[0];
  const stale = onJob(shares, job.id).filter(
    (share) => str(share.status) !== "revoked" && !share.revokedAt && newest && share.scheduleId !== newest.id,
  );
  return (
    <ActionShell detail="Each gets a fresh link to the current version, by email where you have their address." icon={<Store size={15} />} title={title}>
      {stale.length ? (
        <Embedded>
          <VendorReshareBanner projectId={job.id} />
        </Embedded>
      ) : (
        <Done>Every vendor you shared the timeline with already has the current version.</Done>
      )}
    </ActionShell>
  );
}

export function TimelineOwnerCard({ action }: ActionCardProps) {
  const { job, loading } = useJob(action.projectId);
  const title = `Who owns the timeline · ${jobName(job)}`;
  if (loading) return <ActionShell title={title}><Loading /></ActionShell>;
  if (!job) return notFound(title);
  return (
    <ActionShell detail="When the planner owns it, paste theirs and StudioCue works from it." icon={<CalendarRange size={15} />} title={title}>
      <Embedded>
        <TimelineAuthorityPanel projectId={job.id} />
      </Embedded>
    </ActionShell>
  );
}

function vendorsOn(vendors: Rec[] | null, projectId: string): Rec[] {
  return (vendors ?? []).filter(
    (vendor) => !vendor.archivedAt && (vendor.projectId === projectId || arr(vendor.projectIds).includes(projectId)),
  );
}

const vendorOption = (vendor: Rec) => ({
  id: vendor.id,
  name: str(vendor.company) || str(vendor.contactName) || "Vendor",
  detail: [str(vendor.type), str(vendor.contactName), str(vendor.email)].filter(Boolean).join(" · ") || undefined,
});

export function ShareRunOfShowCard({ action }: ActionCardProps) {
  const { job, loading } = useJob(action.projectId);
  const vendors = useRecords("vendors");
  const schedules = useRecords("schedules");
  const shares = useRecords("scheduleShares");
  const runner = useRunner();
  const stopping = action.action === "stop_run_of_show_share";
  const [scope, setScope] = useState("vendor");
  const [message, setMessage] = useState(action.text ?? "");
  const [link, setLink] = useState<string | null>(null);
  const onTheJob = job ? vendorsOn(vendors, job.id) : [];
  const shared = onJob(shares, action.projectId).filter((share) => !share.revokedAt && str(share.status) !== "revoked");
  const candidates = stopping ? onTheJob.filter((vendor) => shared.some((share) => share.vendorContactId === vendor.id)) : onTheJob;
  const options = candidates.map(vendorOption);
  const choice = useSubjectChoice(action.subject, options);
  const title = `${stopping ? "Stop sharing the run of show" : "Share the run of show"} · ${jobName(job)}`;
  if (loading || !vendors || !schedules || !shares) return <ActionShell title={title}><Loading /></ActionShell>;
  if (!job) return notFound(title);
  if (runner.done && !link) return <ActionShell title={title}><Done>{runner.done}</Done></ActionShell>;
  const published = onJob(schedules, job.id).some((schedule) => str(schedule.status) === "published");
  const vendor = candidates.find((item) => item.id === choice.chosen) ?? null;
  if (link)
    return (
      <ActionShell detail="Send this link to them yourself — it opens their part of the day, and they confirm it." icon={<Store size={15} />} title={title}>
        <Form>
          <TextField label="Their link" onChange={() => undefined} value={link} />
        </Form>
        <div className="copilot-flow-actions">
          <button className="button button-dark" onClick={() => void navigator.clipboard?.writeText(link)} type="button">
            <Copy size={14} /> Copy the link
          </button>
        </div>
      </ActionShell>
    );
  if (!stopping && !published)
    return <ActionShell title={title}><Blocked>Publish the timeline first; the run of show is made from it.</Blocked></ActionShell>;
  return (
    <ActionShell
      detail={stopping ? "Their link stops working." : "You get a private link for them; nothing is emailed from here."}
      icon={<Store size={15} />}
      title={title}
    >
      {!options.length ? (
        <Blocked>{stopping ? "The run of show isn't shared with anyone on this job." : "No vendors are on this job yet. Ask me to add one."}</Blocked>
      ) : (
        <SubjectPicker {...choice} noun="vendor" options={options} subject={action.subject} />
      )}
      {!stopping && vendor ? (
        <Form>
          <SelectField
            label="What they see"
            onChange={setScope}
            options={[
              { value: "vendor", label: "Only the parts that involve them" },
              { value: "full", label: "The whole day" },
            ]}
            value={scope}
          />
          <TextAreaField label="A note with it (optional)" onChange={setMessage} rows={3} value={message} />
        </Form>
      ) : null}
      {options.length ? <Actions
        busy={runner.busy}
        danger={stopping}
        disabled={!vendor}
        label={stopping ? "Stop sharing" : "Make their link"}
        onClick={() =>
          void runner.run(
            async () => {
              if (!vendor) return null;
              if (stopping) {
                await sendPlanningCommand("revokeRunOfShowShare", { projectId: job.id, vendorContactId: vendor.id });
                return `Stopped sharing with ${vendorOption(vendor).name}.`;
              }
              const response = await sendPlanningCommand("shareRunOfShow", {
                projectId: job.id,
                vendorContactId: vendor.id,
                scope,
                message: message.trim(),
              });
              const url = str((response.result as Rec).shareUrl);
              if (url) setLink(url);
              return url ? null : "Shared.";
            },
            { refresh: ["scheduleShares"] },
          )
        }
      /> : null}
      <Notice text={runner.notice} />
    </ActionShell>
  );
}

export function InsuranceRequirementCard({ action }: ActionCardProps) {
  const { job, loading } = useJob(action.projectId);
  const runner = useRunner();
  const notRequired = /not|no longer|doesn.?t|does not/i.test(action.text ?? "");
  const title = `${notRequired ? "Mark insurance not required" : "Flag that the venue requires insurance"} · ${jobName(job)}`;
  if (loading) return <ActionShell title={title}><Loading /></ActionShell>;
  if (!job) return notFound(title);
  if (runner.done) return <ActionShell title={title}><Done>{runner.done}</Done></ActionShell>;
  return (
    <ActionShell
      detail={notRequired ? "The certificate of insurance drops off the readiness list." : "A certificate of insurance joins the readiness list for this job."}
      icon={<ShieldAlert size={15} />}
      title={title}
    >
      <Actions
        busy={runner.busy}
        label={notRequired ? "Not required" : "Required"}
        onClick={() =>
          void runner.run(
            async () => {
              await sendPlanningCommand("setInsuranceRequirement", {
                projectId: job.id,
                insuranceRequired: notRequired ? "not_required" : "required",
              });
              return notRequired ? "Insurance is marked not required." : "Insurance is marked required.";
            },
            { refresh: ["projects", "checkpoints", "readinessAssessments", "insuranceRequests"] },
          )
        }
      />
      <Notice text={runner.notice} />
    </ActionShell>
  );
}

export function CoiCard({ action }: ActionCardProps) {
  const { job, loading } = useJob(action.projectId);
  const titles: Record<string, string> = {
    request_coi: "Request a certificate of insurance",
    decide_coi: "Review the certificate of insurance",
    send_coi_to_venue: "Send the certificate to the venue",
    resend_coi: "Correct and resend the certificate",
  };
  const title = `${titles[action.action]} · ${jobName(job)}`;
  if (loading) return <ActionShell title={title}><Loading /></ActionShell>;
  if (!job) return notFound(title);
  return (
    <ActionShell detail="Your insurer is emailed the venue's requirements and replies with the certificate; you approve it and send it on." icon={<ShieldAlert size={15} />} title={title}>
      <Embedded>
        <CoiWorkflowPanel projectId={job.id} />
      </Embedded>
    </ActionShell>
  );
}

const VENDOR_TYPES = [
  { value: "planner", label: "Planner" },
  { value: "venue", label: "Venue" },
  { value: "florist", label: "Florist" },
  { value: "dj", label: "DJ / band" },
  { value: "videographer", label: "Videographer" },
  { value: "insurance_agent", label: "Insurance agent" },
  { value: "other", label: "Other" },
];

function vendorTypeFromWords(words: string): string {
  const text = words.toLowerCase();
  if (/planner|coordinator/.test(text)) return "planner";
  if (/venue|hall|barn|estate|hotel/.test(text)) return "venue";
  if (/florist|floral|flower/.test(text)) return "florist";
  if (/\bdj\b|band|music/.test(text)) return "dj";
  if (/video/.test(text)) return "videographer";
  if (/insur/.test(text)) return "insurance_agent";
  return "other";
}

export function AddVendorCard({ action }: ActionCardProps) {
  const { job, loading } = useJob(action.projectId);
  const runner = useRunner();
  const [company, setCompany] = useState(action.subject ?? "");
  const [contact, setContact] = useState("");
  const [email, setEmail] = useState("");
  const [type, setType] = useState(vendorTypeFromWords(`${action.subject ?? ""} ${action.text ?? ""}`));
  const title = `Add a vendor to ${jobName(job)}`;
  if (loading) return <ActionShell title={title}><Loading /></ActionShell>;
  if (!job) return notFound(title);
  if (runner.done) return <ActionShell title={title}><Done>{runner.done}</Done></ActionShell>;
  const emailOk = !email.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  return (
    <ActionShell detail="Nothing is sent to them. You can share the run of show with them later." icon={<Store size={15} />} title={title}>
      <Form>
        <TextField label="Company" onChange={setCompany} value={company} />
        <SelectField label="What they do" onChange={setType} options={VENDOR_TYPES} value={type} />
        <TextField label="Contact name (optional)" onChange={setContact} value={contact} />
        <TextField label="Email (optional)" onChange={setEmail} type="email" value={email} />
      </Form>
      <Actions
        busy={runner.busy}
        disabled={!company.trim() || !emailOk}
        label="Add them"
        onClick={() =>
          void runner.run(
            async () => {
              await sendPlanningCommand("createVendor", {
                projectId: job.id,
                company: company.trim(),
                contactName: contact.trim(),
                email: email.trim() || null,
                type,
              });
              return `${company.trim()} is on ${jobName(job)}.`;
            },
            { refresh: ["vendors"] },
          )
        }
      />
      <Notice text={runner.notice} />
    </ActionShell>
  );
}

export function VendorChangeCard({ action }: ActionCardProps) {
  const { job, loading } = useJob(action.projectId);
  const vendors = useRecords("vendors");
  const ownerOrAdmin = useIsOwnerOrAdmin();
  const runner = useRunner();
  const removing = action.action === "remove_vendor";
  const onTheJob = job ? vendorsOn(vendors, job.id) : [];
  const options = onTheJob.map(vendorOption);
  const choice = useSubjectChoice(action.subject, options);
  const title = `${removing ? "Remove a vendor from" : "Change a vendor on"} ${jobName(job)}`;
  if (!ownerOrAdmin) return <OwnerOnly title={title} />;
  if (loading || !vendors) return <ActionShell title={title}><Loading /></ActionShell>;
  if (!job) return notFound(title);
  if (runner.done) return <ActionShell title={title}><Done>{runner.done}</Done></ActionShell>;
  const vendor = onTheJob.find((item) => item.id === choice.chosen) ?? null;
  return (
    <ActionShell detail={removing ? "They are archived; you can restore them from Vendors." : undefined} icon={<Store size={15} />} title={title}>
      {!options.length ? <Blocked>No vendors are on this job.</Blocked> : <SubjectPicker {...choice} noun="vendor" options={options} subject={action.subject} />}
      {vendor && !removing ? (
        <Embedded>
          <VendorRecordActions
            vendor={{
              id: vendor.id,
              company: str(vendor.company),
              contactName: str(vendor.contactName),
              email: str(vendor.email) || null,
              phone: str(vendor.phone) || null,
              type: str(vendor.type),
              website: str(vendor.website) || null,
              notes: str(vendor.notes) || null,
              archived: Boolean(vendor.archivedAt),
            }}
          />
        </Embedded>
      ) : null}
      {removing ? (
        <Actions
          busy={runner.busy}
          danger
          disabled={!vendor}
          label="Remove them"
          onClick={() =>
            void runner.run(
              async () => {
                if (!vendor) return null;
                await sendPlanningCommand("archiveVendor", { vendorId: vendor.id, restore: false });
                return `${vendorOption(vendor).name} is removed.`;
              },
              { refresh: ["vendors"] },
            )
          }
        />
      ) : null}
      <Notice text={runner.notice} />
    </ActionShell>
  );
}

// ─── Messages ───────────────────────────────────────────────────────────────

function jobConversations(conversations: Rec[] | null, projectId: string): Rec[] {
  return onJob(conversations, projectId).sort((a, b) =>
    str(b.lastMessageAt ?? b.updatedAt).localeCompare(str(a.lastMessageAt ?? a.updatedAt)),
  );
}

export function ReplyCard({ action }: ActionCardProps) {
  const { job, loading } = useJob(action.projectId);
  const conversations = useRecords("conversations");
  const contacts = useRecords("contacts");
  const runner = useRunner();
  const [body, setBody] = useState(action.text ?? "");
  const [subject, setSubject] = useState("");
  const title = `Write to ${jobName(job)}`;
  if (loading || !conversations || !contacts) return <ActionShell title={title}><Loading /></ActionShell>;
  if (!job) return notFound(title);
  if (runner.done) return <ActionShell title={title}><Done href={`/studio/messages?project=${job.id}`} label="Open the thread">{runner.done}</Done></ActionShell>;
  const thread = jobConversations(conversations, job.id)[0] ?? null;
  const contact = primaryContact(job, contacts);
  const to = str(contact?.email);
  return (
    <ActionShell
      detail={thread ? `A reply in your thread with ${contactName(contact)}.` : `A new email to ${contactName(contact)}${to ? ` at ${to}` : ""}.`}
      icon={<Mail size={15} />}
      title={title}
    >
      {!thread && !contact ? <Blocked>This job has no client to write to.</Blocked> : null}
      <Form>
        {!thread ? <TextField label="Subject" onChange={setSubject} value={subject} /> : null}
        <TextAreaField label="Message" onChange={setBody} rows={7} value={body} />
      </Form>
      <Actions
        busy={runner.busy}
        disabled={body.trim().length < 2 || (!thread && (!contact || subject.trim().length < 2))}
        label={`Send${to ? ` to ${to}` : ""}`}
        onClick={() =>
          void runner.run(
            async () => {
              // Said as it is: queued, held for approval, or (preview) not
              // sent at all — never a flat "Sent." (lib/communications/send-outcome.ts).
              if (thread) {
                return sendOutcomeCopy(
                  await sendCommunicationsCommand({
                    type: "replyToConversation",
                    idempotencyKey: crypto.randomUUID(),
                    input: { conversationId: thread.id, body: body.trim() },
                  }),
                );
              }
              if (!contact) return null;
              const sent = await sendCommunicationsCommand({
                type: "sendMessage",
                idempotencyKey: crypto.randomUUID(),
                input: {
                  projectId: job.id,
                  contactId: contact.id,
                  subject: subject.trim(),
                  body: body.trim(),
                  category: "general",
                  actionLabel: null,
                  actionUrl: null,
                  scheduledFor: null,
                },
              });
              return sendOutcomeCopy(sent);
            },
            { refresh: ["conversations", "messages", "communicationDrafts"] },
          )
        }
      />
      <Notice text={runner.notice} />
    </ActionShell>
  );
}

export function MarkReadCard({ action }: ActionCardProps) {
  const { job, loading } = useJob(action.projectId);
  const conversations = useRecords("conversations");
  const runner = useRunner();
  const title = `Mark their messages read · ${jobName(job)}`;
  if (loading || !conversations) return <ActionShell title={title}><Loading /></ActionShell>;
  if (!job) return notFound(title);
  if (runner.done) return <ActionShell title={title}><Done>{runner.done}</Done></ActionShell>;
  const unread = jobConversations(conversations, job.id).filter((item) => Number(item.studioUnreadCount ?? 0) > 0);
  if (!unread.length) return <ActionShell title={title}><Done>Nothing unread on this job.</Done></ActionShell>;
  return (
    <ActionShell icon={<MailOpen size={15} />} title={title}>
      <Actions
        busy={runner.busy}
        label="Mark read"
        onClick={() =>
          void runner.run(
            async () => {
              for (const conversation of unread)
                await sendCommunicationsCommand({
                  type: "markConversationRead",
                  idempotencyKey: crypto.randomUUID(),
                  input: { conversationId: conversation.id },
                });
              return "Marked read.";
            },
            { refresh: ["conversations"] },
          )
        }
      />
      <Notice text={runner.notice} />
    </ActionShell>
  );
}


/** Messages a team member wrote that wait on the owner: the Messages page's own list. */
export function MessageApprovalCard() {
  const ownerOrAdmin = useIsOwnerOrAdmin();
  const drafts = useRecords("communicationDrafts", ownerOrAdmin);
  const title = "Messages waiting for your approval";
  if (!ownerOrAdmin) return <OwnerOnly title={title} />;
  if (!drafts) return <ActionShell title={title}><Loading /></ActionShell>;
  const waiting = drafts.filter((draft) => draft.status === "needs_approval");
  return (
    <ActionShell
      detail="A team member's message about money, the contract or insurance goes out only once you approve it."
      icon={<Mail size={15} />}
      title={title}
    >
      {waiting.length ? (
        <Embedded>
          <MessageApprovals />
        </Embedded>
      ) : (
        <Done>Nothing is waiting for your approval.</Done>
      )}
    </ActionShell>
  );
}
