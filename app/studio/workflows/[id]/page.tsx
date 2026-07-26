import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, BellRing, CheckCircle2, GitBranch, LockKeyhole, Plus, Zap } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { StatusBadge } from "@/components/ui/status-badge";
import { workflowStages, workflowTemplates } from "@/config/workflow-demo-data";

export const metadata: Metadata = { title: "Workflow detail · StudioHub" };

export default async function WorkflowDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const template = workflowTemplates.find((item) => item.id === id) ?? workflowTemplates[0];
  if (!template) return null;

  return (
    <AppShell active="Workflows">
      <div className="workflow-detail-page">
        <Link className="back-link" href="/studio/workflows"><ArrowLeft size={15} /> Workflow templates</Link>
        <header className="workflow-detail-header">
          <div><p className="eyebrow">{template.eventType} workflow</p><div><h1>{template.name}</h1><StatusBadge tone="success" dot>Active · v{template.version}</StatusBadge></div><p>{template.description}</p></div>
          <Link className="button button-dark" href="/studio/workflows/new"><Plus size={16} /> New version</Link>
        </header>
        <div className="immutable-banner"><LockKeyhole size={17} /><div><strong>Published version locked</strong><p>Projects using version {template.version} retain this exact checkpoint and automation snapshot.</p></div><span><GitBranch size={14} /> {template.activeProjects} active runs</span></div>
        <div className="workflow-detail-grid">
          <section className="panel workflow-stage-panel">
            <div className="panel-heading"><div><h2>Checkpoint sequence</h2><p>Due dates resolve when a project run starts</p></div><StatusBadge>{template.checkpoints} total</StatusBadge></div>
            {workflowStages.map((stage, stageIndex) => (
              <div className="workflow-stage" key={stage.label}>
                <header><i>{stageIndex + 1}</i><strong>{stage.label}</strong><span>{stage.checkpoints.length} shown</span></header>
                {stage.checkpoints.map((checkpoint) => (
                  <article key={checkpoint.name}>
                    <span className={checkpoint.status === "Complete" ? "checkpoint-state complete" : "checkpoint-state"}>{checkpoint.status === "Complete" ? <CheckCircle2 size={15} /> : <i />}</span>
                    <span><strong>{checkpoint.name}</strong><small>{checkpoint.owner} · {checkpoint.due}</small></span>
                    {checkpoint.blocking ? <StatusBadge tone="warning">Blocking</StatusBadge> : <StatusBadge>Non-blocking</StatusBadge>}
                    <small>{checkpoint.status}</small>
                  </article>
                ))}
              </div>
            ))}
          </section>
          <aside className="workflow-side-column">
            <section className="panel">
              <div className="panel-heading"><div><h2>Automations</h2><p>Trigger → conditions → actions</p></div><Zap size={17} /></div>
              <div className="automation-rule-list">
                <article><span><Zap size={15} /></span><div><strong>Booking completed</strong><small>Create workspace · start planning · notify client</small></div><StatusBadge tone="success">Active</StatusBadge></article>
                <article><span><BellRing size={15} /></span><div><strong>Checkpoint approaching</strong><small>7 days before due · send reminder</small></div><StatusBadge tone="success">Active</StatusBadge></article>
                <article><span><Zap size={15} /></span><div><strong>Schedule approved</strong><small>Notify crew · request acknowledgement</small></div><StatusBadge tone="success">Active</StatusBadge></article>
              </div>
            </section>
            <section className="workflow-safety-card">
              <p className="eyebrow">Deterministic safety</p>
              <h2>AI cannot close these gates.</h2>
              <p>Payments, signatures, insurance approval, permissions, waivers, and readiness remain controlled by verified rules and human authority.</p>
            </section>
          </aside>
        </div>
      </div>
    </AppShell>
  );
}
