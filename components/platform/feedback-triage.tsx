"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { collection, getDocs, limit, orderBy, query } from "firebase/firestore";
import { connectStorageEmulator, getDownloadURL, getStorage, ref } from "firebase/storage";
import { getFirebaseClient } from "@/lib/firebase/client";
import {
  FEEDBACK_KIND_LABELS,
  FEEDBACK_STATUSES,
  FEEDBACK_STATUS_LABELS,
  isFeedbackKind,
  isFeedbackStatus,
  type FeedbackKind,
  type FeedbackStatus,
} from "@/features/feedback/model";
import { feedbackErrorMessage, setFeedbackStatus } from "@/lib/feedback/command-client";

/**
 * The team's view of studio feedback (platform admins only — firestore.rules).
 *
 * Moving one to Planned or Shipped emails the studio that sent it, when they
 * said they could be contacted; the note goes in that email and in their
 * "Your feedback" list, so write it to them.
 */

type Feedback = {
  id: string;
  kind: FeedbackKind;
  message: string;
  status: FeedbackStatus;
  statusNote: string | null;
  studioName: string;
  userName: string | null;
  userEmail: string | null;
  followUpOk: boolean;
  route: string;
  viewport: string | null;
  lastError: string | null;
  screenshotPath: string | null;
  createdAt: string;
};

type Filter = "open" | FeedbackStatus | "all";

let storageEmulatorConnected = false;

function text(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

export function FeedbackTriage() {
  const [items, setItems] = useState<Feedback[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("open");
  const [focusId, setFocusId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { firestore } = getFirebaseClient();
      const snapshot = await getDocs(query(collection(firestore, "feedback"), orderBy("createdAt", "desc"), limit(200)));
      setItems(
        snapshot.docs.map((document) => {
          const data = document.data();
          return {
            id: document.id,
            kind: isFeedbackKind(data.kind) ? data.kind : "idea",
            message: text(data.message) ?? "",
            status: isFeedbackStatus(data.status) ? data.status : "received",
            statusNote: text(data.statusNote),
            studioName: text(data.studioName) ?? text(data.tenantId) ?? "Unknown studio",
            userName: text(data.userName),
            userEmail: text(data.userEmail),
            followUpOk: data.followUpOk === true,
            route: text(data.route) ?? "",
            viewport: text(data.viewport),
            lastError: text(data.lastError),
            screenshotPath: text(data.screenshotPath),
            createdAt: text(data.createdAt) ?? "",
          };
        }),
      );
      setError(null);
    } catch {
      setError("Feedback couldn't be loaded. This page needs a platform admin sign-in.");
    }
  }, []);

  useEffect(() => {
    // An email's "Open in triage" link lands on the one it was about.
    const linked = new URL(window.location.href).searchParams.get("id");
    if (linked) {
      queueMicrotask(() => {
        setFocusId(linked);
        setFilter("all");
      });
    }
    queueMicrotask(() => void load());
  }, [load]);

  const counts = useMemo(() => {
    const result: Record<string, number> = { all: items?.length ?? 0, open: 0 };
    for (const item of items ?? []) {
      result[item.status] = (result[item.status] ?? 0) + 1;
      if (item.status === "received" || item.status === "planned") result.open = (result.open ?? 0) + 1;
    }
    return result;
  }, [items]);

  const shown = (items ?? []).filter((item) =>
    focusId
      ? item.id === focusId
      : filter === "all"
        ? true
        : filter === "open"
          ? item.status === "received" || item.status === "planned"
          : item.status === filter,
  );

  const filters: Array<[Filter, string]> = [
    ["open", "Open"],
    ...FEEDBACK_STATUSES.map((status): [Filter, string] => [status, FEEDBACK_STATUS_LABELS[status]]),
    ["all", "All"],
  ];

  return (
    <section className="feedback-triage">
      <div className="feedback-triage-filters" role="tablist">
        {filters.map(([value, label]) => (
          <button
            aria-selected={!focusId && filter === value}
            data-active={!focusId && filter === value ? "true" : "false"}
            key={value}
            onClick={() => {
              setFocusId(null);
              setFilter(value);
            }}
            role="tab"
            type="button"
          >
            {label} <small>{counts[value] ?? 0}</small>
          </button>
        ))}
      </div>
      {error ? <p className="feedback-error">{error}</p> : null}
      {items === null && !error ? <p className="feedback-triage-empty">Loading…</p> : null}
      {items !== null && shown.length === 0 ? <p className="feedback-triage-empty">Nothing here.</p> : null}
      <div className="feedback-triage-list">
        {shown.map((item) => (
          <FeedbackCard item={item} key={item.id} onChanged={load} />
        ))}
      </div>
    </section>
  );
}

function FeedbackCard({ item, onChanged }: { item: Feedback; onChanged: () => Promise<void> }) {
  const [status, setStatus] = useState<FeedbackStatus>(item.status);
  const [note, setNote] = useState(item.statusNote ?? "");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);

  async function openScreenshot() {
    if (!item.screenshotPath) return;
    try {
      const client = getFirebaseClient();
      const storage = getStorage(client.app);
      if (process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true" && !storageEmulatorConnected) {
        try {
          connectStorageEmulator(storage, "127.0.0.1", 9199);
        } catch {
          // Already connected by another caller on this app instance.
        }
        storageEmulatorConnected = true;
      }
      const url = await getDownloadURL(ref(storage, item.screenshotPath));
      setScreenshotUrl(url);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      setResult("The screenshot couldn't be opened.");
    }
  }

  async function save() {
    setSaving(true);
    setResult(null);
    try {
      const outcome = await setFeedbackStatus({ feedbackId: item.id, status, note: note.trim() || null });
      setResult(
        outcome.mode === "preview"
          ? "Preview only: nothing was saved."
          : outcome.notified
            ? `Saved. ${item.userName ?? "They"} will get an email.`
            : "Saved.",
      );
      await onChanged();
    } catch (caught) {
      setResult(feedbackErrorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  const willEmail =
    status !== item.status && (status === "planned" || status === "shipped") && item.followUpOk && item.userEmail;

  return (
    <article className="panel feedback-card">
      <header>
        <span className="feedback-card-kind" data-kind={item.kind}>
          {FEEDBACK_KIND_LABELS[item.kind]}
        </span>
        <strong>{item.studioName}</strong>
        <small>
          {[item.userName, item.userEmail].filter(Boolean).join(" · ")}
          {item.createdAt ? ` · ${new Date(item.createdAt).toLocaleString()}` : ""}
        </small>
      </header>
      <p className="feedback-card-message">{item.message}</p>
      <dl className="feedback-card-facts">
        <div>
          <dt>Screen</dt>
          <dd>{item.route || "—"}</dd>
        </div>
        <div>
          <dt>Device</dt>
          <dd>{item.viewport ?? "—"}</dd>
        </div>
        <div>
          <dt>Contact</dt>
          <dd>{item.followUpOk ? "OK to follow up" : "Asked not to be contacted"}</dd>
        </div>
        {item.lastError ? (
          <div>
            <dt>Last error</dt>
            <dd>{item.lastError}</dd>
          </div>
        ) : null}
      </dl>
      {item.screenshotPath ? (
        <button className="feedback-link" onClick={() => void openScreenshot()} type="button">
          {screenshotUrl ? "Open the screenshot again" : "Open the screenshot"}
        </button>
      ) : null}
      <div className="feedback-card-triage">
        <label>
          <span>Status</span>
          <select onChange={(event) => setStatus(event.target.value as FeedbackStatus)} value={status}>
            {FEEDBACK_STATUSES.map((value) => (
              <option key={value} value={value}>
                {FEEDBACK_STATUS_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Note to the studio (optional)</span>
          <input
            maxLength={1000}
            onChange={(event) => setNote(event.target.value)}
            placeholder="e.g. You can now move a job back a stage from the job page."
            value={note}
          />
        </label>
        <button
          className="feedback-primary"
          disabled={saving || (status === item.status && note.trim() === (item.statusNote ?? ""))}
          onClick={() => void save()}
          type="button"
        >
          {saving ? "Saving…" : willEmail ? "Save and email them" : "Save"}
        </button>
      </div>
      {result ? <p className="feedback-card-result">{result}</p> : null}
    </article>
  );
}
