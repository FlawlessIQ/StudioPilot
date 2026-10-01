"use client";

import { useId, useMemo, useState } from "react";
import { collection, query, where } from "firebase/firestore";
import { X } from "lucide-react";
import type { ConsoleStudio } from "@/features/console/model";
import { useLiveDoc, useLiveQuery } from "@/lib/console/live";
import { useNow } from "@/lib/console/use-now";
import { useConsole } from "./console-context";
import { Dialog } from "./overlay";
import { Button, Notice } from "./ui";
import { useCommand } from "./use-command";

/**
 * The CRM dialogs shared by the Studios table, its bulk bar and a studio's
 * record: email the owner, add a task, tag.
 */

const ACTION_LINKS = [
  { value: "", label: "No button" },
  { value: "/studio", label: "Open StudioCue" },
  { value: "/studio/subscription", label: "Their subscription" },
  { value: "/studio/setup", label: "Setup" },
  { value: "/studio/integrations", label: "Integrations" },
  { value: "/studio/help", label: "Help" },
];

export type SavedReply = { id: string; title?: string; subject?: string; body?: string; kind?: string; archivedAt?: string | null };

type EmailStudioProps = {
  open: boolean;
  onClose: () => void;
  studios: ConsoleStudio[];
  preset?: { subject?: string; body?: string; actionPath?: string };
};

/** Mounts fresh each time it opens, so a half-written email never carries over. */
export function EmailStudioDialog(props: EmailStudioProps) {
  return props.open ? <EmailStudioBody {...props} /> : null;
}

function EmailStudioBody({ open, onClose, studios, preset }: EmailStudioProps) {
  const { run, busy } = useCommand();
  const [subject, setSubject] = useState(preset?.subject ?? "");
  const [body, setBody] = useState(preset?.body ?? "");
  const [actionPath, setActionPath] = useState(preset?.actionPath ?? "");
  const subjectId = useId();
  const bodyId = useId();
  const actionId = useId();
  const replyId = useId();
  const replies = useLiveQuery<SavedReply>(open ? "replies:studio" : null, (firestore) =>
    query(collection(firestore, "consoleReplies"), where("kind", "==", "studio")),
  );
  const missing = studios.filter((studio) => !studio.ownerEmail);
  const reachable = studios.length - missing.length;
  const first = studios[0];
  const send = async () => {
    const result = await run<{ sent: number }>(
      "emailStudio",
      {
        tenantIds: studios.map((studio) => studio.tenantId),
        subject,
        body,
        actionPath: actionPath || null,
        actionLabel: actionPath ? (ACTION_LINKS.find((link) => link.value === actionPath)?.label ?? null) : null,
      },
      { done: (outcome) => (outcome.sent === 1 ? "Email queued to the studio owner." : `Emails queued to ${outcome.sent} studio owners.`) },
    );
    if (result) onClose();
  };
  const usable = (replies.rows ?? []).filter((reply) => !reply.archivedAt);
  return (
    <Dialog
      footer={
        <>
          <Button onClick={onClose} variant="ghost">
            Cancel
          </Button>
          <Button
            busy={busy === "emailStudio"}
            disabled={subject.trim().length < 3 || body.trim().length < 10 || reachable === 0}
            onClick={() => void send()}
            variant="primary"
          >
            {studios.length > 1 ? `Send to ${reachable}` : "Send"}
          </Button>
        </>
      }
      onClose={onClose}
      open={open}
      title={studios.length === 1 ? `Email ${first?.ownerName ?? "the owner"}` : `Email ${studios.length} studio owners`}
    >
      <p className="cx-hint">
        To:{" "}
        {studios.length === 1 ? `${first?.ownerName ?? "Owner"} <${first?.ownerEmail ?? "no email"}> · ${first?.name}` : `${reachable} owners`}.
        Signed “The StudioCue team”. Replies go to the team inbox.
      </p>
      {missing.length ? (
        <Notice tone="warn">
          {`${missing.length === 1 ? `${missing[0]?.name} has` : `${missing.length} studios have`} no owner email on record and won't get this.`}
        </Notice>
      ) : null}
      {usable.length ? (
        <div className="cx-field">
          <label className="cx-label" htmlFor={replyId}>
            Start from a saved reply
          </label>
          <select
            className="cx-select-input"
            defaultValue=""
            id={replyId}
            onChange={(event) => {
              const reply = usable.find((item) => item.id === event.target.value);
              if (reply?.subject) setSubject(reply.subject);
              if (reply?.body) setBody(reply.body);
            }}
          >
            <option value="">Choose…</option>
            {usable.map((reply) => (
              <option key={reply.id} value={reply.id}>
                {reply.title ?? reply.subject ?? "Untitled"}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <div className="cx-field">
        <label className="cx-label" htmlFor={subjectId}>
          Subject
        </label>
        <input className="cx-input" id={subjectId} maxLength={160} onChange={(event) => setSubject(event.target.value)} value={subject} />
      </div>
      <div className="cx-field">
        <label className="cx-label" htmlFor={bodyId}>
          Message
        </label>
        <textarea className="cx-textarea" id={bodyId} maxLength={6000} onChange={(event) => setBody(event.target.value)} rows={8} value={body} />
        <span className="cx-hint">Opens with “Hi {studios.length === 1 ? (first?.ownerName?.split(" ")[0] ?? "there") : "<first name>"},” and ends with the team sign-off.</span>
      </div>
      <div className="cx-field">
        <label className="cx-label" htmlFor={actionId}>
          Button
        </label>
        <select className="cx-select-input" id={actionId} onChange={(event) => setActionPath(event.target.value)} value={actionPath}>
          {ACTION_LINKS.map((link) => (
            <option key={link.value} value={link.value}>
              {link.label}
            </option>
          ))}
        </select>
      </div>
    </Dialog>
  );
}

type Admin = { id: string; uid: string; email?: string | null; name?: string | null; active?: boolean };

/** A due date is 5pm local on the chosen day. */
export function dueIso(day: string): string | null {
  if (!day) return null;
  const at = new Date(`${day}T17:00:00`);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

export function useAdmins(enabled = true) {
  return useLiveQuery<Admin>(enabled ? "admins:active" : null, (firestore) =>
    query(collection(firestore, "platformAdmins"), where("active", "==", true)),
  );
}

type TaskDialogProps = {
  open: boolean;
  onClose: () => void;
  subjectKeys: string[];
  subjectLabel?: string;
  defaultTitle?: string;
};

export function TaskDialog(props: TaskDialogProps) {
  return props.open ? <TaskBody {...props} /> : null;
}

function TaskBody({ open, onClose, subjectKeys, subjectLabel, defaultTitle = "" }: TaskDialogProps) {
  const { run, busy } = useCommand();
  const { user } = useConsole();
  const now = useNow();
  const [title, setTitle] = useState(defaultTitle);
  const [day, setDay] = useState(() => new Date(now + 86_400_000).toISOString().slice(0, 10));
  const [assignee, setAssignee] = useState(user?.uid ?? "");
  const titleId = useId();
  const dueId = useId();
  const whoId = useId();
  const admins = useAdmins(open);
  const save = async () => {
    const result = await run(
      "createTask",
      { title, dueAt: dueIso(day), subjectKeys, assigneeUid: assignee || null },
      { done: subjectKeys.length > 1 ? `${subjectKeys.length} tasks added.` : "Task added." },
    );
    if (result) onClose();
  };
  return (
    <Dialog
      footer={
        <>
          <Button onClick={onClose} variant="ghost">
            Cancel
          </Button>
          <Button busy={busy === "createTask"} disabled={title.trim().length < 2} onClick={() => void save()} variant="primary">
            Add task
          </Button>
        </>
      }
      onClose={onClose}
      open={open}
      title={subjectKeys.length > 1 ? `Add a task to ${subjectKeys.length} studios` : "Add a task"}
    >
      {subjectLabel ? <p className="cx-hint">For {subjectLabel}</p> : null}
      <div className="cx-field">
        <label className="cx-label" htmlFor={titleId}>
          Task
        </label>
        <input className="cx-input" id={titleId} maxLength={300} onChange={(event) => setTitle(event.target.value)} placeholder="Call about the annual plan" value={title} />
      </div>
      <div className="cx-row-2">
        <div className="cx-field">
          <label className="cx-label" htmlFor={dueId}>
            Due
          </label>
          <input className="cx-input" id={dueId} onChange={(event) => setDay(event.target.value)} type="date" value={day} />
        </div>
        <div className="cx-field">
          <label className="cx-label" htmlFor={whoId}>
            Owner
          </label>
          <select className="cx-select-input" id={whoId} onChange={(event) => setAssignee(event.target.value)} value={assignee}>
            {user ? <option value={user.uid}>Me</option> : null}
            {(admins.rows ?? [])
              .filter((admin) => admin.uid !== user?.uid)
              .map((admin) => (
                <option key={admin.uid} value={admin.uid}>
                  {admin.name ?? admin.email ?? admin.uid}
                </option>
              ))}
          </select>
        </div>
      </div>
    </Dialog>
  );
}

type TagsDialogProps = {
  open: boolean;
  onClose: () => void;
  tenantIds: string[];
  current?: string[];
};

export function TagsDialog(props: TagsDialogProps) {
  return props.open ? <TagsBody {...props} /> : null;
}

function TagsBody({ open, onClose, tenantIds, current = [] }: TagsDialogProps) {
  const { run, busy } = useCommand();
  const single = tenantIds.length === 1;
  const [tags, setTags] = useState<string[]>(single ? current : []);
  const [draft, setDraft] = useState("");
  const inputId = useId();
  const known = useLiveDoc<{ tags?: string[] }>(open ? "consoleSettings/tags" : null);
  const suggestions = useMemo(
    () => (known.data?.tags ?? []).filter((tag) => !tags.includes(tag) && tag.includes(draft.trim().toLowerCase())).slice(0, 12),
    [known.data, tags, draft],
  );
  const add = (value: string) => {
    const tag = value.trim().toLowerCase().replace(/[^a-z0-9 -]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 24);
    if (tag && !tags.includes(tag)) setTags((list) => [...list, tag]);
    setDraft("");
  };
  const save = async () => {
    const pending = draft.trim() ? [...tags, draft.trim().toLowerCase()] : tags;
    const result = await run(
      "setStudioTags",
      { tenantIds, tags: pending, mode: single ? "replace" : "add" },
      { done: single ? "Tags saved." : `Tags added to ${tenantIds.length} studios.` },
    );
    if (result) onClose();
  };
  return (
    <Dialog
      footer={
        <>
          <Button onClick={onClose} variant="ghost">
            Cancel
          </Button>
          <Button busy={busy === "setStudioTags"} disabled={!single && !tags.length && !draft.trim()} onClick={() => void save()} variant="primary">
            {single ? "Save tags" : "Add tags"}
          </Button>
        </>
      }
      onClose={onClose}
      open={open}
      title={single ? "Tags" : `Add tags to ${tenantIds.length} studios`}
    >
      <div className="cx-tags">
        {tags.length ? (
          tags.map((tag) => (
            <span className="cx-tag" key={tag}>
              {tag}
              <button aria-label={`Remove ${tag}`} className="cx-link" onClick={() => setTags((list) => list.filter((item) => item !== tag))} type="button">
                <X size={11} />
              </button>
            </span>
          ))
        ) : (
          <span className="cx-hint">No tags yet.</span>
        )}
      </div>
      <div className="cx-field">
        <label className="cx-label" htmlFor={inputId}>
          Add a tag
        </label>
        <input
          className="cx-input"
          id={inputId}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              add(draft);
            }
          }}
          placeholder="pilot, video, referral…"
          value={draft}
        />
        <span className="cx-hint">
          Press Enter to add. {single ? "Replaces this studio's tags." : "Adds to each studio's existing tags."}
        </span>
      </div>
      {suggestions.length ? (
        <div className="cx-tags">
          {suggestions.map((tag) => (
            <button className="cx-chip" key={tag} onClick={() => add(tag)} type="button">
              + {tag}
            </button>
          ))}
        </div>
      ) : null}
    </Dialog>
  );
}
