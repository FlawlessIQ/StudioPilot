"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, Eye, FileText, LoaderCircle, Send, Upload, X } from "lucide-react";
import { Button, Card, List, Main, Note, Pill, PoweredBy, Row, TextArea } from "@/components/kit/kit";
import { useWorkspace } from "@/features/auth/workspace-context";
import { dataIsLive } from "@/lib/runtime-mode";
import { friendlyError } from "@/lib/ai/friendly-error";
import { getClientShotList, submitClientShotList } from "@/lib/client/portal-client";
import { uploadShotListFile } from "@/lib/client/shot-list-upload";
import {
  SHOT_LIST_ACCEPT,
  SHOT_LIST_MAX_FILES,
  SHOT_LIST_NOTE_MAX,
  fileSizeLabel,
  shotListContentType,
  type ShotListView,
} from "@/features/planning/shot-list";

/**
 * "Your shot list": the couple's own must-take photos (Conor, 2026-10-09).
 *
 * Asked for a month out (functions/src/planning/shot-list-upload.ts), but
 * open whenever they have one. It takes the list as they already have it —
 * a document, a PDF, a photo or screenshot of their notes — and a line or
 * two if they'd rather type. Sending puts it on the studio's Today and on
 * the job; they can add to it until the day.
 */

const day = (iso: string | null | undefined) =>
  iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }) : "";

export function ClientShotList() {
  const workspace = useWorkspace();
  const studio = workspace.tenantName && !workspace.tenantName.startsWith("Loading") ? workspace.tenantName : "your studio";
  const [view, setView] = useState<ShotListView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<File[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [justSent, setJustSent] = useState(false);
  const [adding, setAdding] = useState(false);
  const input = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!dataIsLive || !workspace.tenantId || !workspace.projectId) return;
    let live = true;
    void getClientShotList(workspace.tenantId, workspace.projectId)
      .then((result) => {
        if (!live) return;
        setView(result.shotList);
        setNote(result.shotList.note ?? "");
      })
      .catch((caught: unknown) => live && setLoadError(friendlyError(caught, "Your shot list couldn't be loaded. Try again in a moment.")));
    return () => {
      live = false;
    };
  }, [workspace.tenantId, workspace.projectId]);

  const sentFiles = view?.files ?? [];
  const room = SHOT_LIST_MAX_FILES - sentFiles.length - chosen.length;

  function choose(list: FileList | null) {
    setError(null);
    const picked = Array.from(list ?? []);
    const refused = picked.filter((file) => !shotListContentType(file));
    const usable = picked.filter((file) => shotListContentType(file)).slice(0, Math.max(0, room));
    if (refused.length) setError(`${refused.map((file) => file.name).join(", ")}: upload a PDF, Word document, photo, text or CSV file.`);
    else if (picked.length > usable.length) setError(`You can send up to ${SHOT_LIST_MAX_FILES} files. Put the rest in one document if you can.`);
    setChosen((current) => [...current, ...usable]);
    if (input.current) input.current.value = "";
  }

  async function send() {
    if (!workspace.tenantId || !workspace.projectId) return;
    const trimmed = note.trim();
    if (!chosen.length && !trimmed) return setError("Add your list (a file or a few lines) first.");
    setError(null);
    try {
      const uploaded = [];
      for (const [index, file] of chosen.entries()) {
        setBusy(chosen.length > 1 ? `Uploading ${index + 1} of ${chosen.length}…` : "Uploading…");
        uploaded.push(await uploadShotListFile({ tenantId: workspace.tenantId, projectId: workspace.projectId, file }));
      }
      setBusy("Sending…");
      const result = await submitClientShotList(workspace.tenantId, workspace.projectId, uploaded, trimmed || null);
      setView(result.shotList);
      setChosen([]);
      setJustSent(true);
      setAdding(false);
    } catch (caught: unknown) {
      setError(friendlyError(caught, "That didn't send. Check your connection and try again."));
    } finally {
      setBusy(null);
    }
  }

  const received = view?.status === "received";
  const showForm = !received || adding;

  return (
    <Main label="Your shot list">
      <div className="kit-stack-tight">
        <p className="kit-eyebrow">{workspace.projectName}</p>
        <h1 className="kit-title">Your shot list</h1>
        <p className="kit-body">
          The photos you don&rsquo;t want missed: family groups, special people, little details that mean a lot. Send the list you already have, or write it here.
        </p>
      </div>

      {loadError ? <Note tone="danger">{loadError}</Note> : null}

      {received ? (
        <Card tone="accent">
          <p className="kit-eyebrow" style={{ color: "var(--kit-accent)" }}>
            <CheckCircle2 aria-hidden size={14} /> {justSent ? "Sent. Thank you!" : "Sent"}
          </p>
          <p className="kit-body">
            {`${studio} has your list${view?.receivedAt ? ` from ${day(view.receivedAt)}` : ""}. `}
            {view?.seenByStudio ? "They've opened it." : "They'll see it on their next look at your plans."}
          </p>
          {view?.seenByStudio ? (
            <Pill icon={Eye} tone="accent">
              Seen by {studio}
            </Pill>
          ) : null}
        </Card>
      ) : view?.dueDate ? (
        <Note icon={Camera} tone="accent">
          {`${studio} would love it by ${day(view.dueDate)}. No list? That's fine, you can skip this.`}
        </Note>
      ) : null}

      {sentFiles.length || (received && view?.note) ? (
        <section className="kit-stack-tight" aria-label="What you sent">
          <h2 className="kit-subsection">What you sent</h2>
          <List>
            {sentFiles.map((file) => (
              <Row
                icon={FileText}
                key={`${file.name}-${file.uploadedAt}`}
                subtitle={`${fileSizeLabel(file.sizeBytes)} · ${day(file.uploadedAt)}`}
                title={file.name}
                trailing={<CheckCircle2 aria-label="Sent" className="kit-shot-sent" size={18} />}
              />
            ))}
          </List>
          {received && view?.note && !adding ? <p className="kit-body kit-shot-note">{`“${view.note}”`}</p> : null}
        </section>
      ) : null}

      {showForm ? (
        <section className="kit-stack" aria-label={received ? "Add to your list" : "Send your list"}>
          {received ? <h2 className="kit-subsection">Add to your list</h2> : null}
          <label className="kit-dropzone" data-disabled={room <= 0 || busy !== null ? "true" : undefined}>
            <input
              accept={SHOT_LIST_ACCEPT}
              className="kit-dropzone-input"
              disabled={room <= 0 || busy !== null}
              multiple
              onChange={(event) => choose(event.target.files)}
              ref={input}
              type="file"
            />
            <Upload aria-hidden size={26} />
            <span className="kit-dropzone-title">{chosen.length ? "Add another file" : "Choose your list"}</span>
            <span className="kit-dropzone-hint">A document, PDF, or a photo or screenshot of your notes · up to 12 MB each</span>
          </label>

          {chosen.length ? (
            <List label="Ready to send">
              {chosen.map((file, index) => (
                <Row
                  icon={FileText}
                  key={`${file.name}-${index}`}
                  subtitle={fileSizeLabel(file.size)}
                  title={file.name}
                  trailing={
                    <button
                      aria-label={`Remove ${file.name}`}
                      className="kit-shot-remove"
                      disabled={busy !== null}
                      onClick={() => setChosen((current) => current.filter((_, at) => at !== index))}
                      type="button"
                    >
                      <X aria-hidden size={18} />
                    </button>
                  }
                />
              ))}
            </List>
          ) : null}

          <TextArea
            hint="Optional. Names help: “Grandma Rose with all the grandkids.”"
            label={received ? "Anything to add?" : "Or write it here"}
            maxLength={SHOT_LIST_NOTE_MAX}
            onChange={(event) => setNote(event.target.value)}
            placeholder={"Our first look\nBoth families together\nThe rings on our invitation"}
            rows={5}
            value={note}
          />

          {error ? <Note tone="danger">{error}</Note> : null}

          <Button disabled={busy !== null || (!chosen.length && !note.trim())} icon={busy ? LoaderCircle : Send} onClick={() => void send()}>
            {busy ?? `Send to ${studio}`}
          </Button>
          {received ? (
            <Button disabled={busy !== null} onClick={() => setAdding(false)} variant="secondary">
              Cancel
            </Button>
          ) : null}
        </section>
      ) : (
        <Button icon={Upload} onClick={() => setAdding(true)} variant="secondary">
          Add more or change your note
        </Button>
      )}
      <PoweredBy />
    </Main>
  );
}
