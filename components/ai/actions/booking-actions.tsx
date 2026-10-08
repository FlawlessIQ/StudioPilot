"use client";

import { isSalesConsultation } from "@/features/consultations/purpose";
import Link from "next/link";
import { useEffect, useState } from "react";
import { CalendarClock, CalendarX, FileSignature, FileText, HandCoins, Landmark, PackageOpen, Receipt, Send, ShieldCheck } from "lucide-react";
import { refreshTenantRecords } from "@/components/live/tenant-records";
import { runCrmCommand } from "@/lib/crm/command-client";
import { runProposalCommand } from "@/lib/proposals/command-client";
import {
  lookupQuickBooksPayments,
  queryConsultationAvailability,
  sendBookingCommand,
} from "@/lib/booking/command-client";
import { addCalendarDays, todayLocalIso } from "@/lib/format/event-date";
import { ProposalPackagesPanel } from "@/components/proposals/proposal-packages-panel";
import { RecordProposalAcceptance } from "@/components/booking/record-proposal-acceptance";
import { RecordSignedAgreement } from "@/components/booking/record-signed-agreement";
import { RecordRetainerPayment } from "@/components/booking/record-retainer-payment";
import { RecordFinalPayment } from "@/components/booking/record-final-payment";
import { FinalBalanceActions } from "@/components/booking/final-balance-actions";
import { JobSalesTax } from "@/components/booking/job-sales-tax";
import { outstandingFinalBalance } from "@/features/booking/final-balance-due";
import { proposalTermsForPackages } from "@/features/booking/autopilot";
import { briefRerunBlocked } from "@/features/booking/brief-run";
import { currentJobSnapshots } from "@/features/packages/job-packages";
import { BookWithoutRetainer } from "@/components/booking/book-without-retainer";
import { ImportedBookingBanner } from "@/components/imports/imported-booking-banner";
import { ExistingBookingForm } from "@/components/imports/existing-booking-form";
import { NativeContractStep } from "@/components/contracts/native-contract-step";
import { retainerFromSchedule } from "@/features/booking/agreed-retainer";
import { isStandingInvoice } from "@/features/booking/invoice-standing";
import { invoiceVoidRefusal, paymentCorrectable } from "@/features/booking/invoice-corrections";
import { ApproveFinalInvoice, CorrectPayment, RecordInvoicePayment, VoidInvoice } from "@/components/booking/invoice-corrections";
import { HeldInvoiceReview } from "@/components/booking/held-invoice-review";
import { invoicePaymentRefusal } from "@/features/booking/invoice-payments";
import { statusLabel } from "@/features/format/status-label";
import { bookedOnceClause, dateClashes, projectProfile } from "@/features/job-kinds/job-kinds";
import { AMENDABLE_STATES, BookingAmendmentPanel } from "@/components/booking/booking-amendment";
import { SignedCopySharing } from "@/components/contracts/signed-copy-sharing";
import { FILE_BEARING } from "@/features/documents/file-ref";
import { bookingBlockerLabel } from "@/features/booking/blocker-label";
import { useZoomConnected } from "@/components/integrations/use-capability";
import { defaultConsultationMode } from "@/features/consultations/meeting-mode";
import { useNativeSigning } from "@/components/contracts/use-native-signing";
import {
  ACCEPTANCE_AGREEMENT_OUT,
  packageChangeAlreadyApplied,
  proposalAlreadyRevised,
} from "@/features/proposals/workspace-guards";
import { runPublicScheduling } from "@/lib/booking/public-scheduling-client";
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
  browserZone,
  contactName,
  currentProposal,
  dollars,
  freshStateVersion,
  isoFrom,
  jobName,
  num,
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

// ─── Consultations ──────────────────────────────────────────────────────────

const MODES = [
  { value: "zoom", label: "Zoom" },
  { value: "in_person", label: "In person" },
  { value: "phone", label: "Phone" },
];

/** The way to meet the operator named, or null when they named none. */
function modeFromWords(words: string | null): string | null {
  const text = (words ?? "").toLowerCase();
  if (/in.?person|coffee|studio|meet (at|up)|office/.test(text)) return "in_person";
  if (/phone|call me|ring/.test(text)) return "phone";
  if (/zoom|video/.test(text)) return "zoom";
  return null;
}

const when = (iso: unknown): string => {
  const value = new Date(str(iso));
  return Number.isNaN(value.getTime())
    ? "a time not set"
    : value.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};

/** Studio consultation length and the busy calendar, read once per card. */
function useAvailability() {
  const [state, setState] = useState<{ duration: number; busy: Array<{ start: string; end: string }> } | null>(null);
  useEffect(() => {
    let active = true;
    void queryConsultationAvailability()
      .then((result) => {
        if (!active) return;
        if (result.mode === "preview") setState({ duration: 30, busy: [] });
        else
          setState({
            duration: num(result.payload.settings?.durationMinutes) || 30,
            busy: result.payload.busy ?? [],
          });
      })
      .catch(() => active && setState({ duration: 30, busy: [] }));
    return () => {
      active = false;
    };
  }, []);
  return state;
}

function overlaps(busy: Array<{ start: string; end: string }>, startsAt: string, endsAt: string): boolean {
  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);
  return busy.some((slot) => Date.parse(slot.start) < end && Date.parse(slot.end) > start);
}

export function ScheduleConsultationCard({ action }: ActionCardProps) {
  const { job, loading } = useJob(action.projectId);
  const contacts = useRecords("contacts");
  const availability = useAvailability();
  const runner = useRunner();
  const [date, setDate] = useState(action.date ?? "");
  const [time, setTime] = useState(action.time ?? "");
  // Unnamed, it is Zoom only when Zoom is connected — otherwise a "video
  // call" with no link (features/consultations/meeting-mode.ts).
  const zoomConnected = useZoomConnected();
  const [picked, setMode] = useState<string | null>(modeFromWords(action.text));
  const mode = picked ?? defaultConsultationMode(zoomConnected);
  const [location, setLocation] = useState("");
  const title = `Book a consultation with ${jobName(job)}`;
  if (loading || !contacts || !availability) return <ActionShell title={title}><Loading /></ActionShell>;
  if (!job) return notFound(title);
  if (runner.done) return <ActionShell title={title}><Done href="/studio/calendar" label="Open the calendar">{runner.done}</Done></ActionShell>;
  const contact = primaryContact(job, contacts);
  const startsAt = isoFrom(date, time);
  const endsAt = startsAt ? new Date(Date.parse(startsAt) + availability.duration * 60000).toISOString() : null;
  const clash = startsAt && endsAt ? overlaps(availability.busy, startsAt, endsAt) : false;
  return (
    <ActionShell
      detail={`${availability.duration} minutes. ${contactName(contact)} gets a confirmation email${
        mode === "zoom"
          ? zoomConnected
            ? " with the Zoom link"
            : " saying you'll send the video link — Zoom isn't connected, so send it yourself"
          : ""
      }, and it goes on your calendar.`}
      icon={<CalendarClock size={15} />}
      title={title}
    >
      {!contact ? <Blocked>This job has no client on it yet.</Blocked> : null}
      <Form>
        <TextField label="Date" onChange={setDate} type="date" value={date} />
        <TextField hint={`Your time zone (${browserZone()})`} label="Time" onChange={setTime} type="time" value={time} />
        <SelectField label="How" onChange={setMode} options={MODES} value={mode} />
        {mode === "in_person" ? <TextField label="Where" onChange={setLocation} value={location} /> : null}
      </Form>
      {clash ? <Blocked>You already have something on your calendar at that time.</Blocked> : null}
      <Actions
        busy={runner.busy}
        disabled={!contact || !startsAt}
        label="Book it and tell them"
        onClick={() =>
          void runner.run(
            async () => {
              if (!contact || !startsAt || !endsAt) return null;
              await sendBookingCommand({
                type: "scheduleConsultation",
                idempotencyKey: crypto.randomUUID(),
                input: {
                  projectId: job.id,
                  contactId: contact.id,
                  mode,
                  startsAt,
                  endsAt,
                  timezone: browserZone(),
                  location: mode === "in_person" ? location.trim() || null : null,
                },
              });
              return `Booked for ${when(startsAt)}. ${contactName(contact)} is being emailed a confirmation.`;
            },
            { refresh: ["consultations", "projects"] },
          )
        }
      />
      <Notice text={runner.notice} />
    </ActionShell>
  );
}

/** Whether the booking command emailed the couple (it says, on a move or cancel). */
function notifiedOf(outcome: Awaited<ReturnType<typeof sendBookingCommand>>): boolean {
  return outcome.mode === "live" && outcome.payload.clientNotified === true;
}

/** Reschedule, cancel or write up a consultation already on the calendar. */
export function ExistingConsultationCard({ action }: ActionCardProps) {
  const { job, loading } = useJob(action.projectId);
  const consultations = useRecords("consultations");
  const availability = useAvailability();
  const runner = useRunner();
  const kind = action.action;
  const [date, setDate] = useState(action.date ?? "");
  const [time, setTime] = useState(action.time ?? "");
  const [reason, setReason] = useState(kind === "cancel_consultation" ? action.text ?? "" : "");
  const [notes, setNotes] = useState(kind === "complete_consultation" ? action.text ?? "" : "");
  const titles: Record<string, string> = {
    reschedule_consultation: "Move the consultation",
    cancel_consultation: "Cancel the consultation",
    complete_consultation: "Write up the consultation",
  };
  const title = `${titles[kind]} · ${jobName(job)}`;
  if (loading || !consultations || !availability) return <ActionShell title={title}><Loading /></ActionShell>;
  if (!job) return notFound(title);
  if (runner.done) return <ActionShell title={title}><Done>{runner.done}</Done></ActionShell>;
  const statuses = kind === "complete_consultation" ? ["scheduled", "completed"] : ["scheduled"];
  // Completing runs the consultation brief: never on the final details call.
  const booked = onJob(consultations, job.id)
    .filter((item) => kind !== "complete_consultation" || isSalesConsultation(item))
    .filter((item) => statuses.includes(str(item.status)) && !item.archivedAt)
    .sort((a, b) => str(b.startsAt).localeCompare(str(a.startsAt)));
  const consultation = booked[0] ?? null;
  if (!consultation)
    return <ActionShell title={title}><Blocked>{`There is no booked consultation on ${jobName(job)}.`}</Blocked></ActionShell>;
  const length = Math.max(15, (Date.parse(str(consultation.endsAt)) - Date.parse(str(consultation.startsAt))) / 60000 || availability.duration);
  const startsAt = isoFrom(date, time);
  const endsAt = startsAt ? new Date(Date.parse(startsAt) + length * 60000).toISOString() : null;
  if (kind === "complete_consultation" && str(job.state) !== "CONSULTATION")
    return (
      <ActionShell title={title}>
        <Blocked>{`${jobName(job)} has moved past the consultation stage, so its notes are no longer recorded from here.`}</Blocked>
      </ActionShell>
    );
  return (
    <ActionShell
      detail={
        kind === "reschedule_consultation"
          ? `Now ${when(consultation.startsAt)}. They're emailed the new time, and your calendar${consultation.joinUrl ? " and the Zoom meeting" : ""} follow it.`
          : kind === "cancel_consultation"
            ? `${when(consultation.startsAt)}. They're emailed that it's canceled; it comes off your calendar${consultation.joinUrl ? " and the Zoom meeting is removed" : ""}.`
            : `${when(consultation.startsAt)}. Your notes feed the proposal and the job's brief.`
      }
      icon={kind === "cancel_consultation" ? <CalendarX size={15} /> : <CalendarClock size={15} />}
      title={title}
    >
      <Form>
        {kind === "reschedule_consultation" ? (
          <>
            <TextField label="New date" onChange={setDate} type="date" value={date} />
            <TextField hint={`Your time zone (${browserZone()})`} label="New time" onChange={setTime} type="time" value={time} />
          </>
        ) : null}
        {kind === "cancel_consultation" ? (
          <TextField label="Reason (optional, for your records)" onChange={setReason} value={reason} />
        ) : null}
        {kind === "complete_consultation" ? (
          <TextAreaField hint="What they want, what you discussed, what comes next." label="Notes" onChange={setNotes} rows={6} value={notes} />
        ) : null}
      </Form>
      {kind === "reschedule_consultation" && startsAt && endsAt && overlaps(availability.busy, startsAt, endsAt) ? (
        <Blocked>You already have something on your calendar at that time.</Blocked>
      ) : null}
      <Actions
        busy={runner.busy}
        danger={kind === "cancel_consultation"}
        disabled={
          (kind === "reschedule_consultation" && !startsAt) ||
          (kind === "complete_consultation" && notes.trim().length < 20)
        }
        label={
          kind === "reschedule_consultation" ? "Move it" : kind === "cancel_consultation" ? "Cancel it" : "Save the notes"
        }
        onClick={() =>
          void runner.run(
            async () => {
              if (kind === "reschedule_consultation") {
                const moved = await sendBookingCommand({
                  type: "rescheduleConsultation",
                  idempotencyKey: crypto.randomUUID(),
                  input: { projectId: job.id, consultationId: consultation.id, startsAt, endsAt, timezone: browserZone() },
                });
                return notifiedOf(moved)
                  ? `Moved to ${when(startsAt)}. They're being emailed the new time.`
                  : `Moved to ${when(startsAt)}. They weren't emailed, so let them know.`;
              }
              if (kind === "cancel_consultation") {
                const cancelled = await sendBookingCommand({
                  type: "cancelConsultation",
                  idempotencyKey: crypto.randomUUID(),
                  input: { projectId: job.id, consultationId: consultation.id, reason: reason.trim() || null },
                });
                return notifiedOf(cancelled)
                  ? "The consultation is canceled, and they're being emailed."
                  : "The consultation is canceled. They weren't emailed, so let them know.";
              }
              await sendBookingCommand({
                type: "completeConsultation",
                idempotencyKey: crypto.randomUUID(),
                input: { projectId: job.id, consultationId: consultation.id, notes: notes.trim() },
              });
              return "Notes saved. The consultation is marked as held.";
            },
            { refresh: ["consultations", "projects"] },
          )
        }
      />
      {kind === "complete_consultation" && notes.trim().length > 0 && notes.trim().length < 20 ? (
        <p className="cue-action-note">A little more — at least a sentence.</p>
      ) : null}
      <Notice text={runner.notice} />
    </ActionShell>
  );
}

/**
 * Prepare the booking brief again from changed notes (rerunBookingBrief).
 *
 * The notes are the consultation's as saved, with anything the operator just
 * told Cue added underneath, for them to check before a new run is paid for.
 */
export function BookingBriefCard({ action }: ActionCardProps) {
  const { job, loading } = useJob(action.projectId);
  const consultations = useRecords("consultations");
  const proposals = useRecords("proposals");
  const runner = useRunner();
  const [notes, setNotes] = useState<string | null>(null);
  const title = `Prepare the brief again · ${jobName(job)}`;
  if (loading || !consultations || !proposals) return <ActionShell title={title}><Loading /></ActionShell>;
  if (!job) return notFound(title);
  if (runner.done)
    return (
      <ActionShell title={title}>
        <Done href={`/studio/booking?project=${job.id}`} label="Open the booking brief">{runner.done}</Done>
      </ActionShell>
    );
  const consultation =
    onJob(consultations, job.id)
      .filter((item) => str(item.status) === "completed" && !item.archivedAt)
      .sort((a, b) => str(b.startsAt).localeCompare(str(a.startsAt)))[0] ?? null;
  const blocked = briefRerunBlocked({
    consultationStatus: str(consultation?.status),
    projectState: str(job.state),
    proposalStatuses: onJob(proposals, job.id).map((item) => str(item.status)),
  });
  if (blocked || !consultation)
    return <ActionShell title={title}><Blocked>{blocked ?? "Write up the consultation first — the brief is prepared from its notes."}</Blocked></ActionShell>;
  const saved = str(consultation.internalNotes);
  const added = (action.text ?? "").trim();
  const value = notes ?? (added && !saved.includes(added) ? `${saved}\n\n${added}`.trim() : saved);
  return (
    <ActionShell
      detail="A new brief, package suggestion and proposal draft from these notes — one AI action. The current ones are set aside, not deleted. Nothing is sent to the client."
      icon={<FileText size={15} />}
      title={title}
    >
      <Form>
        <TextAreaField label="Consultation notes" onChange={setNotes} rows={7} value={value} />
      </Form>
      <Actions
        busy={runner.busy}
        disabled={value.trim().length < 20}
        label="Prepare it again"
        onClick={() =>
          void runner.run(
            async () => {
              const outcome = await sendBookingCommand({
                type: "rerunBookingBrief",
                idempotencyKey: crypto.randomUUID(),
                input: { projectId: job.id, consultationId: consultation.id, notes: value.trim() },
              });
              if (outcome.mode === "preview") return "Preview mode — the brief was not prepared again.";
              return "Notes saved. The new brief is being prepared and shows on the booking page in a minute or so.";
            },
            { refresh: ["consultations", "aiActions"] },
          )
        }
      />
      <Notice text={runner.notice} />
    </ActionShell>
  );
}

// ─── Packages and proposals ─────────────────────────────────────────────────

const REVISABLE = ["draft", "internal_review", "approved", "sent", "viewed", "accepted"];

function revisableProposal(proposals: Rec[] | null, projectId: string): Rec | null {
  return (
    onJob(proposals, projectId)
      .filter((item) => REVISABLE.includes(str(item.status)))
      .sort((a, b) => num(b.version) - num(a.version))[0] ?? null
  );
}

/** Swap or remove a package: the proposal page's own Packages panel. */
export function ChangePackagesCard({ action }: ActionCardProps) {
  const { job, loading } = useJob(action.projectId);
  const proposals = useRecords("proposals");
  const contacts = useRecords("contacts");
  const snapshots = useRecords("packageSnapshots");
  const runner = useRunner();
  const removing = action.action === "remove_package";
  const discounting = action.action === "set_package_discount";
  const title = `${removing ? "Remove a package from" : discounting ? "Change the discount on" : "Swap the package on"} ${jobName(job)}`;
  if (loading || !proposals || !contacts || !snapshots) return <ActionShell title={title}><Loading /></ActionShell>;
  if (!job) return notFound(title);
  if (signedBookingChange(job))
    return <ChangeBookingCard action={action} />;
  const proposal = revisableProposal(proposals, job.id);
  if (proposal)
    return (
      <ActionShell
        detail={
          str(proposal.status) === "accepted"
            ? "They've accepted. A change makes a revised proposal for them to accept; the accepted one stays in the history."
            : discounting
              ? "Use Discount beside the package: percent or amount off. The proposal is priced again."
              : "The proposal is priced again when you change it."
        }
        icon={<PackageOpen size={15} />}
        title={title}
      >
        <Embedded>
          <ProposalPackagesPanel
            coupleName={contactName(primaryContact(job, contacts))}
            onRevisedInPlace={() => refreshTenantRecords("proposals", "projects", "packageSnapshots")}
            projectId={job.id}
            proposalId={proposal.id}
            status={str(proposal.status)}
          />
        </Embedded>
      </ActionShell>
    );
  // No proposal yet: the packages on the job are all there is to change.
  const ids = [str(job.packageSnapshotId), ...arr(job.additionalPackageSnapshotIds).map(String)].filter(Boolean);
  const onTheJob = snapshots.filter((snapshot) => ids.includes(snapshot.id));
  if (!onTheJob.length)
    return <ActionShell title={title}><Blocked>{`${jobName(job)} has no package yet. Ask me to choose one.`}</Blocked></ActionShell>;
  if (discounting)
    return (
      <ActionShell title={title}>
        <Blocked>{`The discount is set on the proposal's packages, and ${jobName(job)} has no proposal yet. Ask me to draft one, then change the discount.`}</Blocked>
      </ActionShell>
    );
  if (!removing)
    return (
      <ActionShell title={title}>
        <Blocked>No proposal has been made yet, so pick the new package with “choose a package” and remove the old one here.</Blocked>
      </ActionShell>
    );
  return <RemovePackageList action={action} job={job} runner={runner} snapshots={onTheJob} title={title} />;
}

function RemovePackageList({
  action,
  job,
  snapshots,
  title,
  runner,
}: {
  action: ActionCardProps["action"];
  job: Rec;
  snapshots: Rec[];
  title: string;
  runner: ReturnType<typeof useRunner>;
}) {
  const options = snapshots.map((snapshot) => ({
    id: snapshot.id,
    name: str(snapshot.packageName) || str(snapshot.name) || "Package",
    detail: dollars(snapshot.totalCents ?? snapshot.basePriceCents),
  }));
  const choice = useSubjectChoice(action.subject, options);
  if (runner.done) return <ActionShell title={title}><Done>{runner.done}</Done></ActionShell>;
  const chosen = options.find((option) => option.id === choice.chosen);
  return (
    <ActionShell detail="A job keeps at least one package." icon={<PackageOpen size={15} />} title={title}>
      <SubjectPicker {...choice} noun="package" options={options} subject={action.subject} />
      <Actions
        busy={runner.busy}
        danger
        disabled={!chosen || snapshots.length < 2}
        label={chosen ? `Remove ${chosen.name}` : "Remove it"}
        onClick={() =>
          void runner.run(
            async () => {
              if (!chosen) return null;
              await runCrmCommand("removePackage", { projectId: job.id, packageSnapshotId: chosen.id });
              return `Removed ${chosen.name} from ${jobName(job)}.`;
            },
            { refresh: ["projects", "packageSnapshots"] },
          )
        }
      />
      {snapshots.length < 2 ? <p className="cue-action-note">It is the job&apos;s only package.</p> : null}
      <Notice text={runner.notice} />
    </ActionShell>
  );
}

export function PackageRequestCard({ action }: ActionCardProps) {
  const { job, loading } = useJob(action.projectId);
  const requests = useRecords("packageRequests");
  const proposals = useRecords("proposals");
  const runner = useRunner();
  const approving = action.action === "approve_package_request";
  const title = `${approving ? "Add the package they asked for" : "Decline their package request"} · ${jobName(job)}`;
  const pending = onJob(requests, action.projectId).filter((item) => item.status === "pending");
  const requestName = (item: Rec) =>
    str(item.kind) === "date_change" ? `Move the date to ${str(item.requestedDate)}` : str(item.packageName) || "Package";
  const options = pending.map((item) => ({ id: item.id, name: requestName(item), detail: str(item.note) || undefined }));
  const choice = useSubjectChoice(action.subject, options);
  if (loading || !requests || !proposals) return <ActionShell title={title}><Loading /></ActionShell>;
  if (!job) return notFound(title);
  if (runner.done) return <ActionShell title={title}><Done>{runner.done}</Done></ActionShell>;
  if (!pending.length) return <ActionShell title={title}><Done>{`${jobName(job)} has no package request waiting.`}</Done></ActionShell>;
  const request = pending.find((item) => item.id === choice.chosen) ?? null;
  const proposal = revisableProposal(proposals, job.id);
  // Signed: the answer is a booking change they sign, prefilled with the ask.
  if (approving && AMENDABLE_STATES.includes(str(job.state)))
    return (
      <ActionShell
        detail="They've signed, so this is a booking change for them to sign. Their agreement stands until they do."
        icon={<PackageOpen size={15} />}
        title={`Write up the change they asked for · ${jobName(job)}`}
      >
        {options.length > 1 ? <SubjectPicker {...choice} noun="request" options={options} subject={action.subject} /> : null}
        {request ? (
          <BookingAmendmentPanel
            key={request.id}
            prefill={{
              eventDate: str(request.kind) === "date_change" ? str(request.requestedDate) || null : null,
              addPackageIds: str(request.kind) === "date_change" ? [] : [str(request.packageId)].filter(Boolean),
            }}
            projectId={job.id}
          />
        ) : null}
      </ActionShell>
    );
  if (approving && request && str(request.kind) === "date_change")
    return (
      <ActionShell icon={<PackageOpen size={15} />} title={title}>
        <p className="cue-action-note">
          {`Not signed yet, so the date is simply edited: ask me to change ${jobName(job)}'s date to ${str(request.requestedDate)}, or use Edit job. The request clears once the date moves.`}
        </p>
      </ActionShell>
    );
  return (
    <ActionShell
      detail={
        approving
          ? "It is added to the job and the proposal is priced again; they get a revised proposal to accept."
          : "They see that you couldn't add it this time."
      }
      icon={<PackageOpen size={15} />}
      title={title}
    >
      {options.length > 1 ? <SubjectPicker {...choice} noun="request" options={options} subject={action.subject} /> : null}
      {request ? <p className="cue-action-note">{`${requestName(request)}${str(request.note) ? ` — “${str(request.note)}”` : ""}`}</p> : null}
      <Actions
        busy={runner.busy}
        danger={!approving}
        disabled={!request}
        label={approving ? "Add and revise" : "Not now"}
        onClick={() =>
          void runner.run(
            async () => {
              if (!request) return null;
              if (!approving) {
                await runCrmCommand("decidePackageRequest", { requestId: request.id, decision: "declined", resultProposalId: null });
                return "Declined. They'll see you couldn't add it this time.";
              }
              // The same retry-safe steps as Today's Add (features/proposals/
              // workspace-guards.ts): a second tap after the first re-priced
              // the proposal and only closing the request failed used to stop
              // on the revise, which refused the now-superseded version.
              try {
                await runCrmCommand("selectPackage", {
                  projectId: job.id,
                  packageId: str(request.packageId),
                  selectedAddOns: [],
                  mode: "add",
                  discount: { type: "keep" },
                });
              } catch (caught: unknown) {
                if (!packageChangeAlreadyApplied(caught)) throw caught;
              }
              let resultProposalId: string | null = null;
              if (proposal) {
                try {
                  const revised = await runProposalCommand("revise_packages", { proposalId: proposal.id });
                  resultProposalId = str(revised.result.proposalId) || proposal.id;
                } catch (caught: unknown) {
                  if (!proposalAlreadyRevised(caught)) throw caught;
                }
              }
              await runCrmCommand("decidePackageRequest", { requestId: request.id, decision: "approved", resultProposalId });
              return resultProposalId
                ? `Added ${str(request.packageName)}. The revised proposal is ready — open it to approve and send.`
                : `Added ${str(request.packageName)} to ${jobName(job)}.`;
            },
            { refresh: ["packageRequests", "projects", "packageSnapshots", "proposals"] },
          )
        }
      />
      <Notice text={runner.notice} />
    </ActionShell>
  );
}

function in14Days(): string {
  return addCalendarDays(todayLocalIso(), 14);
}

export function DraftProposalCard({ action }: ActionCardProps) {
  const { job, loading } = useJob(action.projectId);
  const snapshots = useRecords("packageSnapshots");
  const proposals = useRecords("proposals");
  const runner = useRunner();
  const [note, setNote] = useState(action.text ?? "");
  const [expires, setExpires] = useState(action.date ?? in14Days());
  const [created, setCreated] = useState<string | null>(null);
  const title = `Draft a proposal for ${jobName(job)}`;
  if (loading || !snapshots || !proposals) return <ActionShell title={title}><Loading /></ActionShell>;
  if (!job) return notFound(title);
  if (created) return <ActionShell title={title}><Done href={`/studio/proposals/${created}`} label="Open the draft">The draft is ready. Nothing has gone to them yet.</Done></ActionShell>;
  const open = currentProposal(proposals, job.id);
  if (open && str(open.status) !== "accepted")
    return (
      <ActionShell title={title}>
        <Blocked>{`${jobName(job)} already has a proposal (${str(open.status).replace("_", " ")}).`}</Blocked>
        <Link className="button button-dark" href={`/studio/proposals/${open.id}`}>Open it</Link>
      </ActionShell>
    );
  const snapshot = snapshots.find((item) => item.id === str(job.packageSnapshotId)) ?? null;
  if (!snapshot)
    return <ActionShell title={title}><Blocked>{`${jobName(job)} has no package yet. Ask me to choose one first.`}</Blocked></ActionShell>;
  if (!["CONSULTATION", "PROPOSAL", "LEAD"].includes(str(job.state)))
    return <ActionShell title={title}><Blocked>{`${jobName(job)} is past the proposal stage.`}</Blocked></ActionShell>;
  // Every package on the job: the card read "From Gold Photo" on a photo +
  // video wedding, and seeded the draft with the photo package's terms alone.
  const onTheJob = currentJobSnapshots(snapshots, job);
  const packageNames = onTheJob.map((item) => str(item.packageName)).filter(Boolean);
  return (
    <ActionShell
      detail={`From ${packageNames.length ? packageNames.join(" + ") : "the selected package"}. It stays a draft for you to check, approve and send.`}
      icon={<FileText size={15} />}
      title={title}
    >
      <Form>
        <TextAreaField label="Cover note (optional)" onChange={setNote} rows={3} value={note} />
        <TextField label="Offer open until" onChange={setExpires} type="date" value={expires} />
      </Form>
      <Actions
        busy={runner.busy}
        disabled={!/^\d{4}-\d{2}-\d{2}$/.test(expires)}
        label="Make the draft"
        onClick={() =>
          void runner.run(
            async () => {
              const result = await runProposalCommand("create_draft", {
                projectId: job.id,
                expiresAt: `${expires}T23:59:59.000Z`,
                notes: note.trim() || null,
                termsSummary: proposalTermsForPackages(onTheJob),
                retainerDueDate: null,
                balanceDueDate: null,
              });
              setCreated(str(result.result.proposalId) || null);
              return null;
            },
            { refresh: ["proposals", "projects"] },
          )
        }
      />
      <Notice text={runner.notice} />
    </ActionShell>
  );
}

export function EditProposalCard({ action }: ActionCardProps) {
  const { job, loading } = useJob(action.projectId);
  const proposals = useRecords("proposals");
  const runner = useRunner();
  const proposal = currentProposal(proposals, action.projectId);
  const [note, setNote] = useState<string | null>(null);
  const [expires, setExpires] = useState<string | null>(null);
  const title = `Edit the draft proposal · ${jobName(job)}`;
  if (loading || !proposals) return <ActionShell title={title}><Loading /></ActionShell>;
  if (!job) return notFound(title);
  if (!proposal) return <ActionShell title={title}><Blocked>{`${jobName(job)} has no proposal yet.`}</Blocked></ActionShell>;
  if (runner.done) return <ActionShell title={title}><Done href={`/studio/proposals/${proposal.id}`} label="Open it">{runner.done}</Done></ActionShell>;
  if (str(proposal.status) !== "draft")
    return (
      <ActionShell title={title}>
        <Blocked>
          {["sent", "viewed"].includes(str(proposal.status))
            ? "It has already gone out. To change it, ask me to correct it — that sends them a new version."
            : "Only a draft can be edited here. Take it back to draft first."}
        </Blocked>
      </ActionShell>
    );
  const noteValue = note ?? action.text ?? str(proposal.notes);
  const expiresValue = expires ?? action.date ?? str(proposal.expiresAt).slice(0, 10);
  return (
    <ActionShell detail="Still a draft; nothing goes to them." icon={<FileText size={15} />} title={title}>
      <Form>
        <TextAreaField label="Cover note" onChange={setNote} rows={4} value={noteValue} />
        <TextField label="Offer open until" onChange={setExpires} type="date" value={expiresValue} />
      </Form>
      <Actions
        busy={runner.busy}
        label="Save the draft"
        onClick={() =>
          void runner.run(
            async () => {
              await runProposalCommand("update_draft", {
                proposalId: proposal.id,
                expectedDraftRevision: num(proposal.draftRevision) || 1,
                expiresAt: `${expiresValue}T23:59:59.000Z`,
                notes: noteValue.trim() || null,
                termsSummary: str(proposal.termsSummary),
                // The dates live on the payment schedule; the proposal has no
                // retainerDueDate field, so every save here cleared them.
                retainerDueDate: scheduleDue(proposal.paymentSchedule, 0),
                balanceDueDate: scheduleDue(proposal.paymentSchedule, 1),
                // Left out, the server keeps the retainer the studio set.
              });
              return "The draft is saved.";
            },
            { refresh: ["proposals"] },
          )
        }
      />
      <Notice text={runner.notice} />
    </ActionShell>
  );
}

/**
 * Send, resend, correct or take back a proposal. Sending walks the same steps
 * the proposal page does — approve, wait for the PDF, send — one tap each.
 */
export function ProposalStepCard({ action }: ActionCardProps) {
  const { job, loading } = useJob(action.projectId);
  const proposals = useRecords("proposals");
  const contacts = useRecords("contacts");
  const ownerOrAdmin = useIsOwnerOrAdmin();
  const runner = useRunner();
  const proposal = currentProposal(proposals, action.projectId);
  const status = str(proposal?.status);
  const pdfQueued = status === "approved" && str(proposal?.pdfState) === "queued";
  useEffect(() => {
    if (!pdfQueued) return;
    const timer = window.setInterval(() => refreshTenantRecords("proposals"), 3500);
    return () => window.clearInterval(timer);
  }, [pdfQueued]);
  const titles: Record<string, string> = {
    send_proposal: "Send the proposal",
    resend_proposal: "Send the proposal again",
    correct_proposal: "Correct the proposal they were sent",
    return_proposal_to_draft: "Take the proposal back to draft",
    discard_proposal_draft: "Discard the draft proposal",
    withdraw_proposal: "Withdraw the proposal",
    remake_proposal_pdf: "Make the proposal's PDF again",
  };
  const title = `${titles[action.action]} · ${jobName(job)}`;
  if (loading || !proposals || !contacts) return <ActionShell title={title}><Loading /></ActionShell>;
  if (!job) return notFound(title);
  if (!proposal) return <ActionShell title={title}><Blocked>{`${jobName(job)} has no proposal yet. Ask me to draft one.`}</Blocked></ActionShell>;
  const client = primaryContact(job, contacts);
  const to = str(client?.email) || "the client";
  const open = <Link className="button button-light" href={`/studio/proposals/${proposal.id}`}>Open the proposal</Link>;
  if (runner.done)
    return <ActionShell title={title}><Done href={`/studio/proposals/${proposal.id}`} label="Open the proposal">{runner.done}</Done></ActionShell>;
  const needsOwner = !ownerOrAdmin && action.action !== "return_proposal_to_draft";
  if (needsOwner) return <OwnerOnly title={title} />;

  if (action.action === "send_proposal") {
    if (["sent", "viewed"].includes(status))
      return <ActionShell title={title}><Done href={`/studio/proposals/${proposal.id}`} label="Open the proposal">{`It was already sent to ${to}. Ask me to send it again if they can't find it.`}</Done></ActionShell>;
    if (status === "accepted")
      return <ActionShell title={title}><Done>They&apos;ve already accepted it.</Done></ActionShell>;
    const step =
      status === "draft" || status === "internal_review"
        ? { label: "Approve it", detail: "First, approve the offer. Its PDF is made next; nothing goes to them yet." }
        : pdfQueued
          ? { label: "Preparing the PDF…", detail: "The PDF is being made. This takes a few seconds." }
          : { label: `Send to ${to}`, detail: `They get an email with the proposal${str(proposal.pdfState) === "ready" ? " and its PDF" : ""} and a link to accept it.` };
    return (
      <ActionShell detail={step.detail} icon={<Send size={15} />} title={title}>
        <Actions
          busy={runner.busy}
          disabled={pdfQueued}
          label={step.label}
          onClick={() =>
            void runner.run(
              async () => {
                if (status === "draft") await runProposalCommand("submit_for_approval", { proposalId: proposal.id });
                if (status === "draft" || status === "internal_review") {
                  await runProposalCommand("approve", { proposalId: proposal.id });
                  return null;
                }
                await runProposalCommand("send", { proposalId: proposal.id });
                return `Sent to ${to}.`;
              },
              { refresh: ["proposals", "projects"] },
            )
          }
          secondary={
            str(proposal.pdfState) === "failed" ? (
              <>
                <button
                  className="button button-light"
                  disabled={runner.busy}
                  onClick={() =>
                    void runner.run(
                      async () => {
                        await runProposalCommand("regenerate_pdf", { proposalId: proposal.id });
                        return null;
                      },
                      { refresh: ["proposals"] },
                    )
                  }
                  type="button"
                >
                  Make the PDF again
                </button>
                {open}
              </>
            ) : (
              open
            )
          }
        />
        {str(proposal.pdfState) === "failed" && status === "approved" ? (
          <p className="cue-action-note">The PDF didn&apos;t come out. You can send without it, or make it again first.</p>
        ) : null}
        <Notice text={runner.notice} />
      </ActionShell>
    );
  }

  const allowed: Record<string, string[]> = {
    remake_proposal_pdf: ["approved"],
    resend_proposal: ["sent", "viewed"],
    correct_proposal: ["sent", "viewed"],
    return_proposal_to_draft: ["internal_review", "approved"],
    discard_proposal_draft: ["draft", "internal_review", "approved"],
    withdraw_proposal: ["sent", "viewed"],
  };
  if (!allowed[action.action]!.includes(status))
    return (
      <ActionShell title={title}>
        <Blocked>
          {action.action === "remake_proposal_pdf"
            ? "Only an approved proposal that hasn't been sent has a PDF to make again."
            : action.action === "discard_proposal_draft"
            ? "It has already been sent, so it isn't a draft to throw away. Ask me to withdraw it instead."
            : action.action === "withdraw_proposal" && status !== "accepted"
            ? "It hasn't been sent yet. Ask me to discard the draft instead."
            : action.action === "return_proposal_to_draft"
            ? status === "draft"
              ? "It is already a draft."
              : "Once it has been sent it can't go back to draft. Ask me to correct it instead."
            : status === "accepted"
              ? signedBookingChange(job)
                ? "They've signed, so this proposal is final. Ask me to change the booking — they sign the change and their agreement stands until they do."
                : "They've accepted it. Change the packages to send them a revised proposal."
              : "It hasn't been sent yet."}
        </Blocked>
        {open}
      </ActionShell>
    );
  const kinds: Record<string, { op: "resend" | "reissue" | "return_to_draft" | "regenerate_pdf" | "discard_draft" | "withdraw"; label: string; detail: string; done: string }> = {
    remake_proposal_pdf: {
      op: "regenerate_pdf",
      label: "Make it again",
      detail: "A fresh PDF is made from the approved proposal. Nothing is sent.",
      done: "The PDF is being made again. It takes a few seconds.",
    },
    resend_proposal: { op: "resend", label: `Send again to ${to}`, detail: "The same proposal, emailed again.", done: `Sent again to ${to}.` },
    correct_proposal: {
      op: "reissue",
      label: "Make a corrected version",
      detail: "A new draft is made from the client's current details and the sent one is withdrawn. You check and send the new one.",
      done: "A corrected draft is ready. Open it to check, approve and send.",
    },
    return_proposal_to_draft: { op: "return_to_draft", label: "Back to draft", detail: "It can be edited again. Its PDF is discarded.", done: "It is a draft again." },
    discard_proposal_draft: {
      op: "discard_draft",
      label: "Discard the draft",
      detail: "Nobody outside your studio has seen it. You can start a new one right away.",
      done: "The draft is discarded. Ask me to draft a new one when you're ready.",
    },
    withdraw_proposal: {
      op: "withdraw",
      label: "Withdraw it",
      detail: "Their page will say it's no longer on offer and they can't accept it. Nothing is emailed — tell them yourself.",
      done: "Withdrawn. Their page now says it's no longer on offer.",
    },
  };
  const kind = kinds[action.action]!;
  return (
    <ActionShell detail={kind.detail} icon={<Send size={15} />} title={title}>
      <Actions
        busy={runner.busy}
        label={kind.label}
        onClick={() =>
          void runner.run(
            async () => {
              await runProposalCommand(kind.op, { proposalId: proposal.id });
              return kind.done;
            },
            { refresh: ["proposals", "projects"] },
          )
        }
        secondary={open}
      />
      <Notice text={runner.notice} />
    </ActionShell>
  );
}

export function RecordAcceptanceCard({ action }: ActionCardProps) {
  const { job, loading } = useJob(action.projectId);
  const proposals = useRecords("proposals");
  const ownerOrAdmin = useIsOwnerOrAdmin();
  const [message, setMessage] = useState<string | null>(null);
  const title = `Record that they accepted · ${jobName(job)}`;
  if (!ownerOrAdmin) return <OwnerOnly title={title} />;
  if (loading || !proposals) return <ActionShell title={title}><Loading /></ActionShell>;
  if (!job) return notFound(title);
  if (message) return <ActionShell title={title}><Done>{message}</Done></ActionShell>;
  const proposal = currentProposal(proposals, job.id);
  if (!proposal) return <ActionShell title={title}><Blocked>{`${jobName(job)} has no proposal to accept.`}</Blocked></ActionShell>;
  if (str(proposal.status) === "accepted") return <ActionShell title={title}><Done>It is already accepted.</Done></ActionShell>;
  if (!["approved", "sent", "viewed"].includes(str(proposal.status)))
    return <ActionShell title={title}><Blocked>Approve the proposal first; then their acceptance can be recorded.</Blocked></ActionShell>;
  return (
    <ActionShell detail="For an acceptance given in person, by phone or by email. The job moves on to the agreement." icon={<ShieldCheck size={15} />} title={title}>
      <Embedded>
        <RecordProposalAcceptance
          onRecorded={(text) => {
            setMessage(text);
            refreshTenantRecords("proposals", "projects");
          }}
          proposalId={proposal.id}
        />
      </Embedded>
    </ActionShell>
  );
}

/**
 * Take back an acceptance recorded by mistake (wave 3). The server decides —
 * proposal-domain.ts planUndoAcceptance — and refuses while an agreement is
 * out; this card says so first rather than offering a tap that fails.
 */
export function UndoAcceptanceCard({ action }: ActionCardProps) {
  const { job, loading } = useJob(action.projectId);
  const proposals = useRecords("proposals");
  const contracts = useRecords("contracts");
  const ownerOrAdmin = useIsOwnerOrAdmin();
  const runner = useRunner();
  const [reason, setReason] = useState(action.text ?? "");
  const title = `Undo the acceptance · ${jobName(job)}`;
  if (!ownerOrAdmin) return <OwnerOnly title={title} />;
  if (loading || !proposals || !contracts) return <ActionShell title={title}><Loading /></ActionShell>;
  if (!job) return notFound(title);
  if (runner.done) return <ActionShell title={title}><Done href={`/studio/projects/${job.id}`} label="Open the job">{runner.done}</Done></ActionShell>;
  const proposal = acceptedProposal(proposals, job.id);
  if (!proposal) return <ActionShell title={title}><Blocked>{`${jobName(job)} has no accepted proposal to undo.`}</Blocked></ActionShell>;
  if (proposal.acceptedWithContractId || proposal.combinedContractId)
    return (
      <ActionShell title={title}>
        <Blocked>They accepted by signing the booking agreement. Withdraw the agreement on the job&apos;s Booking tab instead.</Blocked>
      </ActionShell>
    );
  if (str(job.state) !== "CONTRACT_PENDING")
    return (
      <ActionShell title={title}>
        <Blocked>{`${jobName(job)} has moved on past the agreement, so its acceptance can't be undone. Use Change the booking, or cancel the job.`}</Blocked>
      </ActionShell>
    );
  if (onJob(contracts, job.id).some((item) => ACCEPTANCE_AGREEMENT_OUT.includes(str(item.status))))
    return (
      <ActionShell title={title}>
        <Blocked>The agreement has already gone to the client for this acceptance. Void it first (ask me to void the contract), then undo the acceptance.</Blocked>
      </ActionShell>
    );
  const byCouple = str(proposal.acceptanceAuthority) !== "studio_attested";
  return (
    <ActionShell
      detail={
        byCouple
          ? "The client accepted this themselves, in their portal. The proposal goes back to how it was and the job back to Proposal; they can accept again. Nothing is emailed."
          : "The acceptance you recorded is taken back. The proposal goes back to how it was and the job back to Proposal. Nothing is emailed."
      }
      icon={<ShieldCheck size={15} />}
      title={title}
    >
      <Form>
        <TextField label="Why (optional, for your records)" onChange={setReason} value={reason} />
      </Form>
      <Actions
        busy={runner.busy}
        danger
        label="Undo the acceptance"
        onClick={() =>
          void runner.run(
            async () => {
              const undone = await runProposalCommand("undo_acceptance", {
                proposalId: proposal.id,
                ...(reason.trim() ? { reason: reason.trim().slice(0, 500) } : {}),
              });
              return undone.result.discardedContractDraft === true
                ? `Undone. ${jobName(job)} is back at Proposal, and the unsent agreement draft was discarded.`
                : `Undone. ${jobName(job)} is back at Proposal.`;
            },
            { refresh: ["proposals", "projects", "contracts", "tasks"] },
          )
        }
      />
      <Notice text={runner.notice} />
    </ActionShell>
  );
}

/**
 * They didn't turn up, or a consultation was marked held by mistake (wave 3).
 * A no-show offers the scheduling link the job page already sends.
 */
export function ConsultationCorrectionCard({ action }: ActionCardProps) {
  const { job, loading } = useJob(action.projectId);
  const consultations = useRecords("consultations");
  const zoomConnected = useZoomConnected();
  const runner = useRunner();
  const [invited, setInvited] = useState<string | null>(null);
  // "Now" fixed per mount, so a render stays pure.
  const [now] = useState(() => Date.now());
  const noShow = action.action === "mark_consultation_no_show";
  const title = `${noShow ? "They missed the consultation" : "Reopen the consultation"} · ${jobName(job)}`;
  if (loading || !consultations) return <ActionShell title={title}><Loading /></ActionShell>;
  if (!job) return notFound(title);
  const clientId = str(arr(job.clientContactIds)[0]);
  const invite = clientId ? (
    <button
      className="button button-light"
      disabled={runner.busy || Boolean(invited)}
      onClick={() =>
        void runner.run(async () => {
          await runPublicScheduling({
            type: "create_link",
            idempotencyKey: crypto.randomUUID(),
            input: { projectId: job.id, contactId: clientId, mode: defaultConsultationMode(zoomConnected) },
          });
          setInvited("They're being emailed a link to pick another time.");
        })
      }
      type="button"
    >
      Invite them to rebook
    </button>
  ) : null;
  if (runner.done)
    return (
      <ActionShell title={title}>
        <Done>{runner.done}</Done>
        {noShow && !invited ? <div className="copilot-flow-actions">{invite}</div> : null}
        {invited ? <p className="cue-action-note">{invited}</p> : null}
        <Notice text={runner.notice} />
      </ActionShell>
    );
  const candidates = onJob(consultations, job.id)
    .filter((item) =>
      !item.archivedAt &&
      (noShow
        ? str(item.status) === "scheduled" && Date.parse(str(item.startsAt)) <= now
        : ["completed", "no_show"].includes(str(item.status))),
    )
    .sort((a, b) => str(b.startsAt).localeCompare(str(a.startsAt)));
  const consultation = candidates[0] ?? null;
  if (!consultation)
    return (
      <ActionShell title={title}>
        <Blocked>
          {noShow
            ? `There is no consultation on ${jobName(job)} that has already started.`
            : `There is no consultation on ${jobName(job)} marked as held or missed.`}
        </Blocked>
      </ActionShell>
    );
  if (!noShow && !["LEAD", "CONSULTATION"].includes(str(job.state)))
    return (
      <ActionShell title={title}>
        <Blocked>{`${jobName(job)} has moved on past the consultation, so it can't be reopened.`}</Blocked>
      </ActionShell>
    );
  const future = Date.parse(str(consultation.startsAt)) > now;
  return (
    <ActionShell
      detail={
        noShow
          ? `${when(consultation.startsAt)}. It's marked as missed and the job stays where it is. Nothing is emailed — you can invite them to pick another time next.`
          : future
            ? `${when(consultation.startsAt)}. It goes back on as booked.`
            : `${when(consultation.startsAt)}. It goes back to waiting for your notes. The brief StudioCue already drafted stays.`
      }
      icon={<CalendarX size={15} />}
      title={title}
    >
      <Actions
        busy={runner.busy}
        label={noShow ? "Mark as missed" : "Reopen it"}
        onClick={() =>
          void runner.run(
            async () => {
              await sendBookingCommand({
                type: noShow ? "markConsultationNoShow" : "reopenConsultation",
                idempotencyKey: crypto.randomUUID(),
                input: { projectId: job.id, consultationId: consultation.id },
              });
              return noShow
                ? "Marked as missed. Invite them to pick another time when you're ready."
                : future
                  ? "Reopened. It's back on as booked."
                  : "Reopened. It's waiting for your notes again.";
            },
            { refresh: ["consultations", "projects"] },
          )
        }
      />
      <Notice text={runner.notice} />
    </ActionShell>
  );
}

// ─── Contract ───────────────────────────────────────────────────────────────

function acceptedProposal(proposals: Rec[] | null, projectId: string): Rec | null {
  return onJob(proposals, projectId).find((item) => str(item.status) === "accepted") ?? null;
}

function liveContract(contracts: Rec[] | null, projectId: string): Rec | null {
  return (
    onJob(contracts, projectId)
      .filter((item) => !["superseded", "voided", "failed"].includes(str(item.status)))
      .sort((a, b) => str(b.createdAt).localeCompare(str(a.createdAt)))[0] ?? null
  );
}

/** Prepare, sign and send, or void: StudioCue's own contract step. */
export function ContractCard({ action }: ActionCardProps) {
  const { job, loading } = useJob(action.projectId);
  const proposals = useRecords("proposals");
  const contracts = useRecords("contracts");
  const native = useNativeSigning();
  const [message, setMessage] = useState<string | null>(null);
  const titles: Record<string, string> = {
    prepare_contract: "Prepare the contract",
    sign_and_send_contract: "Sign and send the contract",
    send_contract: "Send the contract",
    void_contract: "Void the contract",
    resend_contract: "Send the contract again",
  };
  const title = `${titles[action.action]} · ${jobName(job)}`;
  if (loading || !proposals || !contracts || native.loading) return <ActionShell title={title}><Loading /></ActionShell>;
  if (!job) return notFound(title);
  const contract = liveContract(contracts, job.id);
  // A booking agreement is out before its proposal is accepted — voiding it
  // must not wait for an acceptance only its signature can give.
  const proposal =
    acceptedProposal(proposals, job.id) ??
    (str(contract?.mode) === "combined"
      ? (onJob(proposals, job.id).find((item) => item.id === str(contract?.proposalId)) ?? null)
      : null);
  if (!native.enabled)
    return (
      <ActionShell title={title}>
        <Blocked>
          Your studio sends its own agreement. Once they&apos;ve signed it, ask me to record the signature and the job moves on.
        </Blocked>
      </ActionShell>
    );
  if (!proposal)
    return <ActionShell title={title}><Blocked>{`The contract is written from the accepted proposal, and ${jobName(job)} hasn't accepted one yet.`}</Blocked></ActionShell>;
  return (
    <ActionShell
      detail={
        action.action === "void_contract"
          ? "Voiding tells them the contract is withdrawn. A signed contract can't be voided."
          : action.action === "resend_contract"
            ? "Send it again emails them the same contract to sign, now — at most once an hour. The 3- and 7-day reminders still go."
            : "You read it, then sign and send it; they sign in their portal. The retainer follows their signature."
      }
      icon={<FileSignature size={15} />}
      title={title}
    >
      {message ? <p className="cue-action-done" role="status">{message}</p> : null}
      <Embedded>
        <NativeContractStep
          contract={contract}
          onChanged={(text) => {
            if (text) setMessage(text);
            refreshTenantRecords("projects", "contracts", "checkpoints", "readinessAssessments");
          }}
          projectId={job.id}
          proposal={proposal}
        />
      </Embedded>
    </ActionShell>
  );
}

export function RecordSignedContractCard({ action }: ActionCardProps) {
  const { job, loading } = useJob(action.projectId);
  const proposals = useRecords("proposals");
  const ownerOrAdmin = useIsOwnerOrAdmin();
  const [message, setMessage] = useState<string | null>(null);
  const title = `Record the signed contract · ${jobName(job)}`;
  if (!ownerOrAdmin) return <OwnerOnly title={title} />;
  if (loading || !proposals) return <ActionShell title={title}><Loading /></ActionShell>;
  if (!job) return notFound(title);
  if (message) return <ActionShell title={title}><Done>{message}</Done></ActionShell>;
  const proposal = acceptedProposal(proposals, job.id);
  if (str(job.state) !== "CONTRACT_PENDING" || !proposal)
    return (
      <ActionShell title={title}>
        <Blocked>
          {proposal
            ? `${jobName(job)} isn't waiting on a signature.`
            : `A signature is recorded against the accepted proposal, and ${jobName(job)} hasn't accepted one yet.`}
        </Blocked>
      </ActionShell>
    );
  return (
    <ActionShell detail="Who signed and when, and the signed copy if you have it. The job moves on to the retainer." icon={<FileSignature size={15} />} title={title}>
      <Embedded>
        <RecordSignedAgreement
          onRecorded={(text) => {
            setMessage(text);
            refreshTenantRecords("projects", "contracts", "checkpoints", "readinessAssessments");
          }}
          primary
          projectId={job.id}
          proposalId={proposal.id}
        />
      </Embedded>
    </ActionShell>
  );
}

// ─── Money ──────────────────────────────────────────────────────────────────

export function RetainerInvoiceCard({ action }: ActionCardProps) {
  const { job, loading } = useJob(action.projectId);
  const snapshots = useRecords("packageSnapshots");
  const proposals = useRecords("proposals");
  const invoices = useRecords("invoiceReferences");
  const runner = useRunner();
  const title = `Raise the retainer invoice · ${jobName(job)}`;
  if (loading || !snapshots || !proposals || !invoices) return <ActionShell title={title}><Loading /></ActionShell>;
  if (!job) return notFound(title);
  if (runner.done) return <ActionShell title={title}><Done>{runner.done}</Done></ActionShell>;
  const snapshot = snapshots.find((item) => item.id === str(job.packageSnapshotId)) ?? null;
  // Only one that stands: a voided or replaced retainer is exactly the case
  // for raising another.
  const existing = onJob(invoices, job.id).find(
    (item) => /retainer/i.test(str(item.kind) + str(item.type) + str(item.label)) && isStandingInvoice(item.status),
  );
  if (existing) return <ActionShell title={title}><Done>{`A retainer invoice already exists (${str(existing.status) || "raised"}).`}</Done></ActionShell>;
  if (str(job.state) !== "RETAINER_PENDING" || !snapshot)
    return <ActionShell title={title}><Blocked>{`The retainer is invoiced once the contract is signed, and ${jobName(job)} isn't there yet.`}</Blocked></ActionShell>;
  const proposal = acceptedProposal(proposals, job.id);
  const schedule = arr(proposal?.paymentSchedule).map((item) => item as Rec);
  const retainerItem = schedule.find((item) => /retainer/i.test(str(item.label))) ?? schedule[0];
  const agreed = str(retainerItem?.dueDate).slice(0, 10);
  const dueDate = /^\d{4}-\d{2}-\d{2}$/.test(agreed) ? agreed : addCalendarDays(todayLocalIso(), 7);
  return (
    <ActionShell
      detail={`${dollars(retainerFromSchedule(proposal?.paymentSchedule, Number(snapshot.retainerCents ?? 0)))}, due ${dueDate}. Your invoicing app creates it and sends it to them.`}
      icon={<Receipt size={15} />}
      title={title}
    >
      <Actions
        busy={runner.busy}
        label="Raise and send it"
        onClick={() =>
          void runner.run(
            async () => {
              await sendBookingCommand({
                type: "createRetainerInvoice",
                idempotencyKey: crypto.randomUUID(),
                input: { projectId: job.id, packageSnapshotId: snapshot.id, customerId: null, dueDate },
              });
              return "The retainer invoice is on its way to them.";
            },
            { refresh: ["invoiceReferences", "projects"] },
          )
        }
      />
      <Notice text={runner.notice} />
    </ActionShell>
  );
}

/** Retainer or balance paid outside StudioCue: the booking page's own form. */
export function RecordPaymentCard({ action }: ActionCardProps) {
  const { job, loading } = useJob(action.projectId);
  const snapshots = useRecords("packageSnapshots");
  const invoices = useRecords("invoiceReferences");
  const proposals = useRecords("proposals");
  const ownerOrAdmin = useIsOwnerOrAdmin();
  const [message, setMessage] = useState<string | null>(null);
  const final = action.action === "record_final_payment";
  const title = `Record the ${final ? "final payment" : "retainer"} · ${jobName(job)}`;
  if (!ownerOrAdmin) return <OwnerOnly title={title} />;
  if (loading || !snapshots || !invoices || !proposals) return <ActionShell title={title}><Loading /></ActionShell>;
  if (!job) return notFound(title);
  if (message) return <ActionShell title={title}><Done>{message}</Done></ActionShell>;
  const snapshot = snapshots.find((item) => item.id === str(job.packageSnapshotId)) ?? null;
  if (!snapshot) return <ActionShell title={title}><Blocked>{`${jobName(job)} has no package, so there is nothing to pay against.`}</Blocked></ActionShell>;
  const state = str(job.state);
  const onRecorded = (text: string) => {
    setMessage(text);
    refreshTenantRecords("projects", "invoiceReferences", "checkpoints", "readinessAssessments");
  };
  const booked = ["BOOKED", "PLANNING", "READY", "EVENT_COMPLETE", "POST_PRODUCTION", "DELIVERED", "REVIEW_REQUESTED"].includes(state);
  const retainers = onJob(invoices, job.id).filter((item) => str(item.kind) === "retainer");
  const retainerPaid = retainers.some((item) => str(item.status) === "paid" && num(item.balanceCents) === 0);
  // A job booked on an approved exception still owes its retainer, and the
  // couple paying it later is recorded here like any other retainer.
  if (!final && retainerPaid)
    return <ActionShell title={title}><Done>{`${jobName(job)}'s retainer is already paid.`}</Done></ActionShell>;
  if (!final && state !== "RETAINER_PENDING" && !booked)
    return <ActionShell title={title}><Blocked>{`${jobName(job)} isn't waiting on its retainer.`}</Blocked></ActionShell>;
  if (final && !["BOOKED", "PLANNING", "READY", "EVENT_COMPLETE", "POST_PRODUCTION", "DELIVERED", "REVIEW_REQUESTED"].includes(state))
    return <ActionShell title={title}><Blocked>{`${jobName(job)} isn't booked yet, so there is no balance to record.`}</Blocked></ActionShell>;
  const invoice = onJob(invoices, job.id).find(
    (item) =>
      (final ? /final|balance/i : /retainer/i).test(str(item.kind) + str(item.type) + str(item.label)) &&
      isStandingInvoice(item.status),
  );
  // What the server records: the invoice out with the couple when one stands,
  // otherwise the retainer the couple agreed — not the package's, which a
  // proposal can override (agreed-retainer.ts).
  const agreedRetainer = retainerFromSchedule(
    acceptedProposal(proposals, job.id)?.paymentSchedule,
    Number(snapshot.retainerCents ?? 0),
  );
  return (
    <ActionShell detail="You enter when and how they paid; the amount comes from the invoice." icon={<HandCoins size={15} />} title={title}>
      <Embedded>
        {final ? (
          <RecordFinalPayment
            balanceLabel={invoice ? dollars(invoice.amountCents) : undefined}
            onRecorded={onRecorded}
            packageSnapshotId={snapshot.id}
            projectId={job.id}
          />
        ) : (
          <RecordRetainerPayment
            onRecorded={onRecorded}
            packageSnapshotId={snapshot.id}
            projectId={job.id}
            retainerLabel={dollars(invoice ? invoice.amountCents : agreedRetainer)}
          />
        )}
      </Embedded>
    </ActionShell>
  );
}

/** The final balance, billed now: the same two actions as Today and Invoices. */
export function SendFinalBalanceCard({ action }: ActionCardProps) {
  const { job, loading } = useJob(action.projectId);
  const proposals = useRecords("proposals");
  const invoices = useRecords("invoiceReferences");
  const ownerOrAdmin = useIsOwnerOrAdmin();
  const [message, setMessage] = useState<string | null>(null);
  const title = `Send the final bill · ${jobName(job)}`;
  if (!ownerOrAdmin) return <OwnerOnly title={title} />;
  if (loading || !proposals || !invoices) return <ActionShell title={title}><Loading /></ActionShell>;
  if (!job) return notFound(title);
  if (message) return <ActionShell title={title}><Done>{message}</Done></ActionShell>;
  const due = outstandingFinalBalance({ projectId: job.id, proposals, invoices });
  // Held for the studio to check: never sent, so "already out" was untrue.
  const held = due.heldForReviewId ? (invoices.find((item) => item.id === due.heldForReviewId) ?? null) : null;
  // In QuickBooks already, waiting on the tax check: send with or without tax.
  if (held && held.sendReview)
    return (
      <ActionShell
        detail="It's in QuickBooks with the sales tax worked out, and nothing has gone to the client yet. Check it, then send it."
        icon={<HandCoins size={15} />}
        title={title}
      >
        <HeldInvoiceReview invoice={held} onDone={setMessage} />
      </ActionShell>
    );
  if (held)
    return (
      <ActionShell
        detail="It's held because the payments on record don't match what was agreed. Check the amount, then send it — or correct the payment first if one was recorded wrongly."
        icon={<HandCoins size={15} />}
        title={title}
      >
        <ApproveFinalInvoice amountCents={due.cents} invoice={held} onDone={setMessage} />
      </ActionShell>
    );
  if (due.finalStanding)
    return <ActionShell title={title}><Done>{`${jobName(job)}'s final bill is already out. Open Invoices to see where it is.`}</Done></ActionShell>;
  if (!due.cents) return <ActionShell title={title}><Done>{`Nothing is left to pay on ${jobName(job)}.`}</Done></ActionShell>;
  return (
    <ActionShell
      detail="The amount is what they agreed less everything already paid. It goes through your invoicing provider, which emails it to them."
      icon={<HandCoins size={15} />}
      title={title}
    >
      <FinalBalanceActions
        balanceLabel={dollars(due.cents)}
        onDone={setMessage}
        packageSnapshotId={str(job.packageSnapshotId) || null}
        projectId={job.id}
      />
      {/* Sales tax matters on the final bill: the job's exemption, here too. */}
      <JobSalesTax exempt={job.salesTaxExempt === true} onChanged={() => refreshTenantRecords("projects")} projectId={job.id} />
    </ActionShell>
  );
}

/** Which bill the operator named, in their words: "the retainer", "the final". */
function namedInvoiceKind(subject: string | null): "retainer" | "final" | null {
  const words = (subject ?? "").toLowerCase();
  if (/final|balance|rest/.test(words)) return "final";
  if (/retainer|deposit/.test(words)) return "retainer";
  return null;
}

const invoiceLine = (invoice: Rec) =>
  `${str(invoice.kind) === "final" ? "Final balance" : "Retainer"} · ${dollars(invoice.amountCents)} · ${statusLabel(invoice.status)}`;

/** Void a wrong or no-longer-owed bill: the booking page's own control. */
export function VoidInvoiceCard({ action }: ActionCardProps) {
  const { job, loading } = useJob(action.projectId);
  const invoices = useRecords("invoiceReferences");
  const ownerOrAdmin = useIsOwnerOrAdmin();
  const [message, setMessage] = useState<string | null>(null);
  const title = `Void an invoice · ${jobName(job)}`;
  if (!ownerOrAdmin) return <OwnerOnly title={title} />;
  if (loading || !invoices) return <ActionShell title={title}><Loading /></ActionShell>;
  if (!job) return notFound(title);
  if (message) return <ActionShell title={title}><Done>{message}</Done></ActionShell>;
  const kind = namedInvoiceKind(action.subject);
  const voidable = onJob(invoices, job.id).filter(
    (item) => invoiceVoidRefusal(item) === null && (!kind || str(item.kind) === kind),
  );
  if (!voidable.length)
    return (
      <ActionShell title={title}>
        <Blocked>
          {`${jobName(job)} has no unpaid ${kind ?? ""} invoice to void. A bill with money on it can't be voided — correct the payment instead, or refund it where it was paid.`.replace(/\s+/g, " ")}
        </Blocked>
      </ActionShell>
    );
  return (
    <ActionShell
      detail="It's voided here and in your invoicing app, so the client can no longer pay it. You can raise a corrected one afterwards."
      icon={<Receipt size={15} />}
      title={title}
    >
      <Embedded>
        {voidable.map((invoice) => (
          <div key={invoice.id}>
            <p className="cue-action-note">{invoiceLine(invoice)}</p>
            <VoidInvoice defaultReason={action.text ?? ""} invoice={invoice} onDone={setMessage} />
          </div>
        ))}
      </Embedded>
    </ActionShell>
  );
}

/**
 * Money towards a bill already out with the couple — part of it or the rest:
 * the booking page's own control. The operator types the amount; the server
 * holds it to the balance and records it in QuickBooks or Stripe too.
 */
export function RecordPartialPaymentCard({ action }: ActionCardProps) {
  const { job, loading } = useJob(action.projectId);
  const invoices = useRecords("invoiceReferences");
  const ownerOrAdmin = useIsOwnerOrAdmin();
  const [message, setMessage] = useState<string | null>(null);
  const title = `Record a payment · ${jobName(job)}`;
  if (!ownerOrAdmin) return <OwnerOnly title={title} />;
  if (loading || !invoices) return <ActionShell title={title}><Loading /></ActionShell>;
  if (!job) return notFound(title);
  if (message) return <ActionShell title={title}><Done>{message}</Done></ActionShell>;
  const kind = namedInvoiceKind(action.subject);
  const payable = onJob(invoices, job.id).filter(
    (item) => invoicePaymentRefusal(item) === null && (!kind || str(item.kind) === kind),
  );
  if (!payable.length)
    return (
      <ActionShell title={title}>
        <Blocked>
          {`${jobName(job)} has no ${kind ?? ""} invoice out with the client with anything left to pay. If they paid before a bill went out, record it from the retainer or final balance step instead.`.replace(/\s+/g, " ")}
        </Blocked>
      </ActionShell>
    );
  return (
    <ActionShell
      detail="You enter what arrived, up to what's left. It's recorded against your name, and in QuickBooks or Stripe too so the client's link asks only for the rest."
      icon={<HandCoins size={15} />}
      title={title}
    >
      <Embedded>
        {payable.map((invoice) => (
          <div key={invoice.id}>
            <p className="cue-action-note">{`${invoiceLine(invoice)} · ${dollars(invoice.balanceCents)} left`}</p>
            <RecordInvoicePayment invoice={invoice} onDone={setMessage} />
          </div>
        ))}
      </Embedded>
    </ActionShell>
  );
}

/** Correct a payment the studio recorded: added to the record, never rewritten. */
export function CorrectPaymentCard({ action }: ActionCardProps) {
  const { job, loading } = useJob(action.projectId);
  const invoices = useRecords("invoiceReferences");
  const ownerOrAdmin = useIsOwnerOrAdmin();
  const [message, setMessage] = useState<string | null>(null);
  const title = `Correct a payment · ${jobName(job)}`;
  if (!ownerOrAdmin) return <OwnerOnly title={title} />;
  if (loading || !invoices) return <ActionShell title={title}><Loading /></ActionShell>;
  if (!job) return notFound(title);
  if (message) return <ActionShell title={title}><Done>{message}</Done></ActionShell>;
  const kind = namedInvoiceKind(action.subject);
  const correctable = onJob(invoices, job.id).filter(
    (item) => paymentCorrectable(item) && (!kind || str(item.kind) === kind),
  );
  if (!correctable.length)
    return (
      <ActionShell title={title}>
        <Blocked>
          {`${jobName(job)} has no payment recorded by hand to correct. A payment from QuickBooks or Stripe is corrected there; StudioCue follows it.`}
        </Blocked>
      </ActionShell>
    );
  return (
    <ActionShell
      detail="You enter what actually arrived. The correction is added to the record; the original stays in the history."
      icon={<HandCoins size={15} />}
      title={title}
    >
      <Embedded>
        {correctable.map((invoice) => (
          <div key={invoice.id}>
            <p className="cue-action-note">{invoiceLine(invoice)}</p>
            <CorrectPayment invoice={invoice} onDone={setMessage} />
          </div>
        ))}
      </Embedded>
    </ActionShell>
  );
}

export function RetainerExceptionCard({ action }: ActionCardProps) {
  const { job, loading } = useJob(action.projectId);
  const ownerOrAdmin = useIsOwnerOrAdmin();
  const [message, setMessage] = useState<string | null>(null);
  const title = `Book without the retainer · ${jobName(job)}`;
  if (!ownerOrAdmin) return <OwnerOnly title={title} />;
  if (loading) return <ActionShell title={title}><Loading /></ActionShell>;
  if (!job) return notFound(title);
  if (message) return <ActionShell title={title}><Done>{message}</Done></ActionShell>;
  if (!["RETAINER_PENDING", "POSTPONED"].includes(str(job.state)))
    return <ActionShell title={title}><Blocked>{`This is for a signed job waiting on its retainer, and ${jobName(job)} isn't.`}</Blocked></ActionShell>;
  return (
    <ActionShell detail="You record why; the job books now and the retainer stays owed." icon={<Landmark size={15} />} title={title}>
      <Embedded>
        <BookWithoutRetainer
          onBooked={(text) => {
            setMessage(text);
            refreshTenantRecords("projects", "checkpoints", "readinessAssessments");
          }}
          projectId={job.id}
          projectVersion={num(job.stateVersion)}
        />
      </Embedded>
    </ActionShell>
  );
}

export function QuickBooksLookupCard({ action }: ActionCardProps) {
  const { job, loading } = useJob(action.projectId);
  const contacts = useRecords("contacts");
  const [result, setResult] = useState<string[] | null>(null);
  const runner = useRunner();
  const title = `Find their payments in QuickBooks · ${jobName(job)}`;
  if (loading || !contacts) return <ActionShell title={title}><Loading /></ActionShell>;
  if (!job) return notFound(title);
  const emails = (contacts ?? [])
    .filter((contact) => arr(job.clientContactIds).includes(contact.id))
    .map((contact) => str(contact.email).toLowerCase())
    .filter(Boolean);
  return (
    <ActionShell detail="Read-only: nothing is recorded until you record it." icon={<Landmark size={15} />} title={title}>
      {!emails.length ? <Blocked>Nobody on this job has an email to look up.</Blocked> : null}
      {result ? (
        result.length ? (
          <ul className="cue-action-note">{result.map((line) => <li key={line}>{line}</li>)}</ul>
        ) : (
          <p className="cue-action-note">QuickBooks shows no payments from them.</p>
        )
      ) : (
        <Actions
          busy={runner.busy}
          disabled={!emails.length}
          label="Look them up"
          onClick={() =>
            void runner.run(async () => {
              const found = await lookupQuickBooksPayments(emails);
              if (!found) {
                setResult([]);
                return null;
              }
              setResult(
                found.clients.flatMap((client) =>
                  arr((client as unknown as Rec).payments).map((payment) => {
                    const row = payment as Rec;
                    return `${dollars(row.amountCents)} on ${str(row.paidOn) || str(row.date)}${str(row.method) ? ` (${str(row.method)})` : ""}`;
                  }),
                ),
              );
              return null;
            })
          }
        />
      )}
      <Notice text={runner.notice} />
    </ActionShell>
  );
}

// ─── Booking ────────────────────────────────────────────────────────────────

export function ConfirmBookingCard({ action }: ActionCardProps) {
  const { job, loading } = useJob(action.projectId);
  const projects = useRecords("projects");
  const runner = useRunner();
  const [blockers, setBlockers] = useState<string[] | null>(null);
  const title = `Confirm the booking · ${jobName(job)}`;
  // Which booked job holds the date, when that is what blocks it.
  // A wedding takes the whole day; sessions share one (dateClashes).
  const sameDay = (projects ?? []).filter(
    (other) =>
      job &&
      other.id !== job.id &&
      !other.archivedAt &&
      str(other.eventDate) === str(job.eventDate) &&
      ["BOOKED", "PLANNING", "READY", "EVENT_COMPLETE"].includes(str(other.state)) &&
      dateClashes(job, [other]),
  );
  if (loading) return <ActionShell title={title}><Loading /></ActionShell>;
  if (!job) return notFound(title);
  if (runner.done) return <ActionShell title={title}><Done>{runner.done}</Done></ActionShell>;
  const state = str(job.state);
  if (!["RETAINER_PENDING", "POSTPONED"].includes(state))
    return (
      <ActionShell title={title}>
        {["BOOKED", "PLANNING", "READY"].includes(state) ? (
          <Done>{`${jobName(job)} is already booked.`}</Done>
        ) : (
          <Blocked>{`A booking is confirmed once ${bookedOnceClause(projectProfile(job))}. ${jobName(job)} is ${state.toLowerCase().replace(/_/g, " ")}.`}</Blocked>
        )}
      </ActionShell>
    );
  return (
    <ActionShell
      detail="It checks the signature, the retainer, the date and their details. If all are there, the job books, the client's portal opens and they get a confirmation."
      icon={<ShieldCheck size={15} />}
      title={title}
    >
      {blockers?.length ? (
        <Blocked>
          {`Still waiting on ${blockers.map(bookingBlockerLabel).join("; ")}.`}
          {blockers.includes("eventDateAvailable") && sameDay.length
            ? ` ${sameDay.map((other) => str(other.name)).join(", ")} is booked on ${str(job.eventDate)}.`
            : ""}
        </Blocked>
      ) : null}
      <Actions
        busy={runner.busy}
        label="Confirm the booking"
        onClick={() =>
          void runner.run(
            async () => {
              const expectedProjectVersion = await freshStateVersion(job.id, job.stateVersion);
              const response = await sendBookingCommand({
                type: "runBookingGate",
                idempotencyKey: crypto.randomUUID(),
                input: { projectId: job.id, expectedProjectVersion, approvedRetainerExceptionId: null },
              });
              const payload = response.mode === "live" ? (response.payload as Rec) : ({} as Rec);
              if (payload.passed === true) return `${jobName(job)} is booked. We're setting it up now.`;
              setBlockers(arr(payload.blockers).map(String));
              return null;
            },
            { refresh: ["projects", "contracts", "invoiceReferences", "checkpoints", "readinessAssessments"] },
          )
        }
      />
      <Notice text={runner.notice} />
    </ActionShell>
  );
}

export function BringBookingLiveCard({ action }: ActionCardProps) {
  const { job, loading } = useJob(action.projectId);
  const title = `Bring the client in · ${jobName(job)}`;
  if (loading) return <ActionShell title={title}><Loading /></ActionShell>;
  if (!job) return notFound(title);
  if (!job.importedAt)
    return <ActionShell title={title}><Blocked>{`${jobName(job)} wasn't imported, so it is already live.`}</Blocked></ActionShell>;
  return (
    <ActionShell detail="An imported booking stays quiet until you choose this." icon={<Send size={15} />} title={title}>
      <Embedded>
        <ImportedBookingBanner onChanged={() => refreshTenantRecords("projects")} project={job} projectId={job.id} />
      </Embedded>
    </ActionShell>
  );
}

export function ImportBookingCard() {
  const ownerOrAdmin = useIsOwnerOrAdmin();
  const title = "Import a booking you already have";
  if (!ownerOrAdmin) return <OwnerOnly title={title} />;
  return (
    <ActionShell
      detail="For a job signed and paid before StudioCue. It arrives quiet: nothing is emailed, invoiced or charged to the client."
      icon={<FileText size={15} />}
      title={title}
    >
      <Embedded>
        <ExistingBookingForm compact source="cue" />
      </Embedded>
      <Link className="button button-light" href="/studio/projects/import">Import a spreadsheet instead</Link>
    </ActionShell>
  );
}

/** Show the couple their signed contract in the portal, or stop. */
export function SignedCopyCard({ action }: ActionCardProps) {
  const { job, loading } = useJob(action.projectId);
  const contracts = useRecords("contracts");
  const title = `Share the signed contract · ${jobName(job)}`;
  if (loading || !contracts) return <ActionShell title={title}><Loading /></ActionShell>;
  if (!job) return notFound(title);
  const signed = onJob(contracts, job.id).find((item) => str(item.status) === "completed") ?? null;
  if (!signed)
    return <ActionShell title={title}><Blocked>{`${jobName(job)} has no signed contract yet.`}</Blocked></ActionShell>;
  // The panel shows nothing without a file, which read as a blank card.
  if (!FILE_BEARING.contracts(signed).length)
    return (
      <ActionShell title={title}>
        <Blocked>No signed copy is attached to this contract yet. Attach it from the job&apos;s booking page, then share it.</Blocked>
      </ActionShell>
    );
  return (
    <ActionShell detail="Whether the client can open the signed copy in their portal." icon={<FileSignature size={15} />} title={title}>
      <Embedded>
        <SignedCopySharing contract={signed} showFiles />
      </Embedded>
    </ActionShell>
  );
}

/**
 * Changing a booking the couple already signed: a new date, a package added
 * or removed. The same panel as the job page's "Change the booking".
 */
export function ChangeBookingCard({ action }: ActionCardProps) {
  const { job, loading } = useJob(action.projectId);
  const resending = action.action === "resend_booking_change";
  const title = `${resending ? "Send the booking change again" : "Change the booking"} · ${jobName(job)}`;
  if (loading) return <ActionShell title={title}><Loading /></ActionShell>;
  if (!job) return notFound(title);
  return (
    <ActionShell
      detail={
        resending
          ? "Send it again emails them the change to sign, now — at most once an hour."
          : "The client signs the change; their current agreement stands until they do, and the job keeps its stage."
      }
      icon={<CalendarClock size={15} />}
      title={title}
    >
      <Embedded>
        <BookingAmendmentPanel projectId={job.id} />
      </Embedded>
    </ActionShell>
  );
}

/** On a signed booking, a package or date change goes through the couple. */
export function signedBookingChange(job: Rec | null): boolean {
  return Boolean(job && AMENDABLE_STATES.includes(str(job.state)));
}

/** A payment's due date from a proposal's schedule, as the draft command takes it. */
function scheduleDue(schedule: unknown, index: number): string | null {
  const entry = Array.isArray(schedule) ? schedule[index] : null;
  const due = entry && typeof entry === "object" ? (entry as Record<string, unknown>).dueDate : null;
  return typeof due === "string" && due ? due.slice(0, 10) : null;
}
