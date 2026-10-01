"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { collection, limit, limitToLast, orderBy, query, where } from "firebase/firestore";
import { ArrowLeft, Bug, CircleHelp, Heart, Lightbulb } from "lucide-react";
import {
  ISSUE_PRIORITIES,
  ISSUE_PRIORITY_LABELS,
  ISSUE_TYPES,
  ISSUE_TYPE_LABELS,
  TRIAGE_LABELS,
  issueTypeForKind,
  triageOf,
  type TriageState,
} from "@/features/console/inbox";
import { dateTime, relative } from "@/lib/console/format";
import { useLiveDoc, useLiveQuery } from "@/lib/console/live";
import { adminFileUrl } from "@/lib/console/storage";
import { personHref, studioHref } from "@/lib/console/studio-display";
import { useConsole } from "../console-context";
import { Topbar } from "../console-frame";
import { type SavedReply, useAdmins } from "../crm-dialogs";
import { ChipSelect, SearchInput, matches } from "../filters";
import { ActionMenu } from "../menu";
import { Dialog } from "../overlay";
import { Button, Empty, KV, Notice, Panel, Pill, Spinner, Tabs } from "../ui";
import { useCommand } from "../use-command";

/**
 * The inbox (docs/console.md, "Inbox"): feedback from studios, a thread per
 * item with the team's replies and notes, and issue linking. List on the left,
 * the open item on the right; on a phone, one at a time.
 */

export type Feedback = {
  id: string;
  tenantId: string;
  studioName?: string;
  userId?: string;
  userEmail?: string | null;
  userName?: string | null;
  role?: string;
  kind: "idea" | "broken" | "confusing" | "praise";
  message: string;
  followUpOk?: boolean;
  route?: string;
  viewport?: string | null;
  userAgent?: string | null;
  lastError?: string | null;
  screenshotPath?: string | null;
  status: string;
  statusNote?: string | null;
  triage?: TriageState;
  issueId?: string | null;
  issueNumber?: number | null;
  assigneeUid?: string | null;
  assigneeEmail?: string | null;
  createdAt: string;
  updatedAt?: string;
  lastInboundAt?: string | null;
};

type Message = {
  id: string;
  direction: "outbound" | "inbound" | "internal";
  body: string;
  authorLabel?: string;
  authorEmail?: string | null;
  fromEmail?: string;
  fromName?: string | null;
  fromMatchesSender?: boolean;
  createdAt: string;
};

type Issue = { id: string; number: number; title: string; status: string; type: string; priority: string; studioCount?: number; feedbackCount?: number };

export const KIND_LABELS: Record<Feedback["kind"], string> = { idea: "Idea", broken: "Something's broken", confusing: "Confusing", praise: "Love this" };
const KIND_ICONS = { idea: Lightbulb, broken: Bug, confusing: CircleHelp, praise: Heart } as const;

export function KindIcon({ kind }: { kind: Feedback["kind"] }) {
  const Icon = KIND_ICONS[kind] ?? Lightbulb;
  return (
    <span aria-label={KIND_LABELS[kind]} className="cx-kind" data-kind={kind} role="img">
      <Icon size={13} />
    </span>
  );
}

const VIEWS: Array<{ key: TriageState | "all"; label: string }> = [
  { key: "new", label: "New" },
  { key: "waiting", label: "Waiting" },
  { key: "linked", label: "Linked" },
  { key: "closed", label: "Closed" },
  { key: "all", label: "All" },
];

export function InboxPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const selectedId = params.get("id");
  const view = (VIEWS.some((item) => item.key === params.get("view")) ? params.get("view") : "new") as TriageState | "all";
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<string>("");
  const feedback = useLiveQuery<Feedback>("inbox:feedback", (firestore) => query(collection(firestore, "feedback"), orderBy("createdAt", "desc"), limit(500)));
  const all = feedback.rows;
  const counts = useMemo(() => {
    const result: Record<string, number> = { all: all?.length ?? 0 };
    for (const item of all ?? []) result[triageOf(item)] = (result[triageOf(item)] ?? 0) + 1;
    return result;
  }, [all]);
  const rows = useMemo(
    () =>
      (all ?? []).filter(
        (item) =>
          (view === "all" || triageOf(item) === view) &&
          (!kind || item.kind === kind) &&
          matches(search, item.message, item.studioName, item.userName, item.userEmail),
      ),
    [all, view, kind, search],
  );
  const go = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
  };
  // Open the newest item in the view on a wide screen, so the detail is never empty.
  useEffect(() => {
    if (!selectedId && rows.length && typeof window !== "undefined" && window.innerWidth > 900) go({ id: rows[0]!.id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, rows.length]);

  return (
    <>
      <Topbar crumbs={[{ label: "CRM" }, { label: "Inbox" }]}>
        <Link className="cx-btn" data-variant="ghost" href="/platform-admin/issues">
          Issues
        </Link>
      </Topbar>
      <div className="cx-split" data-detail-open={selectedId ? "true" : "false"}>
        <section aria-label="Feedback" className="cx-split-list">
          <div className="cx-split-list-head">
            <h1 className="cx-page-title">Inbox</h1>
            <Tabs
              label="Inbox views"
              onChange={(key) => go({ view: key === "new" ? null : key, id: null })}
              tabs={VIEWS.map((item) => ({ key: item.key, label: item.label, count: all ? (counts[item.key] ?? 0) : null }))}
              value={view}
            />
            <div className="cx-inline" style={{ paddingBottom: 10 }}>
              <SearchInput id="inbox-search" onChange={setSearch} placeholder="Search messages and studios" value={search} />
              <ChipSelect label="Kind" onChange={setKind} options={Object.entries(KIND_LABELS).map(([value, label]) => ({ value: value as Feedback["kind"], label }))} value={kind as Feedback["kind"] | ""} />
            </div>
          </div>
          <div className="cx-split-scroll">
            {feedback.error ? <Notice tone="bad">{feedback.error}</Notice> : null}
            {all === null ? (
              <div className="cx-empty"><Spinner /></div>
            ) : rows.length ? (
              rows.map((item) => (
                <button aria-current={item.id === selectedId ? "true" : undefined} className="cx-item" key={item.id} onClick={() => go({ id: item.id })} type="button">
                  <span className="cx-item-lead">
                    <KindIcon kind={item.kind} />
                  </span>
                  <span className="cx-item-title">
                    {item.studioName ?? "A studio"} · {item.userName ?? item.userEmail ?? "someone"}
                  </span>
                  <span className="cx-item-time">{relative(item.lastInboundAt ?? item.createdAt)}</span>
                  <span className="cx-item-snippet">
                    {item.lastInboundAt ? "↩ Replied · " : ""}
                    {item.issueNumber ? `#${item.issueNumber} · ` : ""}
                    {item.message}
                  </span>
                </button>
              ))
            ) : (
              <Empty title={view === "new" ? "Inbox zero" : "Nothing here"}>{view === "new" ? "Every piece of feedback has been looked at." : "No feedback in this view."}</Empty>
            )}
          </div>
        </section>
        <section aria-label="Feedback detail" className="cx-split-detail">
          {selectedId ? <FeedbackDetail feedbackId={selectedId} key={selectedId} onBack={() => go({ id: null })} /> : <Empty title="Choose a message">Pick feedback from the list to read and answer it.</Empty>}
        </section>
      </div>
    </>
  );
}

function FeedbackDetail({ feedbackId, onBack }: { feedbackId: string; onBack: () => void }) {
  const { can, studioById, user } = useConsole();
  const { run, busy } = useCommand();
  const doc = useLiveDoc<Feedback>(`feedback/${feedbackId}`);
  const messages = useLiveQuery<Message>(`inbox:messages:${feedbackId}`, (firestore) =>
    query(collection(firestore, "feedbackMessages"), where("feedbackId", "==", feedbackId), orderBy("createdAt", "asc")),
  );
  const issues = useLiveQuery<Issue>("inbox:issues", (firestore) => query(collection(firestore, "issues"), orderBy("number"), limitToLast(300)));
  const replies = useLiveQuery<SavedReply>("replies:feedback", (firestore) => query(collection(firestore, "consoleReplies"), where("kind", "==", "feedback")));
  const others = useLiveQuery<Feedback>(doc.data ? `inbox:studio:${doc.data.tenantId}` : null, (firestore) =>
    query(collection(firestore, "feedback"), where("tenantId", "==", doc.data!.tenantId), orderBy("createdAt", "desc"), limit(10)),
  );
  const admins = useAdmins(true);
  const [mode, setMode] = useState<"reply" | "note">("reply");
  const [text, setText] = useState("");
  const [shot, setShot] = useState<string | null>(null);
  const [shotError, setShotError] = useState(false);
  const [issueDialog, setIssueDialog] = useState(false);
  const item = doc.data;

  useEffect(() => {
    if (!item?.screenshotPath) return;
    let active = true;
    adminFileUrl(item.screenshotPath)
      .then((url) => active && setShot(url))
      .catch(() => active && setShotError(true));
    return () => {
      active = false;
    };
  }, [item?.screenshotPath]);

  if (doc.loading) return <div className="cx-centered"><Spinner /></div>;
  if (!item) return <Empty title="That feedback isn't there">It may have been removed.</Empty>;
  const triage = triageOf(item);
  const issue = (issues.rows ?? []).find((candidate) => candidate.id === item.issueId);
  const studio = studioById(item.tenantId);
  const send = async () => {
    const result =
      mode === "reply"
        ? await run("replyToFeedback", { feedbackId, body: text }, { done: `Reply sent to ${item.userEmail}.` })
        : await run("addFeedbackNote", { feedbackId, body: text }, { done: "Note added." });
    if (result) setText("");
  };
  const sendAndWait = async () => {
    const result = await run("replyToFeedback", { feedbackId, body: text, markWaiting: true }, { done: "Reply sent. Marked waiting on the studio." });
    if (result) setText("");
  };

  return (
    <>
      <header className="cx-detail-head">
        <button aria-label="Back to the list" className="cx-btn cx-mobile-menu" data-icon="true" data-variant="ghost" onClick={onBack} type="button">
          <ArrowLeft size={15} />
        </button>
        <KindIcon kind={item.kind} />
        <h2 className="cx-detail-title">{KIND_LABELS[item.kind]} from {item.studioName ?? "a studio"}</h2>
        <Pill tone={triage === "new" ? "warn" : triage === "waiting" ? "info" : triage === "linked" ? "accent" : "neutral"}>{TRIAGE_LABELS[triage]}</Pill>
        <span className="cx-page-head-actions">
          {can("inbox.write") ? (
            <>
              {triage !== "closed" ? (
                <Button busy={busy === "setFeedbackTriage"} onClick={() => void run("setFeedbackTriage", { feedbackIds: [feedbackId], triage: "closed" }, { done: "Closed." })}>
                  Close
                </Button>
              ) : (
                <Button onClick={() => void run("setFeedbackTriage", { feedbackIds: [feedbackId], triage: "new" }, { done: "Reopened." })}>Reopen</Button>
              )}
              <ActionMenu
                items={[
                  ...(triage !== "waiting" ? [{ label: "Mark waiting on studio", onSelect: () => void run("setFeedbackTriage", { feedbackIds: [feedbackId], triage: "waiting" }, { done: "Marked waiting." }) }] : []),
                  ...(triage !== "new" ? [{ label: "Mark new", onSelect: () => void run("setFeedbackTriage", { feedbackIds: [feedbackId], triage: "new" }, { done: "Marked new." }) }] : []),
                  { kind: "separator" as const },
                  ...(user ? [{ label: "Assign to me", onSelect: () => void run("assignFeedback", { feedbackIds: [feedbackId], assigneeUid: user.uid }, { done: "Assigned to you." }) }] : []),
                  ...(item.assigneeUid ? [{ label: "Unassign", onSelect: () => void run("assignFeedback", { feedbackIds: [feedbackId], assigneeUid: null }, { done: "Unassigned." }) }] : []),
                  ...(admins.rows ?? []).filter((admin) => admin.uid !== user?.uid).map((admin) => ({ label: `Assign to ${admin.name ?? admin.email ?? admin.uid}`, onSelect: () => void run("assignFeedback", { feedbackIds: [feedbackId], assigneeUid: admin.uid }, { done: "Assigned." }) })),
                ]}
                label="More"
              />
            </>
          ) : null}
        </span>
      </header>
      <div className="cx-detail-body">
        <div className="cx-stack">
          <article className="cx-message">
            <div className="cx-message-head">
              <b>{item.userName ?? item.userEmail ?? "Someone"}</b>
              <span>· {item.role?.replace(/_/g, " ") ?? "studio"} · {item.studioName}</span>
              <time dateTime={item.createdAt} title={dateTime(item.createdAt)}>· {relative(item.createdAt)}</time>
            </div>
            <p className="cx-message-text">{item.message}</p>
            {item.screenshotPath ? (
              shot ? (
                <a href={shot} rel="noreferrer" target="_blank">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img alt={`Screenshot of ${item.route ?? "the screen"} when the feedback was sent`} className="cx-shot" src={shot} />
                </a>
              ) : shotError ? (
                <span className="cx-hint">The screenshot couldn&apos;t be loaded.</span>
              ) : (
                <Spinner label="Loading screenshot" />
              )
            ) : null}
          </article>

          {(messages.rows ?? []).map((message) => (
            <article className="cx-message" data-kind={message.direction === "internal" ? "note" : message.direction === "outbound" ? "outbound" : undefined} key={message.id}>
              <div className="cx-message-head">
                <b>
                  {message.direction === "internal"
                    ? `Internal note · ${message.authorLabel ?? "Team"}`
                    : message.direction === "outbound"
                      ? `The StudioCue team${message.authorEmail ? ` (${message.authorEmail})` : ""}`
                      : (message.fromName ?? message.fromEmail ?? "Studio")}
                </b>
                <time dateTime={message.createdAt} title={dateTime(message.createdAt)}>· {relative(message.createdAt)}</time>
                {message.direction === "inbound" && message.fromMatchesSender === false ? <Pill tone="warn">From a different address</Pill> : null}
              </div>
              <p className="cx-message-text">{message.body}</p>
            </article>
          ))}

          {can("inbox.write") ? (
            <div className="cx-reply">
              <Tabs
                label="Reply or note"
                onChange={setMode}
                tabs={[
                  { key: "reply" as const, label: "Reply to studio" },
                  { key: "note" as const, label: "Internal note" },
                ]}
                value={mode}
              />
              {mode === "reply" && item.followUpOk === false ? (
                <div className="cx-panel-body">
                  <Notice tone="warn">They asked not to be contacted about this one. Add an internal note instead.</Notice>
                </div>
              ) : (
                <>
                  <label className="cx-label" hidden htmlFor="inbox-reply">
                    {mode === "reply" ? "Reply" : "Note"}
                  </label>
                  <textarea
                    id="inbox-reply"
                    onChange={(event) => setText(event.target.value)}
                    onKeyDown={(event) => {
                      if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && text.trim()) void send();
                    }}
                    placeholder={mode === "reply" ? `Write a reply. It's emailed to ${item.userEmail ?? "them"} and signed "The StudioCue team".` : "Only the team sees notes."}
                    value={text}
                  />
                  <div className="cx-reply-foot">
                    {mode === "reply" && (replies.rows ?? []).filter((reply) => !reply.archivedAt).length ? (
                      <select
                        aria-label="Use a saved reply"
                        className="cx-select-input"
                        defaultValue=""
                        onChange={(event) => {
                          const reply = (replies.rows ?? []).find((candidate) => candidate.id === event.target.value);
                          if (reply?.body) setText(reply.body);
                          event.target.value = "";
                        }}
                        style={{ width: 180, height: 26 }}
                      >
                        <option value="">Saved replies…</option>
                        {(replies.rows ?? []).filter((reply) => !reply.archivedAt).map((reply) => (
                          <option key={reply.id} value={reply.id}>
                            {reply.title}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="cx-hint">⌘↵ to send</span>
                    )}
                    <span className="cx-reply-foot-end">
                      {mode === "reply" ? (
                        <Button disabled={!text.trim() || Boolean(busy)} onClick={() => void sendAndWait()}>
                          Send &amp; mark waiting
                        </Button>
                      ) : null}
                      <Button busy={busy === "replyToFeedback" || busy === "addFeedbackNote"} disabled={!text.trim()} onClick={() => void send()} variant="primary">
                        {mode === "reply" ? "Send" : "Add note"}
                      </Button>
                    </span>
                  </div>
                </>
              )}
            </div>
          ) : null}
        </div>

        <aside className="cx-stack">
          <Panel title="Issue">
            {issue ? (
              <>
                <Link className="cx-strong" href={`/platform-admin/issues/${issue.id}`}>
                  #{issue.number} {issue.title}
                </Link>
                <span className="cx-hint">{issue.studioCount === 1 ? "1 studio asked" : `${issue.studioCount ?? 0} studios asked`} · {issue.status.replace(/_/g, " ")}</span>
                {can("inbox.write") ? (
                  <button className="cx-link" onClick={() => void run("linkFeedback", { feedbackIds: [feedbackId], issueId: null }, { done: "Unlinked." })} type="button">
                    Unlink
                  </button>
                ) : null}
              </>
            ) : can("inbox.write") ? (
              <>
                <span className="cx-hint">Group feedback about the same thing into one issue. When it ships, everyone who asked hears.</span>
                <Button onClick={() => setIssueDialog(true)}>Link or create issue</Button>
              </>
            ) : (
              <span className="cx-hint">Not linked.</span>
            )}
          </Panel>
          <Panel title="Context">
            <KV
              items={[
                ["Studio", studio ? <Link className="cx-link" href={studioHref(studio.tenantId)} key="s">{studio.name}</Link> : (item.studioName ?? "—")],
                ["From", item.userId ? <Link className="cx-link" href={personHref(item.userId)} key="p">{item.userEmail ?? item.userName}</Link> : (item.userEmail ?? "—")],
                ["Screen", <span className="cx-mono" key="r">{item.route ?? "—"}</span>],
                ["Device", [item.viewport, item.userAgent].filter(Boolean).join(" · ") || "—"],
                ["Last error", item.lastError ? <span className="cx-mono" key="e">{item.lastError}</span> : "None captured"],
                ["Contact", item.followUpOk ? "OK to follow up" : "Asked not to be contacted"],
                ["Studio status", item.status],
                item.assigneeEmail ? ["Assigned", item.assigneeEmail] : null,
              ]}
            />
          </Panel>
          <Panel title="From this studio">
            {(others.rows ?? []).filter((other) => other.id !== feedbackId).slice(0, 5).map((other) => (
              <Link className="cx-inline" href={`/platform-admin/inbox?id=${other.id}`} key={other.id}>
                <KindIcon kind={other.kind} />
                <span className="cx-sub" style={{ flex: 1 }}>{other.message}</span>
                <span className="cx-hint">{relative(other.createdAt)}</span>
              </Link>
            ))}
            {(others.rows ?? []).filter((other) => other.id !== feedbackId).length === 0 ? <span className="cx-hint">Nothing else yet.</span> : null}
          </Panel>
        </aside>
      </div>
      <IssueLinkDialog feedback={item} issues={issues.rows ?? []} onClose={() => setIssueDialog(false)} open={issueDialog} />
    </>
  );
}

type IssueLinkProps = { open: boolean; onClose: () => void; feedback: Feedback; issues: Issue[] };

export function IssueLinkDialog(props: IssueLinkProps) {
  return props.open ? <IssueLinkBody {...props} /> : null;
}

function IssueLinkBody({ open, onClose, feedback, issues }: IssueLinkProps) {
  const { run, busy } = useCommand();
  const [mode, setMode] = useState<"link" | "create">(() => (issues.some((issue) => !["shipped", "wont_do", "duplicate"].includes(issue.status)) ? "link" : "create"));
  const [issueId, setIssueId] = useState("");
  const [title, setTitle] = useState(() => feedback.message.split(/\r?\n/)[0]!.slice(0, 120));
  const [type, setType] = useState<string>(() => issueTypeForKind(feedback.kind));
  const [priority, setPriority] = useState<string>(feedback.kind === "broken" ? "high" : "normal");
  const openIssues = issues.filter((issue) => !["shipped", "wont_do", "duplicate"].includes(issue.status));
  return (
    <Dialog
      footer={
        <>
          <Button onClick={onClose} variant="ghost">Cancel</Button>
          {mode === "link" ? (
            <Button busy={busy === "linkFeedback"} disabled={!issueId} onClick={() => void run("linkFeedback", { feedbackIds: [feedback.id], issueId }, { done: "Linked to the issue." }).then((result) => result && onClose())} variant="primary">
              Link
            </Button>
          ) : (
            <Button busy={busy === "createIssue"} disabled={title.trim().length < 3} onClick={() => void run<{ number: number }>("createIssue", { title, type, priority, feedbackIds: [feedback.id] }, { done: (result) => `Issue #${result.number} created.` }).then((result) => result && onClose())} variant="primary">
              Create issue
            </Button>
          )}
        </>
      }
      onClose={onClose}
      open={open}
      title="Link to an issue"
    >
      <Tabs label="Link or create" onChange={setMode} tabs={[{ key: "link" as const, label: `Existing (${openIssues.length})` }, { key: "create" as const, label: "New issue" }]} value={mode} />
      {mode === "link" ? (
        openIssues.length ? (
          <div className="cx-field">
            <label className="cx-label" htmlFor="link-issue">Issue</label>
            <select className="cx-select-input" id="link-issue" onChange={(event) => setIssueId(event.target.value)} value={issueId}>
              <option value="">Choose…</option>
              {openIssues.map((issue) => (
                <option key={issue.id} value={issue.id}>
                  #{issue.number} {issue.title} · {issue.studioCount === 1 ? "1 studio" : `${issue.studioCount ?? 0} studios`}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <span className="cx-hint">No open issues. Create one.</span>
        )
      ) : (
        <>
          <div className="cx-field">
            <label className="cx-label" htmlFor="issue-title">Title</label>
            <input className="cx-input" id="issue-title" maxLength={200} onChange={(event) => setTitle(event.target.value)} value={title} />
          </div>
          <div className="cx-row-2">
            <div className="cx-field">
              <label className="cx-label" htmlFor="issue-type">Type</label>
              <select className="cx-select-input" id="issue-type" onChange={(event) => setType(event.target.value)} value={type}>
                {ISSUE_TYPES.map((value) => <option key={value} value={value}>{ISSUE_TYPE_LABELS[value]}</option>)}
              </select>
            </div>
            <div className="cx-field">
              <label className="cx-label" htmlFor="issue-priority">Priority</label>
              <select className="cx-select-input" id="issue-priority" onChange={(event) => setPriority(event.target.value)} value={priority}>
                {ISSUE_PRIORITIES.map((value) => <option key={value} value={value}>{ISSUE_PRIORITY_LABELS[value]}</option>)}
              </select>
            </div>
          </div>
        </>
      )}
    </Dialog>
  );
}
