"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, TriangleAlert } from "lucide-react";
import {
  orderPurgeLines,
  purgeConfirmationMatches,
  purgeTotal,
  PURGE_KEEPS,
} from "@/features/projects/purge-policy";
import {
  previewProjectPurge,
  purgeProject,
  type PurgePreview,
} from "@/lib/projects/purge-client";
import { friendlyError } from "@/lib/ai/friendly-error";

/**
 * Deleting a wedding and everything StudioCue holds about it.
 *
 * Archiving is the answer almost every time, and it is offered directly above
 * this. This is for the case archiving cannot serve: a couple who asks to be
 * forgotten, a job imported twice, a booking made while learning the product.
 *
 * ## Three gates, each doing different work
 *
 * 1. **Opening it.** Collapsed, last on the page, under its own heading. Not
 *    something you land on.
 * 2. **Reading what goes.** Opening it counts the records first and lists
 *    them — "142 messages, 3 invoices, 61 files" — beside what survives. This
 *    is the gate that actually informs: a studio who thought this removed the
 *    client's crew finds out here, before anything happens.
 * 3. **Typing the name, then confirming.** The name proves they know which
 *    job this is; the final press proves they meant this moment. Two prompts,
 *    because the first is about *what* and the second is about *now*.
 *
 * The server repeats every one of these checks — owner, live crew, name — and
 * trusts nothing decided here.
 */
export function DeleteJobPermanently({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const router = useRouter();
  const [preview, setPreview] = useState<PurgePreview | null>(null);
  const [typed, setTyped] = useState("");
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState<"preview" | "delete" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load(open: boolean) {
    if (!open || preview || busy) return;
    setBusy("preview");
    setNotice(null);
    try {
      setPreview(await previewProjectPurge(projectId));
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "This job could not be checked."));
    } finally {
      setBusy(null);
    }
  }

  async function destroy() {
    setBusy("delete");
    setNotice(null);
    try {
      await purgeProject({ projectId, confirmation: typed });
      // The job no longer exists, so there is nothing to return to.
      router.replace("/studio/projects");
      router.refresh();
    } catch (caught: unknown) {
      setArmed(false);
      setNotice(friendlyError(caught, "This job could not be deleted."));
      setBusy(null);
    }
  }

  const lines = preview ? orderPurgeLines(preview.lines) : [];
  const total = purgeTotal(lines);
  const nameMatches = purgeConfirmationMatches(typed, projectName);

  return (
    <details
      className="project-danger-zone"
      onToggle={(event) => void load(event.currentTarget.open)}
    >
      <summary>
        <TriangleAlert aria-hidden="true" size={15} />
        Delete this job permanently
      </summary>
      <div>
        <p className="project-danger-lede">
          This erases the wedding and everything filed against it. There is no
          undo and no archive copy. If you only want it out of your working
          list, archive it instead.
        </p>

        {busy === "preview" ? (
          <p className="form-notice" role="status">
            <LoaderCircle className="spin" size={14} /> Counting what would be
            deleted…
          </p>
        ) : null}

        {preview ? (
          <>
            <div className="project-danger-columns">
              <section>
                <h4>
                  {`Deleted — ${total} ${total === 1 ? "record" : "records"}${
                    preview.fileCount
                      ? ` and ${preview.fileCount} ${preview.fileCount === 1 ? "file" : "files"}`
                      : ""
                  }`}
                </h4>
                <ul>
                  {lines.map((line) => (
                    <li key={line.collection}>
                      <strong>{line.count}</strong> {line.label}
                    </li>
                  ))}
                </ul>
                {preview.clientsDeleted.length ? (
                  <p className="project-danger-client">
                    {`${preview.clientsDeleted.join(", ")} — this was their only job, so their client record goes too.`}
                  </p>
                ) : null}
              </section>
              <section>
                <h4>Kept</h4>
                <ul>
                  {PURGE_KEEPS.map((kept) => (
                    <li key={kept}>{kept}</li>
                  ))}
                  {preview.clientsKept.length ? (
                    <li>
                      {`${preview.clientsKept.join(", ")} — they have other jobs with you, so their client record stays.`}
                    </li>
                  ) : null}
                </ul>
              </section>
            </div>

            <label className="project-danger-confirm">
              {`To confirm, type the job's name: ${projectName}`}
              <input
                autoComplete="off"
                disabled={busy === "delete"}
                onChange={(event) => {
                  setTyped(event.target.value);
                  setArmed(false);
                }}
                placeholder={projectName}
                value={typed}
              />
            </label>

            {armed ? (
              <div className="project-danger-final" role="alert">
                <strong>
                  {`Delete ${projectName} and ${total} ${total === 1 ? "record" : "records"} now? This cannot be undone.`}
                </strong>
                <span>
                  <button
                    className="button button-danger"
                    disabled={busy === "delete"}
                    onClick={() => void destroy()}
                    type="button"
                  >
                    {busy === "delete" ? (
                      <LoaderCircle className="spin" size={15} />
                    ) : null}
                    Yes, delete it all
                  </button>
                  <button
                    className="button button-light"
                    disabled={busy === "delete"}
                    onClick={() => setArmed(false)}
                    type="button"
                  >
                    Keep this job
                  </button>
                </span>
              </div>
            ) : (
              <button
                className="button button-danger"
                disabled={!nameMatches}
                onClick={() => setArmed(true)}
                type="button"
              >
                Delete this job and everything in it
              </button>
            )}
          </>
        ) : null}

        {notice ? (
          <p className="form-error" role="alert">
            {notice}
          </p>
        ) : null}
      </div>
    </details>
  );
}
