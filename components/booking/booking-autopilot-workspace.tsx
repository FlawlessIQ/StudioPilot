"use client";

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
import { groundedBookingDraft } from "@/features/booking/autopilot";
import { runAiQueueCommand } from "@/lib/ai-actions/command-client";
import { sendBookingCommand } from "@/lib/booking/command-client";
import { runCrmCommand } from "@/lib/crm/command-client";
import { getFirebaseClient } from "@/lib/firebase/client";
import { runProposalCommand } from "@/lib/proposals/command-client";
import { friendlyError } from "@/lib/ai/friendly-error";
import {
  PanelError,
  PanelLoading,
  useWorkspaceGate,
} from "@/components/ui/panel-state";

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
  const [packages, setPackages] = useState<Value[]>([]);
  const [actions, setActions] = useState<Value[]>([]);
  const [notes, setNotes] = useState("");
  const [selectedPackageId, setSelectedPackageId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [proposalId, setProposalId] = useState<string | null>(null);
  const [noteSource, setNoteSource] = useState<"notes" | "transcript">("notes");

  const load = useCallback(async () => {
    if (!workspace.tenantId) return;
    setLoading(true);
    try {
      // Inside the try: getFirebaseClient() throws on an incomplete client
      // config, and outside it that escaped as an unhandled rejection, so the
      // finally never ran and this panel spun forever.
      const { firestore } = getFirebaseClient();
      const [projectSnapshot, consultationSnapshot, packageSnapshot, actionSnapshot] =
        await Promise.all([
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
        ]);
      if (
        !projectSnapshot.exists() ||
        projectSnapshot.get("tenantId") !== workspace.tenantId
      )
        throw new Error("Project not found in this workspace.");
      const consultationValue =
        consultationSnapshot.docs
          .map((item): Value => ({ id: item.id, ...item.data() }))
          .sort((left, right) =>
            text(right.startsAt).localeCompare(text(left.startsAt)),
          )[0] ?? null;
      const actionValues = actionSnapshot.docs.map(
        (item): Value => ({ id: item.id, ...item.data() }),
      );
      const recommendation = actionValues.find(
        (action) => action.capability === "package_recommendation",
      );
      setProject({ id: projectSnapshot.id, ...projectSnapshot.data() });
      setConsultation(consultationValue);
      setPackages(
        packageSnapshot.docs.map((item) => ({
          id: item.id,
          ...item.data(),
        })),
      );
      setActions(actionValues);
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
      setNotice(friendlyError(caught, "Booking autopilot could not be loaded."));
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

  const summaryAction = actions.find(
    (action) => action.capability === "consultation_summary",
  );
  const packageAction = actions.find(
    (action) => action.capability === "package_recommendation",
  );
  const proposalAction = actions.find(
    (action) => action.capability === "proposal_draft",
  );
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
  const analysisQueued =
    consultation?.status === "completed" &&
    !summaryAction &&
    object(consultation.aiReview).status === "queued";
  const laterBookingState = [
    "PROPOSAL",
    "CONTRACT_PENDING",
    "RETAINER_PENDING",
    "BOOKED",
    "PLANNING",
    "READY",
  ].includes(text(project?.state));
  const expiry = useMemo(() => futureDate(14), []);
  const retainerDue = useMemo(() => futureDate(7), []);
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
        if (
          values.some(
            (action) => action.capability === "package_recommendation",
          )
        ) {
          setActions(values);
          const prepared = values.find(
            (action) => action.capability === "package_recommendation",
          );
          setSelectedPackageId(
            text(object(prepared?.structuredOutput).packageId),
          );
          break;
        }
      }
      await load();
    } catch (caught: unknown) {
      setNotice(commandError(caught, "The consultation could not be completed."));
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
      for (const action of approvals) {
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
        termsSummary:
          groundedDraft.proposal?.termsSummary ??
          text(selectedPackage.terms),
        retainerDueDate: retainerDue.toISOString().slice(0, 10),
        balanceDueDate: balanceDue.toISOString().slice(0, 10),
      });
      const createdProposalId = text(created.result.proposalId);
      setProposalId(createdProposalId);
      await Promise.all([
        runAiQueueCommand({
          type: "recordAiExecution",
          input: {
            actionId: packageAction.id,
            commandId: packageSnapshotId,
            summary:
              "Created an immutable snapshot of the studio-approved package. Pricing still comes from the package record.",
          },
        }),
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
      <header className="booking-autopilot-hero">
        <div>
          <p className="eyebrow"><Sparkles size={14} /> Booking autopilot</p>
          <h1>From conversation<br />to a reviewable proposal.</h1>
          <p>
            Capture what the couple said once. StudioCue grounds a brief,
            recommends an existing package, and prepares a proposal without
            inventing pricing or sending anything.
          </p>
        </div>
        <aside>
          <span className={consultation ? "is-complete" : ""}><Check /> Inquiry</span>
          <span className={consultation?.status === "completed" ? "is-complete" : ""}><MessageSquareText /> Consultation</span>
          <span className={packageAction ? "is-complete" : ""}><PackageCheck /> Package fit</span>
          <span className={proposalId || laterBookingState ? "is-complete" : ""}><FileText /> Proposal</span>
        </aside>
      </header>

      {!consultation ? (
        <section className="booking-autopilot-empty">
          <CircleAlert />
          <span>
            <strong>Schedule the consultation first.</strong>
            <small>The client can choose an available time from a secure link.</small>
          </span>
          <Link href={`/studio/projects/${projectId}`}>Open project <ArrowRight /></Link>
        </section>
      ) : consultation.status !== "completed" ? (
        <section className="booking-consultation-capture">
          <div>
            <p className="eyebrow">One source of truth</p>
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
      ) : analysisQueued || (!summaryAction && busy === "analyze") ? (
        <section className="booking-autopilot-loading">
          <LoaderCircle className="spin" />
          <span>
            <strong>Grounding the booking brief…</strong>
            <small>Comparing the notes only with active packages and approved terms.</small>
          </span>
        </section>
      ) : laterBookingState ? (
        // The project has moved past consultation — never re-offer the
        // "create draft" release point for work that is already approved.
        <section className="booking-autopilot-empty">
          <Check />
          <span>
            <strong>The consultation stage is complete.</strong>
            <small>Continue with proposal, contract, retainer, and booking evidence.</small>
          </span>
          {proposalId ? (
            <Link href={`/studio/proposals/${proposalId}`}>
              Open proposal draft <ArrowRight />
            </Link>
          ) : (
            <Link href={`/studio/projects/${projectId}`}>Open project <ArrowRight /></Link>
          )}
        </section>
      ) : summaryAction && packageAction && proposalAction ? (
        <>
          <section className="booking-ai-brief">
            <div>
              <p className="eyebrow">AI-prepared · human-reviewed</p>
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
              <Link href="/studio/ai-queue">Inspect full AI evidence <ArrowRight /></Link>
            </aside>
          </section>

          <section className="booking-package-review">
            <header>
              <div>
                <p className="eyebrow">Recommendation—not a decision</p>
                <h2>Choose the package that actually fits</h2>
              </div>
              <StatusBadge tone={Number(object(packageAction.confidence).overall) >= .8 ? "success" : "warning"}>
                {Math.round(Number(object(packageAction.confidence).overall ?? 0) * 100)}% confidence
              </StatusBadge>
            </header>
            <div className="booking-package-options">
              {packages.map((studioPackage) => (
                <button
                  className={selectedPackageId === studioPackage.id ? "is-selected" : ""}
                  key={studioPackage.id}
                  onClick={() => setSelectedPackageId(studioPackage.id)}
                  type="button"
                >
                  <span>{selectedPackageId === studioPackage.id ? <Check /> : null}</span>
                  <span>
                    <small>{studioPackage.id === recommendation.packageId ? "StudioCue recommendation" : "Active package"}</small>
                    <strong>{text(studioPackage.name)}</strong>
                    <em>{money(studioPackage.basePriceCents, studioPackage.currency)} · {Math.round(Number(studioPackage.includedCoverageMinutes ?? 0) / 60)} hours</em>
                  </span>
                </button>
              ))}
            </div>
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
              <p className="eyebrow">Safe release point</p>
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
            <small>Open the review queue to inspect the failed or blocked action.</small>
          </span>
          <Link href="/studio/ai-queue">Open AI review <ArrowRight /></Link>
        </section>
      )}
      {notice ? <p className="booking-autopilot-notice" role="status">{notice}</p> : null}
    </div>
  );
}
