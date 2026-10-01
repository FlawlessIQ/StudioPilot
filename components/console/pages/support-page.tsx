"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { collection, limit, orderBy, query } from "firebase/firestore";
import type { ColumnDef } from "@tanstack/react-table";
import { getAuth } from "firebase/auth";
import { Plus } from "lucide-react";
import { friendlyError } from "@/lib/ai/friendly-error";
import { getAppCheckToken } from "@/lib/firebase/app-check";
import { getFirebaseClient } from "@/lib/firebase/client";
import { dateTime, humanize, relative } from "@/lib/console/format";
import { useLiveQuery } from "@/lib/console/live";
import { studioHref } from "@/lib/console/studio-display";
import { useNow } from "@/lib/console/use-now";
import { useConsole } from "../console-context";
import { Topbar } from "../console-frame";
import { DataTable } from "../data-table";
import { ConfirmDialog, Drawer } from "../overlay";
import { Button, Empty, KV, Notice, PageHead, Panel, Pill, Spinner, Tabs } from "../ui";
import { useCommand } from "../use-command";

/**
 * Support sessions (docs/console.md, docs/security.md): reasoned,
 * time-bounded, revocable, audited. A session opens a read-only summary of
 * one studio; it never signs you in as them.
 */
type Session = {
  id: string;
  tenantId: string;
  studioName?: string;
  platformUserId?: string;
  platformUserEmail?: string | null;
  reason?: string;
  status: "active" | "expired" | "revoked";
  durationMinutes?: number;
  expiresAt: string;
  revokedAt?: string | null;
  revocationReason?: string | null;
  createdAt: string;
};

type Summary = {
  tenant?: { id?: string; businessName?: string; status?: string };
  subscription?: { plan?: string; status?: string; periodEnd?: string } | null;
  integrations?: Array<{ provider?: string; status?: string; lastError?: string | null }>;
  failedJobs?: Array<{ id?: string; type?: string; status?: string; error?: unknown; updatedAt?: string }>;
  [key: string]: unknown;
};

function liveStatus(session: Session, now: number): Session["status"] {
  return session.status === "active" && Date.parse(session.expiresAt) <= now ? "expired" : session.status;
}

async function fetchSummary(tenantId: string, accessId: string): Promise<Summary> {
  const endpoint = process.env.NEXT_PUBLIC_SAAS_ADMIN_FUNCTIONS_URL;
  if (!endpoint) throw new Error("CONSOLE_COMMANDS_NOT_CONFIGURED");
  const user = getAuth(getFirebaseClient().app).currentUser;
  if (!user) throw new Error("AUTHENTICATION_REQUIRED");
  const token = await getAppCheckToken();
  const response = await fetch(`${endpoint.replace(/\/$/, "")}/supportTenantSummary?tenantId=${encodeURIComponent(tenantId)}&accessId=${encodeURIComponent(accessId)}`, {
    headers: { authorization: `Bearer ${await user.getIdToken()}`, ...(token ? { "x-firebase-appcheck": token } : {}) },
  });
  const payload = (await response.json().catch(() => ({}))) as Summary & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "SUPPORT_SUMMARY_FAILED");
  return payload;
}

export function SupportPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { can, studios, studioById, user } = useConsole();
  const { run, busy } = useCommand();
  const sessionId = params.get("session");
  const [tab, setTab] = useState<"active" | "past">("active");
  const [revoking, setRevoking] = useState<Session | null>(null);
  const [starting, setStarting] = useState(false);
  const now = useNow();
  const sessions = useLiveQuery<Session>("support:sessions", (firestore) => query(collection(firestore, "supportAccess"), orderBy("createdAt", "desc"), limit(300)));
  const rows = useMemo(() => (sessions.rows ? sessions.rows.filter((session) => (tab === "active" ? liveStatus(session, now) === "active" : liveStatus(session, now) !== "active")) : null), [sessions.rows, tab, now]);
  const open = (sessions.rows ?? []).find((session) => session.id === sessionId) ?? null;
  const setSession = (id: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (id) next.set("session", id);
    else next.delete("session");
    router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
  };

  const columns = useMemo<ColumnDef<Session, unknown>[]>(
    () => [
      { id: "studio", header: "Studio", accessorFn: (session) => session.studioName ?? studioById(session.tenantId)?.name ?? session.tenantId, meta: { width: 200, flex: true }, cell: ({ row }) => <span className="cx-strong">{row.original.studioName ?? studioById(row.original.tenantId)?.name ?? row.original.tenantId}</span> },
      { id: "admin", header: "Opened by", accessorFn: (session) => session.platformUserEmail ?? "", meta: { width: 200, priority: 2 }, cell: ({ row }) => (row.original.platformUserId === user?.uid ? "You" : (row.original.platformUserEmail ?? "—")) },
      { id: "reason", header: "Reason", accessorFn: (session) => session.reason ?? "", meta: { width: 240, priority: 3 }, cell: ({ row }) => row.original.reason },
      {
        id: "status",
        header: "Status",
        accessorFn: (session) => liveStatus(session, now),
        meta: { width: 150 },
        cell: ({ row }) => {
          const status = liveStatus(row.original, now);
          return status === "active" ? <Pill tone="ok">Active · {Math.max(0, Math.ceil((Date.parse(row.original.expiresAt) - now) / 60_000))}m left</Pill> : <Pill>{humanize(status)}</Pill>;
        },
      },
      { id: "started", header: "Started", accessorFn: (session) => session.createdAt, meta: { width: 110 }, cell: ({ row }) => relative(row.original.createdAt) },
    ],
    [now, studioById, user?.uid],
  );

  return (
    <>
      <Topbar crumbs={[{ label: "Platform" }, { label: "Support sessions" }]}>
        {can("support.session") ? (
          <Button onClick={() => setStarting(true)} variant="primary">
            <Plus size={13} /> Start a session
          </Button>
        ) : null}
      </Topbar>
      <div className="cx-content">
        <PageHead title="Support sessions" />
        <p className="cx-page-intro">A session gives you a read-only summary of one studio for up to an hour: subscription, integrations and failed jobs. Each one needs a reason, ends on its own, and every view is audited.</p>
        {sessions.error ? <Notice tone="bad">{sessions.error}</Notice> : null}
        <Tabs
          label="Session views"
          onChange={setTab}
          tabs={[
            { key: "active" as const, label: "Active", count: sessions.rows ? sessions.rows.filter((session) => liveStatus(session, now) === "active").length : null },
            { key: "past" as const, label: "Past" },
          ]}
          value={tab}
        />
        <DataTable columns={columns} empty={<Empty title={tab === "active" ? "No active sessions" : "No past sessions"} />} getRowId={(session) => session.id} label="Support sessions" onRowClick={(session) => setSession(session.id)} rows={rows} />
      </div>
      <SessionDrawer key={open?.id ?? "none"} onClose={() => setSession(null)} onRevoke={setRevoking} session={open} now={now} />
      <ConfirmDialog
        busy={busy === "revokeSupportAccess"}
        confirmLabel="End session"
        description="The summary stops working at once for whoever opened it."
        onClose={() => setRevoking(null)}
        onConfirm={async ({ reason }) => {
          if (!revoking) return;
          const result = await run("revokeSupportAccess", { supportAccessId: revoking.id, reason }, { done: "Session ended." });
          if (result) setRevoking(null);
        }}
        open={revoking !== null}
        title="End support session"
      />
      <StartSessionDialog onClose={() => setStarting(false)} onStarted={(id) => setSession(id)} open={starting} studios={(studios.rows ?? []).map((studio) => ({ id: studio.tenantId, name: studio.name }))} />
    </>
  );
}

function SessionDrawer({ session, onClose, onRevoke, now }: { session: Session | null; onClose: () => void; onRevoke: (session: Session) => void; now: number }) {
  const { can, user } = useConsole();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const status = session ? liveStatus(session, now) : null;
  const mine = session?.platformUserId === user?.uid;
  useEffect(() => {
    if (!session || status !== "active" || !mine) return;
    let active = true;
    fetchSummary(session.tenantId, session.id)
      .then((result) => active && setSummary(result))
      .catch((caught) => active && setError(friendlyError(caught, "The summary couldn't be loaded.")));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, status, mine]);
  if (!session) return null;
  return (
    <Drawer
      footer={status === "active" && can("support.session") ? <Button onClick={() => onRevoke(session)} variant="danger">End session</Button> : undefined}
      onClose={onClose}
      open
      title={`Support · ${session.studioName ?? session.tenantId}`}
      wide
    >
      <KV
        items={[
          ["Status", status === "active" ? `Active, ends ${relative(session.expiresAt)}` : humanize(status ?? "")],
          ["Reason", session.reason ?? "—"],
          ["Opened by", session.platformUserEmail ?? "—"],
          ["Started", dateTime(session.createdAt)],
          session.revokedAt ? ["Ended", `${dateTime(session.revokedAt)}${session.revocationReason ? ` · “${session.revocationReason}”` : ""}`] : null,
          ["Studio", <a className="cx-link" href={studioHref(session.tenantId)} key="s">Open the studio record</a>],
        ]}
      />
      {status !== "active" ? (
        <Notice>This session has ended. Start a new one to see the summary again.</Notice>
      ) : !mine ? (
        <Notice>Only the admin who opened a session can read its summary.</Notice>
      ) : error ? (
        <Notice tone="bad">{error}</Notice>
      ) : !summary ? (
        <div className="cx-empty"><Spinner /></div>
      ) : (
        <>
          <Panel title="Studio">
            <KV items={[["Name", summary.tenant?.businessName ?? "—"], ["Tenant status", humanize(summary.tenant?.status ?? "")], ["Plan", summary.subscription?.plan ?? "—"], ["Subscription", humanize(summary.subscription?.status ?? "none")], ["Period ends", dateTime(summary.subscription?.periodEnd)]]} />
          </Panel>
          <Panel flush title={`Integrations · ${summary.integrations?.length ?? 0}`}>
            {summary.integrations?.length ? (
              <div className="cx-timeline">
                {summary.integrations.map((item, index) => (
                  <div className="cx-tl-row" key={`${item.provider}-${index}`}>
                    <span className="cx-strong">{humanize(item.provider ?? "")}</span>
                    <span><Pill tone={item.status === "connected" ? "ok" : "bad"}>{humanize(item.status ?? "")}</Pill></span>
                    <span className="cx-mono cx-sub">{item.lastError ?? ""}</span>
                  </div>
                ))}
              </div>
            ) : (
              <Empty title="No integrations" />
            )}
          </Panel>
          <Panel flush title={`Failed provider jobs · ${summary.failedJobs?.length ?? 0}`}>
            {summary.failedJobs?.length ? (
              <div className="cx-timeline">
                {summary.failedJobs.map((job, index) => (
                  <div className="cx-tl-row" key={job.id ?? index}>
                    <span className="cx-tl-time">{relative(job.updatedAt)}</span>
                    <span><Pill tone="bad">{humanize(job.status ?? "")}</Pill></span>
                    <div className="cx-tl-body">
                      <b>{humanize(job.type ?? "")}</b>
                      <small className="cx-mono">{typeof job.error === "object" && job.error ? String((job.error as { code?: string }).code ?? "") : String(job.error ?? "")}</small>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <Empty title="No failed provider jobs" />
            )}
          </Panel>
        </>
      )}
    </Drawer>
  );
}

function StartSessionDialog({ open, onClose, onStarted, studios }: { open: boolean; onClose: () => void; onStarted: (id: string) => void; studios: Array<{ id: string; name: string }> }) {
  const { run, busy } = useCommand();
  const [tenantId, setTenantId] = useState("");
  const [minutes, setMinutes] = useState(30);
  return (
    <ConfirmDialog
      busy={busy === "grantSupportAccess"}
      confirmLabel={`Start ${minutes}-minute session`}
      description="Opens a read-only summary of the studio. It ends on its own and every view is audited."
      onClose={onClose}
      onConfirm={async ({ reason }) => {
        if (!tenantId) return;
        const result = await run<{ supportAccessId: string }>("grantSupportAccess", { tenantId, reason, durationMinutes: minutes }, { done: "Support session started." });
        if (result) {
          onClose();
          onStarted(result.supportAccessId);
        }
      }}
      open={open}
      reasonLabel="What did the studio report?"
      title="Start a support session"
    >
      <div className="cx-field">
        <label className="cx-label" htmlFor="support-studio">Studio</label>
        <select className="cx-select-input" id="support-studio" onChange={(event) => setTenantId(event.target.value)} value={tenantId}>
          <option value="">Choose a studio…</option>
          {[...studios].sort((a, b) => a.name.localeCompare(b.name)).map((studio) => (
            <option key={studio.id} value={studio.id}>{studio.name}</option>
          ))}
        </select>
      </div>
      <div className="cx-field">
        <span className="cx-label">Length</span>
        <div className="cx-segmented">
          {[15, 30, 60].map((value) => (
            <button aria-pressed={minutes === value} key={value} onClick={() => setMinutes(value)} type="button">{value} min</button>
          ))}
        </div>
      </div>
    </ConfirmDialog>
  );
}
