import type { Metadata } from "next";
import { Bot, Clock3, Link2, UserRound } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { StatusBadge } from "@/components/ui/status-badge";
import { auditEvents } from "@/config/workflow-demo-data";

export const metadata: Metadata = { title: "Audit Log · StudioHub" };

export default function AuditPage() {
  return (
    <AppShell active="Workflows">
      <div className="workflow-page">
        <div className="dashboard-heading"><div><p className="eyebrow">Immutable evidence</p><h1>Audit log</h1><p>Meaningful user, system, automation, and provider actions.</p></div><StatusBadge tone="info">Append only</StatusBadge></div>
        <section className="panel audit-timeline-panel">
          {auditEvents.map((event) => (
            <article key={event.id}>
              <span className="audit-actor-icon">{event.type === "User" ? <UserRound size={16} /> : <Bot size={16} />}</span>
              <span><strong>{event.action}</strong><small>{event.entity}</small></span>
              <span><Link2 size={13} /> {event.project}</span>
              <span>{event.actor}<small>{event.type}</small></span>
              <time><Clock3 size={13} /> {event.time}</time>
            </article>
          ))}
        </section>
      </div>
    </AppShell>
  );
}
