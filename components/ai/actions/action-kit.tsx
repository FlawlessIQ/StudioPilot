"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { doc, getDoc } from "firebase/firestore";
import { getFirebaseClient } from "@/lib/firebase/client";
import { Sparkles } from "lucide-react";
import { refreshTenantRecords, useTenantDocuments } from "@/components/live/tenant-records";
import { useWorkspace } from "@/features/auth/workspace-context";
import { matchSubject, type SubjectMatch } from "@/features/ai/flow-subject";
import { friendlyError } from "@/lib/ai/friendly-error";
import type { PreparedAction } from "@/lib/ai/copilot-client";

/**
 * The parts every prepared-action card is made of.
 *
 * A card is Cue's half of "AI prepares, human approves": it says what the tap
 * will do, shows the record it will do it to, asks for anything that is the
 * operator's to decide, and runs the same command the rest of the app runs —
 * as the operator, with that command's own authorization. Cards derive their
 * state from records rather than from the model, so a reopened thread shows
 * what actually happened.
 */

export type Rec = Record<string, unknown> & { id: string };

export const str = (value: unknown): string => (typeof value === "string" ? value : "");
export const num = (value: unknown): number => (typeof value === "number" ? value : 0);
export const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

export const dollars = (cents: unknown): string =>
  `$${(num(cents) / 100).toLocaleString(undefined, {
    minimumFractionDigits: num(cents) % 100 ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;

export type ActionCardProps = { action: PreparedAction };

export const OWNER_ADMIN = new Set(["studio_owner", "studio_admin"]);

export function useIsOwnerOrAdmin(): boolean {
  return OWNER_ADMIN.has(String(useWorkspace().role ?? ""));
}

/** One collection, as the rest of the app reads it (cached, refreshed after writes). */
export function useRecords(collection: string, enabled = true): Rec[] | null {
  const { records } = useTenantDocuments(collection, { enabled });
  return (records as Rec[] | null) ?? null;
}

/** The job a card is about, or null while it loads or when it has none. */
export function useJob(projectId: string | null): { job: Rec | null; loading: boolean } {
  const records = useRecords("projects", Boolean(projectId));
  if (!projectId) return { job: null, loading: false };
  if (!records) return { job: null, loading: true };
  return { job: records.find((item) => item.id === projectId) ?? null, loading: false };
}

export function jobName(job: Rec | null): string {
  return str(job?.name) || "this job";
}

/** Records of one collection on one job. */
export function onJob(records: Rec[] | null, projectId: string | null): Rec[] {
  return (records ?? []).filter((item) => item.projectId === projectId);
}

/**
 * The frame every card shares. `title` says what the tap does; `detail` says
 * what it will mean. Nothing in the frame is model-authored.
 */
export function ActionShell({
  title,
  detail,
  icon,
  children,
}: {
  title: string;
  detail?: ReactNode;
  icon?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="panel copilot-flow cue-action">
      <header className="copilot-flow-head">
        {icon ?? <Sparkles size={15} />}
        <span>
          <strong>{title}</strong>
          {detail ? <small>{detail}</small> : null}
        </span>
      </header>
      {children}
    </div>
  );
}

/** Why the card cannot do this right now, in the studio's terms. */
export function Blocked({ children }: { children: ReactNode }) {
  return (
    <p className="copilot-flow-subject" role="status">
      {children}
    </p>
  );
}

export function Loading() {
  return <p className="cue-action-note">Loading the records…</p>;
}

/** An existing panel from elsewhere in the app, mounted inside the card. */
export function Embedded({ children }: { children: ReactNode }) {
  return <div className="cue-action-embed">{children}</div>;
}

/**
 * Busy / notice / done for a card's one command. `run` refreshes the named
 * collections afterwards so every open panel shows the write.
 */
export function useRunner() {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  async function run(
    work: () => Promise<string | null | void>,
    options: { refresh?: string[]; fallback?: string } = {},
  ) {
    setBusy(true);
    setNotice(null);
    try {
      const message = await work();
      if (typeof message === "string") setDone(message);
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, options.fallback ?? "That could not be done. Nothing was changed."));
    } finally {
      setBusy(false);
      // After a refusal too: the usual reason is that the records moved on
      // (an automatic retainer invoice raised a moment earlier), and the card
      // should show where things now stand rather than the stale offer.
      refreshTenantRecords(...(options.refresh ?? []));
    }
  }
  return { busy, notice, done, setNotice, setDone, run };
}

export function Done({ children, href, label }: { children: ReactNode; href?: string; label?: string }) {
  return (
    <>
      <p className="cue-action-done" role="status">
        {children}
      </p>
      {href ? (
        <Link className="button button-dark" href={href}>
          {label ?? "Open it"}
        </Link>
      ) : null}
    </>
  );
}

export function Notice({ text }: { text: string | null }) {
  return text ? (
    <p className="cue-action-note" role="status">
      {text}
    </p>
  ) : null;
}

/** The approve button, and an optional secondary action beside it. */
export function Actions({
  label,
  busy,
  disabled,
  onClick,
  danger,
  secondary,
}: {
  label: string;
  busy: boolean;
  disabled?: boolean;
  onClick: () => void;
  danger?: boolean;
  secondary?: ReactNode;
}) {
  return (
    <div className="copilot-flow-actions">
      <button
        className={danger ? "button button-danger" : "button button-dark"}
        disabled={busy || disabled}
        onClick={onClick}
        type="button"
      >
        {busy ? "Working…" : label}
      </button>
      {secondary}
    </div>
  );
}

export function Form({ children }: { children: ReactNode }) {
  return <div className="copilot-flow-form">{children}</div>;
}

export function TextField({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "email" | "date" | "time" | "url" | "tel" | "number";
  placeholder?: string;
  hint?: string;
}) {
  return (
    <label>
      {label}
      {hint ? <span>{hint}</span> : null}
      <input
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        type={type}
        value={value}
      />
    </label>
  );
}

export function TextAreaField({
  label,
  value,
  onChange,
  rows = 4,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  hint?: string;
}) {
  return (
    <label>
      {label}
      {hint ? <span>{hint}</span> : null}
      <textarea onChange={(event) => onChange(event.target.value)} rows={rows} value={value} />
    </label>
  );
}

export function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label>
      {label}
      <select onChange={(event) => onChange(event.target.value)} value={value}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function CheckField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="cue-action-check">
      <input checked={checked} onChange={(event) => onChange(event.target.checked)} type="checkbox" />
      {label}
    </label>
  );
}

/**
 * The record the operator named, or a choice among the candidates.
 *
 * Matching is `features/ai/flow-subject.ts` — exact or full-token subset, no
 * guessing — because a wrong match here acts on the wrong person. A single
 * candidate is chosen without asking; several are offered as a pick list.
 */
export function useSubjectChoice(
  subject: string | null,
  options: Array<{ id: string; name: string }>,
): {
  match: SubjectMatch;
  chosen: string | null;
  choose: (id: string | null) => void;
} {
  const match = matchSubject(subject, options);
  const [picked, setPicked] = useState<string | null>(null);
  const automatic =
    match.kind === "matched" ? match.id : options.length === 1 ? options[0]!.id : null;
  const chosen = picked ?? automatic;
  return { match, chosen: options.some((option) => option.id === chosen) ? chosen : null, choose: setPicked };
}

export function SubjectPicker({
  subject,
  noun,
  options,
  match,
  chosen,
  choose,
}: {
  subject: string | null;
  noun: string;
  options: Array<{ id: string; name: string; detail?: string }>;
  match: SubjectMatch;
  chosen: string | null;
  choose: (id: string | null) => void;
}) {
  if (!options.length) return <Blocked>{`There is no ${noun} to choose from here.`}</Blocked>;
  return (
    <>
      {subject && match.kind === "unmatched" ? (
        <Blocked>{`I couldn't find a ${noun} called “${subject}”. Pick the one you meant.`}</Blocked>
      ) : null}
      {match.kind === "ambiguous" ? (
        <Blocked>{`More than one ${noun} matches “${subject}”. Pick the one you meant.`}</Blocked>
      ) : null}
      <div className="copilot-flow-options">
        {options.map((option) => (
          <button
            className={`copilot-flow-option${chosen === option.id ? " is-picked" : ""}`}
            key={option.id}
            onClick={() => choose(option.id)}
            type="button"
          >
            <strong>{option.name}</strong>
            {option.detail ? <small>{option.detail}</small> : null}
          </button>
        ))}
      </div>
    </>
  );
}

/** Local date/time → ISO, in the browser's zone. */
export function isoFrom(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const value = new Date(`${date}T${time}:00`);
  return Number.isNaN(value.getTime()) ? null : value.toISOString();
}

export const todayIso = (): string => {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};

export const browserZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";

/** The couple's first contact on a job. */
export function primaryContact(job: Rec | null, contacts: Rec[] | null): Rec | null {
  const id = str(arr(job?.clientContactIds)[0]);
  return (contacts ?? []).find((contact) => contact.id === id) ?? null;
}

export function contactName(contact: Rec | null): string {
  if (!contact) return "the client";
  return (
    str(contact.displayName) ||
    [str(contact.firstName), str(contact.lastName)].filter(Boolean).join(" ") ||
    str(contact.email) ||
    "the client"
  );
}

/** The newest proposal on a job still in play (not superseded or withdrawn). */
export function currentProposal(proposals: Rec[] | null, projectId: string | null): Rec | null {
  return (
    onJob(proposals, projectId)
      .filter((item) => !["superseded", "withdrawn", "discarded", "expired", "declined"].includes(str(item.status)))
      .sort((a, b) => num(b.version) - num(a.version))[0] ?? null
  );
}

/**
 * A job's state version as the server holds it now.
 *
 * Commands guarded by optimistic concurrency failed on production when a card
 * sent the version it last rendered, a beat behind a transition the previous
 * command caused (project-booking-workspace.tsx, reviewBooking). Read at the
 * moment of asking.
 */
export async function freshStateVersion(projectId: string, fallback: unknown): Promise<number> {
  try {
    const { firestore } = getFirebaseClient();
    const current = await getDoc(doc(firestore, "projects", projectId));
    if (current.exists()) return Number(current.get("stateVersion") ?? 0);
  } catch {
    // Fall back to the rendered version; the server still refuses a stale one.
  }
  return Number(fallback ?? 0);
}

export type { PreparedAction };
