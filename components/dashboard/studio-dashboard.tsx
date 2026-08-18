"use client";

import Link from "next/link";
import {
  Activity,
  ArrowRight,
  CalendarCheck2,
  CircleAlert,
  CircleCheck,
  ContactRound,
  Pencil,
  ReceiptText,
  ShieldCheck,
  Sparkles,
  Wallet,
} from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { SetupChecklist } from "@/components/dashboard/setup-checklist";
import {
  LiveUpcomingRows,
  useTenantDocuments,
} from "@/components/live/tenant-records";
import { useWorkspace } from "@/features/auth/workspace-context";
import { dailyCommandProjection } from "@/features/dashboard/daily-command-center";
import { activeProjectStates } from "@/features/dashboard/active-states";
import {
  describeStudioState,
  greetingFor,
  homeMetrics,
} from "@/features/dashboard/home-metrics";
import {
  omittedKinds,
  rankByUrgency,
  rankWithRepresentation,
  type RankableItem,
  type UrgencyKind,
} from "@/features/dashboard/urgency";
import { formatCents } from "@/lib/format/money";
import {
  describeEventProximity,
  eventDateHasPassed,
  formatEventDate,
} from "@/lib/format/event-date";

const text = (value: unknown): string => (typeof value === "string" ? value : "");

function firstName(value: string) {
  return value.trim().split(/\s+/)[0] || "there";
}

function readable(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/** Days since an ISO timestamp, for "waiting 3 days" copy. */
function daysWaiting(value: unknown): number | null {
  const parsed = Date.parse(text(value));
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.floor((Date.now() - parsed) / 86_400_000));
}

const kindIcon: Record<UrgencyKind, typeof CircleAlert> = {
  exception: CircleAlert,
  approval: Sparkles,
  inquiry: ContactRound,
};

/**
 * Everything the home page needs, read once.
 *
 * These hooks share a module-level cache with in-flight dedupe, so listing a
 * collection here more than once across components costs one request.
 */
function useHomeData() {
  const workspace = useWorkspace();
  const ownerOperations = ["studio_owner", "studio_admin"].includes(
    workspace.role ?? "",
  );
  const projects = useTenantDocuments("projects");
  const leads = useTenantDocuments("leads");
  const tasks = useTenantDocuments("tasks");
  const aiActions = useTenantDocuments("aiActions");
  const automationApprovals = useTenantDocuments("automationApprovals", {
    enabled: ownerOperations,
  });
  const communicationDrafts = useTenantDocuments("communicationDrafts");
  const deliveryDrafts = useTenantDocuments("deliveryDrafts");
  const proposals = useTenantDocuments("proposals");
  const automationRuns = useTenantDocuments("automationRuns", {
    enabled: ownerOperations,
  });
  const providerJobs = useTenantDocuments("providerJobs", {
    enabled: ownerOperations,
  });
  const emailJobs = useTenantDocuments("emailJobs");
  const integrationConnections = useTenantDocuments("integrationConnections", {
    enabled: ownerOperations,
  });
  const bookingOrchestrations = useTenantDocuments("bookingOrchestrations");
  const crewCascades = useTenantDocuments("crewCascades");
  const invoiceReferences = useTenantDocuments("invoiceReferences");

  const now = new Date();
  const projection = dailyCommandProjection({
    now: now.toISOString(),
    projects: projects.records,
    tasks: tasks.records,
    aiActions: aiActions.records,
    automationApprovals: automationApprovals.records,
    communicationDrafts: communicationDrafts.records,
    deliveryDrafts: deliveryDrafts.records,
    proposals: proposals.records,
    automationRuns: automationRuns.records,
    providerJobs: providerJobs.records,
    emailJobs: emailJobs.records,
    integrationConnections: integrationConnections.records,
    bookingOrchestrations: bookingOrchestrations.records,
    crewCascades: crewCascades.records,
    invoiceReferences: invoiceReferences.records,
  });

  const projectsById = new Map(
    (projects.records ?? []).map((project) => [project.id, project]),
  );
  const eventDateFor = (href: string): string | null => {
    const match = /\/studio\/projects\/([^/?#]+)/.exec(href);
    const project = match ? projectsById.get(match[1]) : undefined;
    return project ? text(project.eventDate) : null;
  };

  const inquiries: RankableItem[] = (leads.records ?? [])
    .filter(
      (lead) =>
        !["converted", "lost", "archived"].includes(text(lead.status).toLowerCase()),
    )
    .map((lead) => {
      const waited = daysWaiting(lead.createdAt);
      const facts = [
        text(lead.eventType),
        text(lead.eventDate) ? formatEventDate(lead.eventDate, now) : "",
        text(lead.referralSource) ? `via ${text(lead.referralSource)}` : "",
        waited === null
          ? ""
          : waited === 0
            ? "arrived today"
            : `waiting ${waited} day${waited === 1 ? "" : "s"}`,
      ].filter(Boolean);
      return {
        id: `lead-${lead.id}`,
        kind: "inquiry" as const,
        title:
          text(lead.displayName) || text(lead.name) || text(lead.email) || "New inquiry",
        detail: facts.join(" · "),
        href: `/studio/leads/${lead.id}`,
        eventDate: text(lead.eventDate) || null,
        updatedAt: text(lead.createdAt) || null,
      };
    });

  const approvals: RankableItem[] = projection.approvals.map((entry) => ({
    id: entry.id,
    kind: "approval" as const,
    title: entry.title,
    detail: entry.detail,
    href: entry.href,
    eventDate: eventDateFor(entry.href),
    updatedAt: entry.updatedAt || null,
  }));

  const exceptions: RankableItem[] = projection.exceptions.map((entry) => ({
    id: entry.id,
    kind: "exception" as const,
    title: entry.title,
    detail: entry.detail,
    href: entry.href,
    eventDate: eventDateFor(entry.href),
    updatedAt: entry.updatedAt || null,
  }));

  const metrics = homeMetrics({
    now,
    projects: projects.records,
    invoiceReferences: invoiceReferences.records,
  });

  return {
    now,
    ownerOperations,
    projects,
    projection,
    metrics,
    rankable: [...exceptions, ...approvals, ...inquiries],
    loading: projects.loading || leads.loading,
  };
}

/** The four figures the page leads with, all from data already fetched. */
function HomeMetricStrip({
  metrics,
  loading,
  handledCount,
}: {
  metrics: ReturnType<typeof homeMetrics>;
  loading: boolean;
  handledCount: number;
}) {
  const dash = "—";
  const tiles = [
    {
      label: "Events this month",
      value: loading ? dash : String(metrics.eventsThisMonth),
      note: metrics.nextEvent
        ? `Next: ${metrics.nextEvent.name}, ${formatEventDate(metrics.nextEvent.eventDate)}`
        : "Nothing scheduled",
      icon: CalendarCheck2,
      warn: false,
    },
    {
      label: "Booked value",
      value: loading ? dash : formatCents(metrics.bookedValueCents),
      note: `${formatCents(metrics.collectedCents)} collected`,
      icon: Wallet,
      warn: false,
    },
    {
      label: "Outstanding",
      value: loading ? dash : formatCents(metrics.outstandingCents),
      note:
        metrics.overdueInvoiceCount > 0
          ? `${metrics.overdueInvoiceCount} overdue`
          : "None overdue",
      icon: ReceiptText,
      warn: metrics.overdueInvoiceCount > 0,
    },
    {
      label: "Handled for you",
      value: loading ? dash : String(handledCount),
      note: "Running without your input",
      icon: Activity,
      warn: false,
    },
  ];
  return (
    <section className="ds-stat-row" aria-label="Studio at a glance">
      {tiles.map((tile) => {
        const Icon = tile.icon;
        return (
          <article className="ds-stat" key={tile.label}>
            <div className="ds-stat-top">
              <span className="ds-stat-label">{tile.label}</span>
              <span className={`ds-stat-chip${tile.warn ? " is-warn" : ""}`}>
                <Icon size={15} />
              </span>
            </div>
            <strong className="ds-stat-value">{tile.value}</strong>
            <small className="ds-stat-note">{tile.note}</small>
          </article>
        );
      })}
    </section>
  );
}

/**
 * The top AI-prepared item, rendered as something approvable rather than a
 * link. This is the DraftCard pattern the rest of the product reuses.
 */
function PreparedByStudioCue({
  approvals,
}: {
  approvals: ReturnType<typeof dailyCommandProjection>["approvals"];
}) {
  const top = approvals[0];
  if (!top) return null;
  const remaining = approvals.length - 1;
  // DOM shape follows the design system's AI card: ds-ai-badge holds the icon
  // only, the label sits beside it, and the actions nest inside ds-ai-draft.
  return (
    <section className="ds-card ds-ai" aria-label="Prepared by StudioCue">
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
        <span>{top.detail}</span>
        <h4>{top.title}</h4>
        <div className="ds-ai-actions">
          <Link className="ds-btn ds-btn-primary ds-btn-sm" href={top.href}>
            <CircleCheck size={15} /> Review and approve
          </Link>
          <Link className="ds-btn ds-btn-ghost ds-btn-sm" href="/studio/ai-queue">
            <Pencil size={14} /> See all
          </Link>
        </div>
      </div>
      <p className="ds-ai-note">
        <ShieldCheck size={13} />{" "}
        {remaining > 0
          ? `${remaining} more waiting. You approve every client-facing action.`
          : "You approve every client-facing action — nothing is sent without you."}
      </p>
    </section>
  );
}

/**
 * What the platform is doing right now.
 *
 * This renders `projection.working`, which the engine has always computed and
 * nothing displayed — the clearest evidence the product does work on the
 * studio's behalf.
 */
function StudioCueIsHandling({
  working,
  loading,
}: {
  working: ReturnType<typeof dailyCommandProjection>["working"];
  loading: boolean;
}) {
  return (
    <section className="panel studio-handling" aria-label="StudioCue is handling">
      <div className="ds-section-head">
        <div>
          <p className="ds-eyebrow">Running now</p>
          <h2>StudioCue is handling</h2>
        </div>
        <Link className="ds-seehead-link" href="/studio/ai-queue">
          Activity <ArrowRight size={14} />
        </Link>
      </div>
      {working.length ? (
        <ul className="studio-handling-list">
          {working.slice(0, 5).map((entry) => (
            <li key={entry.id}>
              <span className="studio-handling-dot" aria-hidden="true" />
              <Link href={entry.href}>
                <strong>{entry.title}</strong>
                <small>{entry.detail}</small>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="ds-empty">
          {loading
            ? "Checking what is in flight…"
            : "Nothing is running right now. Approved work will appear here while it completes."}
        </p>
      )}
      <p className="studio-handling-note">
        <ShieldCheck size={13} /> None of this changes status without your approval.
      </p>
    </section>
  );
}

/** One urgency-ranked list across exceptions, approvals and inquiries. */
function AttentionQueue({
  rankable,
  now,
  loading,
}: {
  rankable: RankableItem[];
  now: Date;
  loading: boolean;
}) {
  const limit = 5;
  const shown = rankWithRepresentation(rankable, { now, limit });
  const omitted = omittedKinds(rankable, shown);
  const hiddenCount = rankable.length - shown.length;

  return (
    <section className="panel studio-attention-queue" aria-label="Attention queue">
      <div className="ds-section-head">
        <div>
          <p className="ds-eyebrow">Needs you</p>
          <h2>Ranked by what it costs to wait</h2>
        </div>
        {hiddenCount > 0 ? (
          <Link className="ds-seehead-link" href="/studio/ai-queue">
            {hiddenCount} more <ArrowRight size={14} />
          </Link>
        ) : null}
      </div>
      {shown.length ? (
        <div className="studio-attention-list">
          {shown.map((item) => {
            const Icon = kindIcon[item.kind];
            return (
              <Link href={item.href} key={item.id}>
                <span className={`studio-attention-icon is-${item.kind}`}>
                  <Icon size={17} />
                </span>
                <span>
                  <small>{readable(item.kind)}</small>
                  <strong>{item.title}</strong>
                  <em>{item.detail}</em>
                </span>
                <ArrowRight size={15} />
              </Link>
            );
          })}
        </div>
      ) : (
        <p className="ds-empty">
          {loading ? (
            "Gathering work that needs your attention…"
          ) : (
            <>
              <CircleCheck size={16} /> You are caught up. Nothing needs a decision
              right now.
            </>
          )}
        </p>
      )}
      {omitted.length ? (
        <p className="studio-attention-omitted">
          Also waiting: {omitted.map(readable).join(", ").toLowerCase()}.
        </p>
      ) : null}
    </section>
  );
}

function DashboardSummary() {
  const workspace = useWorkspace();
  const home = useHomeData();
  const { metrics, projection, rankable, now } = home;

  const greetingName =
    workspace.userName === workspace.tenantName
      ? ""
      : `, ${firstName(workspace.userName)}`;
  const subhead = describeStudioState({
    metrics,
    approvalCount: projection.approvals.length,
    workingCount: projection.working.length,
  });

  // The hero's one decision is the most urgent thing overall, so the hero and
  // the queue can never disagree about what matters most.
  const top = rankByUrgency(rankable, { now, limit: 1 })[0];
  const active = (home.projects.records ?? []).filter((project) =>
    activeProjectStates.has(text(project.state)),
  );
  const slipped = active.find((project) =>
    eventDateHasPassed(project.eventDate, now),
  );

  return (
    <>
      <section className="studio-focus-hero">
        <div className="studio-focus-copy">
          <p className="studio-command-kicker">
            <Sparkles size={14} /> {greetingFor(now)}
            {greetingName}
          </p>
          {home.loading ? (
            <h1>Gathering today…</h1>
          ) : top ? (
            <>
              <h1>{top.title}</h1>
              {top.detail ? (
                <span className="studio-focus-project">{top.detail}</span>
              ) : null}
              {subhead ? <p>{subhead}</p> : null}
              <Link className="studio-focus-cta" href={top.href}>
                Review and decide <ArrowRight size={14} />
              </Link>
            </>
          ) : (
            <>
              <h1>You are caught up.</h1>
              <p>
                {subhead ??
                  "Nothing needs a decision right now. New work will appear here as it arrives."}
              </p>
            </>
          )}
        </div>
      </section>

      {slipped ? (
        <section className="studio-slipped-alert" aria-label="Event date passed">
          <CircleAlert size={18} />
          <span>
            <strong>
              {text(slipped.name)}&rsquo;s event was{" "}
              {describeEventProximity(slipped.eventDate, now)}
            </strong>
            <small>
              The project is still in {readable(text(slipped.state).toLowerCase())} at{" "}
              {Number(slipped.readinessScore ?? 0)}% ready. It needs a decision, not
              more time.
            </small>
          </span>
          <Link href={`/studio/projects/${text(slipped.id)}`}>
            Open project <ArrowRight size={14} />
          </Link>
        </section>
      ) : null}

      <HomeMetricStrip
        handledCount={projection.working.length}
        loading={home.loading}
        metrics={metrics}
      />

      {workspace.role !== "staff_photographer" ? (
        <div className="studio-home-grid">
          <AttentionQueue loading={home.loading} now={now} rankable={rankable} />
          <div className="studio-home-side">
            <PreparedByStudioCue approvals={projection.approvals} />
            <StudioCueIsHandling
              loading={home.loading}
              working={projection.working}
            />
          </div>
        </div>
      ) : null}

      <SetupChecklist />

      <section className="panel projects-panel studio-projects-summary">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Your work</p>
            <h2>Projects needing attention</h2>
            <p>The three least-ready active projects, with the next decision for each.</p>
          </div>
          <Link href="/studio/projects">
            View all projects <ArrowRight size={14} />
          </Link>
        </div>
        <div className="project-table" role="table" aria-label="Upcoming projects">
          <div className="project-table-head" role="row">
            <span role="columnheader">Project</span>
            <span role="columnheader">Date</span>
            <span role="columnheader">Stage</span>
            <span role="columnheader">Readiness</span>
            <span role="columnheader">Next decision</span>
          </div>
          <LiveUpcomingRows limit={3} />
        </div>
      </section>
    </>
  );
}

export function StudioDashboard() {
  return (
    <AppShell>
      <DashboardSummary />
    </AppShell>
  );
}
