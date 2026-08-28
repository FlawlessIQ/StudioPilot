"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  Circle,
  CircleSlash,
  LoaderCircle,
  Sparkles,
  UserRound,
} from "lucide-react";
import { useWorkspace } from "@/features/auth/workspace-context";
import type {
  JourneyAction,
  JourneyStep,
} from "@/features/journey/steps";
import { runCrmCommand } from "@/lib/crm/command-client";
import { requestMessageDraft } from "@/lib/ai/message-draft-client";
import { friendlyError } from "@/lib/ai/friendly-error";

/**
 * The Journey — the project page as the photographer's own mental model.
 *
 * One vertical thread from inquiry to review, computed once by
 * useProjectJourney and shared with the next-move card. Every step is a
 * door: complete steps open their record, the current step carries the
 * action inline, waiting steps say who they're waiting on, and upcoming
 * steps say what unlocks them.
 */
export function ProjectJourney({
  projectId,
  steps,
  current,
  stateVersion,
  onTransition,
}: {
  projectId: string;
  steps: JourneyStep[];
  current: JourneyStep | null;
  stateVersion: number;
  onTransition: (state: string, version: number) => void;
}) {
  const complete = steps.filter((step) => step.status === "complete").length;
  // A step the event overtook is neither done nor to-do. Counting it only in
  // the denominator made a wedding that had already happened read "8/14".
  const missed = steps.filter((step) => step.status === "passed").length;

  return (
    <section className="panel project-journey" aria-label="Project journey">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">The journey</p>
          <h2>{current ? current.title : "Everything is handled"}</h2>
          <p>
            {current
              ? "Your one next step — everything else is done, waiting, or not due yet."
              : "No studio action needed right now."}
          </p>
        </div>
        <span className="project-journey-progress">
          {complete}/{steps.length}
          {missed ? <em>{missed} missed</em> : null}
        </span>
      </div>
      <ol className="project-journey-steps">
        {steps.map((step) => (
          <JourneyStepRow
            key={step.key}
            onTransition={onTransition}
            projectId={projectId}
            stateVersion={stateVersion}
            step={step}
          />
        ))}
      </ol>
    </section>
  );
}

const OWNER_LABEL = {
  studio: "You",
  client: "Client",
  provider: "In motion",
} as const;

function JourneyStepRow({
  projectId,
  step,
  stateVersion,
  onTransition,
}: {
  projectId: string;
  step: JourneyStep;
  stateVersion: number;
  onTransition: (state: string, version: number) => void;
}) {
  // The current step's primary action usually points where the record link
  // would; don't render the same door twice.
  const showRecord =
    step.record !== null &&
    !(
      step.status === "current" &&
      step.action?.kind === "link" &&
      step.action.href === step.record.href
    ) &&
    step.status !== "upcoming";

  return (
    <li className={`journey-step is-${step.status}`}>
      <span className="journey-step-marker" aria-hidden="true">
        {step.status === "complete" ? (
          <CheckCircle2 size={17} />
        ) : step.status === "waiting_client" ? (
          <UserRound size={15} />
        ) : step.status === "passed" ? (
          // Not a tick and not an open circle: the moment went by.
          <CircleSlash size={15} />
        ) : (
          <Circle size={15} />
        )}
      </span>
      <span className="journey-step-copy">
        <span className="journey-step-title-line">
          <strong>{step.title}</strong>
          {step.owner && step.status !== "current" ? (
            <em className={`journey-step-owner is-${step.owner}`}>
              {OWNER_LABEL[step.owner]}
            </em>
          ) : null}
        </span>
        <small>
          {step.status === "waiting_client"
            ? `Waiting on the client · ${step.detail}`
            : step.status === "waiting_other"
              ? `In motion · ${step.detail}`
              : step.status === "passed"
                ? "Not done before the day"
                : step.status === "upcoming"
                  ? (step.unlock ?? step.detail)
                  : step.detail}
        </small>
        {showRecord && step.record ? (
          <Link className="journey-step-record" href={step.record.href}>
            {step.record.label} <ArrowUpRight size={12} />
          </Link>
        ) : null}
      </span>
      {step.status === "current" ? (
        <span className="journey-step-actions">
          {step.action ? (
            <JourneyActionButton action={step.action} projectId={projectId} />
          ) : null}
          {step.advance ? (
            <JourneyAdvanceButton
              advance={step.advance}
              onTransition={onTransition}
              projectId={projectId}
              stateVersion={stateVersion}
            />
          ) : null}
        </span>
      ) : null}
    </li>
  );
}

/**
 * "It already happened" — the manual state transition, offered on the step
 * itself for work done outside StudioCue. Server-authorized; evidence-
 * controlled steps never render this.
 */
function JourneyAdvanceButton({
  advance,
  projectId,
  stateVersion,
  onTransition,
}: {
  advance: NonNullable<JourneyStep["advance"]>;
  projectId: string;
  stateVersion: number;
  onTransition: (state: string, version: number) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setNotice(null);
    try {
      const response = await runCrmCommand("transitionProject", {
        projectId,
        expectedVersion: stateVersion,
        targetState: advance.targetState,
      });
      if (response.persisted) {
        onTransition(
          advance.targetState,
          Number(response.result.stateVersion ?? stateVersion + 1),
        );
        setNotice("Marked done and recorded in the audit log.");
      } else {
        setNotice("Preview: this step would be marked done.");
      }
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "This step could not be marked done."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="journey-step-advance">
      <button disabled={busy} onClick={() => void submit()} type="button">
        {busy ? <LoaderCircle className="spin" size={13} /> : null}
        {advance.label}
      </button>
      {notice ? <small role="status">{notice}</small> : null}
    </span>
  );
}

function JourneyActionButton({
  action,
  projectId,
}: {
  action: JourneyAction;
  projectId: string;
}) {
  const workspace = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  if (action.kind === "link") {
    return (
      <Link className="journey-step-action" href={action.href}>
        {action.label} <ArrowRight size={14} />
      </Link>
    );
  }

  async function draft() {
    if (action.kind !== "draft" || !workspace.tenantId) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await requestMessageDraft({
        tenantId: workspace.tenantId,
        trigger: action.trigger,
        projectId,
      });
      setDone(true);
      setNotice(
        result.mode === "preview"
          ? "Preview: the draft would wait in AI review."
          : "Drafted — approve it in AI review.",
      );
    } catch (caught: unknown) {
      setNotice(
        friendlyError(caught, "We couldn't prepare this draft. Try again."),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="journey-step-draft">
      {done ? (
        <Link className="journey-step-action" href="/studio/ai-queue">
          Open AI review <ArrowRight size={14} />
        </Link>
      ) : (
        <button
          className="journey-step-action"
          disabled={busy}
          onClick={() => void draft()}
          type="button"
        >
          {busy ? <LoaderCircle className="spin" size={14} /> : <Sparkles size={14} />}
          {action.label}
        </button>
      )}
      {notice ? <small role="status">{notice}</small> : null}
    </span>
  );
}
