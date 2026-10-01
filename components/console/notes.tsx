"use client";

import { useId, useState } from "react";
import { collection, limit, orderBy, query, where } from "firebase/firestore";
import { Pin } from "lucide-react";
import { dateTime, relative } from "@/lib/console/format";
import { useLiveQuery } from "@/lib/console/live";
import { useConsole } from "./console-context";
import { ActionMenu } from "./menu";
import { Empty, Panel, Spinner } from "./ui";
import { useCommand } from "./use-command";

/**
 * The team's internal notes on a studio, person or issue. Never shown to a
 * studio (firestore.rules). `compact` is just the composer, for the timeline.
 */
type Note = {
  id: string;
  body?: string;
  pinned?: boolean;
  authorUid?: string;
  authorName?: string | null;
  authorEmail?: string | null;
  createdAt?: string;
  archivedAt?: string | null;
};

export function NotesPanel({ subjectKey, title, compact = false }: { subjectKey: string; title: string; compact?: boolean }) {
  const { can, user, role } = useConsole();
  const { run, busy } = useCommand();
  const [body, setBody] = useState("");
  const [pin, setPin] = useState(false);
  const fieldId = useId();
  const notes = useLiveQuery<Note>(compact ? null : `notes:${subjectKey}`, (firestore) =>
    query(collection(firestore, "consoleNotes"), where("subjectKey", "==", subjectKey), orderBy("createdAt", "desc"), limit(200)),
  );
  const live = (notes.rows ?? []).filter((note) => !note.archivedAt).sort((a, b) => Number(b.pinned === true) - Number(a.pinned === true));
  const add = async () => {
    const result = await run("addNote", { subjectKey, body, pinned: pin }, { done: "Note added." });
    if (result) {
      setBody("");
      setPin(false);
    }
  };
  return (
    <Panel flush title={title}>
      {can("crm.write") ? (
        <div className="cx-composer">
          <label className="cx-label" hidden htmlFor={fieldId}>
            New note
          </label>
          <textarea
            className="cx-textarea"
            id={fieldId}
            maxLength={4000}
            onChange={(event) => setBody(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && body.trim()) void add();
            }}
            placeholder="Add an internal note. Studios never see notes."
            rows={2}
            value={body}
          />
          <div className="cx-stack" style={{ gap: 6 }}>
            <button className="cx-btn" data-variant="primary" disabled={!body.trim() || busy === "addNote"} onClick={() => void add()} type="button">
              Add
            </button>
            <label className="cx-check cx-hint">
              <input checked={pin} onChange={(event) => setPin(event.target.checked)} type="checkbox" />
              Pin
            </label>
          </div>
        </div>
      ) : null}
      {compact ? null : notes.rows === null ? (
        <div className="cx-empty">
          <Spinner />
        </div>
      ) : live.length ? (
        <div className="cx-timeline">
          {live.map((note) => (
            <div className="cx-tl-row" data-kind="note" key={note.id}>
              <time className="cx-tl-time" dateTime={note.createdAt} title={dateTime(note.createdAt)}>
                {relative(note.createdAt)}
              </time>
              <span className="cx-hint">{note.pinned ? <Pin size={13} /> : null}</span>
              <div className="cx-tl-body" style={{ gridTemplateColumns: "minmax(0,1fr) auto", display: "grid", alignItems: "start", gap: 8 }}>
                <div>
                  <span className="cx-message-text">{note.body}</span>
                  <small style={{ display: "block" }}>{note.authorName ?? note.authorEmail}</small>
                </div>
                {can("crm.write") ? (
                  <ActionMenu
                    iconOnly
                    items={[
                      note.pinned
                        ? { label: "Unpin", onSelect: () => void run("setNotePinned", { noteId: note.id, pinned: false }, { done: "Note unpinned." }) }
                        : { label: "Pin to the top", onSelect: () => void run("setNotePinned", { noteId: note.id, pinned: true }, { done: "Note pinned." }) },
                      ...(note.authorUid === user?.uid || role === "owner"
                        ? [{ label: "Archive", danger: true, onSelect: () => void run("archiveNote", { noteId: note.id }, { done: "Note archived." }) }]
                        : []),
                    ]}
                    label="Note actions"
                  />
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Empty title="No notes yet">Notes are for the team: context, promises made, what to try next.</Empty>
      )}
    </Panel>
  );
}

