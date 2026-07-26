import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, CalendarDays, CheckCircle2, CircleAlert, MapPin, UserRound } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { ReadinessMeter } from "@/components/ui/readiness-meter";
import { StatusBadge } from "@/components/ui/status-badge";
import { crmProjects } from "@/config/crm-demo-data";
import { workflowStages } from "@/config/workflow-demo-data";

export const metadata: Metadata = { title: "Project · StudioHub" };

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = crmProjects.find((item) => item.id === id) ?? crmProjects[0];
  if (!project) return null;

  return (
    <AppShell active="Projects">
      <div className="project-detail-page">
        <Link className="back-link" href="/studio/projects"><ArrowLeft size={15} /> All projects</Link>
        <header className="project-detail-header">
          <div><div className="project-title-line"><h1>{project.name}</h1><StatusBadge tone={project.state === "READY" ? "success" : "info"} dot>{project.state.replaceAll("_", " ")}</StatusBadge></div><p>{project.id} · {project.event}</p></div>
          <ReadinessMeter value={project.readiness} size="lg" />
        </header>
        <div className="project-facts">
          <span><CalendarDays size={17} /><small>Event date</small><strong>{project.date}</strong></span>
          <span><MapPin size={17} /><small>Venue</small><strong>{project.venue}</strong></span>
          <span><UserRound size={17} /><small>Coordinator</small><strong>{project.owner}</strong></span>
        </div>
        <div className="project-detail-grid">
          <section className="panel">
            <div className="panel-heading"><div><h2>Project lifecycle</h2><p>Transitions follow explicit state rules</p></div></div>
            <div className="state-timeline">
              {["LEAD", "CONSULTATION", "PROPOSAL", "CONTRACT_PENDING", "BOOKED", "PLANNING", "READY"].map((state, index) => {
                const currentIndex = ["LEAD", "CONSULTATION", "PROPOSAL", "CONTRACT_PENDING", "BOOKED", "PLANNING", "READY"].indexOf(project.state);
                return <span className={index <= currentIndex ? "complete" : ""} key={state}><i>{index < currentIndex ? <CheckCircle2 size={14} /> : index + 1}</i><small>{state.replaceAll("_", " ")}</small></span>;
              })}
            </div>
          </section>
          <aside className="next-action-card">
            <p className="eyebrow">Next action</p>
            <CircleAlert size={21} />
            <h2>{project.nextAction}</h2>
            <p>Owned by {project.owner}. This item affects project readiness.</p>
            <Link className="button button-light" href="/studio/leads">Review action</Link>
          </aside>
        </div>
        <section className="panel project-checkpoints-panel">
          <div className="panel-heading"><div><h2>Readiness checkpoints</h2><p>Verified rules from Wedding Photography v7</p></div><Link href="/studio/readiness">Open readiness view</Link></div>
          <div className="project-checkpoint-list">
            {workflowStages.flatMap((stage) => stage.checkpoints).map((checkpoint) => (
              <article key={checkpoint.name}>
                <span className={checkpoint.status === "Complete" ? "checkpoint-state complete" : "checkpoint-state"}>{checkpoint.status === "Complete" ? <CheckCircle2 size={15} /> : <i />}</span>
                <span><strong>{checkpoint.name}</strong><small>{checkpoint.owner} · {checkpoint.due}</small></span>
                <StatusBadge tone={checkpoint.blocking ? "warning" : "neutral"}>{checkpoint.blocking ? "Affects readiness" : "Non-blocking"}</StatusBadge>
                <StatusBadge tone={checkpoint.status === "Complete" ? "success" : checkpoint.status === "Under review" ? "info" : "neutral"}>{checkpoint.status}</StatusBadge>
              </article>
            ))}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
