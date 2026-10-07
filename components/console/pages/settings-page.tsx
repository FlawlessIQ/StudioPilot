"use client";

import { useMemo, useState } from "react";
import { collection, limit, query } from "firebase/firestore";
import { DEFAULT_HEALTH_WEIGHTS, HEALTH_WEIGHT_LABELS, type HealthWeightKey } from "@/features/console/model";
import { CONSOLE_ROLES, CONSOLE_ROLE_LABELS, CONSOLE_ROLE_SUMMARIES } from "@/features/console/roles";
import { relative } from "@/lib/console/format";
import { useLiveDoc, useLiveQuery } from "@/lib/console/live";
import { useConsole } from "../console-context";
import { Topbar } from "../console-frame";
import type { SavedReply } from "../crm-dialogs";
import { ActionMenu } from "../menu";
import { ConfirmDialog, Drawer } from "../overlay";
import { Avatar, Button, Empty, KV, PageHead, Panel, Pill, Tabs } from "../ui";
import { useCommand } from "../use-command";

/** Console settings (docs/console.md): admins, saved replies, health weights, tags, preferences. */
type Admin = { id: string; uid: string; email?: string | null; name?: string | null; role?: string | null; active?: boolean; syncedAt?: string };
type Section = "admins" | "replies" | "health" | "tags" | "preferences" | "growth";

export function SettingsPage() {
  const [section, setSection] = useState<Section>("admins");
  return (
    <>
      <Topbar crumbs={[{ label: "System" }, { label: "Settings" }]} />
      <div className="cx-content">
        <PageHead title="Settings" />
        <Tabs
          label="Settings sections"
          onChange={setSection}
          tabs={[
            { key: "admins" as const, label: "Console admins" },
            { key: "replies" as const, label: "Saved replies" },
            { key: "health" as const, label: "Health score" },
            { key: "growth" as const, label: "Book a demo" },
            { key: "tags" as const, label: "Tags" },
            { key: "preferences" as const, label: "Your preferences" },
          ]}
          value={section}
        />
        {section === "admins" ? <AdminsSection /> : null}
        {section === "replies" ? <RepliesSection /> : null}
        {section === "health" ? <HealthSection /> : null}
        {section === "growth" ? <GrowthSection /> : null}
        {section === "tags" ? <TagsSection /> : null}
        {section === "preferences" ? <PreferencesSection /> : null}
      </div>
    </>
  );
}

function AdminsSection() {
  const { role, user } = useConsole();
  const { run, busy } = useCommand();
  const admins = useLiveQuery<Admin>("settings:admins", (firestore) => query(collection(firestore, "platformAdmins"), limit(200)));
  const [granting, setGranting] = useState(false);
  const [email, setEmail] = useState("");
  const [newRole, setNewRole] = useState<string>("support");
  const [change, setChange] = useState<{ admin: Admin; role: string } | null>(null);
  const active = (admins.rows ?? []).filter((admin) => admin.active !== false);
  return (
    <>
      <Panel actions={role === "owner" ? <Button onClick={() => setGranting(true)} size="sm">Give someone access</Button> : null} flush title={`Console admins · ${active.length}`}>
        {active.length ? (
          <div className="cx-timeline">
            {active.map((admin) => (
              <div className="cx-tl-row" key={admin.uid} style={{ gridTemplateColumns: "minmax(0,1fr) 140px 44px", alignItems: "center" }}>
                <span className="cx-name">
                  <Avatar name={admin.name ?? admin.email} round />
                  <span className="cx-name-text">
                    <b>{admin.name ?? admin.email}{admin.uid === user?.uid ? " (you)" : ""}</b>
                    <small>{admin.email}</small>
                  </span>
                </span>
                <Pill tone="accent">{CONSOLE_ROLE_LABELS[(admin.role ?? "owner") as keyof typeof CONSOLE_ROLE_LABELS] ?? admin.role}</Pill>
                {role === "owner" && admin.uid !== user?.uid ? (
                  <ActionMenu
                    iconOnly
                    items={[
                      ...CONSOLE_ROLES.filter((option) => option !== admin.role).map((option) => ({ label: `Make ${CONSOLE_ROLE_LABELS[option]}`, onSelect: () => setChange({ admin, role: option }) })),
                      { kind: "separator" as const },
                      { label: "Remove Console access", danger: true, onSelect: () => setChange({ admin, role: "none" }) },
                    ]}
                    label={`Change ${admin.email}`}
                  />
                ) : (
                  <span />
                )}
              </div>
            ))}
          </div>
        ) : (
          <Empty title="No admins listed yet">The list fills from sign-in claims on the next rollup.</Empty>
        )}
      </Panel>
      <Panel title="What each role can do">
        <KV items={CONSOLE_ROLES.map((option) => [CONSOLE_ROLE_LABELS[option], CONSOLE_ROLE_SUMMARIES[option]] as [string, string])} />
      </Panel>
      <ConfirmDialog
        busy={busy === "setConsoleRole"}
        confirmLabel="Give access"
        description="They need a StudioCue account with this email already. They're signed out once so the new access applies."
        onClose={() => setGranting(false)}
        onConfirm={async ({ reason }) => {
          const result = await run("setConsoleRole", { email: email.trim(), role: newRole, reason }, { done: `${email.trim()} can now use the Console.` });
          if (result) {
            setGranting(false);
            setEmail("");
          }
        }}
        open={granting}
        title="Give Console access"
      >
        <div className="cx-field">
          <label className="cx-label" htmlFor="grant-email">Email</label>
          <input className="cx-input" id="grant-email" onChange={(event) => setEmail(event.target.value)} type="email" value={email} />
        </div>
        <div className="cx-field">
          <label className="cx-label" htmlFor="grant-role">Role</label>
          <select className="cx-select-input" id="grant-role" onChange={(event) => setNewRole(event.target.value)} value={newRole}>
            {CONSOLE_ROLES.map((option) => <option key={option} value={option}>{CONSOLE_ROLE_LABELS[option]}: {CONSOLE_ROLE_SUMMARIES[option]}</option>)}
          </select>
        </div>
      </ConfirmDialog>
      <ConfirmDialog
        busy={busy === "setConsoleRole"}
        confirmLabel={change?.role === "none" ? "Remove access" : "Change role"}
        danger={change?.role === "none"}
        description={change ? (change.role === "none" ? `${change.admin.email} loses all Console access and is signed out.` : `${change.admin.email} becomes ${CONSOLE_ROLE_LABELS[change.role as keyof typeof CONSOLE_ROLE_LABELS]} and is signed out once.`) : ""}
        onClose={() => setChange(null)}
        onConfirm={async ({ reason }) => {
          if (!change) return;
          const result = await run("setConsoleRole", { uid: change.admin.uid, role: change.role, reason }, { done: "Access changed." });
          if (result) setChange(null);
        }}
        open={change !== null}
        title="Change Console access"
      />
    </>
  );
}

function RepliesSection() {
  const { can } = useConsole();
  const replies = useLiveQuery<SavedReply & { updatedAt?: string }>("settings:replies", (firestore) => query(collection(firestore, "consoleReplies"), limit(500)));
  const [editing, setEditing] = useState<Partial<SavedReply> | null>(null);
  const live = (replies.rows ?? []).filter((reply) => !reply.archivedAt);
  return (
    <>
      <Panel actions={can("inbox.write") ? <Button onClick={() => setEditing({})} size="sm">New saved reply</Button> : null} flush title={`Saved replies · ${live.length}`}>
        {live.length ? (
          <div className="cx-timeline">
            {live.map((reply) => (
              <button className="cx-item" key={reply.id} onClick={() => setEditing(reply)} type="button">
                <span className="cx-item-title">{reply.title}</span>
                <span className="cx-item-time">{reply.kind === "studio" ? "Studio email" : "Feedback reply"}</span>
                <span className="cx-item-snippet">{reply.body}</span>
              </button>
            ))}
          </div>
        ) : (
          <Empty title="No saved replies">Save answers you send often, and pick them in the inbox or when emailing a studio.</Empty>
        )}
      </Panel>
      {editing ? <ReplyEditor editing={editing} key={editing.id ?? "new"} onClose={() => setEditing(null)} /> : null}
    </>
  );
}

function ReplyEditor({ editing, onClose }: { editing: Partial<SavedReply>; onClose: () => void }) {
  const { run, busy } = useCommand();
  const [title, setTitle] = useState(editing.title ?? "");
  const [subject, setSubject] = useState(editing.subject ?? "");
  const [body, setBody] = useState(editing.body ?? "");
  const [kind, setKind] = useState<"feedback" | "studio">((editing.kind as "feedback" | "studio") ?? "feedback");
  return (
      <Drawer
        footer={
          <>
            {editing?.id ? (
              <Button onClick={() => void run("saveReply", { replyId: editing.id, kind, title, subject, body, archived: true }, { done: "Saved reply archived." }).then((result) => result && onClose())} variant="danger">
                Archive
              </Button>
            ) : null}
            <Button onClick={onClose} variant="ghost">Cancel</Button>
            <Button busy={busy === "saveReply"} disabled={title.trim().length < 2 || body.trim().length < 2} onClick={() => void run("saveReply", { ...(editing?.id ? { replyId: editing.id } : {}), kind, title, subject: subject || undefined, body }, { done: "Saved." }).then((result) => result && onClose())} variant="primary">
              Save
            </Button>
          </>
        }
        onClose={onClose}
        open
        title={editing?.id ? "Edit saved reply" : "New saved reply"}
      >
        <div className="cx-form">
          <div className="cx-field">
            <span className="cx-label">Used for</span>
            <div className="cx-segmented">
              <button aria-pressed={kind === "feedback"} onClick={() => setKind("feedback")} type="button">Feedback replies</button>
              <button aria-pressed={kind === "studio"} onClick={() => setKind("studio")} type="button">Studio emails</button>
            </div>
          </div>
          <div className="cx-field">
            <label className="cx-label" htmlFor="reply-title">Name</label>
            <input className="cx-input" id="reply-title" maxLength={80} onChange={(event) => setTitle(event.target.value)} value={title} />
          </div>
          {kind === "studio" ? (
            <div className="cx-field">
              <label className="cx-label" htmlFor="reply-subject">Subject</label>
              <input className="cx-input" id="reply-subject" maxLength={160} onChange={(event) => setSubject(event.target.value)} value={subject} />
            </div>
          ) : null}
          <div className="cx-field">
            <label className="cx-label" htmlFor="reply-body">Message</label>
            <textarea className="cx-textarea" id="reply-body" maxLength={6000} onChange={(event) => setBody(event.target.value)} rows={10} value={body} />
            <span className="cx-hint">The greeting and the “The StudioCue team” sign-off are added for you.</span>
          </div>
        </div>
      </Drawer>
  );
}

function HealthSection() {
  const stored = useLiveDoc<{ weights?: Partial<Record<HealthWeightKey, number>>; updatedAt?: string }>("consoleSettings/health");
  if (stored.loading) return null;
  // Keyed by the saved version, so the form starts from what's stored and refreshes when someone saves.
  return <HealthForm key={stored.data?.updatedAt ?? "defaults"} stored={stored.data} />;
}

function HealthForm({ stored: storedData }: { stored: { weights?: Partial<Record<HealthWeightKey, number>>; updatedAt?: string } | null }) {
  const { can } = useConsole();
  const { run, busy } = useCommand();
  const stored = { data: storedData };
  const [weights, setWeights] = useState<Record<HealthWeightKey, number>>(() => ({ ...DEFAULT_HEALTH_WEIGHTS, ...(storedData?.weights ?? {}) }));
  const [confirm, setConfirm] = useState(false);
  const changed = useMemo(() => (Object.keys(weights) as HealthWeightKey[]).some((key) => weights[key] !== ({ ...DEFAULT_HEALTH_WEIGHTS, ...(stored.data?.weights ?? {}) } as Record<HealthWeightKey, number>)[key]), [weights, stored.data]);
  return (
    <Panel
      actions={
        can("settings.write") ? (
          <>
            <Button onClick={() => setWeights(DEFAULT_HEALTH_WEIGHTS)} size="sm" variant="ghost">Defaults</Button>
            <Button disabled={!changed} onClick={() => setConfirm(true)} size="sm" variant="primary">Save</Button>
          </>
        ) : null
      }
      title="Points each signal takes off a studio's health"
    >
      <span className="cx-hint">A studio starts at 100. Good is 75 and up, Fair 50 to 74, Poor below 50. Changes apply at the next rollup.{stored.data?.updatedAt ? ` Last changed ${relative(stored.data.updatedAt)}.` : ""}</span>
      <div className="cx-grid-2">
        {(Object.keys(HEALTH_WEIGHT_LABELS) as HealthWeightKey[]).map((key) => (
          <div className="cx-field" key={key}>
            <label className="cx-label" htmlFor={`weight-${key}`}>{HEALTH_WEIGHT_LABELS[key]}</label>
            <input className="cx-input" disabled={!can("settings.write")} id={`weight-${key}`} max={100} min={0} onChange={(event) => setWeights((current) => ({ ...current, [key]: Math.max(0, Math.min(100, Number(event.target.value) || 0)) }))} type="number" value={weights[key]} />
          </div>
        ))}
      </div>
      <ConfirmDialog
        busy={busy === "setHealthWeights"}
        confirmLabel="Save weights"
        description="Every studio's health score is recalculated with these at the next rollup."
        onClose={() => setConfirm(false)}
        onConfirm={async ({ reason }) => {
          const result = await run("setHealthWeights", { weights, reason }, { done: "Health weights saved." });
          if (result) setConfirm(false);
        }}
        open={confirm}
        title="Save health weights"
      />
    </Panel>
  );
}

type GrowthSettings = { demoNotifyEmail?: string | null; demoBookingUrl?: string | null; updatedAt?: string };

/** Book a demo (docs/console.md, "Pipeline"): who hears about a request, and the calendar link offered after it. */
function GrowthSection() {
  const stored = useLiveDoc<GrowthSettings>("consoleSettings/growth");
  if (stored.loading) return null;
  return <GrowthForm key={stored.data?.updatedAt ?? "unset"} stored={stored.data} />;
}

function GrowthForm({ stored }: { stored: GrowthSettings | null }) {
  const { can } = useConsole();
  const { run, busy } = useCommand();
  const [email, setEmail] = useState(stored?.demoNotifyEmail ?? "");
  const [url, setUrl] = useState(stored?.demoBookingUrl ?? "");
  const validEmail = !email || /\S+@\S+\.\S+/.test(email);
  const validUrl = !url || /^https:\/\/\S+$/.test(url);
  return (
    <Panel
      actions={
        can("settings.write") ? (
          <Button
            busy={busy === "setGrowthSettings"}
            disabled={!validEmail || !validUrl}
            onClick={() => void run("setGrowthSettings", { demoNotifyEmail: email.trim() || null, demoBookingUrl: url.trim() || null }, { done: "Saved." })}
            size="sm"
            variant="primary"
          >
            Save
          </Button>
        ) : null
      }
      title="Book a demo"
    >
      <span className="cx-hint">A request on studio-cue.com/demo lands on Grow → Pipeline. These decide who hears about it, and what the photographer is offered next.</span>
      <div className="cx-grid-2">
        <div className="cx-field">
          <label className="cx-label" htmlFor="growth-email">Email each request to</label>
          <input className="cx-input" disabled={!can("settings.write")} id="growth-email" onChange={(event) => setEmail(event.target.value)} placeholder="team@studio-cue.com" type="email" value={email} />
          <span className="cx-hint">{email ? "Reply to the email to answer them." : "Nobody is emailed. Requests still show on Pipeline and Home."}</span>
        </div>
        <div className="cx-field">
          <label className="cx-label" htmlFor="growth-url">Calendar link (optional)</label>
          <input className="cx-input" disabled={!can("settings.write")} id="growth-url" onChange={(event) => setUrl(event.target.value)} placeholder="https://calendar.app.google/…" type="url" value={url} />
          <span className="cx-hint">Offered as Pick a time once they send the form. A Google Calendar booking page or Calendly link.</span>
        </div>
      </div>
    </Panel>
  );
}

function TagsSection() {
  const { studios } = useConsole();
  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const studio of studios.rows ?? []) for (const tag of studio.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [studios.rows]);
  return (
    <Panel title="Tags in use">
      {tags.length ? (
        <KV items={tags.map(([tag, count]) => [tag, <a className="cx-link" href={`/platform-admin/studios`} key={tag}>{count} {count === 1 ? "studio" : "studios"}</a>] as [string, React.ReactNode])} />
      ) : (
        <Empty title="No tags yet">Tag studios from their record or the Studios table.</Empty>
      )}
    </Panel>
  );
}

function PreferencesSection() {
  const { theme, setTheme, density, setDensity } = useConsole();
  return (
    <Panel title="Your preferences">
      <span className="cx-hint">Saved in this browser only.</span>
      <div className="cx-field">
        <span className="cx-label">Theme</span>
        <div className="cx-segmented" style={{ maxWidth: 360 }}>
          {(["system", "light", "dark"] as const).map((option) => (
            <button aria-pressed={theme === option} key={option} onClick={() => setTheme(option)} type="button">
              {option === "system" ? "Match system" : option === "light" ? "Light" : "Dark"}
            </button>
          ))}
        </div>
      </div>
      <div className="cx-field">
        <span className="cx-label">Table rows</span>
        <div className="cx-segmented" style={{ maxWidth: 360 }}>
          <button aria-pressed={density === "comfortable"} onClick={() => setDensity("comfortable")} type="button">Comfortable</button>
          <button aria-pressed={density === "compact"} onClick={() => setDensity("compact")} type="button">Compact</button>
        </div>
      </div>
    </Panel>
  );
}
