import Link from "next/link";
import {
  ArrowRight,
  CalendarDays,
  ChevronRight,
  CircleAlert,
  Plus,
  TrendingUp,
} from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { StatusBadge } from "@/components/ui/status-badge";
import { riskItems, todayItems } from "@/config/demo-data";
import { LiveUpcomingRows } from "@/components/live/tenant-records";

const pipeline = [
  { label: "New inquiries", value: 12, color: "sand" },
  { label: "Consultations", value: 8, color: "lilac" },
  { label: "Proposals sent", value: 5, color: "blue" },
  { label: "Contract pending", value: 3, color: "amber" },
  { label: "Booked", value: 9, color: "green" },
];

export function StudioDashboard() {
  return (
    <AppShell>
      <div className="dashboard-heading">
        <div>
          <p className="eyebrow">Sunday, July 26</p>
          <h1>Good morning, Conor.</h1>
          <p>Here’s what needs your attention across Alder &amp; Muse.</p>
        </div>
        <Link className="button button-dark" href="/studio/projects">
          <Plus size={16} /> View projects
        </Link>
      </div>

      <section className="metric-grid" aria-label="Studio overview">
        <article className="metric-card">
          <span className="metric-label">Events this month</span>
          <strong>8</strong>
          <span className="metric-note positive">
            <TrendingUp size={14} /> 2 more than June
          </span>
        </article>
        <article className="metric-card">
          <span className="metric-label">Projects ready</span>
          <strong>14 <small>/ 19</small></strong>
          <span className="metric-note">74% readiness rate</span>
        </article>
        <article className="metric-card metric-alert">
          <span className="metric-label">Blocking items</span>
          <strong>6</strong>
          <span className="metric-note warning">
            <CircleAlert size={14} /> 2 overdue
          </span>
        </article>
        <article className="metric-card">
          <span className="metric-label">Outstanding balance</span>
          <strong>$18.4k</strong>
          <span className="metric-note">Synced 12 min ago · QuickBooks</span>
        </article>
      </section>

      <div className="dashboard-grid">
        <section className="panel today-panel">
          <div className="panel-heading">
            <div>
              <h2>Today</h2>
              <p>Your priority activity</p>
            </div>
            <Link href="/studio/calendar">View calendar <ArrowRight size={14} /></Link>
          </div>
          <div className="today-list">
            {todayItems.map((item) => {
              const Icon = item.icon;
              return (
                <article className="today-row" key={item.detail}>
                  <span className={`today-icon icon-${item.tone}`}>
                    <Icon size={18} />
                  </span>
                  <div>
                    <small>{item.label}</small>
                    <strong>{item.detail}</strong>
                  </div>
                  <time>{item.time}</time>
                  <ChevronRight size={16} />
                </article>
              );
            })}
          </div>
          <div className="day-divider">
            <span><CalendarDays size={14} /> Next event</span>
            <strong>Maya &amp; Theo · The Foundry</strong>
            <small>20 days away</small>
          </div>
        </section>

        <section className="panel risk-panel">
          <div className="panel-heading">
            <div>
              <h2>At risk</h2>
              <p>Items affecting readiness</p>
            </div>
            <StatusBadge tone="danger">6 open</StatusBadge>
          </div>
          <div className="risk-list">
            {riskItems.map((item) => {
              const Icon = item.icon;
              return (
                <article className="risk-row" key={item.label}>
                  <span className="risk-icon"><Icon size={18} /></span>
                  <div>
                    <strong>{item.label}</strong>
                    <small>{item.detail}</small>
                  </div>
                  <StatusBadge>{item.owner}</StatusBadge>
                </article>
              );
            })}
          </div>
          <Link className="panel-footer-link" href="/studio/projects?filter=at-risk">
            Review all blockers <ArrowRight size={14} />
          </Link>
        </section>
      </div>

      <section className="panel projects-panel">
        <div className="panel-heading">
          <div>
            <h2>Upcoming projects</h2>
            <p>Readiness across your next events</p>
          </div>
          <div className="table-actions">
            <StatusBadge tone="info" dot>Live readiness</StatusBadge>
          </div>
        </div>
        <div className="project-table" role="table" aria-label="Upcoming projects">
          <div className="project-table-head" role="row">
            <span role="columnheader">Project</span>
            <span role="columnheader">Date</span>
            <span role="columnheader">State</span>
            <span role="columnheader">Readiness</span>
            <span role="columnheader">Main blocker</span>
          </div>
          <LiveUpcomingRows/>
        </div>
      </section>

      <section className="dashboard-bottom-grid">
        <article className="panel pipeline-card">
          <div className="panel-heading">
            <div>
              <h2>Pipeline</h2>
              <p>Active opportunities by stage</p>
            </div>
            <span className="period-pill">Last 30 days</span>
          </div>
          <div className="pipeline-bars">
            {pipeline.map((stage) => (
              <div className="pipeline-row" key={stage.label}>
                <span>{stage.label}</span>
                <div><i className={`bar-${stage.color}`} style={{ width: `${stage.value * 7}%` }} /></div>
                <strong>{stage.value}</strong>
              </div>
            ))}
          </div>
        </article>
        <article className="panel financial-card">
          <div className="panel-heading">
            <div>
              <h2>Financial snapshot</h2>
              <p>Synced from QuickBooks Online</p>
            </div>
            <StatusBadge tone="success" dot>Healthy</StatusBadge>
          </div>
          <div className="financial-total">
            <span>Booked project value</span>
            <strong>$184,250</strong>
            <small>+$24,800 this month</small>
          </div>
          <div className="financial-split">
            <span><small>Collected</small><strong>$126,430</strong></span>
            <span><small>Outstanding</small><strong>$57,820</strong></span>
          </div>
        </article>
      </section>
    </AppShell>
  );
}
