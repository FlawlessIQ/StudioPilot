import type { Metadata } from "next";
import {
  ArrowRight,
  ArrowUpRight,
  CalendarCheck2,
  Check,
  CircleAlert,
  Clock3,
  MapPin,
  Pencil,
  Plus,
  Sparkles,
  Upload,
  Wallet,
} from "lucide-react";
import { PreviewShell } from "@/components/ds/preview-shell";
import { ReadinessRing } from "@/components/ds/readiness-ring";
import { ThemeSwitcher } from "@/components/ds/theme-switcher";

export const metadata: Metadata = {
  title: "Studio Dashboard — editorial preview",
};

const stats = [
  {
    label: "Events this month",
    value: "3",
    note: "Next: Maya & Theo, Aug 15",
    chip: "chip-claret" as const,
    icon: CalendarCheck2,
  },
  {
    label: "Awaiting client",
    value: "2",
    note: "Questionnaires & approvals",
    chip: "chip-brass" as const,
    icon: Clock3,
  },
  {
    label: "Collected in July",
    value: (
      <>
        <sup>$</sup>18,400
      </>
    ),
    note: "$4,200 outstanding",
    chip: "chip-forest" as const,
    icon: Wallet,
  },
  {
    label: "Needs your eye",
    value: "2",
    note: "Below 100% readiness",
    chip: "chip-amber" as const,
    icon: CircleAlert,
    warn: true,
  },
];

const attention = [
  {
    initials: "MT",
    tone: "ds-mono-claret",
    name: "Maya & Theo",
    meta: "Wedding · Aug 15 · The Foundry, Brooklyn",
    next: "Client to approve the final wedding-day schedule",
    readiness: 72,
    badge: { tone: "ds-badge-brass", label: "Planning" },
  },
  {
    initials: "SM",
    tone: "ds-mono-forest",
    name: "Sofia & Miles",
    meta: "Wedding · Aug 22 · Cedar Lakes Estate",
    next: "Confirm event-day crew briefing time",
    readiness: 94,
    badge: { tone: "ds-badge-forest", label: "Almost ready" },
  },
  {
    initials: "AR",
    tone: "ds-mono-brass",
    name: "Amara & Rio",
    meta: "Wedding · Sep 06 · The Garden Conservatory",
    next: "Send retainer reminder — due in 3 days",
    readiness: 48,
    badge: { tone: "ds-badge-amber", label: "Contract pending" },
  },
];

const pipeline = [
  { label: "Consultations", value: 4 },
  { label: "Proposals", value: 3 },
  { label: "Contracts", value: 2 },
  { label: "Booked", value: 6 },
  { label: "Planning", value: 3 },
];
const pipelineMax = Math.max(...pipeline.map((p) => p.value));

const agenda = [
  { d: "12", m: "Thu", title: "Consultation — Priya & Sam", meta: "3:00 PM · Video call" },
  { d: "15", m: "Sat", title: "Maya & Theo — Wedding day", meta: "All day · The Foundry" },
  { d: "18", m: "Tue", title: "Gallery review — Chen family", meta: "Client approval due" },
];

export default function StudioPreviewPage() {
  return (
    <PreviewShell>
      {/* Hero greeting */}
      <section className="ds-hero">
        <div className="ds-hero-copy">
          <span className="ds-eyebrow">Thursday, August 7</span>
          <h1>
            Good morning, <em>Jordan.</em>
          </h1>
          <p className="ds-hero-sub">
            Three weddings this month, and two need a decision from you before the
            weekend. StudioCue has everything else prepared and waiting for your
            approval.
          </p>
        </div>
        <div className="ds-hero-actions">
          <button type="button" className="ds-btn ds-btn-ghost">
            <Upload size={16} /> Import documents
          </button>
          <button type="button" className="ds-btn ds-btn-primary">
            <Plus size={16} /> New project
          </button>
        </div>
      </section>

      {/* Stat row */}
      <section className="ds-stat-row" aria-label="Studio overview">
        {stats.map((s) => {
          const Icon = s.icon;
          return (
            <article className="ds-card ds-stat" key={s.label}>
              <div className="ds-stat-top">
                <span className="ds-stat-label">{s.label}</span>
                <span className={`ds-stat-chip ds-${s.chip}`}>
                  <Icon size={17} strokeWidth={1.9} />
                </span>
              </div>
              <div className="ds-stat-value">{s.value}</div>
              <p className={`ds-stat-note${s.warn ? " is-warn" : ""}`}>
                {s.warn ? <CircleAlert size={13} /> : <ArrowUpRight size={13} />}
                {s.note}
              </p>
            </article>
          );
        })}
      </section>

      {/* Main grid */}
      <div className="ds-grid">
        {/* Left column */}
        <div className="ds-col">
          <section className="ds-card ds-card-pad">
            <div className="ds-section-head">
              <div>
                <h2>Needs your attention</h2>
                <p>The next decision on each project, ready to make</p>
              </div>
              <span className="ds-seehead-link">
                All projects <ArrowRight size={14} />
              </span>
            </div>
            <div className="ds-attn">
              {attention.map((row) => (
                <div className="ds-attn-row" key={row.name}>
                  <span className={`ds-monogram ${row.tone}`}>{row.initials}</span>
                  <div className="ds-attn-body">
                    <div className="ds-attn-name">
                      {row.name}
                      <span className={`ds-badge ${row.badge.tone}`}>
                        {row.badge.label}
                      </span>
                    </div>
                    <div className="ds-attn-meta">{row.meta}</div>
                    <div className="ds-attn-next">
                      <MapPin size={14} /> {row.next}
                    </div>
                  </div>
                  <div className="ds-attn-right">
                    <ReadinessRing value={row.readiness} />
                    <span className="ds-action">
                      Review <ArrowRight size={14} />
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="ds-card ds-card-pad">
            <div className="ds-section-head">
              <div>
                <h2>This week</h2>
                <p>Consultations, events, and approvals ahead</p>
              </div>
              <span className="ds-seehead-link">
                Open calendar <ArrowRight size={14} />
              </span>
            </div>
            <div className="ds-agenda">
              {agenda.map((a) => (
                <div className="ds-agenda-row" key={a.title}>
                  <div className="ds-agenda-date">
                    <b>{a.d}</b>
                    <span>{a.m}</span>
                  </div>
                  <div className="ds-agenda-body">
                    <strong>{a.title}</strong>
                    <small>{a.meta}</small>
                  </div>
                  <span className="ds-seehead-link">
                    View <ArrowRight size={13} />
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* Right column */}
        <div className="ds-col">
          <section className="ds-card ds-ai">
            <div className="ds-ai-head">
              <span className="ds-ai-badge">
                <Sparkles size={16} />
              </span>
              <div>
                <strong>Prepared by StudioCue</strong>
                <small>Ready for your approval</small>
              </div>
            </div>
            <div className="ds-ai-draft">
              <span>Draft schedule</span>
              <h4>Maya &amp; Theo — wedding-day timeline</h4>
              <p>
                A 7-hour run of show from getting-ready to send-off, built from
                their questionnaire and venue details. Two gaps flagged for you.
              </p>
              <div className="ds-ai-actions">
                <button type="button" className="ds-btn ds-btn-primary ds-btn-sm">
                  <Check size={15} /> Approve &amp; send
                </button>
                <button type="button" className="ds-btn ds-btn-ghost ds-btn-sm">
                  <Pencil size={14} /> Edit
                </button>
              </div>
            </div>
            <div className="ds-ai-note">
              <Check size={14} /> You approve every client-facing action — nothing
              is sent without you.
            </div>
          </section>

          <section className="ds-card ds-card-pad">
            <div className="ds-section-head">
              <div>
                <h2>Pipeline</h2>
                <p>Active projects by stage</p>
              </div>
              <span className="ds-badge ds-badge-forest">
                <span className="ds-dot" /> Live
              </span>
            </div>
            <div className="ds-pipe">
              {pipeline.map((p) => (
                <div className="ds-pipe-row" key={p.label}>
                  <span>{p.label}</span>
                  <span className="ds-pipe-track">
                    <span
                      className="ds-pipe-fill"
                      style={{ width: `${(p.value / pipelineMax) * 100}%` }}
                    />
                  </span>
                  <strong>{p.value}</strong>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>

      <ThemeSwitcher initial="emerald" />
    </PreviewShell>
  );
}
