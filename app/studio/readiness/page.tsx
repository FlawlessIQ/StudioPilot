import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CircleAlert, Clock3, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { ReadinessMeter } from "@/components/ui/readiness-meter";
import { StatusBadge } from "@/components/ui/status-badge";
import { readinessProjects } from "@/config/workflow-demo-data";

export const metadata: Metadata = { title: "Event Readiness · StudioHub" };

export default function ReadinessPage() {
  return (
    <AppShell active="Readiness">
      <div className="workflow-page">
        <div className="dashboard-heading"><div><p className="eyebrow">Deterministic event gate</p><h1>Event readiness</h1><p>Blocking checkpoints, responsible parties, deadlines, and the next action.</p></div><StatusBadge tone="success" dot>Rules version 1</StatusBadge></div>
        <div className="readiness-summary-strip">
          <article><ShieldCheck size={19} /><span><strong>1</strong><small>Ready</small></span></article>
          <article><CircleAlert size={19} /><span><strong>3</strong><small>Not ready</small></span></article>
          <article><Clock3 size={19} /><span><strong>3</strong><small>Overdue blockers</small></span></article>
          <p>AI may explain risk, but only verified checkpoint rules determine this view.</p>
        </div>
        <section className="readiness-project-grid">
          {readinessProjects.map((project) => (
            <Link href={`/studio/projects/${project.id}`} key={project.id}>
              <header><ReadinessMeter value={project.score} size="lg" /><div><StatusBadge tone={project.ready ? "success" : "danger"} dot>{project.ready ? "Ready" : "Not ready"}</StatusBadge><h2>{project.name}</h2><p>{project.date}</p></div></header>
              <div className="readiness-counts"><span><small>Blocking</small><strong>{project.blocking}</strong></span><span><small>Overdue</small><strong>{project.overdue}</strong></span><span><small>At risk</small><strong>{project.atRisk}</strong></span></div>
              <footer><span><small>Recommended next action</small><strong>{project.next}</strong><i>{project.owner}</i></span><ArrowRight size={16} /></footer>
            </Link>
          ))}
        </section>
      </div>
    </AppShell>
  );
}
