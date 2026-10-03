"use client";

import {
  describeCoverage,
  resolveCoverage,
} from "@/features/packages/coverage";
import {
  ArrowRight,
  BrainCircuit,
  Check,
  CircleAlert,
  FileText,
  FileUp,
  LoaderCircle,
  MessageSquareText,
  PackageCheck,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import { StatusBadge } from "@/components/ui/status-badge";
import { useWorkspace } from "@/features/auth/workspace-context";
import { blockingIssues } from "@/features/ai/blocking-issues";
import {
  DEFAULT_PROPOSAL_TERMS,
  groundedBookingDraft,
  proposalTermsForPackages,
} from "@/features/booking/autopilot";
import { currentConsultation } from "@/features/consultations/live";
import { briefRerunBlocked, currentBriefActions } from "@/features/booking/brief-run";
import { runAiQueueCommand } from "@/lib/ai-actions/command-client";
import { sendBookingCommand } from "@/lib/booking/command-client";
import { runCrmCommand } from "@/lib/crm/command-client";
import { getFirebaseClient } from "@/lib/firebase/client";
import { useTenantDocuments } from "@/components/live/tenant-records";
import { runProposalCommand } from "@/lib/proposals/command-client";
import {
  PanelError,
  PanelLoading,
  useWorkspaceGate,
} from "@/components/ui/panel-state";
import { projectStateLabel } from "@/features/projects/state-label";
import { canCreateProposalForProject } from "@/features/proposals/eligibility";
import { bookingGateNeeds, projectProfile, vocab } from "@/features/job-kinds/job-kinds";
import { friendlyError } from "@/lib/ai/friendly-error";
import {
  pastConsultation,
  pastProposal,
  proposalAccepted,
} from "@/features/projects/stage-progress";
import { addCalendarDays, todayLocalIso } from "@/lib/format/event-date";
import { isCataloguePackage } from "@/features/packages/one-off";
import { ConsultationCorrections } from "@/components/booking/consultation-corrections";

type Value = Record<string, unknown> & { id: string };

const text = (value: unknown): string =>
  typeof value === "string" ? value : "";
const object = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

function money(value: unknown, currency: unknown) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: text(currency) || "USD",
  }).format(Number(value ?? 0) / 100);
}

function futureDate(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
}

/**
 * The same offset as a plain date, safe to send.
 *
 * `futureDate(7).toISOString().slice(0, 10)` re-read the shifted local date in
 * UTC and landed a day late every evening in a negative offset. The full
 * timestamp uses of `futureDate` are instants and stay as they are; only the
 * date-string ones were wrong.
 */
function futureDateString(days: number) {
  return addCalendarDays(todayLocalIso(), days);
}

const COMMAND_ERRORS: Record<string, string> = {
  PROJECT_NOT_IN_CONSULTATION:
    "This project is still marked as a lead. Open the project overview and move it to the Consultation stage, then complete the notes here.",
  CONSULTATION_NOT_FOUND:
    "This consultation could not be found. Refresh and try again.",
  CONSULTATION_ALREADY_COMPLETED:
    "This consultation is already completed. Refresh to see the booking brief.",
  PACKAGE_SNAPSHOT_REQUIRED:
    "Approve a package recommendation below before creating the proposal draft.",
  CLIENT_EMAIL_REQUIRED:
    "Add a valid email address for the client before creating the proposal.",
  BOOKING_BRIEF_ALREADY_PREPARING:
    "The brief is already being prepared. It will appear here in a moment.",
};

function commandError(caught: unknown, fallback: string): string {
  const code =
    caught instanceof Error ? caught.message.split(":")[0]?.trim() ?? "" : "";
  return COMMAND_ERRORS[code] ?? friendlyError(caught, fallback);
}

export function BookingAutopilotWorkspace({
  projectId,
}: {
  projectId: string;
}) {
  const workspace = useWorkspace();
  const gate = useWorkspaceGate();
  const [project, setProject] = useState<Value | null>(null);
  const [consultation, setConsultation] = useState<Value | null>(null);
  /** The newest consultation, when it is one they didn't turn up to. */
  const [missed, setMissed] = useState<Value | null>(null);
  const [packages, setPackages] = useState<Value[]>([]);
  const [actions, setActions] = useState<Value[]>([]);
  const [notes, setNotes] = useState("");
  const [selectedPackageId, setSelectedPackageId] = useState("");
  // More than one package on a wedding: photo and video, say (Gabe,
  // 2026-09-30: "Cant pick two packages"). The first chosen stays the main
  // package; these are added alongside it, on one proposal with one total.
  const [extraPackageIds, setExtraPackageIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [proposalId, setProposalId] = useState<string | null>(null);
  const [noteSource, setNoteSource] = useState<"notes" | "transcript">("notes");
  // "Notes changed?" under the brief: the notes, editable, and a fresh run.
  const [rerunOpen, setRerunOpen] = useState(false);
  const [proposalStatuses, setProposalStatuses] = useState<string[]>([]);

  // The project's state via the live store, so a booking mutation elsewhere on
  // this page (record signature/retainer, confirm booking) re-flows the hero
  // and status label here without a reload. Falls back to the one-shot getDoc
  // read below until the store has it.
  const { records: projectRecords } = useTenantDocuments("projects");
  const { records: contractRecords } = useTenantDocuments("contracts");

  const load = useCallback(async () => {
    if (!workspace.tenantId) return;
    setLoading(true);
    try {
      // Inside the try: getFirebaseClient() throws on an incomplete client
      // config, and outside it that escaped as an unhandled rejection, so the
      // finally never ran and this panel spun forever.
      const { firestore } = getFirebaseClient();
      const [
        projectSnapshot,
        consultationSnapshot,
        packageSnapshot,
        actionSnapshot,
        proposalSnapshot,
      ] = await Promise.all([
          getDoc(doc(firestore, "projects", projectId)),
          getDocs(
            query(
              collection(firestore, "consultations"),
              where("tenantId", "==", workspace.tenantId),
              where("projectId", "==", projectId),
            ),
          ),
          getDocs(
            query(
              collection(firestore, "packages"),
              where("tenantId", "==", workspace.tenantId),
              where("active", "==", true),
            ),
          ),
          getDocs(
            query(
              collection(firestore, "aiActions"),
              where("tenantId", "==", workspace.tenantId),
              where("projectId", "==", projectId),
            ),
          ),
          getDocs(
            query(
              collection(firestore, "proposals"),
              where("tenantId", "==", workspace.tenantId),
              where("projectId", "==", projectId),
            ),
          ),
        ]);
      if (
        !projectSnapshot.exists() ||
        projectSnapshot.get("tenantId") !== workspace.tenantId
      )
        throw new Error("Project not found in this workspace.");
      // The latest one that is on or happened: a cancelled call is not the
      // one to write notes against.
      const consultationValues = consultationSnapshot.docs.map(
        (item): Value => ({ id: item.id, ...item.data() }),
      );
      const consultationValue = currentConsultation(consultationValues);
      // A no-show newer than anything on or held: the page offers "invite
      // them to rebook" rather than "schedule the consultation first".
      const newest = consultationValues
        .filter((item) => !item.archivedAt && item.status !== "cancelled")
        .sort((left, right) => text(right.startsAt).localeCompare(text(left.startsAt)))[0];
      setMissed(newest?.status === "no_show" ? newest : null);
      const actionValues = actionSnapshot.docs.map(
        (item): Value => ({ id: item.id, ...item.data() }),
      );
      const recommendation = currentBriefActions(actionValues, consultationValue).package;
      setProject({ id: projectSnapshot.id, ...projectSnapshot.data() });
      setConsultation(consultationValue);
      setPackages(
        packageSnapshot.docs
          // The library, plus a one-off written for this job; never another
          // couple's (features/packages/one-off.ts).
          .filter((item) => isCataloguePackage(item.data(), { projectId }))
          .map((item) => ({
            id: item.id,
            ...item.data(),
          })),
      );
      setActions(actionValues);
      // A proposal on file — created here OR in the standalone builder — means
      // the "no proposal is on file, booked outside StudioCue" copy is wrong.
      // Reflect any existing proposal (accepted first, else the latest version).
      const proposalValue =
        proposalSnapshot.docs
          .map((item): Value => ({ id: item.id, ...item.data() }))
          .sort((left, right) => Number(right.version ?? 0) - Number(left.version ?? 0));
      const onFile =
        proposalValue.find((item) => item.status === "accepted") ??
        proposalValue[0];
      setProposalStatuses(proposalValue.map((item) => text(item.status)));
      if (onFile) setProposalId((current) => current ?? onFile.id);
      setNotes(
        (current) =>
          current || text(consultationValue?.internalNotes),
      );
      setSelectedPackageId(
        (current) =>
          current ||
          text(object(recommendation?.structuredOutput).packageId),
      );
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "This booking could not be loaded."));
    } finally {
      setLoading(false);
    }
  }, [projectId, workspace.tenantId]);

  useEffect(() => {
    if (!workspace.loading && workspace.tenantId)
      void Promise.resolve().then(load);
  }, [load, workspace.loading, workspace.tenantId]);

  // Notes are typed once and easily lost to a stray navigation; keep a local
  // draft per project until the consultation is completed.
  const notesDraftKey = `studiocue:consultation-notes:${projectId}`;
  useEffect(() => {
    void Promise.resolve().then(() => {
      try {
        const saved = window.localStorage.getItem(notesDraftKey);
        if (saved) setNotes((current) => current || saved);
      } catch {
        // Storage unavailable (private mode) — drafts just don't persist.
      }
    });
  }, [notesDraftKey]);
  useEffect(() => {
    try {
      if (notes.trim()) window.localStorage.setItem(notesDraftKey, notes);
    } catch {
      // Storage unavailable — ignore.
    }
  }, [notes, notesDraftKey]);

  // The current run's actions only: after "Prepare the brief again" the
  // earlier brief is superseded and must not be shown or approved.
  const {
    summary: summaryAction,
    package: packageAction,
    proposal: proposalAction,
  } = currentBriefActions(actions, consultation);
  const summary = object(summaryAction?.structuredOutput);
  const recommendation = object(packageAction?.structuredOutput);
  const proposalDraft = object(proposalAction?.structuredOutput);
  const selectedPackage = packages.find(
    (item) => item.id === selectedPackageId,
  );
  const groundedDraft = groundedBookingDraft({
    recommendedPackageId: text(recommendation.packageId) || null,
    selectedPackageId: selectedPackageId || null,
    packages: packages.map((studioPackage) => ({
      id: studioPackage.id,
      name: text(studioPackage.name),
      active: studioPackage.active === true,
      basePriceCents: Number(studioPackage.basePriceCents ?? 0),
      currency: text(studioPackage.currency) || "USD",
      terms: text(studioPackage.terms),
    })),
    consultationSummary: text(summary.summary),
    proposalIntroduction: text(proposalDraft.notes),
  });
  /**
   * Every package going on the proposal, main first, and their terms each
   * under its own name. The draft was seeded with the main package's terms
   * alone, so a photo + video proposal said nothing about the video's.
   */
  const proposalPackages = selectedPackage
    ? [
        selectedPackage,
        ...extraPackageIds.flatMap((id) => packages.filter((item) => item.id === id)),
      ]
    : [];
  const proposalTerms = proposalTermsForPackages(proposalPackages);
  const termsDefaulted = Boolean(selectedPackage) && proposalTerms === DEFAULT_PROPOSAL_TERMS;
  const analysisQueued =
    consultation?.status === "completed" &&
    !summaryAction &&
    object(consultation.aiReview).status === "queued";
  /**
   * Derived, not listed.
   *
   * This was a hand-kept array, and it drifted twice: it omitted the
   * post-event states, and it omitted `POSTPONED` — so a wedding moved to next
   * year, with a signed contract and a paid retainer on file, was shown the
   * pre-consultation flow and told to "Schedule the consultation first".
   * See features/projects/stage-progress.ts.
   */
  // Prefer the live store's state (refreshed by booking mutations) over the
  // one-shot getDoc read, so this hero doesn't sit on a stale "awaiting
  // signature" after the job is booked on the same page.
  const liveState =
    text(projectRecords?.find((entry) => entry.id === projectId)?.state) ||
    text(project?.state);
  const laterBookingState = pastProposal(liveState);
  // What booking this kind of job asks for (job-kinds.ts): a family session
  // has no consultation and no agreement; a sports day pays nothing to book.
  const kindProfile = projectProfile(
    projectRecords?.find((entry) => entry.id === projectId) ?? project,
  );
  const kindNeeds = bookingGateNeeds(kindProfile);
  const kindWords = vocab(kindProfile.kind);
  const nextAfterAcceptance = kindNeeds.agreement
    ? kindNeeds.payment
      ? "The agreement and the retainer are"
      : "The agreement is"
    : kindNeeds.payment
      ? kindProfile.payment === "paid_in_full"
        ? "The payment is"
        : "The retainer is"
      : "The booking check is";
  // PROPOSAL is past preparing one, not past the couple's answer.
  const proposalSettled = proposalAccepted(liveState);
  const rerunBlocked = briefRerunBlocked({
    consultationStatus: text(consultation?.status),
    projectState: liveState,
    proposalStatuses,
  });
  // A booking agreement is out at PROPOSAL: the couple's answer is the
  // signature, and "record their yes in the contract step" is refused.
  const bookingAgreementOut = Boolean(
    contractRecords?.some(
      (entry) =>
        entry.projectId === projectId &&
        entry.mode === "combined" &&
        ["sent", "viewed"].includes(text(entry.status)),
    ),
  );
  /**
   * The consultation already happened, whatever this page can see of it.
   *
   * The job page offers "It already happened — mark done" for a consultation
   * handled over the phone. It advances the project to CONSULTATION and
   * creates no meeting record — there was no meeting to record. This page then
   * read the *record* and told the studio to "Schedule the consultation
   * first", for a conversation they had just said they had already had. There
   * was no notes field and no route to a proposal: the product's own escape
   * hatch led straight into a wall.
   *
   * The state is the authority. Anything from CONSULTATION onward means the
   * conversation is behind them.
   */
  const consultationBehindThem = pastConsultation(liveState);
  const clientContactId = Array.isArray(project?.clientContactIds)
    ? text((project.clientContactIds as unknown[])[0]) || null
    : null;
  const expiry = useMemo(() => futureDate(14), []);
  const retainerDueDate = useMemo(() => futureDateString(7), []);
  const balanceDue = useMemo(() => {
    const eventDate = new Date(`${text(project?.eventDate)}T12:00:00`);
    const value = Number.isFinite(eventDate.valueOf())
      ? eventDate
      : futureDate(60);
    value.setDate(value.getDate() - 30);
    return value;
  }, [project?.eventDate]);

  async function completeConsultation() {
    if (!consultation || notes.trim().length < 20) return;
    setBusy("analyze");
    setNotice(null);
    try {
      await sendBookingCommand({
        type: "completeConsultation",
        idempotencyKey: crypto.randomUUID(),
        input: {
          projectId,
          consultationId: consultation.id,
          notes: notes.trim(),
        },
      });
      setNotice(
        "Consultation saved. StudioCue is preparing a cited brief, package fit, and proposal draft.",
      );
      try {
        window.localStorage.removeItem(notesDraftKey);
      } catch {
        // Storage unavailable — ignore.
      }
      await waitForBrief(Number(consultation.briefRun ?? 1));
      await load();
    } catch (caught: unknown) {
      setNotice(commandError(caught, "The consultation could not be completed."));
    } finally {
      setBusy(null);
    }
  }

  /** Poll until the given run's package suggestion lands, or give up quietly. */
  async function waitForBrief(briefRun: number) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 1500));
      const { firestore } = getFirebaseClient();
      const snapshot = await getDocs(
        query(
          collection(firestore, "aiActions"),
          where("tenantId", "==", workspace.tenantId),
          where("projectId", "==", projectId),
        ),
      );
      const values = snapshot.docs.map(
        (item): Value => ({ id: item.id, ...item.data() }),
      );
      const prepared = currentBriefActions(values, { briefRun }).package;
      if (prepared) {
        setActions(values);
        setSelectedPackageId(text(object(prepared.structuredOutput).packageId));
        setExtraPackageIds([]);
        return;
      }
    }
  }

  /**
   * "Prepare the brief again from these notes". The server saves the notes,
   * charges one AI action, sets the open brief aside and queues a new one;
   * the page then shows "preparing" until it lands.
   */
  async function rerunBrief() {
    if (!consultation || notes.trim().length < 20) return;
    setBusy("rerun");
    setNotice(null);
    try {
      const outcome = await sendBookingCommand({
        type: "rerunBookingBrief",
        idempotencyKey: crypto.randomUUID(),
        input: {
          projectId,
          consultationId: consultation.id,
          notes: notes.trim(),
        },
      });
      if (outcome.mode === "preview") {
        setNotice("Preview mode — the brief was not prepared again.");
        return;
      }
      setRerunOpen(false);
      setNotice(
        "Notes saved. StudioCue is preparing the brief again; the earlier one is set aside, not deleted.",
      );
      try {
        window.localStorage.removeItem(notesDraftKey);
      } catch {
        // Storage unavailable — ignore.
      }
      // Reload first so the page shows "preparing" rather than the old brief.
      await load();
      await waitForBrief(Number(outcome.payload.briefRun ?? 0));
      await load();
    } catch (caught: unknown) {
      setNotice(commandError(caught, "The brief could not be prepared again."));
    } finally {
      setBusy(null);
    }
  }

  async function importTranscript(file: File) {
    const allowed = ["text/plain", "text/markdown", "text/vtt", "application/json"];
    if (!allowed.includes(file.type) && !/\.(txt|md|vtt|json)$/i.test(file.name)) {
      setNotice("Upload a TXT, Markdown, VTT, or JSON transcript export.");
      return;
    }
    if (file.size > 500_000) {
      setNotice("Transcript exports must be smaller than 500 KB.");
      return;
    }
    try {
      const value = await file.text();
      const transcript = file.name.endsWith(".json")
        ? JSON.stringify(JSON.parse(value), null, 2)
        : value;
      setNotes(transcript.slice(0, 20_000));
      setNoteSource("transcript");
      setNotice("Transcript loaded. Review it, then let StudioCue prepare the booking brief.");
    } catch {
      setNotice("This transcript export could not be read.");
    }
  }

  async function createProposal() {
    if (
      !project ||
      !selectedPackage ||
      !proposalAction ||
      !packageAction ||
      !groundedDraft.ready
    )
      return;
    setBusy("proposal");
    setNotice(null);
    try {
      const approvals = [summaryAction, packageAction, proposalAction].filter(
        (action): action is Value =>
          action !== undefined && action.status === "review_required",
      );
      // An action the server would refuse to approve — the AI picked no
      // package, or the package had no terms — is settled by the studio's own
      // choice on this page. Set it aside rather than approve it: approving
      // it was refused, and the draft never got made (GR, 2026-09-30).
      const setAside = new Set(
        approvals
          .filter((action) => blockingIssues(action, { withEdit: true }).length > 0)
          .map((action) => action.id),
      );
      for (const action of approvals) {
        if (setAside.has(action.id)) {
          await runAiQueueCommand({
            type: "decideAiAction",
            input: { actionId: action.id, decision: "dismissed" },
          });
          continue;
        }
        await runAiQueueCommand({
          type: "decideAiAction",
          input: {
            actionId: action.id,
            decision: "approved",
            editDelta:
              action.capability === "package_recommendation"
                ? {
                    ...object(action.structuredOutput),
                    packageId: selectedPackage.id,
                    packageName: selectedPackage.name,
                  }
                : object(action.structuredOutput),
          },
        });
      }
      let packageSnapshotId = text(project.packageSnapshotId);
      if (!packageSnapshotId) {
        const selection = await runCrmCommand("selectPackage", {
          projectId,
          packageId: selectedPackage.id,
          selectedAddOns: [],
          discount: { type: "none" },
        });
        packageSnapshotId = text(selection.result.packageSnapshotId);
      }
      // The rest go alongside it, as the proposal's Packages panel adds them.
      for (const packageId of extraPackageIds) {
        try {
          await runCrmCommand("selectPackage", {
            projectId,
            packageId,
            selectedAddOns: [],
            mode: "add",
            discount: { type: "none" },
          });
        } catch (caught: unknown) {
          if (!(caught instanceof Error && caught.message.includes("PACKAGE_ALREADY_ON_JOB"))) throw caught;
        }
      }
      let projectVersion = Number(project.stateVersion ?? 0);
      if (project.state === "CONSULTATION") {
        const transition = await runCrmCommand("transitionProject", {
          projectId,
          expectedVersion: projectVersion,
          targetState: "PROPOSAL",
        });
        projectVersion = Number(
          transition.result.stateVersion ?? projectVersion + 1,
        );
      }
      const created = await runProposalCommand("create_draft", {
        projectId,
        expiresAt: expiry.toISOString(),
        notes:
          text(proposalDraft.notes) ||
          "Thank you for sharing what matters most for your celebration.",
        termsSummary: proposalTerms,
        retainerDueDate: retainerDueDate,
        balanceDueDate: balanceDue.toISOString().slice(0, 10),
      });
      const createdProposalId = text(created.result.proposalId);
      setProposalId(createdProposalId);
      // Only an approved action records what it led to.
      const approvedOnly = (actionId: string) =>
        !setAside.has(actionId) &&
        (approvals.some((action) => action.id === actionId) ||
          text(actions.find((action) => action.id === actionId)?.status) === "approved");
      await Promise.all([
        approvedOnly(packageAction.id) &&
        runAiQueueCommand({
          type: "recordAiExecution",
          input: {
            actionId: packageAction.id,
            commandId: packageSnapshotId,
            summary:
              "Created an immutable snapshot of the studio-approved package. Pricing still comes from the package record.",
          },
        }),
        approvedOnly(proposalAction.id) &&
        runAiQueueCommand({
          type: "recordAiExecution",
          input: {
            actionId: proposalAction.id,
            commandId: createdProposalId,
            summary:
              "Created an unsent proposal draft from the approved package snapshot and consultation brief.",
          },
        }),
      ]);
      setProject((current) =>
        current
          ? {
              ...current,
              state: "PROPOSAL",
              stateVersion: projectVersion,
            }
          : current,
      );
      setNotice(
        "Proposal draft created from the approved package snapshot. Nothing has been sent.",
      );
    } catch (caught: unknown) {
      setNotice(commandError(caught, "The proposal draft could not be created."));
    } finally {
      setBusy(null);
    }
  }

  // The workspace must resolve before this panel can fetch anything. If it
  // errors or stalls, say so instead of spinning forever.
  if (gate.status === "error") {
    return (
      <PanelError
        detail={gate.message}
        onRetry={gate.retry}
        title="Booking context could not be loaded"
      />
    );
  }
  if (gate.status === "loading" || loading) {
    return <PanelLoading label="Loading inquiry-to-booked context…" />;
  }

  return (
    <div className="booking-autopilot">
      {/* This hero used to explain turning an inquiry into a proposal on
          every job, including weddings signed and paid eight months ago. A
          screen that reads identically on day one and day three hundred is
          not telling anyone where their job is. Past consultation, it states
          the stage instead of pitching the flow. */}
      {laterBookingState ? (
        <header className="booking-autopilot-hero is-settled">
          <div>
            <p className="eyebrow">
              <Check size={14} /> {projectStateLabel(liveState)}
            </p>
            {/* "Chen Wedding is past the proposal" was shown at Proposal out,
                on a job whose couple had not answered — above a contract step
                that could not start until they did. */}
            {proposalSettled ? (
              <>
                <h1>The proposal is accepted.</h1>
                {/* Promised "the balance" below, and no balance section
                    followed — it lives on Invoices (UI audit, 2026-10-02). */}
                <p>
                  {`${nextAfterAcceptance} below.`}
                  {kindProfile.payment === "deposit_and_balance" ? (
                    <>
                      {" "}The final balance is on{" "}
                      <Link href={`/studio/invoices?project=${projectId}`}>Invoices</Link>.
                    </>
                  ) : kindProfile.payment === "on_the_day" ? (
                    " The bill is paid on the day."
                  ) : kindProfile.payment === "invoice_after" ? (
                    " The bill goes out after the event."
                  ) : null}
                </p>
              </>
            ) : bookingAgreementOut ? (
              <>
                <h1>The booking agreement is with the client.</h1>
                <p>
                  Signing it accepts the proposal, and the retainer follows.
                  To change anything, withdraw it in the contract step below.
                </p>
              </>
            ) : (
              <>
                <h1>The proposal is with the client.</h1>
                <p>
                  {kindNeeds.agreement
                    ? "Once they accept it, the agreement and the retainer are the next steps. Already have their yes by email or on a call? Record it in the contract step below."
                    : kindNeeds.payment
                      ? "Once they accept it, the invoice goes to them, and paying it books the job. Already have their yes by email or on a call? Record it on the proposal."
                      : "Once they accept it, the job books itself. Already have their yes by email or on a call? Record it on the proposal."}
                </p>
              </>
            )}
          </div>
        </header>
      ) : (
        <header className="booking-autopilot-hero">
          <div>
            {kindProfile.consultation ? (
              <>
                <p className="eyebrow"><Sparkles size={14} /> From the consultation</p>
                <h1>From conversation<br />to a reviewable proposal.</h1>
                <p>
                  Capture what the client said once. StudioCue grounds a brief,
                  recommends an existing package, and prepares a proposal without
                  inventing pricing or sending anything.
                </p>
              </>
            ) : (
              <>
                <p className="eyebrow"><Sparkles size={14} /> From the inquiry</p>
                <h1>From inquiry<br />to a priced proposal.</h1>
                <p>
                  {`A ${kindWords.event} needs no consultation call. Choose a package and send the price — nothing goes out until you approve it.`}
                </p>
              </>
            )}
          </div>
          <aside>
            <span className={consultation || !kindProfile.consultation ? "is-complete" : ""}><Check /> Inquiry</span>
            {kindProfile.consultation ? (
              <span className={consultation?.status === "completed" ? "is-complete" : ""}><MessageSquareText /> Consultation</span>
            ) : null}
            <span className={packageAction ? "is-complete" : ""}><PackageCheck /> Package fit</span>
            <span className={proposalId ? "is-complete" : ""}><FileText /> Proposal</span>
          </aside>
        </header>
      )}

      {consultation && !laterBookingState ? (
        // They didn't show, or it was marked held by mistake. Renders nothing
        // when neither applies.
        <ConsultationCorrections
          consultation={consultation}
          contactId={clientContactId}
          onChanged={() => void load()}
          projectId={projectId}
          projectState={liveState}
        />
      ) : null}

      {laterBookingState ? (
        /**
         * Past the proposal, so no consultation guidance at all.
         *
         * The hero directly above says "Nothing here needs the consultation
         * flow any more", and the branches below then ran it: a wedding already
         * shot, with no proposal record, was told "No consultation was recorded
         * — that's fine. Prepare the proposal directly." A job past this stage
         * needs to know what StudioCue holds, not to be sold the flow again.
         */
        proposalId ? (
          // The way to the accepted proposal. Before acceptance the contract
          // step below carries the link, with what it is waiting on.
          proposalSettled ? (
          <section className="booking-autopilot-empty is-quiet">
            <Check />
            <span>
              <strong>The proposal they accepted is on file.</strong>
            </span>
            {/* A button, not grey text that read as disabled. */}
            <Link className="button button-light button-sm" href={`/studio/proposals/${proposalId}`}>
              Open proposal <ArrowRight />
            </Link>
          </section>
          ) : null
        ) : canCreateProposalForProject(liveState, { ...(project ?? {}), state: liveState }) ? (
          <section className="booking-autopilot-empty">
            <Check />
            <span>
              <strong>No proposal is on file for this job.</strong>
              <small>
                Prepare one when you are ready — the agreement and payments
                below follow from it.
              </small>
            </span>
            <Link href={`/studio/proposals/new?project=${projectId}`}>
              Prepare the proposal <ArrowRight />
            </Link>
          </section>
        ) : (
          /**
           * A job booked outside StudioCue.
           *
           * The words here were already right, but the shape was not: a
           * white card with a heading opening "No proposal is on file"
           * reads as a fault, and the reference studio screenshotted it as
           * one. Nothing is missing — he has the wedding, the agreement and
           * the money — so it is stated as the fact it is, quietly, in the
           * same flat treatment as the accepted-proposal note above rather
           * than as a card demanding something.
           *
           * `laterBookingState` is true from PROPOSAL onward, so the branch
           * above covers a job whose proposal is still the studio's move;
           * the command refuses anything past PROPOSAL, which is why this
           * one offers no link at all.
           */
          <section className="booking-autopilot-empty is-quiet">
            <Check />
            <span>
              <strong>Booked outside StudioCue — no proposal needed.</strong>
              <small>
                A proposal is an offer, and this job is past that. The
                agreement and payments below are what StudioCue holds for it.
              </small>
            </span>
          </section>
        )
      ) : !consultation && missed ? (
        <section className="booking-autopilot-empty">
          <CircleAlert />
          <span>
            <strong>They missed the consultation.</strong>
            <small>The job stays where it is. Invite them to pick another time, or reopen it if they did come.</small>
          </span>
          <ConsultationCorrections
            consultation={missed}
            contactId={clientContactId}
            onChanged={() => void load()}
            projectId={projectId}
            projectState={liveState}
          />
        </section>
      ) : !consultation && consultationBehindThem && !proposalId ? (
        // The stage moved past consultation without a meeting record (handled
        // over the phone, stage advanced by hand). Don't demand a
        // consultation that will never exist — point at the proposal flow
        // instead. Once a proposal exists this is stale advice, so it steps
        // aside for the `laterBookingState` branch below.
        <section className="booking-autopilot-empty">
          <Check />
          <span>
            <strong>No consultation was recorded — that&rsquo;s fine.</strong>
            <small>
              You marked it as handled elsewhere. Prepare the proposal
              directly; it will lock a package if one isn&rsquo;t chosen yet.
            </small>
          </span>
          <Link href={`/studio/proposals/new?project=${projectId}`}>
            Prepare the proposal <ArrowRight />
          </Link>
        </section>
      ) : !consultation && !kindProfile.consultation && !proposalId ? (
        // A kind with no consultation (job-kinds.ts) prices straight from
        // the inquiry; it used to be told to schedule a call it never has.
        <section className="booking-autopilot-empty">
          <Check />
          <span>
            <strong>{`No consultation for a ${kindWords.event}.`}</strong>
            <small>
              Prepare the proposal straight away; it will lock a package if
              one isn&rsquo;t chosen yet.
            </small>
          </span>
          <Link href={`/studio/proposals/new?project=${projectId}`}>
            Prepare the proposal <ArrowRight />
          </Link>
        </section>
      ) : !consultation ? (
        <section className="booking-autopilot-empty">
          <CircleAlert />
          <span>
            <strong>Schedule the consultation first.</strong>
            <small>The client can choose an available time from a secure link.</small>
          </span>
          <Link href={`/studio/projects/${projectId}`}>Open project <ArrowRight /></Link>
        </section>
      ) : consultation.status !== "completed" && !laterBookingState ? (
        /**
         * Only while the job is still in the consultation phase.
         *
         * A consultation scheduled and never marked complete is the normal
         * case for a job booked over the phone afterwards — the record stays
         * `scheduled` forever. Without the state guard this rendered the full
         * "Capture consultation notes" form directly beneath a hero saying
         * "Nothing here needs the consultation flow any more", so a booked
         * wedding opened on a form asking for notes on a meeting that had
         * already served its purpose.
         */
        <section className="booking-consultation-capture">
          <div>
            <p className="eyebrow">What they told you</p>
            <h2>Capture consultation notes</h2>
            <p>
              Paste notes or import the transcript you already have. StudioCue
              extracts only stated priorities, locations, coverage expectations,
              decision makers, and unanswered questions.
            </p>
          </div>
          <div className="booking-note-source-tabs" role="tablist" aria-label="Consultation source">
            <button className={noteSource === "notes" ? "is-active" : ""} onClick={() => setNoteSource("notes")} role="tab" type="button">Paste notes</button>
            <button className={noteSource === "transcript" ? "is-active" : ""} onClick={() => setNoteSource("transcript")} role="tab" type="button">Import transcript</button>
          </div>
          {noteSource === "transcript" ? (
            <label className="booking-transcript-upload">
              <FileUp size={18} />
              <span>
                <strong>Upload the consultation transcript</strong>
                <small>TXT, Markdown, VTT, or JSON · up to 500 KB</small>
              </span>
              <input
                accept=".txt,.md,.vtt,.json,text/plain,text/markdown,text/vtt,application/json"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void importTranscript(file);
                  event.target.value = "";
                }}
                type="file"
              />
            </label>
          ) : null}
          <label>
            <span>{noteSource === "transcript" ? "Transcript text" : "Consultation notes"}</span>
            <textarea
              onChange={(event) => setNotes(event.target.value)}
              placeholder={noteSource === "transcript" ? "Upload a transcript above or paste it here…" : "They care most about candid moments, want preparation at two locations, expect about 120 guests…"}
              value={notes}
            />
            <small>{notes.trim().length}/20 minimum characters</small>
          </label>
          <button
            disabled={Boolean(busy) || notes.trim().length < 20}
            onClick={() => void completeConsultation()}
            type="button"
          >
            {busy === "analyze" ? <LoaderCircle className="spin" /> : <BrainCircuit />}
            Complete & prepare booking brief
          </button>
        </section>
      ) : analysisQueued || (!summaryAction && (busy === "analyze" || busy === "rerun")) ? (
        <section className="booking-autopilot-loading">
          <LoaderCircle className="spin" />
          <span>
            <strong>Grounding the booking brief…</strong>
            <small>Comparing the notes only with active packages and approved terms.</small>
          </span>
        </section>
      ) : summaryAction && packageAction && proposalAction ? (
        <>
          <section className="booking-ai-brief">
            <div>
              <p className="eyebrow">Drafted for you to check</p>
              <h2>Consultation brief</h2>
              <p>{text(summary.summary)}</p>
              <div>
                {list(summary.priorities).map((priority) => (
                  <span key={String(priority)}><Check /> {String(priority)}</span>
                ))}
              </div>
            </div>
            <aside>
              <small>Source</small>
              <strong>Consultation notes + project facts</strong>
              <span><ShieldCheck /> No inferred price, availability, or agreement</span>
              <Link href={`/studio/projects/${projectId}`}>See what Cue based this on <ArrowRight /></Link>
              {/* The brief was made once, from the notes as they were; a
                  follow-up call that changed the picture had no way back in. */}
              {!rerunBlocked ? (
                <button
                  aria-expanded={rerunOpen}
                  disabled={Boolean(busy)}
                  onClick={() => setRerunOpen((open) => !open)}
                  type="button"
                >
                  <BrainCircuit /> {rerunOpen ? "Keep this brief" : "Notes changed? Prepare it again"}
                </button>
              ) : null}
            </aside>
          </section>

          {rerunOpen && !rerunBlocked ? (
            <section className="booking-consultation-capture">
              <div>
                <p className="eyebrow">What they told you</p>
                <h2>Prepare the brief again</h2>
                <p>
                  Add what you learned since. StudioCue prepares a new brief,
                  package suggestion and proposal draft from these notes — one
                  AI action. The ones below are set aside, not deleted.
                </p>
              </div>
              <label>
                <span>Consultation notes</span>
                <textarea onChange={(event) => setNotes(event.target.value)} value={notes} />
                <small>{notes.trim().length}/20 minimum characters</small>
              </label>
              <button
                disabled={Boolean(busy) || notes.trim().length < 20}
                onClick={() => void rerunBrief()}
                type="button"
              >
                {busy === "rerun" ? <LoaderCircle className="spin" /> : <BrainCircuit />}
                Prepare the brief again from these notes
              </button>
            </section>
          ) : null}

          <section className="booking-package-review">
            <header>
              <div>
                <p className="eyebrow">A suggestion — your call</p>
                <h2>Choose the package that actually fits</h2>
              </div>
              {/* A confidence is in a package. With none suggested it was the
                  AI's certainty that nothing fits, shown as "100% confidence"
                  beside "Choose the package that actually fits" (UAT T14). */}
              {text(recommendation.packageId) ? (
                <StatusBadge tone={Number(object(packageAction.confidence).overall) >= .8 ? "success" : "warning"}>
                  {Math.round(Number(object(packageAction.confidence).overall ?? 0) * 100)}% confidence
                </StatusBadge>
              ) : (
                <StatusBadge tone="warning">No package suggested</StatusBadge>
              )}
            </header>
            <div className="booking-package-options">
              {packages.map((studioPackage) => {
                const main = selectedPackageId === studioPackage.id;
                const extra = extraPackageIds.includes(studioPackage.id);
                return (
                <button
                  aria-pressed={main || extra}
                  className={main || extra ? "is-selected" : ""}
                  key={studioPackage.id}
                  onClick={() => {
                    // Tap to add or remove; the first chosen is the main package.
                    if (main) {
                      const [next, ...rest] = extraPackageIds;
                      setSelectedPackageId(next ?? "");
                      setExtraPackageIds(rest);
                    } else if (extra) setExtraPackageIds(extraPackageIds.filter((id) => id !== studioPackage.id));
                    else if (!selectedPackageId) setSelectedPackageId(studioPackage.id);
                    else if (extraPackageIds.length < 3) setExtraPackageIds([...extraPackageIds, studioPackage.id]);
                  }}
                  type="button"
                >
                  <span>{main || extra ? <Check /> : null}</span>
                  <span>
                    <small>
                      {main && extraPackageIds.length
                        ? "Main package"
                        : extra
                          ? "Added alongside"
                          : studioPackage.id === recommendation.packageId
                            ? "StudioCue recommendation"
                            : "Active package"}
                    </small>
                    <strong>{text(studioPackage.name)}</strong>
                    <em>{money(studioPackage.basePriceCents, studioPackage.currency)} · {Math.round(Number(studioPackage.includedCoverageMinutes ?? 0) / 60)} hours · {describeCoverage(resolveCoverage(studioPackage))}</em>
                  </span>
                </button>
                );
              })}
            </div>
            <p className="booking-package-hint">
              {extraPackageIds.length
                ? `${1 + extraPackageIds.length} packages on one proposal, one total. Tap a package to take it off.`
                : "Tap more than one to offer them together — photo and video, say."}
            </p>
            <div className="booking-package-rationale">
              <strong>Why this fit was suggested</strong>
              <p>{text(recommendation.rationale)}</p>
              {list(recommendation.fitGaps).length ? (
                <span><CircleAlert /> {list(recommendation.fitGaps).map(String).join(" · ")}</span>
              ) : null}
            </div>
          </section>

          <section className="booking-proposal-release">
            <div>
              <p className="eyebrow">Nothing is sent yet</p>
              <h2>Create the proposal draft</h2>
              <p>
                This approves the reviewed AI work, snapshots the selected
                package and price, advances the project to Proposal, and creates
                an unsent draft. Sending remains a separate approval.
              </p>
            </div>
            <button
              disabled={
                Boolean(busy) || !selectedPackage || !groundedDraft.ready
              }
              onClick={() => void createProposal()}
              type="button"
            >
              {busy === "proposal" ? <LoaderCircle className="spin" /> : <FileText />}
              Approve inputs & create draft
            </button>
            {termsDefaulted ? (
              <p className="booking-package-hint">
                {`${proposalPackages.length > 1 ? "These packages have" : "This package has"} no terms written, so the draft uses standard wording. Change it on the draft before you send.`}
              </p>
            ) : null}
            {proposalId ? (
              <Link href={`/studio/proposals/${proposalId}`}>
                Open proposal draft <ArrowRight />
              </Link>
            ) : null}
          </section>
        </>
      ) : (
        <section className="booking-autopilot-empty">
          <CircleAlert />
          <span>
            <strong>AI preparation needs attention.</strong>
            <small>Open the job to see the failed or blocked action.</small>
          </span>
          <Link href={`/studio/projects/${projectId}`}>Open the job <ArrowRight /></Link>
        </section>
      )}
      {notice ? <p className="booking-autopilot-notice" role="status">{notice}</p> : null}
    </div>
  );
}
