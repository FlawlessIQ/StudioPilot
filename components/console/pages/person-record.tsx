"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { collection, limit, orderBy, query, where } from "firebase/firestore";
import type { ColumnDef } from "@tanstack/react-table";
import { PERSON_TYPE_LABELS, PROVIDER_LABELS, ROLE_LABELS, type ConsolePerson } from "@/features/console/model";
import { CONSOLE_ROLE_LABELS } from "@/features/console/roles";
import { dateTime, humanize, relative } from "@/lib/console/format";
import { useLiveDoc, useLiveQuery } from "@/lib/console/live";
import { studioHref } from "@/lib/console/studio-display";
import { useConsole } from "../console-context";
import { Topbar } from "../console-frame";
import { DataTable } from "../data-table";
import { ActionMenu } from "../menu";
import { NotesPanel } from "../notes";
import { Dialog } from "../overlay";
import { PeopleDialogs, usePeopleActions } from "../people-actions";
import { Avatar, Button, CopyId, Empty, KV, Panel, Pill, Spinner, Tabs, When } from "../ui";

/** One account (docs/console.md, "People"). */

const TABS = ["overview", "feedback", "notes", "activity"] as const;
type Tab = (typeof TABS)[number];
type Raw = Record<string, unknown> & { id: string };
type Membership = ConsolePerson["memberships"][number];

export function PersonRecord({ uid }: { uid: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tab = (TABS.includes(params.get("tab") as Tab) ? params.get("tab") : "overview") as Tab;
  const { studioById, can } = useConsole();
  const person = useLiveDoc<ConsolePerson>(`consolePeople/${uid}`);
  const actions = usePeopleActions();
  const feedback = useLiveQuery<Raw>(tab === "feedback" ? `person-feedback:${uid}` : null, (firestore) =>
    query(collection(firestore, "feedback"), where("userId", "==", uid), limit(100)),
  );
  const activity = useLiveQuery<Raw>(tab === "activity" ? `person-audit:${uid}` : null, (firestore) =>
    query(collection(firestore, "auditEvents"), where("actorId", "==", uid), orderBy("timestamp", "desc"), limit(200)),
  );
  const [event, setEvent] = useState<Raw | null>(null);
  const setTab = (next: Tab) => {
    const query = new URLSearchParams(params.toString());
    if (next === "overview") query.delete("tab");
    else query.set("tab", next);
    router.replace(`${pathname}${query.size ? `?${query}` : ""}`, { scroll: false });
  };

  const membershipColumns = useMemo<ColumnDef<Membership, unknown>[]>(
    () => [
      { id: "studio", header: "Studio", accessorFn: (row) => row.tenantName, meta: { width: 240, flex: true }, cell: ({ row }) => <span className="cx-strong">{row.original.tenantName}</span> },
      { id: "role", header: "Role", accessorFn: (row) => row.role, meta: { width: 140 }, cell: ({ row }) => ROLE_LABELS[row.original.role] ?? humanize(row.original.role) },
      { id: "status", header: "Access", accessorFn: (row) => row.status, meta: { width: 110 }, cell: ({ row }) => <Pill tone={row.original.status === "active" ? "ok" : "neutral"}>{humanize(row.original.status)}</Pill> },
      {
        id: "plan",
        header: "Studio status",
        accessorFn: (row) => studioById(row.tenantId)?.lifecycle ?? "",
        meta: { width: 140, priority: 2 },
        cell: ({ row }) => humanize(studioById(row.original.tenantId)?.lifecycle ?? "—"),
      },
    ],
    [studioById],
  );

  if (person.loading)
    return (
      <>
        <Topbar crumbs={[{ label: "People", href: "/platform-admin/people" }, { label: "Loading…" }]} />
        <div className="cx-centered">
          <Spinner />
        </div>
      </>
    );
  const p = person.data;
  if (!p)
    return (
      <>
        <Topbar crumbs={[{ label: "People", href: "/platform-admin/people" }, { label: "Not found" }]} />
        <div className="cx-content">
          <Empty action={<Link className="cx-btn" href="/platform-admin/people">Back to people</Link>} title="No person with that id">
            Rows refresh every 15 minutes; a new account may not have one yet.
          </Empty>
        </div>
      </>
    );
  const name = p.name ?? p.email ?? "No name";
  const items = actions.menuItems(p);

  return (
    <>
      <Topbar crumbs={[{ label: "People", href: "/platform-admin/people" }, { label: name }]} />
      <header className="cx-record-head">
        <Avatar large name={name} />
        <div className="cx-record-heading">
          <h1 className="cx-record-title">
            {name}
            {p.consoleRole ? <Pill tone="accent">{CONSOLE_ROLE_LABELS[p.consoleRole as keyof typeof CONSOLE_ROLE_LABELS] ?? "Admin"}</Pill> : <Pill dot={false}>{PERSON_TYPE_LABELS[p.type]}</Pill>}
            {p.disabled ? <Pill tone="bad">Disabled</Pill> : p.emailVerified ? <Pill tone="ok">Verified</Pill> : <Pill tone="warn">Unverified</Pill>}
          </h1>
          <div className="cx-record-meta">
            {p.email ? <span>{p.email}</span> : null}
            <span>Signs in with {p.providers.map((provider) => PROVIDER_LABELS[provider] ?? provider).join(", ") || "—"}</span>
            {p.createdAt ? <span>Joined {relative(p.createdAt)}</span> : null}
            <CopyId label="user id" value={p.uid} />
          </div>
        </div>
        <div className="cx-record-actions">
          {can("people.support") && p.email ? <Button onClick={() => actions.setState({ kind: "reset", person: p })}>Send password reset</Button> : null}
          {items.length ? <ActionMenu items={items} label="More" /> : null}
        </div>
      </header>
      <div className="cx-record-tabs">
        <Tabs label="Person sections" onChange={setTab} tabs={TABS.map((key) => ({ key, label: key === "activity" ? "Activity" : humanize(key) }))} value={tab} />
      </div>

      {tab === "overview" ? (
        <div className="cx-record-body">
          <div className="cx-stack">
            <DataTable
              columns={membershipColumns}
              empty={<Empty title="Not a member of any studio" />}
              getRowId={(row) => `${row.tenantId}_${row.role}`}
              label="Studios"
              mobile={(row) => ({ title: row.tenantName, end: ROLE_LABELS[row.role] ?? row.role, meta: row.status })}
              onRowClick={(row) => router.push(studioHref(row.tenantId))}
              rows={p.memberships}
            />
          </div>
          <aside className="cx-stack">
            <Panel title="Account">
              <KV
                items={[
                  ["Email", p.email ?? "—"],
                  ["Verified", p.emailVerified ? "Yes" : "No"],
                  ["Status", p.disabled ? "Disabled" : "Active"],
                  ["Last sign-in", <When at={p.lastSignInAt} key="s" />],
                  ["Last active", <When at={p.lastActiveAt} key="a" />],
                  ["Joined", p.createdAt ? dateTime(p.createdAt) : "—"],
                ]}
              />
            </Panel>
          </aside>
        </div>
      ) : null}

      {tab === "feedback" ? (
        <div className="cx-record-body" data-single="true">
          <Panel flush title="Feedback they sent">
            {feedback.rows === null ? (
              <div className="cx-empty"><Spinner /></div>
            ) : feedback.rows.length ? (
              <div className="cx-timeline">
                {[...feedback.rows].sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? ""))).map((item) => (
                  <div className="cx-tl-row" key={item.id}>
                    <span className="cx-tl-time">{relative(String(item.createdAt ?? ""))}</span>
                    <span><Pill>{humanize(String(item.status ?? ""))}</Pill></span>
                    <div className="cx-tl-body">
                      <Link className="cx-strong" href={`/platform-admin/inbox?id=${encodeURIComponent(item.id)}`}>{String(item.message ?? "")}</Link>
                      <small>{humanize(String(item.kind ?? ""))} · {String(item.studioName ?? "")}</small>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <Empty title="No feedback from them" />
            )}
          </Panel>
        </div>
      ) : null}

      {tab === "notes" ? (
        <div className="cx-record-body" data-single="true">
          <NotesPanel subjectKey={`person:${uid}`} title="Notes" />
        </div>
      ) : null}

      {tab === "activity" ? (
        <div className="cx-record-body" data-single="true">
          <DataTable
            columns={[
              { id: "time", header: "Time", accessorFn: (row: Raw) => String(row.timestamp ?? ""), meta: { width: 160 }, cell: ({ row }) => dateTime(String(row.original.timestamp ?? "")) },
              { id: "action", header: "Action", accessorFn: (row: Raw) => String(row.action ?? ""), meta: { width: 260, flex: true }, cell: ({ row }) => <span className="cx-mono">{String(row.original.action ?? "")}</span> },
              { id: "studio", header: "Studio", accessorFn: (row: Raw) => String(row.tenantId ?? ""), meta: { width: 200 }, cell: ({ row }) => studioById(String(row.original.tenantId ?? ""))?.name ?? (row.original.tenantId === "platform" ? "Platform" : String(row.original.tenantId ?? "—")) },
            ]}
            empty={<Empty title="No recorded actions" />}
            getRowId={(row) => row.id}
            label="Activity"
            onRowClick={setEvent}
            rows={activity.rows}
          />
          <Dialog onClose={() => setEvent(null)} open={Boolean(event)} title={String(event?.action ?? "Event")}>
            <pre className="cx-code-block">{JSON.stringify(event, null, 2)}</pre>
          </Dialog>
        </div>
      ) : null}
      <PeopleDialogs actions={actions} />
    </>
  );
}
