"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { collection, documentId, limit, orderBy, query, where } from "firebase/firestore";
import type { ColumnDef } from "@tanstack/react-table";
import { Check, ChevronLeft, ChevronRight, Circle, ExternalLink, Pin, RefreshCw } from "lucide-react";
import {
  LIFECYCLE_LABELS,
  LIFECYCLE_TONES,
  ROLE_LABELS,
  SETUP_KEYS,
  SETUP_LABELS,
  type ConsolePerson,
  type ConsoleStudio,
} from "@/features/console/model";
import { TIMELINE_KIND_LABELS, TIMELINE_KIND_TONES, buildTimeline } from "@/features/console/timeline";
import { explainJobError } from "@/features/console/job-errors";
import { dateTime, humanize, money, percentOf, relative, shortDate } from "@/lib/console/format";
import { useLiveDoc, useLiveQuery } from "@/lib/console/live";
import { useJobs } from "@/lib/console/jobs";
import { billingMomentText, personHref, planLabel, stripeCustomerUrl, stripeSubscriptionUrl, studioHref, subscriptionBadge } from "@/lib/console/studio-display";
import { useConsole } from "../console-context";
import { Topbar } from "../console-frame";
import { EmailStudioDialog, TagsDialog, TaskDialog } from "../crm-dialogs";
import { DataTable } from "../data-table";
import { ActionMenu, type MenuItem } from "../menu";
import { ConfirmDialog, Dialog } from "../overlay";
import { Avatar, Button, CopyId, Empty, Health, KV, NameCell, Notice, Panel, Pill, Spinner, Tabs, Tag, UsageBar, When } from "../ui";
import { useCommand } from "../use-command";
import { BillingDialogs, useBillingDialogs } from "../billing-dialogs";
import { NotesPanel } from "../notes";
import { TasksList, type ConsoleTask } from "../tasks";

/** One studio, everything about it (docs/console.md, "Studio record"). */

const TABS = ["overview", "timeline", "team", "billing", "usage", "integrations", "feedback", "jobs", "notes", "audit"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABELS: Record<Tab, string> = {
  overview: "Overview",
  timeline: "Timeline",
  team: "Team",
  billing: "Billing",
  usage: "Usage",
  integrations: "Integrations",
  feedback: "Feedback",
  jobs: "Jobs",
  notes: "Notes",
  audit: "Audit",
};

type Raw = Record<string, unknown> & { id: string };

export function StudioRecord({ tenantId }: { tenantId: string }) {
  const { studios, can } = useConsole();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tab = (TABS.includes(params.get("tab") as Tab) ? params.get("tab") : "overview") as Tab;
  const summary = useLiveDoc<ConsoleStudio>(`consoleStudios/${tenantId}`);
  const tenant = useLiveDoc<Raw>(`tenants/${tenantId}`);
  const studio = summary.data;
  const [dialog, setDialog] = useState<null | "email" | "task" | "tags" | "suspend" | "unsuspend" | "support">(null);
  const { run, busy } = useCommand();
  const billing = useBillingDialogs();

  const jobs = useJobs("failed");
  const studioJobs = (jobs.rows ?? []).filter((job) => job.tenantId === tenantId);
  const tasks = useLiveQuery<ConsoleTask>(`tasks:studio:${tenantId}`, (firestore) =>
    query(collection(firestore, "consoleTasks"), where("subjectKey", "==", `studio:${tenantId}`), orderBy("createdAt", "desc"), limit(100)),
  );
  const notes = useLiveQuery<Raw>(`notes:studio:${tenantId}`, (firestore) =>
    query(collection(firestore, "consoleNotes"), where("subjectKey", "==", `studio:${tenantId}`), orderBy("createdAt", "desc"), limit(200)),
  );

  // Previous / next within the list as it's sorted by default.
  const ordered = useMemo(
    () => (studios.rows ?? []).filter((item) => item.lifecycle !== "churned").sort((a, b) => a.name.localeCompare(b.name)),
    [studios.rows],
  );
  const position = ordered.findIndex((item) => item.tenantId === tenantId);
  const previous = position > 0 ? ordered[position - 1] : null;
  const next = position >= 0 && position < ordered.length - 1 ? ordered[position + 1] : null;

  const setTab = (nextTab: Tab) => {
    const query = new URLSearchParams(params.toString());
    if (nextTab === "overview") query.delete("tab");
    else query.set("tab", nextTab);
    router.replace(`${pathname}${query.size ? `?${query}` : ""}`, { scroll: false });
  };

  if (summary.loading || tenant.loading) {
    return (
      <>
        <Topbar crumbs={[{ label: "Studios", href: "/platform-admin/studios" }, { label: "Loading…" }]} />
        <div className="cx-centered">
          <Spinner />
        </div>
      </>
    );
  }

  if (!tenant.data) {
    return (
      <>
        <Topbar crumbs={[{ label: "Studios", href: "/platform-admin/studios" }, { label: "Not found" }]} />
        <div className="cx-content">
          <Empty action={<Link className="cx-btn" href="/platform-admin/studios">Back to studios</Link>} title="There's no studio with that id">
            It may have been deleted. The id was <span className="cx-mono">{tenantId}</span>.
          </Empty>
        </div>
      </>
    );
  }

  if (!studio) {
    return (
      <>
        <Topbar crumbs={[{ label: "Studios", href: "/platform-admin/studios" }, { label: String(tenant.data.brandName ?? tenant.data.businessName ?? tenantId) }]} />
        <div className="cx-content">
          <Empty
            action={
              <Button busy={busy === "refreshStudio"} onClick={() => void run("refreshStudio", { tenantId }, { done: "Studio row built." })} variant="primary">
                Build this studio&apos;s row
              </Button>
            }
            title="This studio's summary hasn't been built yet"
          >
            Rows are built every 15 minutes. Build it now to see the record.
          </Empty>
        </div>
      </>
    );
  }

  const badge = subscriptionBadge(studio.subscriptionStatus, studio.comped);
  const moment = billingMomentText(studio.billingMoment);
  const openTasks = (tasks.rows ?? []).filter((task) => task.status === "open");
  const liveNotes = (notes.rows ?? []).filter((note) => !note.archivedAt);
  const pinned = liveNotes.filter((note) => note.pinned === true);

  const moreItems: MenuItem[] = [
    ...(can("crm.write") ? [{ label: "Tags…", onSelect: () => setDialog("tags") }] : []),
    ...billing.menuItems(studio),
    { kind: "separator" },
    ...(can("support.session") ? [{ label: "Start support session…", onSelect: () => setDialog("support") }] : []),
    ...(can("features.write") ? [{ label: "Feature access", onSelect: () => router.push(`/platform-admin/features?studio=${encodeURIComponent(tenantId)}`) }] : []),
    { label: "Refresh this row", onSelect: () => void run("refreshStudio", { tenantId }, { done: "Studio row refreshed." }) },
    ...(can("studios.suspend")
      ? [
          { kind: "separator" as const },
          studio.suspended
            ? { label: "Unsuspend studio…", onSelect: () => setDialog("unsuspend") }
            : { label: "Suspend studio…", hint: "type name", danger: true, onSelect: () => setDialog("suspend") },
        ]
      : []),
  ];

  const sideRail = (
    <aside className="cx-stack">
      <Panel actions={<Health band={studio.health.band} score={studio.health.score} />} title="Health">
        {studio.health.reasons.length ? (
          <ul className="cx-reasons">
            {studio.health.reasons.map((reason) => (
              <li key={reason.key}>
                {reason.label} (−{reason.points})
              </li>
            ))}
          </ul>
        ) : (
          <span className="cx-hint">{studio.health.band === "none" ? "Not scored while there's no live subscription." : "Nothing is pulling the score down."}</span>
        )}
      </Panel>
      <Panel actions={<button className="cx-link" onClick={() => setTab("billing")} type="button">Billing</button>} title="Subscription">
        <KV
          items={[
            ["Plan", <b key="p">{planLabel(studio.plan, studio.cadence)}</b>],
            ["Status", <Pill key="s" tone={badge.tone}>{badge.label}</Pill>],
            ["MRR", studio.mrrCents ? money(studio.mrrCents, { cents: true }) : <span className="cx-dim" key="m">{mrrNote(studio)}</span>],
            ["Next", moment.text],
            ["Discount", studio.discount ? <span key="d">{studio.discount.code ? <Tag code>{studio.discount.code}</Tag> : null} {discountText(studio)}</span> : <span className="cx-dim" key="d">None</span>],
            studio.comped ? ["Comp", studio.compEndsAt ? `until ${shortDate(studio.compEndsAt)}` : "no end date"] : null,
            ["Customer", studio.stripeCustomerId ? <a className="cx-link" href={stripeCustomerUrl(studio.stripeCustomerId)!} key="c" rel="noreferrer" target="_blank">{studio.stripeCustomerId} ↗</a> : <span className="cx-dim" key="c">No Stripe customer</span>],
          ]}
        />
      </Panel>
      <Panel title="Usage this month">
        <KV
          items={[
            ["AI actions", <span key="a">{studio.aiActionsMonth.toLocaleString()} / {studio.aiActionsLimit?.toLocaleString() ?? "—"}<UsageBar limit={studio.aiActionsLimit} value={studio.aiActionsMonth} /></span>],
            ["Seats", <span key="s">{studio.seats.internal} / {studio.seats.max ?? "—"}<UsageBar limit={studio.seats.max} value={studio.seats.internal} /></span>],
            ["Client emails", `${studio.emails30d} in 30 days${studio.emailsFailed30d ? ` · ${studio.emailsFailed30d} failed` : ""}`],
            ["Active jobs", String(studio.jobs.active)],
          ]}
        />
      </Panel>
      <Panel actions={can("crm.write") ? <button className="cx-link" onClick={() => setDialog("task")} type="button">+ Add</button> : null} flush title="Tasks">
        <TasksList empty="No open tasks." tasks={openTasks} />
      </Panel>
    </aside>
  );

  return (
    <>
      <Topbar crumbs={[{ label: "Studios", href: "/platform-admin/studios" }, { label: studio.name }]}>
        {position >= 0 ? <span className="cx-hint">{position + 1} of {ordered.length}</span> : null}
        <Button aria-label="Previous studio" disabled={!previous} icon onClick={() => previous && router.push(studioHref(previous.tenantId, tab === "overview" ? undefined : tab))} variant="ghost">
          <ChevronLeft size={15} />
        </Button>
        <Button aria-label="Next studio" disabled={!next} icon onClick={() => next && router.push(studioHref(next.tenantId, tab === "overview" ? undefined : tab))} variant="ghost">
          <ChevronRight size={15} />
        </Button>
      </Topbar>

      <header className="cx-record-head">
        <Avatar large name={studio.name} />
        <div className="cx-record-heading">
          <h1 className="cx-record-title">
            {studio.name}
            {studio.suspended ? <Pill tone="bad">Suspended</Pill> : <Pill tone={badge.tone}>{badge.label}</Pill>}
            <Pill tone={LIFECYCLE_TONES[studio.lifecycle]}>{LIFECYCLE_LABELS[studio.lifecycle]}</Pill>
            <Pill dot={false}>{planLabel(studio.plan, studio.cadence)}</Pill>
            {(studio.tags ?? []).map((tag) => (
              <Tag key={tag}>{tag}</Tag>
            ))}
          </h1>
          <div className="cx-record-meta">
            <span>
              Owner{" "}
              {studio.ownerUid ? (
                <Link className="cx-link" href={personHref(studio.ownerUid)}>
                  {studio.ownerName ?? studio.ownerEmail ?? "unknown"}
                </Link>
              ) : (
                "unknown"
              )}
              {studio.ownerEmail && studio.ownerName ? ` · ${studio.ownerEmail}` : ""}
            </span>
            {studio.timezone ? <span>{studio.timezone}</span> : null}
            {studio.createdAt ? <span>Signed up {shortDate(studio.createdAt)}</span> : null}
            {studio.slug ? <span>/{studio.slug}</span> : null}
            <CopyId label="studio id" value={tenantId} />
          </div>
        </div>
        <div className="cx-record-actions">
          {can("crm.write") ? (
            <>
              <Button disabled={!studio.ownerEmail} onClick={() => setDialog("email")}>
                Email owner
              </Button>
              <Button onClick={() => setDialog("task")}>Add task</Button>
            </>
          ) : null}
          {can("billing.write") && studio.subscriptionStatus === "past_due" && studio.ownerEmail ? (
            <Button onClick={() => billing.open("card", [studio])}>Send card-update link</Button>
          ) : null}
          <ActionMenu items={moreItems} label="More" />
        </div>
      </header>

      <div className="cx-record-tabs">
        <Tabs
          label="Studio sections"
          onChange={setTab}
          tabs={TABS.map((key) => ({
            key,
            label: TAB_LABELS[key],
            count:
              key === "team"
                ? studio.seats.internal + studio.seats.crew
                : key === "integrations"
                  ? studio.integrations.length || null
                  : key === "feedback"
                    ? studio.openFeedback || null
                    : key === "jobs"
                      ? studioJobs.filter((job) => !job.dismissedAt).length || null
                      : key === "notes"
                        ? liveNotes.length || null
                        : null,
          }))}
          value={tab}
        />
      </div>

      {studio.suspended ? (
        <div className="cx-content" style={{ paddingBottom: 0 }}>
          <Notice title="This studio is suspended" tone="bad">
            {`${studio.suspensionReason ?? "No reason recorded."} Their studio app is locked; couples and crew can still use their portals.`}
          </Notice>
        </div>
      ) : null}

      {tab === "overview" ? (
        <div className="cx-record-body">
          <div className="cx-stack">
            {pinned.length ? (
              <Panel flush title="Pinned notes">
                <div className="cx-timeline">
                  {pinned.map((note) => (
                    <div className="cx-tl-row" data-kind="note" key={note.id}>
                      <span className="cx-tl-time">{shortDate(String(note.createdAt))}</span>
                      <span><Pin size={13} /></span>
                      <div className="cx-tl-body">
                        <span className="cx-message-text">{String(note.body)}</span>
                        <small>{String(note.authorName ?? note.authorEmail ?? "")}</small>
                      </div>
                    </div>
                  ))}
                </div>
              </Panel>
            ) : null}
            <div className="cx-grid-2">
              <Panel title={`Setup · ${studio.setupDone} of 6`}>
                <ul className="cx-checklist">
                  {SETUP_KEYS.map((key) => (
                    <li data-done={studio.setup[key] ? "true" : "false"} key={key}>
                      {studio.setup[key] ? <Check data-done="true" size={14} /> : <Circle data-done="false" size={14} />}
                      {SETUP_LABELS[key]}
                    </li>
                  ))}
                </ul>
              </Panel>
              <Panel title="Activity">
                <KV
                  items={[
                    ["Last active", <When at={studio.lastActiveAt} key="a" />],
                    ["Last sign-in", <When at={studio.lastSignInAt} key="s" />],
                    ["Actions, 30d", `${studio.events30d}${studio.eventsPrior30d ? ` (prior 30d: ${studio.eventsPrior30d})` : ""}`],
                    ["Jobs", `${studio.jobs.total} total · ${studio.jobs.active} active · ${studio.jobs.booked} booked`],
                    ["First job", studio.jobs.firstAt ? shortDate(studio.jobs.firstAt) : "None yet"],
                    ["Team", `${studio.seats.internal} staff · ${studio.seats.crew} crew · ${studio.seats.clients} clients`],
                  ]}
                />
              </Panel>
            </div>
            <StudioTimeline compact tenantId={tenantId} />
          </div>
          {sideRail}
        </div>
      ) : null}

      {tab === "timeline" ? (
        <div className="cx-record-body">
          <div className="cx-stack">
            {can("crm.write") ? <NotesPanel compact subjectKey={`studio:${tenantId}`} title="Add a note" /> : null}
            <StudioTimeline tenantId={tenantId} />
          </div>
          {sideRail}
        </div>
      ) : null}

      {tab === "team" ? <TeamTab tenantId={tenantId} /> : null}
      {tab === "billing" ? <BillingTab billing={billing} studio={studio} /> : null}
      {tab === "usage" ? <UsageTab studio={studio} /> : null}
      {tab === "integrations" ? <IntegrationsTab tenantId={tenantId} /> : null}
      {tab === "feedback" ? <FeedbackTab tenantId={tenantId} /> : null}
      {tab === "jobs" ? (
        <div className="cx-record-body" data-single="true">
          <Panel flush title="Failed jobs">
            {studioJobs.length ? (
              <div className="cx-timeline">
                {studioJobs.map((job) => {
                  const advice = explainJobError(job.errorCode, job.errorMessage);
                  return (
                    <div className="cx-tl-row" key={job.key}>
                      <span className="cx-tl-time">{relative(job.failedAt)}</span>
                      <span>{job.dismissedAt ? <Pill>Dismissed</Pill> : <Pill tone="bad">Failed</Pill>}</span>
                      <div className="cx-tl-body">
                        <b>{humanize(job.type)}</b>
                        <span>{advice.cause} {advice.advice}</span>
                        <small className="cx-mono">{job.errorCode}</small>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <Empty title="No failed jobs">Nothing for this studio is stuck.</Empty>
            )}
          </Panel>
          <Link className="cx-link" href="/platform-admin/jobs">Open Jobs to rerun or dismiss →</Link>
        </div>
      ) : null}
      {tab === "notes" ? (
        <div className="cx-record-body" data-single="true">
          <NotesPanel subjectKey={`studio:${tenantId}`} title="Notes" />
          <Panel actions={can("crm.write") ? <button className="cx-link" onClick={() => setDialog("task")} type="button">+ Add</button> : null} flush title="All tasks">
            <TasksList empty="No tasks for this studio." tasks={tasks.rows ?? []} />
          </Panel>
        </div>
      ) : null}
      {tab === "audit" ? <AuditTab tenantId={tenantId} /> : null}

      <EmailStudioDialog onClose={() => setDialog(null)} open={dialog === "email"} studios={[studio]} />
      <TaskDialog onClose={() => setDialog(null)} open={dialog === "task"} subjectKeys={[`studio:${tenantId}`]} subjectLabel={studio.name} />
      <TagsDialog current={studio.tags ?? []} onClose={() => setDialog(null)} open={dialog === "tags"} tenantIds={[tenantId]} />
      <BillingDialogs state={billing} />
      <ConfirmDialog
        busy={busy === "suspendTenant"}
        confirmLabel="Suspend studio"
        confirmName={studio.name}
        danger
        description={`${studio.name}'s studio app locks immediately and every studio command is refused. Couples and crew can still use their portals. Billing in Stripe is not touched.`}
        onClose={() => setDialog(null)}
        onConfirm={async ({ reason, confirmName }) => {
          const result = await run("suspendTenant", { tenantId, reason, confirmName }, { done: `${studio.name} is suspended.` });
          if (result) setDialog(null);
        }}
        open={dialog === "suspend"}
        title={`Suspend ${studio.name}`}
      />
      <ConfirmDialog
        busy={busy === "unsuspendTenant"}
        confirmLabel="Unsuspend studio"
        description={`${studio.name}'s studio app opens again straight away.`}
        onClose={() => setDialog(null)}
        onConfirm={async ({ reason }) => {
          const result = await run("unsuspendTenant", { tenantId, reason }, { done: `${studio.name} is unsuspended.` });
          if (result) setDialog(null);
        }}
        open={dialog === "unsuspend"}
        title={`Unsuspend ${studio.name}`}
      />
      <SupportSessionDialog onClose={() => setDialog(null)} open={dialog === "support"} studio={studio} />
    </>
  );
}

/** Why a studio contributes nothing to MRR, said plainly. */
function mrrNote(studio: ConsoleStudio): string {
  if (studio.comped) return "Comped";
  if (studio.subscriptionStatus === "trialing") return studio.potentialMrrCents ? `${money(studio.potentialMrrCents)} if they convert` : "Trial";
  if (studio.subscriptionStatus === "past_due" || studio.subscriptionStatus === "paused") return "Not counted while past due";
  return "—";
}

export function discountText(studio: Pick<ConsoleStudio, "discount">): string {
  const discount = studio.discount;
  if (!discount) return "";
  const amount = discount.percentOff ? `${discount.percentOff}% off` : discount.amountOffCents ? `${money(discount.amountOffCents, { cents: true })} off` : "Discount";
  const span = discount.duration === "forever" ? "forever" : discount.duration === "repeating" ? `for ${discount.durationMonths ?? "?"} months` : "once";
  return `${amount} ${span}${discount.endsAt ? ` · ends ${shortDate(discount.endsAt)}` : ""}`;
}

function StudioTimeline({ tenantId, compact = false }: { tenantId: string; compact?: boolean }) {
  const [filter, setFilter] = useState<string>("all");
  const size = compact ? 25 : 150;
  const audit = useLiveQuery<Raw>(`tl:audit:${tenantId}:${size}`, (firestore) =>
    query(collection(firestore, "auditEvents"), where("tenantId", "==", tenantId), orderBy("timestamp", "desc"), limit(size)),
  );
  const product = useLiveQuery<Raw>(`tl:product:${tenantId}:${size}`, (firestore) =>
    query(collection(firestore, "productEvents"), where("tenantId", "==", tenantId), orderBy("occurredAt", "desc"), limit(compact ? 15 : 80)),
  );
  const feedback = useLiveQuery<Raw>(`tl:feedback:${tenantId}`, (firestore) =>
    query(collection(firestore, "feedback"), where("tenantId", "==", tenantId), orderBy("createdAt", "desc"), limit(50)),
  );
  const invoices = useLiveQuery<Raw>(`tl:invoices:${tenantId}`, (firestore) =>
    query(collection(firestore, "saasInvoices"), where("tenantId", "==", tenantId), orderBy("createdAt", "desc"), limit(36)),
  );
  const notes = useLiveQuery<Raw>(`notes:studio:${tenantId}`, (firestore) =>
    query(collection(firestore, "consoleNotes"), where("subjectKey", "==", `studio:${tenantId}`), orderBy("createdAt", "desc"), limit(200)),
  );
  const tasks = useLiveQuery<Raw>(`tasks:studio:${tenantId}`, (firestore) =>
    query(collection(firestore, "consoleTasks"), where("subjectKey", "==", `studio:${tenantId}`), orderBy("createdAt", "desc"), limit(100)),
  );
  const loading = [audit, product, feedback, invoices, notes].some((source) => source.rows === null);
  const entries = useMemo(
    () => buildTimeline({ audit: audit.rows, product: product.rows, feedback: feedback.rows, invoices: invoices.rows, notes: notes.rows, tasks: tasks.rows }),
    [audit.rows, product.rows, feedback.rows, invoices.rows, notes.rows, tasks.rows],
  );
  const kinds = ["all", "billing", "email", "feedback", "note", "product", "team"];
  const shown = entries.filter((entry) => filter === "all" || entry.kind === filter || (filter === "product" && entry.kind === "lifecycle")).slice(0, compact ? 10 : 400);
  return (
    <Panel
      actions={
        compact ? null : (
          <span className="cx-inline">
            {kinds.map((kind) => (
              <button className="cx-chip" data-active={filter === kind ? "true" : undefined} key={kind} onClick={() => setFilter(kind)} type="button">
                {kind === "all" ? "All" : TIMELINE_KIND_LABELS[kind as keyof typeof TIMELINE_KIND_LABELS]}
              </button>
            ))}
          </span>
        )
      }
      flush
      title={compact ? "Recent" : "Timeline"}
    >
      {loading ? (
        <div className="cx-empty">
          <Spinner />
        </div>
      ) : shown.length ? (
        <div className="cx-timeline">
          {shown.map((entry) => (
            <div className="cx-tl-row" data-kind={entry.kind === "note" ? "note" : undefined} key={entry.key}>
              <time className="cx-tl-time" dateTime={entry.at} title={dateTime(entry.at)}>
                {relative(entry.at)}
              </time>
              <span>
                <Pill tone={entry.tone ?? TIMELINE_KIND_TONES[entry.kind]}>{TIMELINE_KIND_LABELS[entry.kind]}</Pill>
              </span>
              <div className="cx-tl-body">
                {entry.href ? (
                  entry.href.startsWith("http") ? (
                    <a className="cx-strong" href={entry.href} rel="noreferrer" target="_blank">
                      {entry.title} <ExternalLink size={11} />
                    </a>
                  ) : (
                    <Link className="cx-strong" href={entry.href}>
                      {entry.title}
                    </Link>
                  )
                ) : (
                  <span className={entry.kind === "note" ? "cx-message-text" : "cx-strong"}>{entry.title}</span>
                )}
                {entry.detail ? <small>{entry.detail}</small> : null}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Empty title="Nothing yet">{filter === "all" ? "No history for this studio yet." : "Nothing of this kind."}</Empty>
      )}
    </Panel>
  );
}

type Membership = { id: string; userId?: string; role?: string; status?: string; createdAt?: string };

function TeamTab({ tenantId }: { tenantId: string }) {
  const router = useRouter();
  const memberships = useLiveQuery<Membership>(`team:${tenantId}`, (firestore) => query(collection(firestore, "memberships"), where("tenantId", "==", tenantId)));
  const uids = useMemo(() => [...new Set((memberships.rows ?? []).map((item) => item.userId).filter((uid): uid is string => Boolean(uid)))].slice(0, 30), [memberships.rows]);
  const people = useLiveQuery<ConsolePerson>(uids.length ? `team-people:${uids.join(",")}` : null, (firestore) =>
    query(collection(firestore, "consolePeople"), where(documentId(), "in", uids)),
  );
  const byUid = new Map((people.rows ?? []).map((person) => [person.uid, person]));
  type Row = Membership & { person?: ConsolePerson };
  const rows: Row[] | null = memberships.rows ? memberships.rows.map((item) => ({ ...item, person: byUid.get(item.userId ?? "") })) : null;
  const order = ["studio_owner", "studio_admin", "studio_coordinator", "staff_photographer", "staff_videographer", "subcontractor", "client"];
  const columns: ColumnDef<Row, unknown>[] = [
    {
      id: "person",
      header: "Person",
      accessorFn: (row) => row.person?.name ?? row.person?.email ?? row.userId ?? "",
      meta: { width: 280 },
      cell: ({ row }) => <NameCell name={row.original.person?.name ?? row.original.person?.email ?? "Unknown person"} round sub={row.original.person?.email} />,
    },
    { id: "role", header: "Role", accessorFn: (row) => order.indexOf(row.role ?? ""), meta: { width: 130 }, cell: ({ row }) => ROLE_LABELS[row.original.role ?? ""] ?? row.original.role ?? "—" },
    {
      id: "status",
      header: "Access",
      accessorFn: (row) => row.status ?? "",
      meta: { width: 110 },
      cell: ({ row }) => <Pill tone={row.original.status === "active" ? "ok" : "neutral"}>{row.original.status === "active" ? "Active" : humanize(row.original.status)}</Pill>,
    },
    { id: "verified", header: "Verified", accessorFn: (row) => (row.person?.emailVerified ? 1 : 0), meta: { width: 90 }, cell: ({ row }) => (row.original.person ? (row.original.person.emailVerified ? "Yes" : <span className="cx-strong">No</span>) : "—") },
    { id: "signin", header: "Last sign-in", accessorFn: (row) => row.person?.lastSignInAt ?? "", meta: { width: 120 }, cell: ({ row }) => <When at={row.original.person?.lastSignInAt} /> },
    { id: "active", header: "Last active", accessorFn: (row) => row.person?.lastActiveAt ?? "", meta: { width: 120 }, cell: ({ row }) => <When at={row.original.person?.lastActiveAt} /> },
  ];
  return (
    <div className="cx-record-body" data-single="true">
      <DataTable
        columns={columns}
        empty={<Empty title="No one on this studio" />}
        getRowId={(row) => row.id}
        initialSort={[{ id: "role", desc: false }]}
        label="Team"
        mobile={(row) => ({ title: row.person?.name ?? row.person?.email ?? "Unknown", end: ROLE_LABELS[row.role ?? ""] ?? row.role, meta: [row.person?.email, row.status].filter(Boolean).join(" · ") })}
        onRowClick={(row) => row.userId && router.push(personHref(row.userId))}
        rows={rows}
      />
    </div>
  );
}

function BillingTab({ studio, billing }: { studio: ConsoleStudio; billing: ReturnType<typeof useBillingDialogs> }) {
  const { can } = useConsole();
  const { run, busy } = useCommand();
  const invoices = useLiveQuery<Raw>(`invoices:${studio.tenantId}`, (firestore) =>
    query(collection(firestore, "saasInvoices"), where("tenantId", "==", studio.tenantId), orderBy("createdAt", "desc"), limit(100)),
  );
  const badge = subscriptionBadge(studio.subscriptionStatus, studio.comped);
  const columns: ColumnDef<Raw, unknown>[] = [
    { id: "date", header: "Date", accessorFn: (row) => String(row.createdAt ?? ""), meta: { width: 120 }, cell: ({ row }) => shortDate(String(row.original.createdAt ?? "")) },
    { id: "number", header: "Invoice", accessorFn: (row) => String(row.number ?? row.id), meta: { width: 160 }, cell: ({ row }) => <span className="cx-mono">{String(row.original.number ?? row.original.id)}</span> },
    { id: "reason", header: "For", accessorFn: (row) => String(row.billingReason ?? ""), meta: { width: 160 }, cell: ({ row }) => humanize(String(row.original.billingReason ?? "")) },
    {
      id: "status",
      header: "Status",
      accessorFn: (row) => String(row.status ?? ""),
      meta: { width: 120 },
      cell: ({ row }) => {
        const failed = row.original.lastEvent === "invoice.payment_failed" && row.original.status !== "paid";
        return <Pill tone={row.original.status === "paid" ? "ok" : failed ? "bad" : "neutral"}>{failed ? "Payment failed" : humanize(String(row.original.status ?? ""))}</Pill>;
      },
    },
    { id: "discount", header: "Discount", accessorFn: (row) => Number(row.discountCents ?? 0), meta: { width: 100, align: "right" }, cell: ({ row }) => (Number(row.original.discountCents) ? `−${money(Number(row.original.discountCents), { cents: true })}` : <span className="cx-dim">—</span>) },
    { id: "total", header: "Total", accessorFn: (row) => Number(row.totalCents ?? 0), meta: { width: 100, align: "right" }, cell: ({ row }) => money(Number(row.original.totalCents ?? 0), { cents: true }) },
    {
      id: "link",
      header: "",
      enableSorting: false,
      meta: { width: 60 },
      cell: ({ row }) =>
        typeof row.original.hostedInvoiceUrl === "string" ? (
          <a aria-label="Open invoice in Stripe" className="cx-link" href={row.original.hostedInvoiceUrl} rel="noreferrer" target="_blank">
            <ExternalLink size={13} />
          </a>
        ) : null,
    },
  ];
  return (
    <div className="cx-record-body" data-single="true">
      <div className="cx-grid-2">
        <Panel
          actions={
            can("billing.write") && studio.stripeSubscriptionId ? (
              <Button busy={busy === "syncSubscription"} onClick={() => void run("syncSubscription", { tenantId: studio.tenantId }, { done: "Synced from Stripe." })} size="sm" variant="ghost">
                <RefreshCw size={12} /> Sync from Stripe
              </Button>
            ) : null
          }
          title="Subscription"
        >
          <KV
            items={[
              ["Plan", <b key="p">{planLabel(studio.plan, studio.cadence)}</b>],
              ["Status", <Pill key="s" tone={badge.tone}>{badge.label}</Pill>],
              ["MRR", studio.mrrCents ? money(studio.mrrCents, { cents: true }) : "—"],
              studio.trialEndsAt ? ["Trial ends", shortDate(studio.trialEndsAt)] : null,
              ["Period ends", studio.currentPeriodEnd ? shortDate(studio.currentPeriodEnd) : "—"],
              ["Cancels", studio.cancelAtPeriodEnd ? <span className="cx-strong" key="c">At period end</span> : "No"],
              ["Discount", studio.discount ? discountText(studio) : "None"],
              ["Comp", studio.comped ? `${studio.compEndsAt ? `Until ${shortDate(studio.compEndsAt)}` : "No end date"}${studio.compReason ? ` · “${studio.compReason}”` : ""}` : "No"],
              studio.lastPaymentFailedAt ? ["Payment failed", <span className="cx-strong" key="f">{relative(studio.lastPaymentFailedAt)}</span>] : null,
            ]}
          />
        </Panel>
        <Panel title="Stripe">
          <KV
            items={[
              ["Customer", studio.stripeCustomerId ? <a className="cx-link" href={stripeCustomerUrl(studio.stripeCustomerId)!} key="c" rel="noreferrer" target="_blank">{studio.stripeCustomerId} ↗</a> : "None"],
              ["Subscription", studio.stripeSubscriptionId ? <a className="cx-link" href={stripeSubscriptionUrl(studio.stripeSubscriptionId)!} key="s" rel="noreferrer" target="_blank">{studio.stripeSubscriptionId} ↗</a> : "None"],
            ]}
          />
          {can("billing.write") ? (
            <div className="cx-inline" style={{ flexWrap: "wrap" }}>
              <ActionMenu align="left" items={billing.menuItems(studio)} label="Billing actions" />
            </div>
          ) : null}
          <span className="cx-hint">Cards and payment methods stay in Stripe. StudioCue stores only these references.</span>
        </Panel>
      </div>
      <DataTable
        columns={columns}
        empty={<Empty title="No invoices yet">Invoices appear here as Stripe sends them, from this release onward.</Empty>}
        getRowId={(row) => row.id}
        initialSort={[{ id: "date", desc: true }]}
        label="Invoices"
        mobile={(row) => ({ title: money(Number(row.totalCents ?? 0), { cents: true }), end: humanize(String(row.status ?? "")), meta: `${shortDate(String(row.createdAt ?? ""))} · ${String(row.number ?? "")}` })}
        rows={invoices.rows}
      />
    </div>
  );
}

function UsageTab({ studio }: { studio: ConsoleStudio }) {
  const counters = useLiveQuery<Raw>(`usage:${studio.tenantId}`, (firestore) =>
    query(collection(firestore, "usageCounters"), where("tenantId", "==", studio.tenantId), orderBy("period", "desc"), limit(24)),
  );
  const months = (counters.rows ?? []).filter((row) => typeof row.period === "string" && /^\d{4}-\d{2}$/.test(String(row.period))).slice(0, 12).reverse();
  const max = Math.max(1, ...months.map((row) => Number(row.aiActions ?? 0)));
  return (
    <div className="cx-record-body" data-single="true">
      <div className="cx-grid-3">
        <Panel title="AI actions this month">
          <span className="cx-page-title">{studio.aiActionsMonth.toLocaleString()}</span>
          <UsageBar limit={studio.aiActionsLimit} value={studio.aiActionsMonth} />
          <span className="cx-hint">{percentOf(studio.aiActionsMonth, studio.aiActionsLimit)}% of {studio.aiActionsLimit?.toLocaleString() ?? "—"}</span>
        </Panel>
        <Panel title="Seats">
          <span className="cx-page-title">
            {studio.seats.internal} / {studio.seats.max ?? "—"}
          </span>
          <UsageBar limit={studio.seats.max} value={studio.seats.internal} />
          <span className="cx-hint">{studio.seats.crew} crew · {studio.seats.clients} clients</span>
        </Panel>
        <Panel title="Activity, 30 days">
          <span className="cx-page-title">{studio.events30d}</span>
          <span className="cx-hint">Prior 30 days: {studio.eventsPrior30d}. Client emails: {studio.emails30d}.</span>
        </Panel>
      </div>
      <Panel title="AI actions by month">
        {months.length ? (
          <svg aria-label="AI actions by month" className="cx-chart" role="img" viewBox={`0 0 ${months.length * 48 + 40} 160`}>
            <line className="cx-chart-grid" x1="30" x2={months.length * 48 + 30} y1="130" y2="130" />
            {months.map((row, index) => {
              const value = Number(row.aiActions ?? 0);
              const height = Math.round((value / max) * 100);
              return (
                <g key={String(row.period)}>
                  <rect className="cx-chart-bar" height={height} rx="2" width="28" x={38 + index * 48} y={130 - height} />
                  <text textAnchor="middle" x={52 + index * 48} y="146">{String(row.period).slice(5)}</text>
                  <text textAnchor="middle" x={52 + index * 48} y={124 - height}>{value}</text>
                </g>
              );
            })}
          </svg>
        ) : (
          <Empty title="No usage recorded yet" />
        )}
      </Panel>
      <Panel title="Jobs">
        <KV items={[["Total", String(studio.jobs.total)], ["Active", String(studio.jobs.active)], ["Inquiries", String(studio.jobs.leads)], ["Booked or later", String(studio.jobs.booked)], ["Closed", String(studio.jobs.closed)], ["Most recent", studio.jobs.lastAt ? shortDate(studio.jobs.lastAt) : "—"]]} />
      </Panel>
    </div>
  );
}

function IntegrationsTab({ tenantId }: { tenantId: string }) {
  const rows = useLiveQuery<Raw>(`integrations:${tenantId}`, (firestore) => query(collection(firestore, "integrationConnections"), where("tenantId", "==", tenantId)));
  const columns: ColumnDef<Raw, unknown>[] = [
    { id: "provider", header: "Provider", accessorFn: (row) => String(row.provider ?? ""), meta: { width: 180 }, cell: ({ row }) => <span className="cx-strong">{humanize(String(row.original.provider ?? ""))}</span> },
    { id: "account", header: "Account", accessorFn: (row) => String(row.accountLabel ?? row.providerAccountName ?? row.providerAccountId ?? ""), meta: { width: 220 }, cell: ({ row }) => String(row.original.accountLabel ?? row.original.providerAccountName ?? row.original.providerAccountId ?? "—") },
    {
      id: "status",
      header: "Status",
      accessorFn: (row) => String(row.status ?? ""),
      meta: { width: 120 },
      cell: ({ row }) => <Pill tone={row.original.status === "connected" ? "ok" : row.original.archivedAt ? "neutral" : "bad"}>{row.original.archivedAt ? "Removed" : humanize(String(row.original.status ?? ""))}</Pill>,
    },
    { id: "checked", header: "Checked", accessorFn: (row) => String(row.lastHealthCheckAt ?? ""), meta: { width: 120 }, cell: ({ row }) => <When at={typeof row.original.lastHealthCheckAt === "string" ? row.original.lastHealthCheckAt : null} /> },
    { id: "error", header: "Last error", accessorFn: (row) => String(row.lastError ?? ""), meta: { width: 280 }, cell: ({ row }) => (row.original.lastError ? <span className="cx-mono" title={String(row.original.lastError)}>{String(row.original.lastError)}</span> : <span className="cx-dim">—</span>) },
  ];
  return (
    <div className="cx-record-body" data-single="true">
      <DataTable columns={columns} empty={<Empty title="No integrations connected" />} getRowId={(row) => row.id} label="Integrations" rows={rows.rows} />
    </div>
  );
}

function FeedbackTab({ tenantId }: { tenantId: string }) {
  const router = useRouter();
  const rows = useLiveQuery<Raw>(`feedback:${tenantId}`, (firestore) => query(collection(firestore, "feedback"), where("tenantId", "==", tenantId), orderBy("createdAt", "desc"), limit(100)));
  const columns: ColumnDef<Raw, unknown>[] = [
    { id: "date", header: "Sent", accessorFn: (row) => String(row.createdAt ?? ""), meta: { width: 110 }, cell: ({ row }) => <When at={String(row.original.createdAt ?? "")} /> },
    { id: "kind", header: "Kind", accessorFn: (row) => String(row.kind ?? ""), meta: { width: 110 }, cell: ({ row }) => humanize(String(row.original.kind ?? "")) },
    { id: "message", header: "Message", accessorFn: (row) => String(row.message ?? ""), meta: { width: 380 }, cell: ({ row }) => String(row.original.message ?? "") },
    { id: "from", header: "From", accessorFn: (row) => String(row.userName ?? row.userEmail ?? ""), meta: { width: 160 }, cell: ({ row }) => String(row.original.userName ?? row.original.userEmail ?? "—") },
    { id: "status", header: "Status", accessorFn: (row) => String(row.status ?? ""), meta: { width: 100 }, cell: ({ row }) => <Pill tone={row.original.status === "received" ? "warn" : row.original.status === "shipped" ? "ok" : "neutral"}>{humanize(String(row.original.status ?? ""))}</Pill> },
  ];
  return (
    <div className="cx-record-body" data-single="true">
      <DataTable
        columns={columns}
        empty={<Empty title="No feedback from this studio" />}
        getRowId={(row) => row.id}
        label="Feedback"
        mobile={(row) => ({ title: String(row.message ?? ""), end: humanize(String(row.status ?? "")), meta: `${humanize(String(row.kind ?? ""))} · ${relative(String(row.createdAt ?? ""))}` })}
        onRowClick={(row) => router.push(`/platform-admin/inbox?id=${encodeURIComponent(row.id)}`)}
        rows={rows.rows}
      />
    </div>
  );
}

function AuditTab({ tenantId }: { tenantId: string }) {
  const [open, setOpen] = useState<Raw | null>(null);
  const rows = useLiveQuery<Raw>(`audit:${tenantId}`, (firestore) => query(collection(firestore, "auditEvents"), where("tenantId", "==", tenantId), orderBy("timestamp", "desc"), limit(300)));
  const columns: ColumnDef<Raw, unknown>[] = [
    { id: "time", header: "Time", accessorFn: (row) => String(row.timestamp ?? ""), meta: { width: 150 }, cell: ({ row }) => dateTime(String(row.original.timestamp ?? "")) },
    { id: "actor", header: "Actor", accessorFn: (row) => String(row.actorEmail ?? row.actorType ?? ""), meta: { width: 200 }, cell: ({ row }) => String(row.original.actorEmail ?? humanize(String(row.original.actorType ?? ""))) },
    { id: "action", header: "Action", accessorFn: (row) => String(row.action ?? ""), meta: { width: 240 }, cell: ({ row }) => <span className="cx-mono">{String(row.original.action ?? "")}</span> },
    { id: "entity", header: "Target", accessorFn: (row) => String(row.entityType ?? ""), meta: { width: 200 }, cell: ({ row }) => `${humanize(String(row.original.entityType ?? ""))}` },
    { id: "reason", header: "Reason", accessorFn: (row) => String(row.reason ?? ""), meta: { width: 240 }, cell: ({ row }) => (row.original.reason ? String(row.original.reason) : <span className="cx-dim">—</span>) },
  ];
  return (
    <div className="cx-record-body" data-single="true">
      <DataTable columns={columns} empty={<Empty title="No audit events" />} getRowId={(row) => row.id} label="Audit events" onRowClick={setOpen} rows={rows.rows} />
      <Dialog onClose={() => setOpen(null)} open={Boolean(open)} title={String(open?.action ?? "Audit event")}>
        <pre className="cx-code-block">{JSON.stringify(open, null, 2)}</pre>
      </Dialog>
    </div>
  );
}

function SupportSessionDialog({ open, onClose, studio }: { open: boolean; onClose: () => void; studio: ConsoleStudio }) {
  const { run, busy } = useCommand();
  const router = useRouter();
  const [minutes, setMinutes] = useState(30);
  return (
    <ConfirmDialog
      busy={busy === "grantSupportAccess"}
      confirmLabel={`Start ${minutes}-minute session`}
      description={`Opens a read-only support summary of ${studio.name}: subscription, integrations and failed jobs. It expires on its own, every view is audited, and it never signs you in as them.`}
      onClose={onClose}
      onConfirm={async ({ reason }) => {
        const result = await run<{ supportAccessId: string }>("grantSupportAccess", { tenantId: studio.tenantId, reason, durationMinutes: minutes }, { done: "Support session started." });
        if (result) {
          onClose();
          router.push(`/platform-admin/support?session=${encodeURIComponent(result.supportAccessId)}`);
        }
      }}
      open={open}
      reasonLabel="What did the studio report?"
      title={`Support session for ${studio.name}`}
    >
      <div className="cx-field">
        <span className="cx-label">Length</span>
        <div className="cx-segmented">
          {[15, 30, 60].map((value) => (
            <button aria-pressed={minutes === value} key={value} onClick={() => setMinutes(value)} type="button">
              {`${value} min`}
            </button>
          ))}
        </div>
      </div>
    </ConfirmDialog>
  );
}

