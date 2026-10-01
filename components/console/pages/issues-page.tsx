"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { collection, limit, limitToLast, orderBy, query, where } from "firebase/firestore";
import type { ColumnDef } from "@tanstack/react-table";
import { Columns3, List, Plus } from "lucide-react";
import {
  ISSUE_PRIORITIES,
  ISSUE_PRIORITY_LABELS,
  ISSUE_STATUSES,
  ISSUE_STATUS_LABELS,
  ISSUE_TYPES,
  ISSUE_TYPE_LABELS,
  type IssuePriority,
  type IssueStatus,
  type IssueType,
} from "@/features/console/inbox";
import type { Tone } from "@/features/console/model";
import { dateTime, relative, shortDate } from "@/lib/console/format";
import { useLiveDoc, useLiveQuery } from "@/lib/console/live";
import { studioHref } from "@/lib/console/studio-display";
import { useNow } from "@/lib/console/use-now";
import { useConsole } from "../console-context";
import { Topbar } from "../console-frame";
import { DataTable } from "../data-table";
import { ChipSelect, FilterBar, SearchInput, matches } from "../filters";
import { ActionMenu } from "../menu";
import { NotesPanel } from "../notes";
import { ConfirmDialog, Dialog } from "../overlay";
import { Button, Empty, KV, Notice, PageHead, Panel, Pill, Spinner, Tabs } from "../ui";
import { useCommand } from "../use-command";
import { type Feedback, KindIcon } from "./inbox-page";

/**
 * Issues (docs/console.md): the team's bugs and requests, each gathering every
 * piece of feedback about it. Sorted by how many studios asked. A table or a
 * board by status.
 */
export type Issue = {
  id: string;
  number: number;
  title: string;
  description?: string;
  type: IssueType;
  priority: IssuePriority;
  status: IssueStatus;
  statusNote?: string | null;
  target?: string | null;
  feedbackCount?: number;
  studioCount?: number;
  tenantIds?: string[];
  createdAt: string;
  updatedAt?: string;
  shippedAt?: string | null;
  duplicateOf?: string | null;
  createdByEmail?: string | null;
};

export const STATUS_TONES: Record<IssueStatus, Tone> = {
  open: "warn",
  planned: "info",
  in_progress: "accent",
  shipped: "ok",
  wont_do: "neutral",
  duplicate: "neutral",
};

const PRIORITY_TONES: Record<IssuePriority, Tone> = { urgent: "bad", high: "warn", normal: "neutral", low: "neutral" };

type View = "open" | "bugs" | "requests" | "planned" | "shipped" | "all";
const VIEWS: Array<{ key: View; label: string; test: (issue: Issue, now: number) => boolean }> = [
  { key: "open", label: "Open", test: (issue) => ["open", "planned", "in_progress"].includes(issue.status) },
  { key: "bugs", label: "Open bugs", test: (issue) => issue.type === "bug" && ["open", "planned", "in_progress"].includes(issue.status) },
  { key: "requests", label: "Requests by demand", test: (issue) => issue.type !== "bug" && ["open", "planned", "in_progress"].includes(issue.status) },
  { key: "planned", label: "Planned", test: (issue) => issue.status === "planned" || issue.status === "in_progress" },
  { key: "shipped", label: "Shipped, 30d", test: (issue, now) => issue.status === "shipped" && Boolean(issue.shippedAt) && now - Date.parse(issue.shippedAt!) < 30 * 86_400_000 },
  { key: "all", label: "All", test: () => true },
];

export function IssuesPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { can } = useConsole();
  const view = (VIEWS.some((item) => item.key === params.get("view")) ? params.get("view") : "open") as View;
  const layout = params.get("layout") === "board" ? "board" : "table";
  const [search, setSearch] = useState("");
  const [type, setType] = useState<string>("");
  const [creating, setCreating] = useState(false);
  const issues = useLiveQuery<Issue>("console:issues", (firestore) => query(collection(firestore, "issues"), orderBy("number"), limitToLast(1000)));
  const all = issues.rows;
  const now = useNow();
  const counts = useMemo(() => Object.fromEntries(VIEWS.map((item) => [item.key, (all ?? []).filter((issue) => item.test(issue, now)).length])), [all, now]);
  const rows = useMemo(() => {
    if (!all) return null;
    const test = VIEWS.find((item) => item.key === view)!.test;
    return all.filter((issue) => test(issue, now) && (!type || issue.type === type) && matches(search, issue.title, `#${issue.number}`, issue.description));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, view, type, search]);
  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (value === null) next.delete(key);
    else next.set(key, value);
    router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
  };

  const columns = useMemo<ColumnDef<Issue, unknown>[]>(
    () => [
      { id: "number", header: "#", accessorFn: (issue) => issue.number, meta: { width: 56 }, cell: ({ row }) => <span className="cx-mono">#{row.original.number}</span> },
      { id: "title", header: "Issue", accessorFn: (issue) => issue.title.toLowerCase(), meta: { width: 260, flex: true }, cell: ({ row }) => <span className="cx-strong">{row.original.title}</span> },
      { id: "type", header: "Type", accessorFn: (issue) => issue.type, meta: { width: 96, priority: 3 }, cell: ({ row }) => ISSUE_TYPE_LABELS[row.original.type] },
      {
        id: "studios",
        header: "Studios asking",
        accessorFn: (issue) => issue.studioCount ?? 0,
        meta: { width: 120, align: "right" },
        cell: ({ row }) => <span className={row.original.studioCount ? "cx-strong" : "cx-dim"}>{row.original.studioCount ?? 0}</span>,
      },
      { id: "priority", header: "Priority", accessorFn: (issue) => ISSUE_PRIORITIES.indexOf(issue.priority), meta: { width: 96 }, cell: ({ row }) => <Pill tone={PRIORITY_TONES[row.original.priority]}>{ISSUE_PRIORITY_LABELS[row.original.priority]}</Pill> },
      { id: "status", header: "Status", accessorFn: (issue) => ISSUE_STATUSES.indexOf(issue.status), meta: { width: 112 }, cell: ({ row }) => <Pill tone={STATUS_TONES[row.original.status]}>{ISSUE_STATUS_LABELS[row.original.status]}</Pill> },
      { id: "target", header: "Target", accessorFn: (issue) => issue.target ?? "", meta: { width: 96, priority: 4 }, cell: ({ row }) => row.original.target ?? <span className="cx-dim">—</span> },
      { id: "updated", header: "Updated", accessorFn: (issue) => issue.updatedAt ?? issue.createdAt, meta: { width: 96, priority: 2 }, cell: ({ row }) => relative(row.original.updatedAt ?? row.original.createdAt) },
    ],
    [],
  );

  const boardColumns: IssueStatus[] = ["open", "planned", "in_progress", "shipped"];

  return (
    <>
      <Topbar crumbs={[{ label: "CRM" }, { label: "Issues" }]}>
        <Link className="cx-btn" data-variant="ghost" href="/platform-admin/inbox">
          Inbox
        </Link>
        {can("inbox.write") ? (
          <Button onClick={() => setCreating(true)} variant="primary">
            <Plus size={13} />
            New issue
          </Button>
        ) : null}
      </Topbar>
      <div className="cx-content">
        <PageHead count={all?.filter((issue) => ["open", "planned", "in_progress"].includes(issue.status)).length ?? null} title="Issues">
          <div className="cx-segmented" style={{ width: 180 }}>
            <button aria-pressed={layout === "table"} onClick={() => set("layout", null)} type="button">
              <List size={13} /> Table
            </button>
            <button aria-pressed={layout === "board"} onClick={() => set("layout", "board")} type="button">
              <Columns3 size={13} /> Board
            </button>
          </div>
        </PageHead>
        {issues.error ? <Notice tone="bad">{issues.error}</Notice> : null}
        {layout === "table" ? (
          <Tabs label="Issue views" onChange={(key) => set("view", key === "open" ? null : key)} tabs={VIEWS.map((item) => ({ key: item.key, label: item.label, count: all ? counts[item.key] : null }))} value={view} />
        ) : null}
        <FilterBar>
          <SearchInput id="issue-search" onChange={setSearch} placeholder="Filter by title or number" value={search} />
          <ChipSelect label="Type" onChange={setType} options={ISSUE_TYPES.map((value) => ({ value, label: ISSUE_TYPE_LABELS[value] }))} value={type as IssueType | ""} />
        </FilterBar>
        {layout === "table" ? (
          <DataTable
            columns={columns}
            empty={<Empty title={all?.length ? "No issues in this view" : "No issues yet"}>Create one from a piece of feedback in the inbox, or with New issue.</Empty>}
            getRowId={(issue) => issue.id}
            initialSort={[{ id: view === "requests" ? "studios" : "number", desc: true }]}
            label="Issues"
            mobile={(issue) => ({ title: `#${issue.number} ${issue.title}`, end: <Pill tone={STATUS_TONES[issue.status]}>{ISSUE_STATUS_LABELS[issue.status]}</Pill>, meta: `${ISSUE_TYPE_LABELS[issue.type]} · ${issue.studioCount ?? 0} studios asking` })}
            onRowClick={(issue) => router.push(`/platform-admin/issues/${issue.id}`)}
            rows={rows}
          />
        ) : (
          <div className="cx-board">
            {boardColumns.map((status) => {
              const cards = (all ?? [])
                .filter((issue) => issue.status === status && (!type || issue.type === type) && matches(search, issue.title, `#${issue.number}`))
                .filter((issue) => status !== "shipped" || (issue.shippedAt && now - Date.parse(issue.shippedAt) < 30 * 86_400_000))
                .sort((a, b) => (b.studioCount ?? 0) - (a.studioCount ?? 0));
              return (
                <section aria-label={ISSUE_STATUS_LABELS[status]} className="cx-board-col" key={status}>
                  <header className="cx-board-col-head">
                    <Pill tone={STATUS_TONES[status]}>{ISSUE_STATUS_LABELS[status]}</Pill>
                    <span className="cx-tab-count">{cards.length}</span>
                  </header>
                  {cards.map((issue) => (
                    <Link className="cx-card" href={`/platform-admin/issues/${issue.id}`} key={issue.id}>
                      <span className="cx-card-title">{issue.title}</span>
                      <span className="cx-card-meta">
                        <span className="cx-mono">#{issue.number}</span>
                        <span>{ISSUE_TYPE_LABELS[issue.type]}</span>
                        <Pill tone={PRIORITY_TONES[issue.priority]}>{ISSUE_PRIORITY_LABELS[issue.priority]}</Pill>
                        <span>{issue.studioCount ?? 0} studios</span>
                      </span>
                    </Link>
                  ))}
                  {!cards.length ? <span className="cx-hint" style={{ padding: "0 4px" }}>None</span> : null}
                </section>
              );
            })}
          </div>
        )}
      </div>
      <NewIssueDialog onClose={() => setCreating(false)} open={creating} />
    </>
  );
}

function NewIssueDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { run, busy } = useCommand();
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<IssueType>("bug");
  const [priority, setPriority] = useState<IssuePriority>("normal");
  return (
    <Dialog
      footer={
        <>
          <Button onClick={onClose} variant="ghost">Cancel</Button>
          <Button
            busy={busy === "createIssue"}
            disabled={title.trim().length < 3}
            onClick={async () => {
              const result = await run<{ issueId: string; number: number }>("createIssue", { title, description, type, priority }, { done: (outcome) => `Issue #${outcome.number} created.` });
              if (result) {
                onClose();
                router.push(`/platform-admin/issues/${result.issueId}`);
              }
            }}
            variant="primary"
          >
            Create issue
          </Button>
        </>
      }
      onClose={onClose}
      open={open}
      title="New issue"
    >
      <div className="cx-field">
        <label className="cx-label" htmlFor="new-issue-title">Title</label>
        <input className="cx-input" id="new-issue-title" maxLength={200} onChange={(event) => setTitle(event.target.value)} value={title} />
      </div>
      <div className="cx-field">
        <label className="cx-label" htmlFor="new-issue-description">Details</label>
        <textarea className="cx-textarea" id="new-issue-description" maxLength={6000} onChange={(event) => setDescription(event.target.value)} value={description} />
      </div>
      <div className="cx-row-2">
        <div className="cx-field">
          <label className="cx-label" htmlFor="new-issue-type">Type</label>
          <select className="cx-select-input" id="new-issue-type" onChange={(event) => setType(event.target.value as IssueType)} value={type}>
            {ISSUE_TYPES.map((value) => <option key={value} value={value}>{ISSUE_TYPE_LABELS[value]}</option>)}
          </select>
        </div>
        <div className="cx-field">
          <label className="cx-label" htmlFor="new-issue-priority">Priority</label>
          <select className="cx-select-input" id="new-issue-priority" onChange={(event) => setPriority(event.target.value as IssuePriority)} value={priority}>
            {ISSUE_PRIORITIES.map((value) => <option key={value} value={value}>{ISSUE_PRIORITY_LABELS[value]}</option>)}
          </select>
        </div>
      </div>
    </Dialog>
  );
}

export function IssueRecord({ issueId }: { issueId: string }) {
  const router = useRouter();
  const { can, studioById } = useConsole();
  const { run, busy } = useCommand();
  const doc = useLiveDoc<Issue>(`issues/${issueId}`);
  const linked = useLiveQuery<Feedback>(`issue:feedback:${issueId}`, (firestore) =>
    query(collection(firestore, "feedback"), where("issueId", "==", issueId), orderBy("createdAt", "desc"), limit(500)),
  );
  const all = useLiveQuery<Issue>("console:issues", (firestore) => query(collection(firestore, "issues"), orderBy("number"), limitToLast(1000)));
  const [statusDialog, setStatusDialog] = useState<IssueStatus | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeTarget, setMergeTarget] = useState("");
  const [editing, setEditing] = useState(false);
  const issue = doc.data;
  if (doc.loading)
    return (
      <>
        <Topbar crumbs={[{ label: "Issues", href: "/platform-admin/issues" }, { label: "Loading…" }]} />
        <div className="cx-centered"><Spinner /></div>
      </>
    );
  if (!issue)
    return (
      <>
        <Topbar crumbs={[{ label: "Issues", href: "/platform-admin/issues" }, { label: "Not found" }]} />
        <div className="cx-content"><Empty title="No issue with that id" /></div>
      </>
    );
  const notifying = statusDialog === "planned" || statusDialog === "in_progress" || statusDialog === "shipped";
  const reachable = (linked.rows ?? []).filter((item) => item.followUpOk && item.userEmail).length;
  const studios = [...new Set((linked.rows ?? []).map((item) => item.tenantId))];

  return (
    <>
      <Topbar crumbs={[{ label: "Issues", href: "/platform-admin/issues" }, { label: `#${issue.number}` }]} />
      <header className="cx-record-head">
        <div className="cx-record-heading">
          <h1 className="cx-record-title">
            <span className="cx-mono">#{issue.number}</span> {issue.title}
            <Pill tone={STATUS_TONES[issue.status]}>{ISSUE_STATUS_LABELS[issue.status]}</Pill>
            <Pill tone={PRIORITY_TONES[issue.priority]}>{ISSUE_PRIORITY_LABELS[issue.priority]}</Pill>
            <Pill dot={false}>{ISSUE_TYPE_LABELS[issue.type]}</Pill>
          </h1>
          <div className="cx-record-meta">
            <span>{issue.studioCount ?? 0} studios asking · {issue.feedbackCount ?? 0} pieces of feedback</span>
            <span>Opened {shortDate(issue.createdAt)}{issue.createdByEmail ? ` by ${issue.createdByEmail}` : ""}</span>
            {issue.shippedAt ? <span>Shipped {shortDate(issue.shippedAt)}</span> : null}
          </div>
        </div>
        {can("inbox.write") ? (
          <div className="cx-record-actions">
            {issue.status !== "shipped" ? (
              <Button onClick={() => setStatusDialog("shipped")} variant="primary">
                Mark shipped
              </Button>
            ) : null}
            <ActionMenu
              items={[
                ...ISSUE_STATUSES.filter((status) => status !== issue.status && status !== "shipped").map((status) => ({ label: `Move to ${ISSUE_STATUS_LABELS[status]}`, onSelect: () => setStatusDialog(status) })),
                { kind: "separator" as const },
                { label: "Edit details…", onSelect: () => setEditing(true) },
                { label: "Merge into another issue…", onSelect: () => setMergeOpen(true) },
              ]}
              label="More"
            />
          </div>
        ) : null}
      </header>
      {issue.duplicateOf ? (
        <div className="cx-content" style={{ paddingBottom: 0 }}>
          <Notice tone="info">
            Merged into <Link className="cx-link" href={`/platform-admin/issues/${issue.duplicateOf}`}>another issue</Link>.
          </Notice>
        </div>
      ) : null}
      <div className="cx-record-body">
        <div className="cx-stack">
          {issue.description ? (
            <Panel title="Details">
              <p className="cx-message-text">{issue.description}</p>
            </Panel>
          ) : null}
          <Panel flush title={`Feedback · ${linked.rows?.length ?? "…"}`}>
            {linked.rows === null ? (
              <div className="cx-empty"><Spinner /></div>
            ) : linked.rows.length ? (
              <div className="cx-timeline">
                {linked.rows.map((item) => (
                  <div className="cx-tl-row" key={item.id}>
                    <span className="cx-tl-time" title={dateTime(item.createdAt)}>{relative(item.createdAt)}</span>
                    <span><KindIcon kind={item.kind} /></span>
                    <div className="cx-tl-body">
                      <Link className="cx-strong" href={`/platform-admin/inbox?id=${item.id}`}>{item.message}</Link>
                      <small>
                        {item.studioName} · {item.userName ?? item.userEmail} · {item.followUpOk ? "will hear when it ships" : "asked not to be contacted"}
                      </small>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <Empty title="No feedback linked">Link feedback from the inbox to count who asked.</Empty>
            )}
          </Panel>
          <NotesPanel subjectKey={`issue:${issueId}`} title="Team notes" />
        </div>
        <aside className="cx-stack">
          <Panel title="Studios asking">
            {studios.length ? (
              studios.map((tenantId) => {
                const studio = studioById(tenantId);
                return (
                  <Link className="cx-link" href={studioHref(tenantId)} key={tenantId}>
                    {studio?.name ?? tenantId}
                  </Link>
                );
              })
            ) : (
              <span className="cx-hint">None yet.</span>
            )}
          </Panel>
          <Panel title="Status">
            <KV items={[["Status", ISSUE_STATUS_LABELS[issue.status]], ["Note", issue.statusNote ?? "—"], ["Target", issue.target ?? "—"], ["Updated", relative(issue.updatedAt ?? issue.createdAt)]]} />
          </Panel>
        </aside>
      </div>

      <ConfirmDialog
        busy={busy === "setIssueStatus"}
        confirmLabel={statusDialog ? `Move to ${ISSUE_STATUS_LABELS[statusDialog]}` : "Save"}
        description={
          notifying
            ? `${reachable} ${reachable === 1 ? "person" : "people"} who asked will get one email saying it's ${statusDialog === "shipped" ? "live" : "on the plan"}, with your note. Anyone already told about this step isn't told again.`
            : statusDialog === "wont_do" || statusDialog === "duplicate"
              ? "Linked feedback closes quietly. No one is emailed."
              : "Only the team sees this change."
        }
        onClose={() => setStatusDialog(null)}
        onConfirm={async ({ reason }) => {
          if (!statusDialog) return;
          const result = await run<{ studiosNotified: number }>(
            "setIssueStatus",
            { issueId, status: statusDialog, note: reason || null },
            { done: (outcome) => `Moved to ${ISSUE_STATUS_LABELS[statusDialog]}${outcome.studiosNotified ? `. ${outcome.studiosNotified} emailed.` : "."}` },
          );
          if (result) setStatusDialog(null);
        }}
        open={statusDialog !== null}
        reasonLabel={notifying ? "Note to the studios (optional, shown in the email)" : "Note (optional)"}
        reasonPlaceholder={statusDialog === "shipped" ? "e.g. You can now change the delivery date from the job page." : ""}
        reasonOptional
        requireReason={false}
        title={statusDialog ? `Move #${issue.number} to ${ISSUE_STATUS_LABELS[statusDialog]}` : ""}
      />

      <Dialog
        footer={
          <>
            <Button onClick={() => setMergeOpen(false)} variant="ghost">Cancel</Button>
            <Button
              busy={busy === "mergeIssues"}
              disabled={!mergeTarget}
              onClick={async () => {
                const result = await run("mergeIssues", { sourceIssueId: issueId, targetIssueId: mergeTarget }, { done: "Merged." });
                if (result) {
                  setMergeOpen(false);
                  router.push(`/platform-admin/issues/${mergeTarget}`);
                }
              }}
              variant="primary"
            >
              Merge
            </Button>
          </>
        }
        onClose={() => setMergeOpen(false)}
        open={mergeOpen}
        title={`Merge #${issue.number} into…`}
      >
        <p>Its feedback moves to the other issue, and this one is marked a duplicate.</p>
        <select aria-label="Issue to merge into" className="cx-select-input" onChange={(event) => setMergeTarget(event.target.value)} value={mergeTarget}>
          <option value="">Choose an issue…</option>
          {(all.rows ?? []).filter((other) => other.id !== issueId && other.status !== "duplicate").map((other) => (
            <option key={other.id} value={other.id}>#{other.number} {other.title}</option>
          ))}
        </select>
      </Dialog>
      <EditIssueDialog issue={issue} onClose={() => setEditing(false)} open={editing} />
    </>
  );
}

function EditIssueDialog({ issue, open, onClose }: { issue: Issue; open: boolean; onClose: () => void }) {
  const { run, busy } = useCommand();
  const [title, setTitle] = useState(issue.title);
  const [description, setDescription] = useState(issue.description ?? "");
  const [type, setType] = useState<IssueType>(issue.type);
  const [priority, setPriority] = useState<IssuePriority>(issue.priority);
  const [target, setTarget] = useState(issue.target ?? "");
  return (
    <Dialog
      footer={
        <>
          <Button onClick={onClose} variant="ghost">Cancel</Button>
          <Button
            busy={busy === "updateIssue"}
            disabled={title.trim().length < 3}
            onClick={async () => {
              const result = await run("updateIssue", { issueId: issue.id, title, description, type, priority, target: target.trim() || null }, { done: "Issue saved." });
              if (result) onClose();
            }}
            variant="primary"
          >
            Save
          </Button>
        </>
      }
      onClose={onClose}
      open={open}
      title={`Edit #${issue.number}`}
    >
      <div className="cx-field">
        <label className="cx-label" htmlFor="edit-issue-title">Title</label>
        <input className="cx-input" id="edit-issue-title" onChange={(event) => setTitle(event.target.value)} value={title} />
      </div>
      <div className="cx-field">
        <label className="cx-label" htmlFor="edit-issue-description">Details</label>
        <textarea className="cx-textarea" id="edit-issue-description" onChange={(event) => setDescription(event.target.value)} value={description} />
      </div>
      <div className="cx-row-2">
        <div className="cx-field">
          <label className="cx-label" htmlFor="edit-issue-type">Type</label>
          <select className="cx-select-input" id="edit-issue-type" onChange={(event) => setType(event.target.value as IssueType)} value={type}>
            {ISSUE_TYPES.map((value) => <option key={value} value={value}>{ISSUE_TYPE_LABELS[value]}</option>)}
          </select>
        </div>
        <div className="cx-field">
          <label className="cx-label" htmlFor="edit-issue-priority">Priority</label>
          <select className="cx-select-input" id="edit-issue-priority" onChange={(event) => setPriority(event.target.value as IssuePriority)} value={priority}>
            {ISSUE_PRIORITIES.map((value) => <option key={value} value={value}>{ISSUE_PRIORITY_LABELS[value]}</option>)}
          </select>
        </div>
      </div>
      <div className="cx-field">
        <label className="cx-label" htmlFor="edit-issue-target">Target</label>
        <input className="cx-input" id="edit-issue-target" maxLength={60} onChange={(event) => setTarget(event.target.value)} placeholder="e.g. October, v2.4" value={target} />
      </div>
    </Dialog>
  );
}

