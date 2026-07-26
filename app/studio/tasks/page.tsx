import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CheckSquare2, Filter, Plus } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { StatusBadge } from "@/components/ui/status-badge";
import { workflowTasks } from "@/config/workflow-demo-data";

export const metadata: Metadata = { title: "Tasks · StudioHub" };

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ priority?: string; view?: string }>;
}) {
  const { priority = "all", view = "open" } = await searchParams;
  const visibleTasks = view === "completed" ? [] : workflowTasks.filter(
    (task) => priority === "all" || task.priority.toLowerCase() === priority,
  );
  return (
    <AppShell active="Tasks">
      <div className="workflow-page">
        <div className="dashboard-heading">
          <div><p className="eyebrow">Execution queue</p><h1>Tasks</h1><p>Work assigned to the studio, with project, due date, and readiness impact.</p></div>
          <Link className="button button-dark" href="/studio/tasks/new"><Plus size={16} /> Create task</Link>
        </div>
        <section className="panel workflow-table-panel">
          <div className="crm-toolbar">
            <div className="crm-tabs"><Link className={view === "open" ? "active" : ""} href={`?view=open&priority=${priority}`}>Open <span>12</span></Link><Link className={view === "completed" ? "active" : ""} href={`?view=completed&priority=${priority}`}>Completed</Link></div>
            <form className="crm-search-form" method="get"><input name="view" type="hidden" value={view} /><Filter size={15} /><select aria-label="Task priority" defaultValue={priority} name="priority"><option value="all">All priorities</option><option value="urgent">Urgent</option><option value="high">High</option><option value="normal">Normal</option></select><button type="submit">Apply</button></form>
          </div>
          <div className="workflow-task-table">
            <div className="workflow-task-head"><span>Task</span><span>Project</span><span>Due</span><span>Owner</span><span>Priority</span><span>Status</span><span /></div>
            {visibleTasks.map((task) => (
              <article key={task.id}>
                <span className="task-title"><i><CheckSquare2 size={15} /></i><span><strong>{task.title}</strong><small>{task.id}{task.blocking ? " · affects readiness" : ""}</small></span></span>
                <span>{task.project}</span><time>{task.due}</time><span>{task.owner}</span>
                <StatusBadge tone={task.priority === "Urgent" ? "danger" : task.priority === "High" ? "warning" : "neutral"}>{task.priority}</StatusBadge>
                <StatusBadge tone={task.status === "In progress" ? "info" : "neutral"}>{task.status}</StatusBadge>
                <Link href={`/studio/projects/${task.project.includes("Johnson") ? "PRJ-2048" : "PRJ-2064"}`} aria-label={`Open project for ${task.title}`}><ArrowRight size={15} /></Link>
              </article>
            ))}
          </div>
          {visibleTasks.length === 0 ? <div className="crm-list-empty"><CheckSquare2 size={20} /><strong>No matching tasks</strong><span>Choose another view or priority.</span></div> : null}
        </section>
      </div>
    </AppShell>
  );
}
