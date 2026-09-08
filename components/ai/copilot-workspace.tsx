"use client";

import { Fragment, FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  BookOpenCheck,
  Check,
  CircleAlert,
  FileText,
  FolderKanban,
  FolderPlus,
  Mail,
  LoaderCircle,
  Send,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useWorkspace } from "@/features/auth/workspace-context";
import { AiQueueCard } from "@/components/ai/ai-approval-queue";
import {
  refreshTenantRecords,
  useTenantDocuments,
} from "@/components/live/tenant-records";
import {
  askCopilot,
  type CopilotResult,
  type CopilotJobObject,
} from "@/lib/ai/copilot-client";
import {
  requestMessageDraft,
  type MessageDraftTrigger,
} from "@/lib/ai/message-draft-client";
import { friendlyError } from "@/lib/ai/friendly-error";

const prompts = [
  "What needs my attention today?",
  "Which projects are not ready?",
  "Which contracts are unsigned?",
  "Which clients have unpaid balances?",
  "Which subcontractors have not accepted?",
  "Which upcoming projects have travel conflicts?",
];

type ChatTurn =
  | { role: "user"; text: string }
  | { role: "assistant"; result: CopilotResult };

export function CopilotWorkspace() {
  const workspace = useWorkspace();
  const [question, setQuestion] = useState("");
  const [projectOnly, setProjectOnly] = useState(false);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const started = turns.length > 0;

  async function runAsk(raw: string) {
    if (!workspace.tenantId) {
      setError("No active studio is available.");
      return;
    }
    const asked = raw.trim();
    if (asked.length < 3 || busy) return;
    // The conversation so far, oldest first, so a follow-up is understood in
    // context. Assistant turns contribute their concise answer (facts and
    // citations are re-derived server-side each turn, not replayed).
    const history = turns.map((turn) =>
      turn.role === "user"
        ? { role: "user" as const, text: turn.text }
        : { role: "assistant" as const, text: turn.result.answer },
    );
    setTurns((prior) => [...prior, { role: "user", text: asked }]);
    setQuestion("");
    setBusy(true);
    setError(null);
    try {
      const result = await askCopilot({
        tenantId: workspace.tenantId,
        projectId: projectOnly ? workspace.projectId : null,
        question: asked,
        history,
      });
      setTurns((prior) => [...prior, { role: "assistant", result }]);
    } catch (caught: unknown) {
      setError(friendlyError(caught, "Copilot failed."));
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runAsk(question);
  }

  // P4 — proactive: greet an owner opening the assistant with today's priorities
  // instead of a blank prompt, once per browser session and only on the empty
  // state (an ongoing conversation is left alone). It runs the same grounded,
  // read-only "attention" question the user could ask by hand — nothing sends.
  const autoBriefed = useRef(false);
  useEffect(() => {
    if (autoBriefed.current) return;
    if (workspace.loading || !workspace.tenantId) return;
    if (turns.length > 0) return;
    let alreadyThisSession = false;
    try {
      alreadyThisSession =
        sessionStorage.getItem("studiohub.copilotAutoBrief") === "1";
    } catch {
      // Storage disabled — skip the auto-brief rather than risk a loop.
      alreadyThisSession = true;
    }
    if (alreadyThisSession) return;
    autoBriefed.current = true;
    try {
      sessionStorage.setItem("studiohub.copilotAutoBrief", "1");
    } catch {
      // ignore
    }
    // Deferred so the ask's state updates land outside this effect's
    // synchronous run; it fires once after bootstrap on the empty state.
    const timer = setTimeout(() => void runAsk("What needs my attention today?"), 0);
    return () => clearTimeout(timer);
  }, [workspace.loading, workspace.tenantId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="copilot-workspace">
      <header className="page-heading">
        <div>
          <p className="eyebrow">One StudioCue assistant</p>
          <h1>Ask or create</h1>
          <p>
            Ask about your studio or start client communication, a project, or
            imported workflow from one place.
          </p>
        </div>
      </header>
      <nav className="copilot-create-actions" aria-label="Create with StudioCue">
        <Link href="/studio/messages">
          <Mail size={17} />
          <span><strong>Draft a client email</strong><small>Write, revise, and approve before sending</small></span>
        </Link>
        <Link href="/studio/projects/new">
          <FolderPlus size={17} />
          <span><strong>Create a project</strong><small>Start with the client and event essentials</small></span>
        </Link>
        <Link href="/studio/import">
          <FileText size={17} />
          <span><strong>Import studio materials</strong><small>Turn existing files into reusable workflows</small></span>
        </Link>
      </nav>
      {started ? (
        <section className="copilot-thread" aria-live="polite" aria-label="Conversation">
          {turns.map((turn, index) =>
            turn.role === "user" ? (
              <div className="copilot-turn-user" key={`u-${index}`}>
                <p>{turn.text}</p>
              </div>
            ) : (
              <AssistantTurn key={`a-${index}`} result={turn.result} />
            ),
          )}
          {busy ? (
            <p className="copilot-turn-thinking" role="status">
              <LoaderCircle className="spin" size={15} /> Reviewing records…
            </p>
          ) : null}
        </section>
      ) : null}
      <section className="panel copilot-compose">
        {!started ? (
          <div className="copilot-prompts" aria-label="Suggested questions">
            {prompts.map((prompt) => (
              <button key={prompt} type="button" onClick={() => setQuestion(prompt)}>
                <Sparkles size={14} /> {prompt}
              </button>
            ))}
          </div>
        ) : null}
        <form onSubmit={(event) => void submit(event)}>
          <label>
            <span>
              {started
                ? "Ask a follow-up — it keeps the conversation's context"
                : "Ask about operations, risk, payments, contracts, or crew"}
            </span>
            <textarea
              required
              minLength={3}
              maxLength={1200}
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder={
                started
                  ? "What should I do about it?"
                  : "What is blocking my next wedding?"
              }
            />
          </label>
          {workspace.projectId ? (
            <label className="copilot-scope">
              <input
                checked={projectOnly}
                type="checkbox"
                onChange={(event) => setProjectOnly(event.target.checked)}
              />
              Restrict this question to {workspace.projectName}
            </label>
          ) : null}
          <button className="button button-dark" disabled={busy} type="submit">
            {busy ? <LoaderCircle className="spin" /> : <Send />}
            {busy ? "Reviewing records…" : started ? "Send" : "Ask StudioCue"}
          </button>
        </form>
      </section>
      <p className="copilot-boundary is-footnote">
        <ShieldCheck aria-hidden="true" size={14} />
        <span>
          <strong>Answers only — Copilot never changes authoritative status.</strong>
          <small>
            Payments, signatures, insurance approval, permissions and readiness
            follow the project&rsquo;s own rules, and any action needs your
            confirmation.
          </small>
        </span>
      </p>
      {error ? (
        <section className="panel copilot-error" role="alert">
          <CircleAlert />
          <span>
            <strong>Copilot could not answer</strong>
            <small>{error}</small>
          </span>
        </section>
      ) : null}
    </div>
  );
}

function reviewTrace(result: CopilotResult): Array<{ label: string; detail: string }> {
  const trace: Array<{ label: string; detail: string }> = [];
  const job = result.jobObject;
  if (job?.readiness) {
    trace.push({ label: "Readiness", detail: `${job.readiness.satisfied}/${job.readiness.total} clear` });
  }
  if (job?.attention.length) {
    trace.push({ label: "Attention", detail: `${job.attention.length} flagged` });
  }
  if (result.citations.length) {
    trace.push({ label: "Projects", detail: `${result.citations.length} referenced` });
  }
  if (result.facts.length) {
    trace.push({ label: "Records", detail: `${result.facts.length} facts` });
  }
  return trace.slice(0, 4);
}

function AssistantTurn({ result }: { result: CopilotResult }) {
  const trace = reviewTrace(result);
  return (
    <section className="panel copilot-result">
      <header>
        <BookOpenCheck />
        <span>
          <p className="eyebrow">Grounded response</p>
          <small>Facts current as of {new Date(result.asOf).toLocaleString()}</small>
        </span>
      </header>
      {trace.length ? (
        <div className="cp-trace" aria-label="What the assistant reviewed">
          {trace.map((step) => (
            <span className="cp-trace-chip" key={step.label}>
              <Check size={12} strokeWidth={3} />
              <b>{step.label}</b>
              <span>{step.detail}</span>
            </span>
          ))}
        </div>
      ) : null}
      <h2>{result.answer}</h2>
      {result.jobObject ? <JobObject job={result.jobObject} /> : null}
      {result.facts.length ? (
        <div>
          <h3>Verified facts</h3>
          <ul>{result.facts.map((fact) => <li key={fact}>{fact}</li>)}</ul>
        </div>
      ) : null}
      {result.suggestions.length ? (
        <div>
          <h3>Suggestions</h3>
          <ul>{result.suggestions.map((suggestion) => <li key={suggestion}>{suggestion}</li>)}</ul>
        </div>
      ) : null}
      {result.citations.length ? (
        <footer>
          {result.citations.map((citation) => (
            <Link href={citation.href} key={`${citation.href}-${citation.label}`}>
              {citation.label}
            </Link>
          ))}
        </footer>
      ) : null}
      <PreparedActions citations={result.citations} />
    </section>
  );
}

function humanState(state: string): string {
  if (!state) return "In progress";
  const s = state.replaceAll("_", " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * The job rendered as a live object: readiness meter, lifecycle position, and
 * the record-derived attention list. Every value comes from the server's
 * deterministic jobObject — none of it is model-authored.
 */
function JobObject({ job }: { job: CopilotJobObject }) {
  const dateLabel = job.eventDate
    ? new Date(`${job.eventDate}T00:00:00`).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;
  const sub = [dateLabel, job.venue].filter(Boolean).join(" · ");
  const r = job.readiness;
  const segTotal = r ? Math.max(r.total, 1) : 0;
  return (
    <div className="cp-job">
      <div className="cp-job-top">
        <span className="cp-film" aria-hidden="true"><FolderKanban size={18} /></span>
        <span className="cp-job-id">
          <strong>{job.name}</strong>
          {sub ? <small>{sub}</small> : null}
        </span>
        <span className="cp-stage-pill"><i aria-hidden="true" /> {humanState(job.state)}</span>
      </div>

      <div className="cp-job-grid">
        {r ? (
          <div className="cp-job-cell">
            <p className="cp-cell-label">Readiness</p>
            <div className="cp-readiness">
              <b>{r.satisfied}<span>/{r.total}</span></b>
              <span>{r.ready ? "ready to go" : "checkpoints clear"}</span>
            </div>
            <div className="cp-segs">
              {Array.from({ length: segTotal }).map((_, i) => (
                <span key={i} className={i < r.satisfied ? "cp-seg on" : "cp-seg"} />
              ))}
            </div>
          </div>
        ) : null}
        <div className="cp-job-cell">
          <p className="cp-cell-label">Lifecycle</p>
          <div className="cp-timeline">
            {job.stages.map((stage, i) => (
              <Fragment key={stage}>
                {i > 0 ? (
                  <span className={i <= job.stageIndex ? "cp-tl-line done" : "cp-tl-line"} />
                ) : null}
                <span className={i === job.stageIndex ? "cp-tl-node now" : "cp-tl-node"}>
                  <span
                    className={
                      i < job.stageIndex
                        ? "cp-tl-dot done"
                        : i === job.stageIndex
                          ? "cp-tl-dot now"
                          : "cp-tl-dot"
                    }
                  >
                    {i < job.stageIndex ? <Check size={9} strokeWidth={3.5} /> : null}
                  </span>
                  <span className="cp-tl-cap">{stage}</span>
                </span>
              </Fragment>
            ))}
          </div>
        </div>
      </div>

      {job.attention.length ? (
        <div className="cp-attn">
          {job.attention.map((a) => (
            <div className="cp-attn-row" key={a.name}>
              <span className={`cp-sev ${a.severity}`} aria-hidden="true" />
              <span className="cp-attn-what">{a.name}</span>
              {a.reason ? <span className="cp-attn-reason">{a.reason}</span> : null}
              <span className={`cp-attn-tag ${a.severity}`}>
                {a.severity === "critical"
                  ? "blocks"
                  : a.severity === "warning"
                    ? "attention"
                    : "on track"}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const preparedActionOptions: Array<{
  trigger: MessageDraftTrigger;
  label: string;
}> = [
  { trigger: "day_before_checklist", label: "Draft the day-before checklist" },
  { trigger: "delivery_note", label: "Draft a delivery email" },
  { trigger: "review_request", label: "Draft a review request" },
];

// Drafts that only make sense after the event; hidden while it is still upcoming.
const POST_EVENT_TRIGGERS = new Set<MessageDraftTrigger>([
  "delivery_note",
  "review_request",
]);

/**
 * Copilot with hands: answers can end in prepared drafts. Each chip creates a
 * draft that lands in the AI review queue — Copilot never sends anything.
 */
function PreparedActions({
  citations,
}: {
  citations: Array<{ label: string; href: string }>;
}) {
  const workspace = useWorkspace();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Draft ids prepared from this answer, newest first, so their approval cards
  // appear inline below — the owner approves and sends here instead of leaving
  // for the review queue. (P2 of the AI command-chat plan.)
  const [draftedIds, setDraftedIds] = useState<string[]>([]);
  const aiState = useTenantDocuments("aiActions");
  const projectState = useTenantDocuments("projects");
  const projectCitation = citations.find((citation) =>
    citation.href.startsWith("/studio/projects/"),
  );
  const projectId = projectCitation?.href.split("/").pop() ?? null;

  // Don't offer post-event drafts (delivery email, review request) before the
  // event has happened — a "please review your experience" note dated before
  // the wedding reads as a mistake. The day-before checklist stays: it is a
  // pre-event step. Absent/unparseable event date shows everything (fail open).
  const project = (projectState.records ?? []).find(
    (record) => record.id === projectId,
  );
  // Captured once at mount so the render stays pure (no Date.now() in render).
  const [nowMs] = useState(() => Date.now());
  const eventDateMs = Date.parse(String(project?.eventDate ?? ""));
  const eventInFuture = Number.isFinite(eventDateMs) && eventDateMs > nowMs;
  const visibleActionOptions = preparedActionOptions.filter(
    (option) => !(eventInFuture && POST_EVENT_TRIGGERS.has(option.trigger)),
  );

  const inlineActions = (aiState.records ?? []).filter((record) =>
    draftedIds.includes(record.id),
  );

  if (!projectId || !workspace.tenantId) return null;

  // Prepare one draft, returning its action id (or null in preview mode).
  async function draftFor(
    trigger: MessageDraftTrigger,
  ): Promise<string | null> {
    if (!workspace.tenantId) return null;
    const result = await requestMessageDraft({
      tenantId: workspace.tenantId,
      trigger,
      projectId,
    });
    return result.mode === "live" ? result.actionId : null;
  }

  function showDrafts(ids: string[]) {
    if (!ids.length) return;
    setDraftedIds((prior) => [
      ...ids.filter((id) => !prior.includes(id)),
      ...prior,
    ]);
    // useTenantDocuments is a cached fetch, not a live subscription — the
    // aiActions snapshot was read at page load, before these drafts existed.
    // Refresh it so the new records load and their inline cards render.
    refreshTenantRecords("aiActions");
  }

  async function prepare(trigger: MessageDraftTrigger, label: string) {
    if (!workspace.tenantId) return;
    setBusy(trigger);
    setNotice(null);
    try {
      const id = await draftFor(trigger);
      if (id) showDrafts([id]);
      else
        setNotice(
          `Preview: "${label}" would be prepared as an approval card here.`,
        );
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "The draft could not be prepared."));
    } finally {
      setBusy(null);
    }
  }

  // P3: prepare every suggested next step at once, so the owner reviews and
  // sends them as a batch of cards rather than one chip at a time. Each draft
  // is independent — one failing doesn't sink the rest — and each still lands
  // as its own approval card that sends only on the owner's tap.
  async function prepareAll() {
    if (!workspace.tenantId) return;
    setBusy("__all__");
    setNotice(null);
    const ids: string[] = [];
    let failures = 0;
    for (const option of visibleActionOptions) {
      try {
        const id = await draftFor(option.trigger);
        if (id) ids.push(id);
      } catch {
        failures += 1;
      }
    }
    showDrafts(ids);
    if (!ids.length)
      setNotice(
        failures
          ? "These drafts could not be prepared. Try again."
          : "Preview: these drafts would be prepared as approval cards here.",
      );
    else if (failures)
      setNotice(`Prepared ${ids.length}; ${failures} could not be prepared.`);
    setBusy(null);
  }

  return (
    <div className="copilot-prepared-actions">
      <small>
        Prepared next steps for {projectCitation?.label ?? "this project"} —
        each draft appears below for you to review, edit, and send:
      </small>
      {visibleActionOptions.length > 1 ? (
        <button
          className="button button-dark copilot-prepare-all"
          disabled={busy !== null}
          onClick={() => void prepareAll()}
          type="button"
        >
          {busy === "__all__" ? (
            <LoaderCircle className="spin" size={14} />
          ) : (
            <Sparkles size={14} />
          )}
          Prepare all {visibleActionOptions.length} next steps
        </button>
      ) : null}
      <div>
        {visibleActionOptions.map((option) => (
          <button
            disabled={busy !== null}
            key={option.trigger}
            onClick={() => void prepare(option.trigger, option.label)}
            type="button"
          >
            {busy === option.trigger ? (
              <LoaderCircle className="spin" size={13} />
            ) : (
              <Sparkles size={13} />
            )}
            {option.label}
          </button>
        ))}
      </div>
      {inlineActions.length ? (
        <div className="copilot-inline-approvals">
          {inlineActions.map((action) => (
            <AiQueueCard
              action={action}
              key={action.id}
              onDecision={(id) =>
                setDraftedIds((prior) => prior.filter((value) => value !== id))
              }
            />
          ))}
        </div>
      ) : null}
      {notice ? <p role="status">{notice}</p> : null}
    </div>
  );
}
