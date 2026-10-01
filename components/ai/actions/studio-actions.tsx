"use client";

import { isCataloguePackage } from "@/features/packages/one-off";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { BadgeCheck, Camera, CheckSquare, ClipboardCheck, Film, Link2, ListChecks, Mail, PackagePlus, Plug, Settings2, Star, UserCog, UserMinus, Users } from "lucide-react";
import { useWorkspace } from "@/features/auth/workspace-context";
import { offeredProviders } from "@/features/integrations/schema";
import type { IntegrationProvider } from "@/features/integrations/schema";
import { runCrmCommand } from "@/lib/crm/command-client";
import { runWorkflowCommand } from "@/lib/workflows/command-client";
import { sendCrewCommand } from "@/lib/crew/command-client";
import { sendPostEventCommand } from "@/lib/post-event/command-client";
import { startProviderConnect } from "@/lib/integrations/command-client";
import { CreateCrewProfileForm } from "@/components/crew/create-crew-profile-form";
import { CrewRecordActions, crewActionsProps } from "@/components/crew/crew-record-actions";
import { CrewOfferSettings } from "@/components/crew/crew-offer-settings";
import { CrewCascadeWorkspace } from "@/components/crew/crew-cascade-workspace";
import { withdrawCrew } from "@/components/crew/withdraw-crew-control";
import { setOwnerShooting } from "@/components/crew/owner-shooting-toggle";
import { ownerShootsJob } from "@/features/crew/staffing-plan";
import { isLiveAssignment } from "@/features/crew/job-stopped";
import { withdrawConsequence, withdrawDoneMessage } from "@/features/crew/withdraw-copy";
import { CreateWorkflowForm } from "@/components/workflows/create-workflow-form";
import { CoiSettings } from "@/components/settings/coi-settings";
import { AddOnLibrary } from "@/components/library/add-on-library";
import { ReadinessCheckpoints } from "@/components/projects/readiness-checkpoints";
import { DeliveryForm } from "@/components/post-event/delivery-form";
import { PostProductionChecklist } from "@/components/post-event/post-production-checklist";
import { DeliveryCloseoutWorkspace } from "@/components/post-event/delivery-closeout-workspace";
import { ReplaceDeliveryLink } from "@/components/post-event/replace-delivery-link";
import { TeamManagement } from "@/components/team/team-management";
import { CreatePackageForm } from "@/components/crm/create-package-form";
import { EditPackageForm } from "@/components/crm/edit-package-form";
import { AgreementEditor } from "@/components/contracts/agreement-editor";
import { LifecyclePackPanel } from "@/components/communications/lifecycle-pack-panel";
import { ConsultationAvailability } from "@/components/settings/consultation-availability";
import { AutopaySettings } from "@/components/integrations/autopay-settings";
import { EmailBranding } from "@/components/settings/email-branding";
import { StudioIdentitySettings } from "@/components/settings/studio-identity";
import { DataControls } from "@/components/settings/data-controls";
import { TimingRuleEditor } from "@/components/planning/timing-rule-editor";
import { InquiryForwardingAddress, InquiryForwardingSettings } from "@/components/crm/inquiry-forwarding-address";
import { AssigneeSelect } from "@/components/tasks/task-assignee";
import { assigneeFields, assigneeValue } from "@/features/tasks/assignee";
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
  dollars,
  jobName,
  onJob,
  str,
  todayIso,
  useIsOwnerOrAdmin,
  useJob,
  useRecords,
  useRunner,
  useSubjectChoice,
  type ActionCardProps,
  type Rec,
} from "./action-kit";
import { OwnerOnly } from "./job-actions";
import { ConfirmStep } from "@/components/ui/confirm-step";

const notFound = (title: string) => (
  <ActionShell title={title}>
    <Blocked>I couldn&apos;t find that job.</Blocked>
  </ActionShell>
);

// ─── Crew ───────────────────────────────────────────────────────────────────

export function AddCrewMemberCard() {
  return (
    <ActionShell
      detail="They're added to your roster and emailed an invitation to the crew app."
      icon={<Camera size={15} />}
      title="Add someone to your crew"
    >
      <Embedded>
        <CreateCrewProfileForm />
      </Embedded>
    </ActionShell>
  );
}

const profileOption = (profile: Rec) => ({
  id: profile.id,
  name: str(profile.name) || str(profile.email) || "Crew member",
  detail: [arr(profile.trades).join(", "), str(profile.email)].filter(Boolean).join(" · ") || undefined,
});

/** Edit, invite or archive someone on the roster. */
export function CrewMemberCard({ action }: ActionCardProps) {
  const profiles = useRecords("crewProfiles");
  const runner = useRunner();
  const kind = action.action;
  const active = (profiles ?? []).filter((profile) => (kind === "archive_crew_member" ? !profile.archivedAt : true));
  const options = active.map(profileOption);
  const choice = useSubjectChoice(action.subject, options);
  const titles: Record<string, string> = {
    edit_crew_member: "Change a crew member's details",
    invite_crew_member: "Invite a crew member to the crew app",
    archive_crew_member: "Take someone off your active roster",
  };
  const title = titles[kind]!;
  if (!profiles) return <ActionShell title={title}><Loading /></ActionShell>;
  if (runner.done) return <ActionShell title={title}><Done>{runner.done}</Done></ActionShell>;
  const profile = active.find((item) => item.id === choice.chosen) ?? null;
  return (
    <ActionShell
      detail={
        kind === "invite_crew_member"
          ? "They get an email with a link to set up their crew account."
          : kind === "archive_crew_member"
            ? "They stop being offered work. Someone with an open job can't be archived until it's settled."
            : "Their details, rate, trades and paperwork."
      }
      icon={<UserCog size={15} />}
      title={title}
    >
      <SubjectPicker {...choice} noun="crew member" options={options} subject={action.subject} />
      {profile && kind === "edit_crew_member" ? (
        <Embedded>
          <CrewRecordActions crew={crewActionsProps(profile)} />
        </Embedded>
      ) : null}
      {kind !== "edit_crew_member" ? (
        <Actions
          busy={runner.busy}
          danger={kind === "archive_crew_member"}
          disabled={!profile}
          label={kind === "invite_crew_member" ? "Send the invitation" : "Archive them"}
          onClick={() =>
            void runner.run(
              async () => {
                if (!profile) return null;
                if (kind === "invite_crew_member") {
                  await sendCrewCommand("inviteCrewProfile", { crewProfileId: profile.id });
                  return `Invited ${profileOption(profile).name} to the crew app.`;
                }
                await sendCrewCommand("archiveCrewProfile", { crewProfileId: profile.id, restore: false });
                return `${profileOption(profile).name} is off the active roster.`;
              },
              { refresh: ["crewProfiles"] },
            )
          }
        />
      ) : null}
      <Notice text={runner.notice} />
    </ActionShell>
  );
}

function useAssignmentChoice(action: ActionCardProps["action"], filter: (assignment: Rec) => boolean) {
  const { job, loading } = useJob(action.projectId);
  const assignments = useRecords("crewAssignments");
  const profiles = useRecords("crewProfiles");
  const candidates = onJob(assignments, action.projectId).filter(filter);
  const nameOf = (assignment: Rec) =>
    str((profiles ?? []).find((profile) => profile.id === assignment.crewProfileId)?.name) || str(assignment.role) || "Crew member";
  const options = candidates.map((assignment) => ({
    id: assignment.id,
    name: nameOf(assignment),
    detail: [str(assignment.role), str(assignment.status)].filter(Boolean).join(" · ") || undefined,
  }));
  const choice = useSubjectChoice(action.subject, options);
  return {
    job,
    loading: loading || !assignments || !profiles,
    options,
    choice,
    assignment: candidates.find((item) => item.id === choice.chosen) ?? null,
    nameOf,
  };
}

export function WaiveRequirementCard({ action }: ActionCardProps) {
  const picked = useAssignmentChoice(action, (assignment) =>
    arr(assignment.requirements).some((requirement) => {
      const row = requirement as Rec;
      return row.required === true && !["completed", "waived"].includes(str(row.status));
    }),
  );
  const runner = useRunner();
  const [requirementId, setRequirementId] = useState("");
  const [reason, setReason] = useState(action.text ?? "");
  const title = `Waive crew paperwork · ${jobName(picked.job)}`;
  if (picked.loading) return <ActionShell title={title}><Loading /></ActionShell>;
  if (!picked.job) return notFound(title);
  if (runner.done) return <ActionShell title={title}><Done>{runner.done}</Done></ActionShell>;
  const open = arr(picked.assignment?.requirements)
    .map((item) => item as Rec)
    .filter((row) => row.required === true && !["completed", "waived"].includes(str(row.status)));
  const chosen = requirementId || str(open[0]?.id);
  return (
    <ActionShell detail="The requirement stops blocking them; your reason is kept on the record." icon={<ClipboardCheck size={15} />} title={title}>
      {!picked.options.length ? (
        <Blocked>Nobody on this job has paperwork outstanding.</Blocked>
      ) : (
        <SubjectPicker {...picked.choice} noun="crew member" options={picked.options} subject={action.subject} />
      )}
      {picked.assignment ? (
        <Form>
          <SelectField
            label="Which requirement"
            onChange={setRequirementId}
            options={open.map((row) => ({ value: str(row.id), label: str(row.name) || str(row.kind) }))}
            value={chosen}
          />
          <TextField label="Why" onChange={setReason} value={reason} />
        </Form>
      ) : null}
      {picked.options.length ? <Actions
        busy={runner.busy}
        disabled={!picked.assignment || !chosen || !reason.trim()}
        label="Waive it"
        onClick={() =>
          void runner.run(
            async () => {
              if (!picked.assignment || !picked.job) return null;
              await sendCrewCommand("waiveRequirement", {
                projectId: picked.job.id,
                assignmentId: picked.assignment.id,
                requirementId: chosen,
                reason: reason.trim(),
              });
              return `Waived for ${picked.nameOf(picked.assignment)}.`;
            },
            { refresh: ["crewAssignments", "checkpoints", "readinessAssessments"] },
          )
        }
      /> : null}
      <Notice text={runner.notice} />
    </ActionShell>
  );
}

/**
 * Take someone off a job, or swap them for the next person on the list.
 *
 * Asked "take Sam off the Smith wedding" or "Sam can't make it, find someone
 * else", Cue had nothing to prepare: no command ended one assignment. The card
 * names the person and says whether they will be emailed before anything
 * runs, the same sentence the job page's crew card confirms.
 */
export function WithdrawCrewCard({ action }: ActionCardProps) {
  const replace = action.action === "replace_crew";
  const picked = useAssignmentChoice(action, (assignment) =>
    isLiveAssignment(assignment.status),
  );
  const ownerOrAdmin = useIsOwnerOrAdmin();
  const runner = useRunner();
  const [reason, setReason] = useState(action.text ?? "");
  const title = `${replace ? "Replace" : "Withdraw"} crew · ${jobName(picked.job)}`;
  if (!ownerOrAdmin) return <OwnerOnly title={title} />;
  if (picked.loading) return <ActionShell title={title}><Loading /></ActionShell>;
  if (!picked.job) return notFound(title);
  if (runner.done) {
    return (
      <ActionShell title={title}>
        <Done href={`/studio/crew?project=${encodeURIComponent(picked.job.id)}`} label="Open the job's crew">
          {runner.done}
        </Done>
      </ActionShell>
    );
  }
  const chosen = picked.assignment;
  const accepted = str(chosen?.status) === "accepted";
  const name = chosen ? picked.nameOf(chosen) : "";
  const role = str(chosen?.role) || "Crew";
  return (
    <ActionShell
      detail={
        chosen
          ? withdrawConsequence({ name, role, accepted, replace })
          : "Choose who comes off the job."
      }
      icon={<UserMinus size={15} />}
      title={title}
    >
      {!picked.options.length ? (
        <Blocked>Nobody is booked on, or has an offer out for, this job.</Blocked>
      ) : (
        <SubjectPicker {...picked.choice} noun="crew member" options={picked.options} subject={action.subject} />
      )}
      {chosen && accepted ? (
        <Form>
          <TextField label="Reason (optional — it goes in their email)" onChange={setReason} value={reason} />
        </Form>
      ) : null}
      {picked.options.length ? (
        <Actions
          busy={runner.busy}
          danger
          disabled={!chosen}
          label={replace ? "Withdraw and re-offer" : name ? `Withdraw ${name}` : "Withdraw"}
          onClick={() =>
            void runner.run(
              async () => {
                if (!chosen || !picked.job) return null;
                const outcome = await withdrawCrew({
                  projectId: picked.job.id,
                  assignmentId: chosen.id,
                  replace,
                  reason,
                });
                return withdrawDoneMessage(outcome, { name, role, replace });
              },
              { refresh: ["crewAssignments", "crewCascades", "readinessAssessments"] },
            )
          }
        />
      ) : null}
      <Notice text={runner.notice} />
    </ActionShell>
  );
}

export function CrewCloseoutCard({ action }: ActionCardProps) {
  const reviewing = action.action === "review_crew_closeout";
  const picked = useAssignmentChoice(action, (assignment) => {
    const closeout = (assignment.closeout ?? {}) as Rec;
    return reviewing ? str(closeout.status) === "submitted" : ["approved", "paid"].includes(str(closeout.status));
  });
  const runner = useRunner();
  const [decision, setDecision] = useState("approved");
  const [note, setNote] = useState(action.text ?? "");
  const [status, setStatus] = useState("paid");
  const [expected, setExpected] = useState(action.date ?? todayIso());
  const [reference, setReference] = useState("");
  const title = `${reviewing ? "Review crew closeout" : "Record a crew payment"} · ${jobName(picked.job)}`;
  if (picked.loading) return <ActionShell title={title}><Loading /></ActionShell>;
  if (!picked.job) return notFound(title);
  if (runner.done) return <ActionShell title={title}><Done>{runner.done}</Done></ActionShell>;
  const closeout = (picked.assignment?.closeout ?? {}) as Rec;
  return (
    <ActionShell
      detail={
        reviewing
          ? "Their hours, expenses and hand-off. Approving lets you record their payment."
          : "Records the payment's status for your books. No money moves from StudioCue."
      }
      icon={<BadgeCheck size={15} />}
      title={title}
    >
      {!picked.options.length ? (
        <Blocked>{reviewing ? "No crew closeouts are waiting for review on this job." : "Nobody on this job has an approved closeout to pay."}</Blocked>
      ) : (
        <SubjectPicker {...picked.choice} noun="crew member" options={picked.options} subject={action.subject} />
      )}
      {picked.assignment && reviewing ? (
        <>
          {closeout.hoursWorked || closeout.expensesCents ? (
            <p className="cue-action-note">
              {[closeout.hoursWorked ? `${String(closeout.hoursWorked)} hours` : "", closeout.expensesCents ? `${dollars(closeout.expensesCents)} expenses` : ""]
                .filter(Boolean)
                .join(" · ")}
            </p>
          ) : null}
          <Form>
            <SelectField
              label="Decision"
              onChange={setDecision}
              options={[
                { value: "approved", label: "Approve" },
                { value: "needs_changes", label: "Send back for changes" },
              ]}
              value={decision}
            />
            <TextAreaField label="Note to them (optional)" onChange={setNote} rows={2} value={note} />
          </Form>
        </>
      ) : null}
      {picked.assignment && !reviewing ? (
        <Form>
          <SelectField
            label="Status"
            onChange={setStatus}
            options={[
              { value: "scheduled", label: "Scheduled" },
              { value: "processing", label: "Processing" },
              { value: "paid", label: "Paid" },
            ]}
            value={status}
          />
          <TextField label={status === "paid" ? "Paid on" : "Expected on"} onChange={setExpected} type="date" value={expected} />
          <TextField label="Reference (optional)" onChange={setReference} value={reference} />
        </Form>
      ) : null}
      {picked.options.length ? <Actions
        busy={runner.busy}
        disabled={!picked.assignment}
        label={reviewing ? (decision === "approved" ? "Approve" : "Send back") : "Record it"}
        onClick={() =>
          void runner.run(
            async () => {
              if (!picked.assignment || !picked.job) return null;
              const who = picked.nameOf(picked.assignment);
              if (reviewing) {
                await sendCrewCommand("reviewAssignmentCloseout", {
                  projectId: picked.job.id,
                  assignmentId: picked.assignment.id,
                  decision,
                  reviewerNote: note.trim() || null,
                });
                return decision === "approved" ? `Approved ${who}'s closeout.` : `Sent ${who}'s closeout back.`;
              }
              await sendCrewCommand("updateAssignmentPayment", {
                projectId: picked.job.id,
                assignmentId: picked.assignment.id,
                status,
                expectedAt: /^\d{4}-\d{2}-\d{2}$/.test(expected) ? new Date(`${expected}T12:00:00`).toISOString() : null,
                reference: reference.trim() || null,
              });
              return `Recorded ${who}'s payment as ${status}.`;
            },
            { refresh: ["crewAssignments"] },
          )
        }
      /> : null}
      <Notice text={runner.notice} />
    </ActionShell>
  );
}

export function CrewOfferSettingsCard() {
  const workspace = useWorkspace();
  const title = "Crew offer settings";
  if (workspace.role !== "studio_owner")
    return <ActionShell title={title}><Blocked>Only the studio owner can change how crew offers go out.</Blocked></ActionShell>;
  return (
    <ActionShell detail="Whether offers go out automatically on booking, and how long crew have to answer." icon={<Users size={15} />} title={title}>
      <Embedded>
        <CrewOfferSettings />
      </Embedded>
    </ActionShell>
  );
}

// ─── Tasks and readiness ────────────────────────────────────────────────────

export function CreateTaskCard({ action }: ActionCardProps) {
  const { job, loading } = useJob(action.projectId);
  const runner = useRunner();
  const [title, setTitle] = useState((action.text ?? "").slice(0, 200));
  const [due, setDue] = useState(action.date ?? "");
  const [priority, setPriority] = useState("normal");
  const [assignee, setAssignee] = useState("");
  const heading = `Add a task to ${jobName(job)}`;
  if (loading) return <ActionShell title={heading}><Loading /></ActionShell>;
  if (!job) return notFound(heading);
  if (runner.done) return <ActionShell title={heading}><Done>{runner.done}</Done></ActionShell>;
  return (
    <ActionShell detail="Only your team sees it." icon={<ListChecks size={15} />} title={heading}>
      <Form>
        <TextField label="Task" onChange={setTitle} value={title} />
        <TextField label="Due (optional)" onChange={setDue} type="date" value={due} />
        <SelectField
          label="Priority"
          onChange={setPriority}
          options={[
            { value: "low", label: "Low" },
            { value: "normal", label: "Normal" },
            { value: "high", label: "High" },
            { value: "urgent", label: "Urgent" },
          ]}
          value={priority}
        />
        <AssigneeSelect onChange={setAssignee} value={assignee} />
      </Form>
      <Actions
        busy={runner.busy}
        disabled={title.trim().length < 2}
        label="Add it"
        onClick={() =>
          void runner.run(
            async () => {
              await runWorkflowCommand("createTask", {
                projectId: job.id,
                workflowRunId: null,
                checkpointId: null,
                title: title.trim(),
                description: "",
                ...assigneeFields(assignee),
                dueDate: /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null,
                priority,
                blocking: false,
              });
              return `Added “${title.trim()}” to ${jobName(job)}.`;
            },
            { refresh: ["tasks"] },
          )
        }
      />
      <Notice text={runner.notice} />
    </ActionShell>
  );
}

const DONE_TASK = new Set(["done", "completed", "complete", "closed", "cancelled"]);

export function CompleteTaskCard({ action }: ActionCardProps) {
  const { job, loading } = useJob(action.projectId);
  const tasks = useRecords("tasks");
  const runner = useRunner();
  const open = onJob(tasks, action.projectId).filter((task) => !DONE_TASK.has(str(task.status)));
  const options = open.map((task) => ({ id: task.id, name: str(task.title) || "Task", detail: str(task.dueDate) ? `Due ${str(task.dueDate)}` : undefined }));
  const choice = useSubjectChoice(action.subject, options);
  const [completedId, setCompletedId] = useState<string | null>(null);
  const undo = useRunner();
  const title = `Mark a task done · ${jobName(job)}`;
  if (loading || !tasks) return <ActionShell title={title}><Loading /></ActionShell>;
  if (!job) return notFound(title);
  // Done is one tap, so it keeps a way back: a mis-tap reopens the task.
  if (runner.done)
    return (
      <ActionShell title={title}>
        <Done>{undo.done ?? runner.done}</Done>
        {completedId && !undo.done ? (
          <div className="copilot-flow-actions">
            <button
              className="button button-light"
              disabled={undo.busy}
              onClick={() =>
                void undo.run(
                  async () => {
                    await runWorkflowCommand("reopenTask", { taskId: completedId });
                    return "Undone — it's open again.";
                  },
                  { refresh: ["tasks"] },
                )
              }
              type="button"
            >
              {undo.busy ? "Working…" : "Undo"}
            </button>
          </div>
        ) : null}
        <Notice text={undo.notice} />
      </ActionShell>
    );
  const task = open.find((item) => item.id === choice.chosen) ?? null;
  return (
    <ActionShell icon={<CheckSquare size={15} />} title={title}>
      {!options.length ? <Done>No open tasks on this job.</Done> : <SubjectPicker {...choice} noun="task" options={options} subject={action.subject} />}
      {options.length ? (
        <Actions
          busy={runner.busy}
          disabled={!task}
          label="Mark done"
          onClick={() =>
            void runner.run(
              async () => {
                if (!task) return null;
                await runWorkflowCommand("completeTask", { taskId: task.id });
                setCompletedId(task.id);
                return `“${str(task.title)}” is done.`;
              },
              { refresh: ["tasks", "checkpoints", "readinessAssessments"] },
            )
          }
        />
      ) : null}
      <Notice text={runner.notice} />
    </ActionShell>
  );
}

/**
 * Edit, reopen or cancel a task (wave 3): the same commands as the row on
 * /studio/tasks. Reopen picks among settled tasks; edit and cancel among open
 * ones.
 */
export function TaskChangeCard({ action }: ActionCardProps) {
  const { job, loading } = useJob(action.projectId);
  const tasks = useRecords("tasks");
  const runner = useRunner();
  const kind = action.action as "edit_task" | "reopen_task" | "cancel_task";
  const pool = onJob(tasks, action.projectId).filter((task) =>
    kind === "reopen_task" ? DONE_TASK.has(str(task.status)) : !DONE_TASK.has(str(task.status)),
  );
  const options = pool.map((task) => ({
    id: task.id,
    name: str(task.title) || "Task",
    detail: kind === "reopen_task" ? str(task.status) : str(task.dueDate) ? `Due ${str(task.dueDate)}` : undefined,
  }));
  const choice = useSubjectChoice(action.subject, options);
  const task = pool.find((item) => item.id === choice.chosen) ?? null;
  const [edits, setEdits] = useState<{
    id: string;
    title: string;
    dueDate: string;
    priority: string;
    assignee: string;
    description: string;
  } | null>(null);
  const [reason, setReason] = useState(kind === "cancel_task" ? action.text ?? "" : "");
  const titles = { edit_task: "Change a task", reopen_task: "Reopen a task", cancel_task: "Cancel a task" };
  const title = `${titles[kind]} · ${jobName(job)}`;
  if (loading || !tasks) return <ActionShell title={title}><Loading /></ActionShell>;
  if (!job) return notFound(title);
  if (runner.done) return <ActionShell title={title}><Done>{runner.done}</Done></ActionShell>;
  // The edit form starts from the chosen task, and from the words the
  // operator used for a new due date or title.
  const form =
    task && kind === "edit_task"
      ? edits?.id === task.id
        ? edits
        : {
            id: task.id,
            title: str(task.title),
            dueDate: action.date ?? str(task.dueDate),
            priority: str(task.priority) || "normal",
            assignee: assigneeValue(task),
            description: str(task.description),
          }
      : null;
  const change = (patch: Partial<NonNullable<typeof form>>) => form && setEdits({ ...form, ...patch });
  return (
    <ActionShell
      detail={
        kind === "cancel_task"
          ? "It stays on the list as a record, marked cancelled."
          : kind === "reopen_task"
            ? "It goes back on the list as not started."
            : "Only your team sees tasks."
      }
      icon={<ListChecks size={15} />}
      title={title}
    >
      {!options.length ? (
        <Done>{kind === "reopen_task" ? "No done or cancelled tasks on this job." : "No open tasks on this job."}</Done>
      ) : (
        <SubjectPicker {...choice} noun="task" options={options} subject={action.subject} />
      )}
      {form ? (
        <Form>
          <TextField label="Task" onChange={(value) => change({ title: value })} value={form.title} />
          <TextField label="Due" onChange={(value) => change({ dueDate: value })} type="date" value={form.dueDate} />
          <AssigneeSelect onChange={(value) => change({ assignee: value })} value={form.assignee} />
          <SelectField
            label="Priority"
            onChange={(value) => change({ priority: value })}
            options={[
              { value: "low", label: "Low" },
              { value: "normal", label: "Normal" },
              { value: "high", label: "High" },
              { value: "urgent", label: "Urgent" },
            ]}
            value={form.priority}
          />
          <TextAreaField label="Notes" onChange={(value) => change({ description: value })} rows={2} value={form.description} />
        </Form>
      ) : null}
      {task && kind === "cancel_task" ? (
        <Form>
          <TextField label="Why (optional)" onChange={setReason} value={reason} />
        </Form>
      ) : null}
      {options.length ? (
        <Actions
          busy={runner.busy}
          danger={kind === "cancel_task"}
          disabled={!task || (form !== null && form.title.trim().length < 2)}
          label={kind === "edit_task" ? "Save" : kind === "reopen_task" ? "Reopen it" : "Cancel it"}
          onClick={() =>
            void runner.run(
              async () => {
                if (!task) return null;
                if (kind === "edit_task" && form) {
                  await runWorkflowCommand("updateTask", {
                    taskId: task.id,
                    title: form.title.trim(),
                    description: form.description.trim(),
                    dueDate: /^\d{4}-\d{2}-\d{2}$/.test(form.dueDate) ? form.dueDate : null,
                    priority: form.priority,
                    ...assigneeFields(form.assignee),
                  });
                  return `Saved “${form.title.trim()}”.`;
                }
                if (kind === "reopen_task") {
                  await runWorkflowCommand("reopenTask", { taskId: task.id });
                  return `“${str(task.title)}” is open again.`;
                }
                await runWorkflowCommand("cancelTask", { taskId: task.id, reason: reason.trim().slice(0, 500) || null });
                return `“${str(task.title)}” is cancelled.`;
              },
              { refresh: ["tasks"] },
            )
          }
        />
      ) : null}
      <Notice text={runner.notice} />
    </ActionShell>
  );
}

export function ReadinessCard({ action }: ActionCardProps) {
  const { job, loading } = useJob(action.projectId);
  const title = `Readiness · ${jobName(job)}`;
  if (loading) return <ActionShell title={title}><Loading /></ActionShell>;
  if (!job) return notFound(title);
  return (
    <ActionShell
      detail={
        action.action === "reopen_checkpoint"
          ? "Reopen an item marked done or waived by mistake — owners and admins, with a reason."
          : "Mark an item done when it was handled outside StudioCue; only the owner can waive one."
      }
      icon={<ClipboardCheck size={15} />}
      title={title}
    >
      <Embedded>
        <ReadinessCheckpoints projectId={job.id} />
      </Embedded>
    </ActionShell>
  );
}

// ─── After the event ────────────────────────────────────────────────────────

export function DeliveryCard({ action }: ActionCardProps) {
  const { job, loading } = useJob(action.projectId);
  const titles: Record<string, string> = {
    record_delivery: "Deliver the gallery",
    complete_editing_step: "Post-production",
    update_album: "The album",
    close_job: "Close out the job",
  };
  const title = `${titles[action.action]} · ${jobName(job)}`;
  if (loading) return <ActionShell title={title}><Loading /></ActionShell>;
  if (!job) return notFound(title);
  const details: Record<string, string> = {
    record_delivery: "They're emailed the gallery link now; the review request and album reminders follow on their own.",
    complete_editing_step: "Tick off each step as it's done. Only the backup has to be done before anything is released.",
    update_album: "Track the album from selections to fulfilment.",
    close_job: "Everything owed is checked; anything settled outside StudioCue can be confirmed here before it closes.",
  };
  return (
    <ActionShell detail={details[action.action]} icon={<Film size={15} />} title={title}>
      <Embedded>
        {action.action === "record_delivery" ? (
          <DeliveryForm projectId={job.id} />
        ) : action.action === "complete_editing_step" ? (
          <PostProductionChecklist projectId={job.id} />
        ) : (
          <DeliveryCloseoutWorkspace projectId={job.id} />
        )}
      </Embedded>
    </ActionShell>
  );
}

export function ConfirmReviewCard({ action }: ActionCardProps) {
  const { job, loading } = useJob(action.projectId);
  const reviews = useRecords("reviewRequests");
  const ownerOrAdmin = useIsOwnerOrAdmin();
  const runner = useRunner();
  // One tap cancelled every review ask still to come, for good — the server
  // skips them and nothing brings them back (wave 3). A studio that only
  // wants the asks to stop has "Don't ask them", which records no review.
  const [confirming, setConfirming] = useState(false);
  const title = `They left a review · ${jobName(job)}`;
  if (!ownerOrAdmin) return <OwnerOnly title={title} />;
  if (loading || !reviews) return <ActionShell title={title}><Loading /></ActionShell>;
  if (!job) return notFound(title);
  if (runner.done) return <ActionShell title={title}><Done>{runner.done}</Done></ActionShell>;
  // The statuses the server writes. This read "confirmed" and "completed",
  // which it never writes, so a couple's own `client_confirmed` looked open
  // and the card offered to overwrite it; a `skipped` ask is closed too.
  const closedStatuses = ["client_confirmed", "manually_confirmed", "skipped"];
  const jobReviews = onJob(reviews, job.id);
  const request = jobReviews.find((item) => !closedStatuses.includes(str(item.status))) ?? null;
  if (jobReviews.some((item) => str(item.status) === "client_confirmed"))
    return <ActionShell title={title}><Done>They already confirmed their review in their portal.</Done></ActionShell>;
  if (!request) return <ActionShell title={title}><Done>There is no open review request on this job.</Done></ActionShell>;
  return (
    <ActionShell detail="The remaining review reminders to them stop." icon={<Star size={15} />} title={title}>
      {confirming ? (
        <ConfirmStep
          busy={runner.busy}
          cancelLabel="Not yet"
          confirmLabel="Yes, they reviewed us"
          label="Record their review?"
          onCancel={() => setConfirming(false)}
          onConfirm={() =>
            void runner.run(
              async () => {
                await sendPostEventCommand("confirmReview", { projectId: job.id, reviewRequestId: request.id });
                return "Recorded. No more review reminders will go to them.";
              },
              { refresh: ["reviewRequests", "projects"] },
            )
          }
        >
          This records that they left a review and cancels every review ask still to come — that can&rsquo;t be undone.
          If they haven&rsquo;t reviewed yet and you just want the asks to stop, ask Cue not to ask them instead.
        </ConfirmStep>
      ) : (
        <Actions busy={runner.busy} label="They reviewed us" onClick={() => setConfirming(true)} />
      )}
      <Notice text={runner.notice} />
    </ActionShell>
  );
}

/**
 * "I sent them the wrong gallery link" (Wave 2). Picks the delivery by what
 * the operator named, then mounts the same two-step correction the delivery
 * page uses; a link in the operator's words is offered as the new one.
 */
export function ReplaceGalleryLinkCard({ action }: ActionCardProps) {
  const { job, loading } = useJob(action.projectId);
  const deliveries = useRecords("deliveryRecords");
  const ownerOrAdmin = useIsOwnerOrAdmin();
  const [done, setDone] = useState<string | null>(null);
  const live = onJob(deliveries, action.projectId).filter((item) => !["revoked", "draft"].includes(str(item.status)));
  const options = live.map((item) => ({
    id: item.id,
    name: str(item.label) || "Delivery",
    detail: str(item.galleryUrl) || undefined,
  }));
  const choice = useSubjectChoice(action.subject, options);
  const title = `Fix a gallery link · ${jobName(job)}`;
  if (!ownerOrAdmin) return <OwnerOnly title={title} />;
  if (loading || !deliveries) return <ActionShell title={title}><Loading /></ActionShell>;
  if (!job) return notFound(title);
  if (done) return <ActionShell title={title}><Done>{done}</Done></ActionShell>;
  const delivery = live.find((item) => item.id === choice.chosen) ?? null;
  const offered = /^https:\/\/\S+$/.test(action.text ?? "") ? (action.text as string) : "";
  return (
    <ActionShell
      detail="The wrong link is taken back and forwards to the right one; the couple gets one email saying so."
      icon={<Link2 size={15} />}
      title={title}
    >
      {!options.length ? (
        <Done>Nothing has been delivered on this job yet.</Done>
      ) : (
        <SubjectPicker {...choice} noun="delivery" options={options} subject={action.subject} />
      )}
      {delivery ? (
        <Embedded>
          <ReplaceDeliveryLink
            defaultOpen
            delivery={delivery}
            initialUrl={offered}
            key={delivery.id}
            onReplaced={setDone}
            projectId={job.id}
          />
        </Embedded>
      ) : null}
    </ActionShell>
  );
}

/** "Don't ask them for a review" (Wave 2): the honest stop, not a fake confirmation. */
export function SkipReviewRequestsCard({ action }: ActionCardProps) {
  const { job, loading } = useJob(action.projectId);
  const reviews = useRecords("reviewRequests");
  const ownerOrAdmin = useIsOwnerOrAdmin();
  const runner = useRunner();
  const title = `Don't ask for a review · ${jobName(job)}`;
  if (!ownerOrAdmin) return <OwnerOnly title={title} />;
  if (loading || !reviews) return <ActionShell title={title}><Loading /></ActionShell>;
  if (!job) return notFound(title);
  if (runner.done) return <ActionShell title={title}><Done>{runner.done}</Done></ActionShell>;
  if (typeof job.reviewRequestsSkippedAt === "string")
    return <ActionShell title={title}><Done>Review asks are already off for this couple.</Done></ActionShell>;
  const pending = onJob(reviews, job.id).filter((item) => str(item.status) === "scheduled").length;
  return (
    <ActionShell
      detail={
        pending
          ? `${pending} review ${pending === 1 ? "ask hasn't" : "asks haven't"} gone out yet; ${pending === 1 ? "it" : "they"} will be cancelled and none scheduled. Nothing is sent to them.`
          : "No review asks will be scheduled for this couple. Nothing is sent to them."
      }
      icon={<Star size={15} />}
      title={title}
    >
      <Actions
        busy={runner.busy}
        label="Don't ask them"
        onClick={() =>
          void runner.run(
            async () => {
              await sendPostEventCommand("skipReviewRequests", { projectId: job.id, reason: action.text ?? null });
              return "Done. StudioCue won't ask them for a review.";
            },
            { refresh: ["reviewRequests", "projects", "projectCloseouts"] },
          )
        }
      />
      <Notice text={runner.notice} />
    </ActionShell>
  );
}

// ─── Team ───────────────────────────────────────────────────────────────────

export function TeamCard({ action }: ActionCardProps) {
  const workspace = useWorkspace();
  const titles: Record<string, string> = {
    invite_team_member: "Invite someone to your team",
    change_team_member: "Change someone's access",
    revoke_team_invite: "Withdraw a team invitation",
  };
  const title = titles[action.action] ?? "Your team";
  if (workspace.role !== "studio_owner")
    return <ActionShell title={title}><Blocked>Only the studio owner manages the team.</Blocked></ActionShell>;
  return (
    <ActionShell detail={action.text ? `You mentioned: ${action.text}` : "Invitations are emailed; each person uses a seat on your plan."} icon={<Users size={15} />} title={title}>
      <Embedded>
        <TeamManagement />
      </Embedded>
    </ActionShell>
  );
}

// ─── Studio settings ────────────────────────────────────────────────────────

export function PackageCatalogueCard({ action }: ActionCardProps) {
  // The price list: a one-off written for one couple is not on it
  // (features/packages/one-off.ts).
  const packages = useRecords("packages")?.filter((item) => isCataloguePackage(item)) ?? null;
  const ownerOrAdmin = useIsOwnerOrAdmin();
  const runner = useRunner();
  const kind = action.action;
  const active = (packages ?? []).filter((item) => item.active === true);
  const options = (kind === "retire_package" ? active : packages ?? []).map((item) => ({
    id: item.id,
    name: str(item.name) || "Package",
    detail: `${dollars(item.basePriceCents)}${item.active === true ? "" : " · not offered"}`,
  }));
  const choice = useSubjectChoice(action.subject, options);
  const titles: Record<string, string> = {
    create_package: "Add a package to your price list",
    edit_package: "Change a package",
    retire_package: "Stop offering a package",
  };
  const title = titles[kind]!;
  if (!ownerOrAdmin) return <OwnerOnly title={title} />;
  if (kind === "create_package")
    return (
      <ActionShell detail="Its price, retainer, coverage and what's included." icon={<PackagePlus size={15} />} title={title}>
        <Embedded>
          <CreatePackageForm returnTo="/studio/copilot" />
        </Embedded>
      </ActionShell>
    );
  if (!packages) return <ActionShell title={title}><Loading /></ActionShell>;
  if (runner.done) return <ActionShell title={title}><Done>{runner.done}</Done></ActionShell>;
  const chosen = options.find((option) => option.id === choice.chosen) ?? null;
  return (
    <ActionShell
      detail={kind === "retire_package" ? "Jobs that already have it keep it; it just isn't offered from now on." : "Jobs already priced keep the version they were priced with."}
      icon={<PackagePlus size={15} />}
      title={title}
    >
      <SubjectPicker {...choice} noun="package" options={options} subject={action.subject} />
      {chosen && kind === "edit_package" ? (
        <Embedded>
          <EditPackageForm packageId={chosen.id} />
        </Embedded>
      ) : null}
      {kind === "retire_package" ? (
        <Actions
          busy={runner.busy}
          danger
          disabled={!chosen}
          label="Stop offering it"
          onClick={() =>
            void runner.run(
              async () => {
                if (!chosen) return null;
                await runCrmCommand("updatePackage", { packageId: chosen.id, active: false });
                return `${chosen.name} is no longer offered.`;
              },
              { refresh: ["packages"] },
            )
          }
        />
      ) : null}
      <Notice text={runner.notice} />
    </ActionShell>
  );
}

/** A settings screen, mounted in the chat. */
export function SettingsCard({ action }: ActionCardProps) {
  const workspace = useWorkspace();
  const ownerOrAdmin = useIsOwnerOrAdmin();
  const owner = workspace.role === "studio_owner";
  const panels: Record<string, { title: string; detail: string; ownerOnly?: boolean; body: ReactNode; href: string; open?: string }> = {
    edit_agreement: {
      title: "Your agreement",
      detail: "The contract StudioCue writes each couple's from, and whether it goes out on its own after they accept.",
      body: <AgreementEditor />,
      href: "/studio/contracts/agreement",
    },
    set_contract_auto_send: {
      title: "Send contracts automatically",
      detail: "Turning this on signs each contract with your typed name when it goes out after they accept.",
      body: <AgreementEditor />,
      href: "/studio/contracts/agreement",
    },
    edit_questionnaire_template: {
      title: "Planning questionnaires",
      detail: "Create a questionnaire or change one. A change makes a new version; couples mid-way keep theirs.",
      // A full-page editor: it does not fit a chat column (it overflowed by
      // 460px on a 1440px screen), so the card opens it instead.
      body: null,
      href: "/studio/questionnaires",
      open: "Open the questionnaire editor",
    },
    edit_email_template: {
      title: "Email templates",
      detail: "Change the wording of StudioCue's emails. A saved change is a draft until you activate it.",
      body: null,
      href: "/studio/settings/email-templates",
      open: "Open the email templates",
    },
    set_consultation_availability: {
      title: "Consultation availability",
      detail: "When couples can book, how long a consultation is, and Zoom, phone or in person.",
      body: <ConsultationAvailability />,
      href: "/studio/settings/consultation-availability",
    },
    set_automatic_emails: {
      title: "Automatic emails",
      // Only these three are governed here (lifecycle-pack-panel.tsx). Review
      // asks, questionnaire and payment reminders have their own controls, so
      // the card doesn't claim them.
      detail:
        "The schedule confirmation, final balance summary and day-before checklist: whether StudioCue drafts them, and whether they send without your review.",
      ownerOnly: true,
      body: <LifecyclePackPanel />,
      href: "/studio/settings/automatic-drafts",
    },
    set_autopay: {
      title: "Automatic card payments",
      detail: "Charge the balance to the card on file when it's due. Needs QuickBooks Payments connected.",
      body: <AutopaySettings />,
      href: "/studio/integrations?tab=autopay",
    },
    edit_branding: {
      title: "Your studio's name and branding",
      detail: "The name, logo, colour and contact details on everything the couple sees.",
      ownerOnly: true,
      body: (
        <>
          <StudioIdentitySettings />
          <EmailBranding />
        </>
      ),
      href: "/studio/settings/email-branding",
    },
    edit_timing_rules: {
      title: "Timing rules",
      detail: "How long each part of the day takes, used when a timeline is drafted.",
      body: <TimingRuleEditor />,
      href: "/studio/schedules/new",
    },
    export_studio_data: {
      title: "Export your studio's data",
      detail: "A full export, emailed as a download when it's ready.",
      ownerOnly: true,
      body: <DataControls />,
      href: "/studio/settings/data",
    },
    set_crew_offer_settings: {
      title: "Crew offer settings",
      detail: "Whether offers go out automatically on booking, and how long crew have to answer.",
      ownerOnly: true,
      body: <CrewOfferSettings />,
      href: "/studio/settings/crew-offers",
    },
    edit_workflow_template: {
      title: "Custom workflows",
      detail: "The checklist and automations a kind of job follows. A change makes a new version; jobs already running keep theirs.",
      body: <CreateWorkflowForm />,
      href: "/studio/workflows",
    },
    set_insurance_settings: {
      title: "Certificates of insurance",
      detail: "Your agent's details and how StudioCue asks for, chases and sends certificates.",
      body: <CoiSettings />,
      href: "/studio/settings/insurance",
    },
    edit_add_on_library: {
      title: "Add-ons",
      detail: "The extras you sell on top of a package. Packages suggest them; you choose them per job.",
      body: <AddOnLibrary />,
      href: "/studio/library/add-ons",
    },
    import_studio_materials: {
      title: "Import your studio materials",
      detail: "Bring in templates, price lists, contracts and questionnaires from files or your website. You review every draft before anything goes live.",
      body: null,
      href: "/studio/import",
      open: "Open the importer",
    },
    set_up_inquiry_capture: {
      title: "Inquiry capture",
      detail: "Forward inquiries to StudioCue and teach it your contact form.",
      body: <InquiryForwardingSettings />,
      href: "/studio/settings/inquiry-capture",
    },
  };
  const panel = panels[action.action]!;
  if (panel.ownerOnly ? !owner : !ownerOrAdmin)
    return (
      <ActionShell title={panel.title}>
        <Blocked>{panel.ownerOnly ? "Only the studio owner can change this." : "Only the studio's owners and admins can change this."}</Blocked>
      </ActionShell>
    );
  return (
    <ActionShell detail={panel.detail} icon={<Settings2 size={15} />} title={panel.title}>
      {panel.body ? (
        <>
          <Embedded>{panel.body}</Embedded>
          <Link className="button button-light" href={panel.href}>Open it in Settings</Link>
        </>
      ) : (
        <Link className="button button-dark" href={panel.href}>{panel.open ?? "Open it"}</Link>
      )}
    </ActionShell>
  );
}

export function ForwardingAddressCard() {
  return (
    <ActionShell
      detail="Forward any inquiry here, or set a filter in your email to forward them automatically. Each becomes an inquiry with a reply drafted."
      icon={<Mail size={15} />}
      title="Your inquiry forwarding address"
    >
      <Embedded>
        <InquiryForwardingAddress />
      </Embedded>
      <Link className="button button-light" href="/studio/settings/inquiry-capture">Set up forwarding</Link>
    </ActionShell>
  );
}

const PROVIDER_LABELS: Partial<Record<IntegrationProvider, string>> = {
  google_calendar: "Google Calendar",
  zoom: "Zoom",
  quickbooks: "QuickBooks",
  dropbox: "Dropbox",
};

const enabledOAuth = new Set(
  (process.env.NEXT_PUBLIC_ENABLED_OAUTH_PROVIDERS ?? "")
    .split(",")
    .map((provider) => provider.trim())
    .filter(Boolean),
);

export function ConnectIntegrationCard({ action }: ActionCardProps) {
  const workspace = useWorkspace();
  const ownerOrAdmin = useIsOwnerOrAdmin();
  const connections = useRecords("integrationConnections");
  const runner = useRunner();
  const options = [...offeredProviders].map((provider) => {
    const connection = (connections ?? []).find((item) => item.provider === provider && !item.archivedAt);
    return {
      id: provider,
      name: PROVIDER_LABELS[provider] ?? provider,
      detail: str(connection?.status) === "connected" ? "Connected" : "Not connected",
    };
  });
  const choice = useSubjectChoice(action.subject, options);
  const title = "Connect an app";
  if (!ownerOrAdmin) return <OwnerOnly title={title} />;
  const chosen = options.find((option) => option.id === choice.chosen) ?? null;
  const available = chosen ? enabledOAuth.has(chosen.id) : false;
  return (
    <ActionShell detail="You sign in to the app and approve StudioCue there, then come back here." icon={<Plug size={15} />} title={title}>
      <SubjectPicker {...choice} noun="app" options={options} subject={action.subject} />
      {chosen && !available ? <Blocked>{`${chosen.name} can't be connected in this environment yet.`}</Blocked> : null}
      <Actions
        busy={runner.busy}
        disabled={!chosen || !available || !workspace.tenantId}
        label={chosen ? `${chosen.detail === "Connected" ? "Reconnect" : "Connect"} ${chosen.name}` : "Connect"}
        onClick={() =>
          void runner.run(async () => {
            if (!chosen || !workspace.tenantId) return null;
            const url = await startProviderConnect(chosen.id as IntegrationProvider, workspace.tenantId, "/studio/copilot");
            window.location.assign(url);
            return null;
          })
        }
        secondary={<Link className="button button-light" href="/studio/integrations">All integrations</Link>}
      />
      <Notice text={runner.notice} />
    </ActionShell>
  );
}

export function SubscriptionCard() {
  const workspace = useWorkspace();
  return (
    <ActionShell detail="Your plan, card and invoices are managed with Stripe." icon={<Link2 size={15} />} title="Your StudioCue subscription">
      {workspace.role !== "studio_owner" ? <Blocked>Only the studio owner manages the subscription.</Blocked> : null}
      <Link className="button button-dark" href="/studio/subscription">Open the subscription</Link>
    </ActionShell>
  );
}


/**
 * The crew for several roles at once, including the plan StudioCue prepared
 * at booking: the crew page's own planner, for this job.
 */
export function CrewPlanCard({ action }: ActionCardProps) {
  const { job, loading } = useJob(action.projectId);
  const title = `Plan the crew · ${jobName(job)}`;
  if (loading) return <ActionShell title={title}><Loading /></ActionShell>;
  if (!job) return notFound(title);
  return (
    <ActionShell
      detail="Approve the plan prepared at booking, or choose people for each role. Offers go out when you send them; each person is asked in turn if the first says no."
      icon={<Users size={15} />}
      title={title}
    >
      <Embedded>
        <CrewCascadeWorkspace projectId={job.id} />
      </Embedded>
    </ActionShell>
  );
}

/**
 * "I'm not at the Smith wedding — send crew for everything." Whether the owner
 * shoots a job is set per job (see OwnerShootingToggle); `text` says which way.
 */
export function OwnerShootingCard({ action }: ActionCardProps) {
  const { job, loading } = useJob(action.projectId);
  const ownerOrAdmin = useIsOwnerOrAdmin();
  const runner = useRunner();
  const title = `Who's shooting · ${jobName(job)}`;
  if (!ownerOrAdmin) return <OwnerOnly title={title} />;
  if (loading) return <ActionShell title={title}><Loading /></ActionShell>;
  if (!job) return <ActionShell title={title}><Blocked>{"I couldn't find that job."}</Blocked></ActionShell>;
  if (runner.done) return <ActionShell title={title}><Done href={`/studio/projects/${job.id}`} label="Open the job">{runner.done}</Done></ActionShell>;
  const said = str(action.text).toLowerCase();
  const wantShooting = !/\b(no|not|isn'?t|won'?t|away|off|crew)\b/.test(said);
  const now = ownerShootsJob(job);
  return (
    <ActionShell
      detail={
        wantShooting
          ? "You're one of the crew on this job, so StudioCue books one fewer person."
          : "You're not on this one, so every role in the packages is booked from your crew."
      }
      icon={<Users size={15} />}
      title={title}
    >
      {now === wantShooting ? (
        <Done href={`/studio/projects/${job.id}`} label="Open the job">
          {wantShooting ? "You're already down as shooting this one." : "It's already set to crew for every role."}
        </Done>
      ) : (
        <>
          <Actions
            busy={runner.busy}
            label={wantShooting ? "I'm shooting it" : "Not me this time"}
            onClick={() =>
              void runner.run(async () => {
                await setOwnerShooting(job.id, wantShooting);
                return wantShooting
                  ? "Done — you're shooting it, and the crew count is one fewer."
                  : "Done — every role will be booked from your crew.";
              }, { refresh: ["projects"] })
            }
          />
          <Notice text={runner.notice} />
        </>
      )}
    </ActionShell>
  );
}
