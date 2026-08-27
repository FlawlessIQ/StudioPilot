"use client";

import { useState } from "react";
import { Archive, ArchiveRestore, LoaderCircle } from "lucide-react";
import { archiveCopy, type ArchivableKind } from "@/features/records/archive";
import { friendlyError } from "@/lib/ai/friendly-error";

/**
 * Archive or restore a client, vendor or collaborator.
 *
 * One control for all three, because the idea is the same and a studio should
 * not meet three different versions of it. The confirmation is a second click
 * rather than a browser dialog: `window.confirm` blocks the page and reads as
 * an error, and this is a reversible bookkeeping action, not a deletion.
 *
 * See features/records/archive.ts for the words and the refusals.
 */
export function ArchiveToggle({
  archived,
  kind,
  onDone,
  run,
}: {
  archived: boolean;
  kind: ArchivableKind;
  onDone: (message: string) => void;
  /** Performs the command. Throws on refusal. */
  run: (restore: boolean) => Promise<void>;
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const copy = archiveCopy(kind, archived);

  async function go() {
    setBusy(true);
    setNotice(null);
    try {
      await run(archived);
      setAsking(false);
      onDone(archived ? `${copy.label} — done.` : `${copy.label} — done.`);
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "That could not be changed."));
    } finally {
      setBusy(false);
    }
  }

  if (!copy.confirm || asking) {
    return (
      <span className="record-archive-confirm">
        {copy.confirm ? <small>{copy.confirm}</small> : null}
        <span>
          <button
            className="button button-quiet"
            disabled={busy}
            onClick={() => void go()}
            type="button"
          >
            {busy ? <LoaderCircle className="spin" size={14} /> : null}
            {copy.confirm ? "Yes, archive" : copy.label}
          </button>
          {copy.confirm ? (
            <button
              className="button button-quiet"
              disabled={busy}
              onClick={() => setAsking(false)}
              type="button"
            >
              Keep it
            </button>
          ) : null}
        </span>
        {notice ? (
          <p className="form-notice" role="status">
            {notice}
          </p>
        ) : null}
      </span>
    );
  }

  return (
    <span className="record-archive-confirm">
      <button
        className="button button-quiet"
        onClick={() => setAsking(true)}
        type="button"
      >
        {archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}{" "}
        {copy.label}
      </button>
      {notice ? (
        <p className="form-notice" role="status">
          {notice}
        </p>
      ) : null}
    </span>
  );
}
