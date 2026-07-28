"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import {
  BookOpenCheck,
  CircleAlert,
  LoaderCircle,
  Send,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useWorkspace } from "@/features/auth/workspace-context";
import { askCopilot, type CopilotResult } from "@/lib/ai/copilot-client";

const prompts = [
  "What needs my attention today?",
  "Which projects are not ready?",
  "Which contracts are unsigned?",
  "Which clients have unpaid balances?",
  "Which subcontractors have not accepted?",
  "Which upcoming projects have travel conflicts?",
];

export function CopilotWorkspace() {
  const workspace = useWorkspace();
  const [question, setQuestion] = useState("");
  const [projectOnly, setProjectOnly] = useState(false);
  const [result, setResult] = useState<CopilotResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace.tenantId) {
      setError("No active studio is available.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setResult(
        await askCopilot({
          tenantId: workspace.tenantId,
          projectId: projectOnly ? workspace.projectId : null,
          question,
        }),
      );
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Copilot failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="copilot-workspace">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Permission-aware assistant</p>
          <h1>Event Copilot</h1>
          <p>
            Grounded in records the signed-in user is permitted to access, with
            links back to source projects.
          </p>
        </div>
      </header>
      <div className="copilot-boundary">
        <ShieldCheck />
        <span>
          <strong>Copilot cannot change authoritative status.</strong>
          <small>
            Payments, signatures, COI approval, permissions, and readiness remain
            deterministic. Any future action will require confirmation.
          </small>
        </span>
      </div>
      <section className="panel copilot-compose">
        <div className="copilot-prompts" aria-label="Suggested questions">
          {prompts.map((prompt) => (
            <button key={prompt} type="button" onClick={() => setQuestion(prompt)}>
              <Sparkles size={14} /> {prompt}
            </button>
          ))}
        </div>
        <form onSubmit={(event) => void submit(event)}>
          <label>
            <span>Ask about operations, risk, payments, contracts, or crew</span>
            <textarea
              required
              minLength={3}
              maxLength={1200}
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="What is blocking my next wedding?"
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
            {busy ? "Reviewing records…" : "Ask Copilot"}
          </button>
        </form>
      </section>
      {error ? (
        <section className="panel copilot-error" role="alert">
          <CircleAlert />
          <span>
            <strong>Copilot could not answer</strong>
            <small>{error}</small>
          </span>
        </section>
      ) : null}
      {result ? (
        <section className="panel copilot-result" aria-live="polite">
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
        </section>
      ) : null}
    </div>
  );
}
