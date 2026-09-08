"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import {
  BookOpenCheck,
  CircleAlert,
  FileText,
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
import { askCopilot, type CopilotResult } from "@/lib/ai/copilot-client";
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

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace.tenantId) {
      setError("No active studio is available.");
      return;
    }
    const asked = question.trim();
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

function AssistantTurn({ result }: { result: CopilotResult }) {
  return (
    <section className="panel copilot-result">
      <header>
        <BookOpenCheck />
        <span>
          <p className="eyebrow">Grounded response</p>
          <small>Facts current as of {new Date(result.asOf).toLocaleString()}</small>
        </span>
      </header>
      <h2>{result.answer}</h2>
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

const preparedActionOptions: Array<{
  trigger: MessageDraftTrigger;
  label: string;
}> = [
  { trigger: "day_before_checklist", label: "Draft the day-before checklist" },
  { trigger: "delivery_note", label: "Draft a delivery email" },
  { trigger: "review_request", label: "Draft a review request" },
];

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
  const projectCitation = citations.find((citation) =>
    citation.href.startsWith("/studio/projects/"),
  );
  const projectId = projectCitation?.href.split("/").pop() ?? null;

  const inlineActions = (aiState.records ?? []).filter((record) =>
    draftedIds.includes(record.id),
  );

  if (!projectId || !workspace.tenantId) return null;

  async function prepare(trigger: MessageDraftTrigger, label: string) {
    if (!workspace.tenantId) return;
    setBusy(trigger);
    setNotice(null);
    try {
      const result = await requestMessageDraft({
        tenantId: workspace.tenantId,
        trigger,
        projectId,
      });
      if (result.mode === "live" && result.actionId) {
        setDraftedIds((prior) =>
          prior.includes(result.actionId!) ? prior : [result.actionId!, ...prior],
        );
        // useTenantDocuments is a cached fetch, not a live subscription — the
        // aiActions snapshot was read at page load, before this draft existed.
        // Refresh it so the just-created record loads and its inline approval
        // card renders (without this the card never appeared).
        refreshTenantRecords("aiActions");
      } else {
        setNotice(
          `Preview: "${label}" would be prepared as an approval card here.`,
        );
      }
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "The draft could not be prepared."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="copilot-prepared-actions">
      <small>
        Prepared next steps for {projectCitation?.label ?? "this project"} —
        each draft appears below for you to review, edit, and send:
      </small>
      <div>
        {preparedActionOptions.map((option) => (
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
