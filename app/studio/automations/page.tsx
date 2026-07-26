import type { Metadata } from "next";
import { CircleCheck, Clock3, RotateCw, Zap } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { StatusBadge } from "@/components/ui/status-badge";
import { automationRuns } from "@/config/workflow-demo-data";

export const metadata: Metadata = { title: "Automation Runs · StudioHub" };

export default function AutomationsPage() {
  return (
    <AppShell active="Workflows">
      <div className="workflow-page">
        <div className="dashboard-heading"><div><p className="eyebrow">Workflow execution</p><h1>Automation runs</h1><p>Idempotent actions, retry state, attempts, and normalized outcomes.</p></div><StatusBadge tone="success" dot>98.4% successful</StatusBadge></div>
        <section className="panel automation-run-panel">
          <div className="automation-run-head"><span>Run</span><span>Rule & project</span><span>Actions</span><span>Attempts</span><span>Outcome</span><span>Time</span></div>
          {automationRuns.map((run) => (
            <article key={run.id}>
              <span className={run.status === "Succeeded" ? "run-icon success" : "run-icon retry"}>{run.status === "Succeeded" ? <CircleCheck size={16} /> : <RotateCw size={16} />}</span>
              <span><strong>{run.rule}</strong><small>{run.id} · {run.project}</small></span>
              <span><Zap size={13} /> {run.actions}</span>
              <span>{run.attempts}</span>
              <StatusBadge tone={run.status === "Succeeded" ? "success" : "warning"}>{run.status}</StatusBadge>
              <time><Clock3 size={13} /> {run.time}</time>
            </article>
          ))}
        </section>
      </div>
    </AppShell>
  );
}
