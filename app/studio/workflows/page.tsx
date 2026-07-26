import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, GitBranch, Plus, Workflow } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { StatusBadge } from "@/components/ui/status-badge";
import { workflowTemplates } from "@/config/workflow-demo-data";

export const metadata: Metadata = { title: "Workflow Templates · StudioHub" };

export default function WorkflowsPage() {
  return (
    <AppShell active="Workflows">
      <div className="workflow-page">
        <div className="dashboard-heading">
          <div><p className="eyebrow">Automation foundation</p><h1>Workflow templates</h1><p>Versioned checkpoints, relative dates, triggers, conditions, and actions.</p></div>
          <Link className="button button-dark" href="/studio/workflows/new"><Plus size={16} /> Create workflow</Link>
        </div>
        <div className="workflow-metrics">
          <article><small>Active templates</small><strong>3</strong><span>Wedding, corporate, sports</span></article>
          <article><small>Active workflow runs</small><strong>25</strong><span>Across 23 projects</span></article>
          <article><small>Open checkpoints</small><strong>74</strong><span>12 affect readiness</span></article>
          <article><small>Automation reliability</small><strong>98.4%</strong><span>Last 30 days</span></article>
        </div>
        <section className="workflow-template-grid">
          {workflowTemplates.map((template) => (
            <Link href={`/studio/workflows/${template.id}`} key={template.id}>
              <header><span className="workflow-icon"><Workflow size={19} /></span><StatusBadge tone={template.status === "Active" ? "success" : "warning"} dot>{template.status}</StatusBadge></header>
              <p className="eyebrow">{template.eventType} · Version {template.version}</p>
              <h2>{template.name}</h2>
              <p>{template.description}</p>
              <dl>
                <span><dt>Checkpoints</dt><dd>{template.checkpoints}</dd></span>
                <span><dt>Automations</dt><dd>{template.automations}</dd></span>
                <span><dt>Active projects</dt><dd>{template.activeProjects}</dd></span>
              </dl>
              <footer><span><GitBranch size={14} /> Immutable published versions</span><ArrowRight size={15} /></footer>
            </Link>
          ))}
        </section>
      </div>
    </AppShell>
  );
}
