"use client";

import { useState } from "react";
import { Archive, Briefcase, CircleSlash, Inbox, MailPlus, PencilLine, RotateCcw, Route, Trash2, UserPlus } from "lucide-react";
import { useWorkspace } from "@/features/auth/workspace-context";
import { tradeAllows, tradeMoves, tradeProfile, tradeVocab } from "@/features/trades/trades";
import {
  allowedProjectTransitions,
  transitionAuthority,
  transitionRoute,
} from "@/features/projects/state-machine";
import { interruptionsFor } from "@/features/projects/interruptions";
import {
  backwardMovesFor,
  uncancelRefusal,
  UNCANCEL_WINDOW_DAYS,
} from "@/features/projects/going-back";
import { holdResumeStates, type HoldRecord } from "@/features/projects/hold-resume";
import type { ProjectState } from "@/features/projects/schema";
import { projectStateLabel } from "@/features/projects/state-label";
import { runCrmCommand } from "@/lib/crm/command-client";
import { runClientInvitation } from "@/lib/client/invitation-client";
import { CreateProjectForm } from "@/components/crm/create-project-form";
import { CreateContactForm } from "@/components/crm/create-contact-form";
import { ignorableSenderOf } from "@/features/intake/not-inquiry";
import { IgnoredSenders } from "@/components/intake/ignored-senders";
import { useLeadCaptureSetup } from "@/components/intake/lead-capture-setup";
import { ProjectEdit } from "@/components/projects/project-edit";
import { ProjectAddClient } from "@/components/projects/project-add-client";
import { billingAddressOf, ClientRecordActions } from "@/components/clients/client-record-actions";
import { coupleConfirmed } from "@/features/contacts/billing-address-signing";
import { DeleteJobPermanently } from "@/components/projects/delete-job-permanently";
import { AMENDABLE_STATES, BookingAmendmentPanel } from "@/components/booking/booking-amendment";
import {
  ActionShell,
  Actions,
  Blocked,
  CheckField,
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
  freshStateVersion,
  jobName,
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

/** The steps only evidence moves, in the trade's words: no delivery for a trade that delivers nothing. */
function proofSteps(trade: unknown): string {
  const offer = tradeVocab(trade).proposal.toLowerCase();
  return tradeProfile(trade).delivery
    ? `an accepted ${offer}, a signature, a paid retainer, a delivery`
    : `an accepted ${offer}, a signature, a paid retainer`;
}

const PRE_BOOKING = new Set(["LEAD", "CONSULTATION", "PROPOSAL", "CONTRACT_PENDING", "RETAINER_PENDING"]);

function OwnerOnly({ title }: { title: string }) {
  return (
    <ActionShell title={title}>
      <Blocked>Only the studio&apos;s owners and admins can do this.</Blocked>
    </ActionShell>
  );
}

export function CreateJobCard({ action }: ActionCardProps) {
  return (
    <ActionShell detail="Enter the client and the event. Nothing is sent to them." icon={<Briefcase size={15} />} title="Start a new job">
      <Embedded>
        <CreateProjectForm sharedMessage={action.text} />
      </Embedded>
    </ActionShell>
  );
}

const JOB_FIELDS: Record<string, string> = {
  name: "name",
  eventDate: "date",
  eventType: "event type",
  venueName: "venue",
  city: "city",
  timezone: "time zone",
};

/** Accepts the model's field names and the words an operator might use. */
function jobField(field: string | null): string | null {
  const value = (field ?? "").toLowerCase().replace(/[\s_-]/g, "");
  const aliases: Record<string, string> = {
    name: "name",
    title: "name",
    eventdate: "eventDate",
    date: "eventDate",
    weddingdate: "eventDate",
    eventtype: "eventType",
    type: "eventType",
    venuename: "venueName",
    venue: "venueName",
    location: "venueName",
    city: "city",
    timezone: "timezone",
    tz: "timezone",
  };
  return aliases[value] ?? null;
}

export function EditJobCard({ action }: ActionCardProps) {
  const { job, loading } = useJob(action.projectId);
  const runner = useRunner();
  const field = jobField(action.field);
  const [value, setValue] = useState(action.text ?? (field === "eventDate" ? action.date ?? "" : ""));
  if (loading) return <ActionShell title="Edit the job"><Loading /></ActionShell>;
  if (!job) return <ActionShell title="Edit the job"><Blocked>I couldn&apos;t find that job.</Blocked></ActionShell>;
  const current = {
    name: str(job.name),
    eventDate: str(job.eventDate),
    eventType: str(job.eventType),
    venueName: str(job.venueName) || null,
    city: str(job.city) || null,
    timezone: str(job.timezone) || "America/New_York",
  };
  // No single field named: the job page's own editor, every field at once.
  if (!field) {
    return (
      <ActionShell detail="Change the name, date, type, venue, city or time zone." icon={<PencilLine size={15} />} title={`Edit ${jobName(job)}`}>
        <Embedded>
          <ProjectEdit project={{ ...current, id: job.id, archived: Boolean(job.archivedAt) }} />
        </Embedded>
      </ActionShell>
    );
  }
  // A signed booking's date is the couple's agreement too: they sign the move.
  if (field === "eventDate" && AMENDABLE_STATES.includes(str(job.state)))
    return (
      <ActionShell
        detail="They've signed for the current date, so the move goes to them to sign. Their agreement stands until they do."
        icon={<PencilLine size={15} />}
        title={`Move the date · ${jobName(job)}`}
      >
        <Embedded>
          <BookingAmendmentPanel projectId={job.id} />
        </Embedded>
      </ActionShell>
    );
  const was = (current as Record<string, string | null>)[field] ?? "";
  const label = JOB_FIELDS[field]!;
  const valid = field === "eventDate" ? /^\d{4}-\d{2}-\d{2}$/.test(value) : value.trim().length > 0;
  if (runner.done) return <ActionShell title={`Change the ${label}`}><Done>{runner.done}</Done></ActionShell>;
  return (
    <ActionShell
      detail={`${was || "Not set"} → ${value || "…"}`}
      icon={<PencilLine size={15} />}
      title={`Change the ${label} on ${jobName(job)}`}
    >
      {job.archivedAt ? <Blocked>This job is archived. Restore it first.</Blocked> : null}
      <Form>
        <TextField
          label={`New ${label}`}
          onChange={setValue}
          type={field === "eventDate" ? "date" : "text"}
          value={value}
        />
      </Form>
      {field === "eventDate" ? (
        <p className="cue-action-note">Moving the date re-checks readiness and crew availability for the new day.</p>
      ) : null}
      <Actions
        busy={runner.busy}
        disabled={!valid || value.trim() === was || Boolean(job.archivedAt)}
        label="Save the change"
        onClick={() =>
          void runner.run(
            async () => {
              // updateProject writes every descriptive field at once: the
              // current values, with exactly this one replaced.
              await runCrmCommand("updateProject", { ...current, [field]: value.trim(), projectId: job.id });
              return `Changed the ${label} on ${jobName(job)} to ${value.trim()}.`;
            },
            { refresh: ["projects", "readinessAssessments"] },
          )
        }
      />
      <Notice text={runner.notice} />
    </ActionShell>
  );
}

const CLOSE_REASONS = [
  { value: "went_quiet", label: "They went quiet" },
  { value: "booked_elsewhere", label: "They booked someone else" },
  { value: "budget", label: "Budget" },
  { value: "date_taken", label: "The date is taken" },
  { value: "not_a_fit", label: "Not a fit" },
  { value: "other", label: "Something else" },
];

function reasonFromWords(words: string | null, fallback: string): string {
  const text = (words ?? "").toLowerCase();
  if (/elsewhere|another|someone else|other photographer|booked with/.test(text)) return "booked_elsewhere";
  if (/budget|price|expensive|afford|cost/.test(text)) return "budget";
  if (/date|taken|booked that day|unavailable/.test(text)) return "date_taken";
  if (/fit|style/.test(text)) return "not_a_fit";
  if (/quiet|ghost|no reply|never replied|cold/.test(text)) return "went_quiet";
  return fallback;
}

export function CloseInquiryCard({ action }: ActionCardProps) {
  const { job, loading } = useJob(action.projectId);
  const runner = useRunner();
  const [reason, setReason] = useState(
    reasonFromWords(action.text, action.action === "inquiry_booked_elsewhere" ? "booked_elsewhere" : "went_quiet"),
  );
  const title = `Mark ${jobName(job)} as lost`;
  if (loading) return <ActionShell title={title}><Loading /></ActionShell>;
  if (!job) return <ActionShell title={title}><Blocked>I couldn&apos;t find that job.</Blocked></ActionShell>;
  if (runner.done) return <ActionShell title={title}><Done>{runner.done}</Done></ActionShell>;
  const state = str(job.state);
  if (state === "LOST") return <ActionShell title={title}><Done>{`${jobName(job)} is already marked lost.`}</Done></ActionShell>;
  if (!PRE_BOOKING.has(state))
    return <ActionShell title={title}><Blocked>{`${jobName(job)} is ${projectStateLabel(state).toLowerCase()}, so it isn't an open inquiry. To stop a booked job, move it to Canceled.`}</Blocked></ActionShell>;
  return (
    <ActionShell
      detail="It moves to Lost, and its follow-ups and unsent reply drafts stop. You can reopen it any time."
      icon={<CircleSlash size={15} />}
      title={title}
    >
      <Form>
        <SelectField label="Why" onChange={setReason} options={CLOSE_REASONS} value={reason} />
      </Form>
      <Actions
        busy={runner.busy}
        label="Mark as lost"
        onClick={() =>
          void runner.run(
            async () => {
              await runCrmCommand("closeInquiry", { projectId: job.id, leadId: null, reason });
              return `${jobName(job)} is marked lost. Its follow-ups have stopped.`;
            },
            { refresh: ["projects", "leads", "aiActions"] },
          )
        }
      />
      <Notice text={runner.notice} />
    </ActionShell>
  );
}

/** Reopen, keep open, heard from them: one command each, no fields. */
export function InquiryOneTapCard({ action }: ActionCardProps) {
  const { job, loading } = useJob(action.projectId);
  const runner = useRunner();
  const kinds: Record<string, { title: string; detail: string; op: string; done: string; states: string[]; wrong: string }> = {
    reopen_inquiry: {
      title: "Reopen the inquiry",
      detail: "It goes back to the stage it closed from.",
      op: "reopenInquiry",
      done: "is open again.",
      states: ["LOST"],
      wrong: "isn't marked lost, so there is nothing to reopen.",
    },
    keep_inquiry_open: {
      title: "Keep the inquiry open",
      detail: "StudioCue stops asking whether to close it for another week.",
      op: "keepInquiryOpen",
      done: "stays open. You won't be asked to close it for a week.",
      states: [...PRE_BOOKING],
      wrong: "isn't an open inquiry.",
    },
    heard_from_couple: {
      title: "They got back to you another way",
      detail: "Follow-ups restart from today and the unsent follow-up drafts are dismissed.",
      op: "inquiryHeardElsewhere",
      done: "is marked as heard from. Follow-ups restart from today.",
      states: [...PRE_BOOKING],
      wrong: "isn't an open inquiry.",
    },
  };
  const kind = kinds[action.action]!;
  const title = `${kind.title}: ${jobName(job)}`;
  if (loading) return <ActionShell title={title}><Loading /></ActionShell>;
  if (!job) return <ActionShell title={title}><Blocked>I couldn&apos;t find that job.</Blocked></ActionShell>;
  if (runner.done) return <ActionShell title={title}><Done>{runner.done}</Done></ActionShell>;
  if (!kind.states.includes(str(job.state)))
    return <ActionShell title={title}><Blocked>{`${jobName(job)} ${kind.wrong}`}</Blocked></ActionShell>;
  return (
    <ActionShell detail={kind.detail} icon={<Inbox size={15} />} title={title}>
      <Actions
        busy={runner.busy}
        label={kind.title}
        onClick={() =>
          void runner.run(
            async () => {
              await runCrmCommand(kind.op, { projectId: job.id, leadId: null });
              return `${jobName(job)} ${kind.done}`;
            },
            { refresh: ["projects", "leads", "aiActions"] },
          )
        }
      />
      <Notice text={runner.notice} />
    </ActionShell>
  );
}

function leadName(lead: Rec): string {
  return (
    str(lead.displayName) ||
    [str(lead.firstName), str(lead.lastName)].filter(Boolean).join(" ") ||
    str(lead.email) ||
    str(lead.subject) ||
    "Unnamed inquiry"
  );
}

/** Answering a "Maybe an inquiry": yes it is, or no it isn't. */
export function MaybeInquiryCard({ action }: ActionCardProps) {
  const leads = useRecords("leads");
  const runner = useRunner();
  const confirming = action.action === "confirm_inquiry";
  const held = (leads ?? []).filter((lead) => lead.needsConfirmation === true && !lead.archivedAt);
  const options = held.map((lead) => ({
    id: lead.id,
    name: leadName(lead),
    detail: [str(lead.eventDate), str(lead.email)].filter(Boolean).join(" · ") || undefined,
  }));
  const choice = useSubjectChoice(action.subject, options);
  // Off unless ticked: an ignored sender's mail is dropped for good, and the
  // studio should see which address that is first (NotInquiryConfirm).
  const [ignoreSender, setIgnoreSender] = useState(false);
  const title = confirming ? "Confirm it's an inquiry" : "Mark it as not an inquiry";
  if (!leads) return <ActionShell title={title}><Loading /></ActionShell>;
  if (runner.done) return <ActionShell title={title}><Done href="/studio/leads" label="Open Inquiries">{runner.done}</Done></ActionShell>;
  if (!held.length) return <ActionShell title={title}><Done>Nothing is waiting in “Maybe an inquiry”.</Done></ActionShell>;
  const lead = held.find((item) => item.id === choice.chosen) ?? null;
  const sender = ignorableSenderOf(lead);
  return (
    <ActionShell
      detail={
        confirming
          ? "It becomes a real inquiry: a job is made for it and a reply is drafted."
          : "It is dropped. Its sender keeps being captured unless you check the box below."
      }
      icon={<Inbox size={15} />}
      title={title}
    >
      <SubjectPicker {...choice} noun="held message" options={options} subject={action.subject} />
      {!confirming && sender ? (
        <Form>
          <CheckField
            checked={ignoreSender}
            label={`Also ignore everything from ${sender} from now on`}
            onChange={setIgnoreSender}
          />
        </Form>
      ) : null}
      <Actions
        busy={runner.busy}
        danger={!confirming}
        disabled={!lead}
        label={confirming ? "It's an inquiry" : "Not an inquiry"}
        onClick={() =>
          void runner.run(
            async () => {
              if (!lead) return null;
              if (confirming) {
                await runCrmCommand("updateLead", { leadId: lead.id, confirmInquiry: true });
                return `${leadName(lead)} is now an inquiry.`;
              }
              const wantsIgnore = Boolean(sender) && ignoreSender;
              const { result } = await runCrmCommand("markLeadNotInquiry", {
                leadId: lead.id,
                ignoreSender: wantsIgnore,
              });
              const kept = result.senderKept as { message?: unknown } | null | undefined;
              if (wantsIgnore && kept && typeof kept.message === "string")
                return `${leadName(lead)} is dropped. StudioCue will keep capturing ${sender}: ${kept.message}`;
              return wantsIgnore
                ? `${leadName(lead)} is dropped, and mail from ${sender} will be ignored. Undo it in Settings → Inquiry capture.`
                : `${leadName(lead)} is dropped. Its sender is still captured.`;
            },
            { refresh: ["leads", "projects"] },
          )
        }
      />
      <Notice text={runner.notice} />
    </ActionShell>
  );
}

/**
 * The senders "not an inquiry" taught capture to ignore, with Remove — the
 * same list as Settings → Inquiry capture, so "why aren't my form's inquiries
 * arriving?" can be answered and fixed from Cue.
 */
export function IgnoredSendersCard() {
  const ownerOrAdmin = useIsOwnerOrAdmin();
  const { setup, actions, error, unavailable } = useLeadCaptureSetup();
  const title = "Senders StudioCue ignores";
  if (!ownerOrAdmin) return <OwnerOnly title={title} />;
  if (unavailable) return <ActionShell title={title}><Blocked>Inquiry capture isn&apos;t available on this workspace yet.</Blocked></ActionShell>;
  if (error) return <ActionShell title={title}><Blocked>{error}</Blocked></ActionShell>;
  if (!setup) return <ActionShell title={title}><Loading /></ActionShell>;
  return (
    <ActionShell
      detail="Mail from these is dropped without a trace. Remove one and its messages are captured again."
      icon={<Inbox size={15} />}
      title={title}
    >
      <Embedded>
        <IgnoredSenders onChanged={actions.refresh} senders={setup.ignoredSenders ?? []} />
      </Embedded>
    </ActionShell>
  );
}

export function AddContactCard() {
  return (
    <ActionShell detail="Add them to the studio's contacts. Nothing is sent to them." icon={<UserPlus size={15} />} title="Add a contact">
      <Embedded>
        <CreateContactForm />
      </Embedded>
    </ActionShell>
  );
}

const CONTACT_FIELDS: Record<string, string> = {
  firstname: "firstName",
  first: "firstName",
  lastname: "lastName",
  last: "lastName",
  surname: "lastName",
  email: "email",
  emailaddress: "email",
  phone: "phone",
  phonenumber: "phone",
  mobile: "phone",
};

/**
 * Archive or restore a client (wave 3): the same command as the Clients row.
 * The candidates are narrowed by the words the operator used, since a studio
 * has hundreds of contacts and the pick list shows every candidate.
 */
export function ContactArchiveCard({ action }: ActionCardProps) {
  const contacts = useRecords("contacts");
  const ownerOrAdmin = useIsOwnerOrAdmin();
  const runner = useRunner();
  const restoring = action.action === "restore_contact";
  const words = (action.subject ?? "").toLowerCase().split(/\s+/).filter((word) => word.length > 1);
  const pool = (contacts ?? [])
    .filter((contact) => Boolean(contact.archivedAt) === restoring)
    .filter((contact) => {
      if (!words.length) return true;
      const haystack = `${contactName(contact)} ${str(contact.email)}`.toLowerCase();
      return words.some((word) => haystack.includes(word));
    })
    .sort((left, right) => str(right.updatedAt).localeCompare(str(left.updatedAt)))
    .slice(0, 12);
  const options = pool.map((contact) => ({ id: contact.id, name: contactName(contact), detail: str(contact.email) || undefined }));
  const choice = useSubjectChoice(action.subject, options);
  const title = restoring ? "Restore a client" : "Archive a client";
  if (!ownerOrAdmin) return <OwnerOnly title={title} />;
  if (!contacts) return <ActionShell title={title}><Loading /></ActionShell>;
  if (runner.done) return <ActionShell title={title}><Done>{runner.done}</Done></ActionShell>;
  const contact = pool.find((item) => item.id === choice.chosen) ?? null;
  return (
    <ActionShell
      detail={
        restoring
          ? "They come back to the working list, and can be edited again."
          : "Off the working list; nothing is deleted. Not while a job of theirs is still live."
      }
      icon={<Archive size={15} />}
      title={title}
    >
      {options.length ? (
        <SubjectPicker {...choice} noun="client" options={options} subject={action.subject} />
      ) : (
        <Blocked>{restoring ? "No archived client matches that." : "No client matches that."}</Blocked>
      )}
      {options.length ? (
        <Actions
          busy={runner.busy}
          disabled={!contact}
          label={restoring ? "Restore" : "Archive"}
          onClick={() =>
            void runner.run(
              async () => {
                if (!contact) return null;
                await runCrmCommand("archiveContact", { contactId: contact.id, restore: restoring });
                return restoring ? `${contactName(contact)} is back on the list.` : `${contactName(contact)} is archived.`;
              },
              { refresh: ["contacts"] },
            )
          }
        />
      ) : null}
      <Notice text={runner.notice} />
    </ActionShell>
  );
}

export function EditContactCard({ action }: ActionCardProps) {
  const { job, loading } = useJob(action.projectId);
  const contacts = useRecords("contacts");
  const ownerOrAdmin = useIsOwnerOrAdmin();
  const runner = useRunner();
  const onTheJob = (contacts ?? []).filter((contact) => arr(job?.clientContactIds).includes(contact.id));
  const options = onTheJob.map((contact) => ({ id: contact.id, name: contactName(contact), detail: str(contact.email) || undefined }));
  const choice = useSubjectChoice(action.subject, options);
  const field = CONTACT_FIELDS[(action.field ?? "").toLowerCase().replace(/[\s_-]/g, "")] ?? null;
  const [value, setValue] = useState(action.text ?? "");
  // A makeup or hair studio's offer is a quote (trades.ts).
  const offer = tradeVocab(useWorkspace().tenantTrade).proposal.toLowerCase();
  const title = "Correct the client's details";
  if (!ownerOrAdmin) return <OwnerOnly title={title} />;
  if (loading || !contacts) return <ActionShell title={title}><Loading /></ActionShell>;
  if (!job) return <ActionShell title={title}><Blocked>I couldn&apos;t find that job.</Blocked></ActionShell>;
  const contact = onTheJob.find((item) => item.id === choice.chosen) ?? null;
  if (runner.done) return <ActionShell title={title}><Done>{runner.done}</Done></ActionShell>;
  const client = contact
    ? {
        id: contact.id,
        firstName: str(contact.firstName),
        lastName: str(contact.lastName),
        displayName: contactName(contact),
        email: str(contact.email) || null,
        phone: str(contact.phone) || null,
        company: str(contact.company) || null,
        notes: str(contact.notes) || null,
      }
    : null;
  return (
    <ActionShell
      detail={field && client ? `${String((client as Record<string, unknown>)[field] ?? "") || "Not set"} → ${value || "…"}` : "Their name, email or phone."}
      icon={<PencilLine size={15} />}
      title={title}
    >
      {options.length > 1 ? <SubjectPicker {...choice} noun="client" options={options} subject={action.subject} /> : null}
      {client && field ? (
        <>
          <Form>
            <TextField label="New value" onChange={setValue} type={field === "email" ? "email" : "text"} value={value} />
          </Form>
          {field === "email" ? (
            <p className="cue-action-note">{`A ${offer} already sent keeps the address it went to. Correct it from the ${offer} to send a new version.`}</p>
          ) : null}
          <Actions
            busy={runner.busy}
            disabled={!value.trim()}
            label="Save the change"
            onClick={() =>
              void runner.run(
                async () => {
                  await runCrmCommand("updateContact", {
                    contactId: client.id,
                    firstName: client.firstName,
                    lastName: client.lastName,
                    // The stored value, not the name this card shows.
                    displayName: str(contact?.displayName) || null,
                    email: client.email,
                    phone: client.phone,
                    company: client.company,
                    notes: client.notes,
                    [field]: value.trim(),
                  });
                  return `Updated ${contactName(contact)}.`;
                },
                { refresh: ["contacts"] },
              )
            }
          />
        </>
      ) : client ? (
        <Embedded>
          <ClientRecordActions
            archived={Boolean(contact?.archivedAt)}
            client={{
              ...client,
              billingAddress: billingAddressOf(contact?.billingAddress),
              billingAddressByCouple: coupleConfirmed(contact) !== null,
            }}
          />
        </Embedded>
      ) : null}
      <Notice text={runner.notice} />
    </ActionShell>
  );
}

export function AddClientToJobCard({ action }: ActionCardProps) {
  const { job, loading } = useJob(action.projectId);
  const title = `Add a client to ${jobName(job)}`;
  if (loading) return <ActionShell title={title}><Loading /></ActionShell>;
  if (!job) return <ActionShell title={title}><Blocked>I couldn&apos;t find that job.</Blocked></ActionShell>;
  return (
    <ActionShell detail="A partner, parent or planner who should be on the job." icon={<UserPlus size={15} />} title={title}>
      <Embedded>
        <ProjectAddClient archived={Boolean(job.archivedAt)} projectId={job.id} />
      </Embedded>
    </ActionShell>
  );
}

export function PortalInviteCard({ action }: ActionCardProps) {
  const { job, loading } = useJob(action.projectId);
  const contacts = useRecords("contacts");
  const workspace = useWorkspace();
  const runner = useRunner();
  const revoking = action.action === "revoke_portal_invite";
  const onTheJob = (contacts ?? []).filter((contact) => arr(job?.clientContactIds).includes(contact.id));
  const options = onTheJob.map((contact) => ({
    id: contact.id,
    name: contactName(contact),
    detail: str(contact.email) || "No email on file",
  }));
  const choice = useSubjectChoice(action.subject, options);
  const title = revoking ? "Withdraw the portal invitation" : "Invite the client to their portal";
  if (loading || !contacts) return <ActionShell title={title}><Loading /></ActionShell>;
  if (!job) return <ActionShell title={title}><Blocked>I couldn&apos;t find that job.</Blocked></ActionShell>;
  if (runner.done) return <ActionShell title={title}><Done>{runner.done}</Done></ActionShell>;
  const contact = onTheJob.find((item) => item.id === choice.chosen) ?? null;
  const email = str(contact?.email);
  return (
    <ActionShell
      detail={
        revoking
          ? "Their invitation link stops working. Anything they already opened stays as it is."
          : "They get an email with a link to their portal. Sending again keeps the earlier link working."
      }
      icon={<MailPlus size={15} />}
      title={`${title}${job ? ` · ${jobName(job)}` : ""}`}
    >
      {options.length > 1 ? <SubjectPicker {...choice} noun="client" options={options} subject={action.subject} /> : null}
      {!options.length ? <Blocked>This job has no client on it yet.</Blocked> : null}
      {contact && !email && !revoking ? <Blocked>{`${contactName(contact)} has no email on file. Add one first.`}</Blocked> : null}
      <Actions
        busy={runner.busy}
        danger={revoking}
        disabled={!contact || (!revoking && !email) || !workspace.tenantId}
        label={revoking ? "Withdraw it" : `Send to ${email || "them"}`}
        onClick={() =>
          void runner.run(async () => {
            if (!contact || !workspace.tenantId) return null;
            const tenantId = workspace.tenantId;
            if (!revoking) {
              await runClientInvitation({
                type: "invite",
                tenantId,
                idempotencyKey: crypto.randomUUID(),
                input: { contactId: contact.id, projectId: job.id },
              });
              return `Sent ${contactName(contact)} their portal invitation at ${email}.`;
            }
            const status = (await runClientInvitation({
              type: "status",
              tenantId,
              idempotencyKey: crypto.randomUUID(),
              input: { contactId: contact.id },
            })) as Record<string, unknown>;
            const pending = arr(status.invitations)
              .map((item) => item as Record<string, unknown>)
              .filter((item) => item.status === "pending" && (!item.projectId || item.projectId === job.id));
            if (!pending.length) return `${contactName(contact)} has no pending invitation.`;
            for (const invitation of pending)
              await runClientInvitation({
                type: "revoke",
                tenantId,
                idempotencyKey: crypto.randomUUID(),
                input: { invitationId: str(invitation.invitationId) },
              });
            return `Withdrew ${contactName(contact)}'s portal invitation.`;
          })
        }
      />
      <Notice text={runner.notice} />
    </ActionShell>
  );
}

/** Stages a job can be moved to by hand from where it is. */
export function manualTargets(state: string, hold: HoldRecord = {}, trade?: unknown): ProjectState[] {
  const from = state as ProjectState;
  // A held job only goes back where it was held from — Cue offered PLANNING
  // to a job held at PROPOSAL, which skipped the booking gate.
  const resumable = from === "POSTPONED" ? holdResumeStates(hold) : null;
  // A trade with nothing to deliver goes from the day to the review (trades.ts).
  const moves = [...(tradeMoves(trade, from) as ProjectState[]), ...(allowedProjectTransitions[from] ?? [])];
  return moves.filter(
    (to) =>
      // Nor anywhere the trade never goes (post-production, for a DJ).
      tradeAllows(trade, to) &&
      !transitionAuthority(from, to) &&
      to !== "ARCHIVED" &&
      // LOST, reopening and undoing a cancel have their own cards
      // (mark_inquiry_lost, reopen_job, uncancel_job): the plain move
      // skipped their bookkeeping and the server now refuses it.
      transitionRoute(from, to) === "transitionProject" &&
      (!resumable || resumable.includes(to)),
  );
}

function stageFromWords(words: string | null, targets: ProjectState[]): ProjectState | null {
  const text = (words ?? "").toLowerCase().replace(/[\s_-]+/g, " ").trim();
  if (!text) return null;
  return (
    targets.find((target) => projectStateLabel(target).toLowerCase() === text) ??
    targets.find((target) => target.toLowerCase().replace(/_/g, " ") === text) ??
    targets.find((target) => text.includes(projectStateLabel(target).toLowerCase())) ??
    null
  );
}

export function MoveStageCard({ action }: ActionCardProps) {
  const { job, loading } = useJob(action.projectId);
  const runner = useRunner();
  const trade = useWorkspace().tenantTrade;
  const label = (state: string) => projectStateLabel(state, trade);
  const targets = job
    ? manualTargets(
        str(job.state),
        {
          postponedFromState: job.postponedFromState,
          bookingCompletedAt: job.bookingCompletedAt,
        },
        trade,
      )
    : [];
  const [target, setTarget] = useState<string>("");
  const [reason, setReason] = useState("");
  const title = `Move ${jobName(job)} to another stage`;
  if (loading) return <ActionShell title={title}><Loading /></ActionShell>;
  if (!job) return <ActionShell title={title}><Blocked>I couldn&apos;t find that job.</Blocked></ActionShell>;
  if (runner.done) return <ActionShell title={title}><Done>{runner.done}</Done></ActionShell>;
  const chosen = (target || stageFromWords(action.text, targets) || targets[0] || "") as string;
  const needsReason = chosen === "CANCELLED" || chosen === "POSTPONED";
  return (
    <ActionShell
      detail={`It is ${label(str(job.state))} now. Steps that need proof — ${proofSteps(trade)} — move on their own when that happens and can't be set here.`}
      icon={<Route size={15} />}
      title={title}
    >
      {!targets.length ? (
        <Blocked>{`From ${label(str(job.state))}, the next step happens on its own when its evidence arrives.`}</Blocked>
      ) : (
        <Form>
          <SelectField
            label="Move it to"
            onChange={setTarget}
            options={targets.map((value) => ({ value, label: label(value) }))}
            value={chosen}
          />
          {needsReason ? (
            <TextAreaField
              hint="Crew offers are withdrawn and accepted crew are told."
              label="Why (at least a sentence)"
              onChange={setReason}
              rows={2}
              value={reason}
            />
          ) : null}
        </Form>
      )}
      {targets.length ? (
        <Actions
          busy={runner.busy}
          danger={needsReason}
          disabled={!chosen || (needsReason && reason.trim().length < 10)}
          label={`Move to ${label(chosen)}`}
          onClick={() =>
            void runner.run(
              async () => {
                const expectedVersion = await freshStateVersion(job.id, job.stateVersion);
                await runCrmCommand("transitionProject", {
                  projectId: job.id,
                  expectedVersion,
                  targetState: chosen,
                  reason: reason.trim() || null,
                });
                return `${jobName(job)} is now ${label(chosen)}.`;
              },
              { refresh: ["projects", "readinessAssessments", "crewAssignments"] },
            )
          }
        />
      ) : null}
      <Notice text={runner.notice} />
    </ActionShell>
  );
}

export function ArchiveJobCard({ action }: ActionCardProps) {
  const { job, loading } = useJob(action.projectId);
  const ownerOrAdmin = useIsOwnerOrAdmin();
  const runner = useRunner();
  const restore = action.action === "restore_job";
  const title = restore ? `Restore ${jobName(job)}` : `Archive ${jobName(job)}`;
  if (!ownerOrAdmin) return <OwnerOnly title={title} />;
  if (loading) return <ActionShell title={title}><Loading /></ActionShell>;
  if (!job) return <ActionShell title={title}><Blocked>I couldn&apos;t find that job.</Blocked></ActionShell>;
  if (runner.done) return <ActionShell title={title}><Done>{runner.done}</Done></ActionShell>;
  const archived = Boolean(job.archivedAt);
  if (restore && !archived) return <ActionShell title={title}><Done>{`${jobName(job)} isn't archived.`}</Done></ActionShell>;
  if (!restore && archived) return <ActionShell title={title}><Done>{`${jobName(job)} is already archived.`}</Done></ActionShell>;
  return (
    <ActionShell
      detail={restore ? "It comes back to your jobs as it was." : "It leaves your jobs and nothing more is sent for it. You can restore it."}
      icon={restore ? <RotateCcw size={15} /> : <Archive size={15} />}
      title={title}
    >
      <Actions
        busy={runner.busy}
        label={restore ? "Restore it" : "Archive it"}
        onClick={() =>
          void runner.run(
            async () => {
              await runCrmCommand("archiveProject", { projectId: job.id, restore });
              return restore ? `${jobName(job)} is restored.` : `${jobName(job)} is archived.`;
            },
            { refresh: ["projects"] },
          )
        }
      />
      <Notice text={runner.notice} />
    </ActionShell>
  );
}

export function DeleteJobCard({ action }: ActionCardProps) {
  const { job, loading } = useJob(action.projectId);
  const workspace = useWorkspace();
  const title = `Delete ${jobName(job)} permanently`;
  if (workspace.role !== "studio_owner") return (
    <ActionShell title={title}>
      <Blocked>Only the studio owner can delete a job permanently. Archiving keeps it out of the way.</Blocked>
    </ActionShell>
  );
  if (loading) return <ActionShell title={title}><Loading /></ActionShell>;
  if (!job) return <ActionShell title={title}><Blocked>I couldn&apos;t find that job.</Blocked></ActionShell>;
  return (
    <ActionShell
      detail="Everything on it is erased and can't be recovered. You type the job's name to confirm."
      icon={<Trash2 size={15} />}
      title={title}
    >
      <Embedded>
        <DeleteJobPermanently projectId={job.id} projectName={jobName(job)} />
      </Embedded>
    </ActionShell>
  );
}

export { OwnerOnly, primaryContact };

/**
 * Cancel a job (Wave 3). Cue used `move_job_stage` for this, which said what
 * a hold does but not what a cancel does. This card says it, and offers the
 * same "Tell the couple" choice the job page does — off by default.
 */
export function CancelJobCard({ action }: ActionCardProps) {
  const { job, loading } = useJob(action.projectId);
  const runner = useRunner();
  const [reason, setReason] = useState(action.text ?? "");
  const [tell, setTell] = useState(false);
  const [message, setMessage] = useState("");
  const title = `Cancel ${jobName(job)}`;
  if (loading) return <ActionShell title={title}><Loading /></ActionShell>;
  if (!job) return <ActionShell title={title}><Blocked>I couldn&apos;t find that job.</Blocked></ActionShell>;
  if (runner.done) return <ActionShell title={title}><Done>{runner.done}</Done></ActionShell>;
  const state = str(job.state) as ProjectState;
  if (state === "CANCELLED") return <ActionShell title={title}><Done>{`${jobName(job)} is already canceled.`}</Done></ActionShell>;
  if (!interruptionsFor(state).includes("CANCELLED"))
    return (
      <ActionShell title={title}>
        <Blocked>
          {PRE_BOOKING.has(state)
            ? `${jobName(job)} is still an inquiry. Mark it lost instead — that records why and stops its follow-ups.`
            : `${jobName(job)} is ${projectStateLabel(state).toLowerCase()}, and a job can't be canceled after the event.`}
        </Blocked>
      </ActionShell>
    );
  return (
    <ActionShell
      detail={`Crew are released (anyone who accepted is emailed), billing stops with tasks to void open invoices, an unsigned agreement is withdrawn, the job comes off your calendar, and StudioCue stops emailing the client. The owner can undo it for ${UNCANCEL_WINDOW_DAYS} days, but the crew, invoices and agreement don't come back on their own.`}
      icon={<CircleSlash size={15} />}
      title={title}
    >
      <Form>
        <TextAreaField label="Why (at least a sentence)" onChange={setReason} rows={2} value={reason} />
        <CheckField checked={tell} label="Tell the client by email" onChange={setTell} />
        {tell ? (
          <TextAreaField
            hint="Leave empty for a short note that the booking is canceled."
            label="Your message"
            onChange={setMessage}
            rows={3}
            value={message}
          />
        ) : null}
      </Form>
      <Actions
        busy={runner.busy}
        danger
        disabled={reason.trim().length < 10}
        label="Cancel the job"
        onClick={() =>
          void runner.run(
            async () => {
              const expectedVersion = await freshStateVersion(job.id, job.stateVersion);
              await runCrmCommand("transitionProject", {
                projectId: job.id,
                expectedVersion,
                targetState: "CANCELLED",
                reason: reason.trim(),
                notifyClient: tell,
                clientMessage: tell ? message.trim() || null : null,
              });
              return `${jobName(job)} is canceled.${tell ? " The client is being emailed." : ""}`;
            },
            { refresh: ["projects", "crewAssignments", "invoiceReferences", "contracts", "tasks"] },
          )
        }
      />
      <Notice text={runner.notice} />
    </ActionShell>
  );
}

/** Undo a cancel, or reopen a finished job (Wave 3). Owner only, with a reason. */
export function GoBackJobCard({ action }: ActionCardProps) {
  const { job, loading } = useJob(action.projectId);
  const workspace = useWorkspace();
  const runner = useRunner();
  const [reason, setReason] = useState(action.text ?? "");
  const uncancel = action.action === "uncancel_job";
  const title = uncancel ? `Undo the cancel: ${jobName(job)}` : `Reopen ${jobName(job)}`;
  if (workspace.role !== "studio_owner")
    return <ActionShell title={title}><Blocked>Only the studio owner can do this.</Blocked></ActionShell>;
  if (loading) return <ActionShell title={title}><Loading /></ActionShell>;
  if (!job) return <ActionShell title={title}><Blocked>I couldn&apos;t find that job.</Blocked></ActionShell>;
  if (runner.done) return <ActionShell title={title}><Done>{runner.done}</Done></ActionShell>;
  // The trade decides whether there is an edit to go back to: a DJ, makeup
  // artist or hair stylist delivers nothing after the day (trades.ts).
  const delivers = tradeProfile(workspace.tenantTrade).delivery;
  const move = backwardMovesFor(
    { ...job, state: str(job.state), id: job.id },
    { agreementOut: false, now: new Date().toISOString(), trade: workspace.tenantTrade },
  ).find((candidate) => candidate.route === (uncancel ? "uncancelProject" : "reopenJob"));
  if (!move) {
    const state = str(job.state);
    const refusal = uncancel
      ? uncancelRefusal(
          { state: job.state, cancelledFromState: job.cancelledFromState, cancelledAt: job.cancelledAt, interruptionAt: job.interruptionAt },
          new Date().toISOString(),
        )
      : null;
    return (
      <ActionShell title={title}>
        <Blocked>
          {uncancel
            ? refusal === "NOT_CANCELLED"
              ? `${jobName(job)} isn't canceled.`
              : refusal === "UNCANCEL_WINDOW_PASSED"
                ? `${jobName(job)} was canceled more than ${UNCANCEL_WINDOW_DAYS} days ago, so it can't be undone. Create a new job for the client instead.`
                : `${jobName(job)} was canceled before StudioCue recorded where it stood, so it can't be brought back. Create a new job instead.`
            : `${jobName(job)} is ${projectStateLabel(state, workspace.tenantTrade).toLowerCase()}. ${delivers ? "Only a delivered or closed job is reopened." : "Only a closed job is reopened."}`}
        </Blocked>
      </ActionShell>
    );
  }
  return (
    <ActionShell detail={move.detail} icon={<RotateCcw size={15} />} title={title}>
      <Form>
        <TextAreaField label="Why (at least a sentence)" onChange={setReason} rows={2} value={reason} />
      </Form>
      <Actions
        busy={runner.busy}
        disabled={reason.trim().length < 10}
        label={move.label}
        onClick={() =>
          void runner.run(
            async () => {
              const expectedVersion = await freshStateVersion(job.id, job.stateVersion);
              if (uncancel)
                await runCrmCommand("uncancelProject", { projectId: job.id, expectedVersion, reason: reason.trim() });
              else
                await runCrmCommand("reopenJob", {
                  projectId: job.id,
                  expectedVersion,
                  targetState: move.target,
                  reason: reason.trim(),
                });
              return uncancel
                ? `${jobName(job)} is back at ${projectStateLabel(move.target)}. Re-offer the crew and re-send any invoice or agreement it needs.`
                : delivers
                  ? `${jobName(job)} is back at ${projectStateLabel(move.target)}. Review and album asks are paused until you deliver again.`
                  : `${jobName(job)} is open again. The review ask is paused until you close it.`;
            },
            { refresh: ["projects"] },
          )
        }
      />
      <Notice text={runner.notice} />
    </ActionShell>
  );
}

/**
 * An inquiry that never became a job: close it, reopen it, or bring back one
 * marked "not an inquiry" (Wave 3). The job-scoped cards can't reach these —
 * there is no job — so the lead is picked by name.
 */
export function LeadLifecycleCard({ action }: ActionCardProps) {
  const leads = useRecords("leads");
  const ownerOrAdmin = useIsOwnerOrAdmin();
  const runner = useRunner();
  const [reason, setReason] = useState(reasonFromWords(action.text, "went_quiet"));
  const [unignore, setUnignore] = useState(false);
  const kind = action.action as "close_lead" | "reopen_lead" | "restore_inquiry";
  const candidates = (leads ?? []).filter((lead) => {
    if (kind === "restore_inquiry") return lead.notInquiry === true;
    if (lead.projectId || lead.notInquiry === true) return false;
    return kind === "reopen_lead"
      ? lead.status === "lost"
      : !["lost", "archived", "converted"].includes(str(lead.status));
  });
  const options = candidates.map((lead) => ({
    id: lead.id,
    name: leadName(lead),
    detail: [str(lead.eventDate), str(lead.email)].filter(Boolean).join(" · ") || undefined,
  }));
  const choice = useSubjectChoice(action.subject, options);
  const title =
    kind === "restore_inquiry" ? "Bring back an inquiry" : kind === "reopen_lead" ? "Reopen an inquiry" : "Close an inquiry";
  if (kind === "restore_inquiry" && !ownerOrAdmin) return <OwnerOnly title={title} />;
  if (!leads) return <ActionShell title={title}><Loading /></ActionShell>;
  if (runner.done)
    return <ActionShell title={title}><Done href="/studio/leads" label="Open Inquiries">{runner.done}</Done></ActionShell>;
  const lead = candidates.find((item) => item.id === choice.chosen) ?? null;
  const sender = ignorableSenderOf(lead);
  return (
    <ActionShell
      detail={
        kind === "restore_inquiry"
          ? "It comes back to Inquiries, and so does its job if it had one."
          : kind === "reopen_lead"
            ? "It goes back to Inquiries as a new inquiry, and its link works again."
            : "It moves to Closed on Inquiries, and the link the client was sent stops offering a call."
      }
      icon={<Inbox size={15} />}
      title={title}
    >
      <SubjectPicker {...choice} noun="inquiry" options={options} subject={action.subject} />
      {kind === "close_lead" ? (
        <Form>
          <SelectField label="Why" onChange={setReason} options={CLOSE_REASONS} value={reason} />
        </Form>
      ) : null}
      {kind === "restore_inquiry" && sender ? (
        <Form>
          <CheckField
            checked={unignore}
            label={`Also start capturing mail from ${sender} again, if it was ignored`}
            onChange={setUnignore}
          />
        </Form>
      ) : null}
      <Actions
        busy={runner.busy}
        disabled={!lead}
        label={title}
        onClick={() =>
          void runner.run(
            async () => {
              if (!lead) return null;
              if (kind === "restore_inquiry") {
                await runCrmCommand("restoreInquiry", { leadId: lead.id, unignoreSender: unignore });
                return `${leadName(lead)} is back on Inquiries.`;
              }
              await runCrmCommand(kind === "close_lead" ? "closeInquiry" : "reopenInquiry", {
                projectId: null,
                leadId: lead.id,
                ...(kind === "close_lead" ? { reason } : {}),
              });
              return kind === "close_lead" ? `${leadName(lead)} is closed.` : `${leadName(lead)} is open again.`;
            },
            { refresh: ["leads", "projects", "aiActions"] },
          )
        }
      />
      <Notice text={runner.notice} />
    </ActionShell>
  );
}
