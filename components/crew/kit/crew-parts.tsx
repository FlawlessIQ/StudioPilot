"use client";

import { useEffect, useState } from "react";
import { Camera, CheckCircle2, FileUp, LoaderCircle, MessageCircle } from "lucide-react";
import { collection, getDocs, limit, query, where } from "firebase/firestore";
import { Button, KitRoot, TextArea } from "@/components/kit/kit";
import { SheetDialog } from "@/components/ui/sheet-dialog";
import { useWorkspace } from "@/features/auth/workspace-context";
import { friendlyError } from "@/lib/ai/friendly-error";
import { uploadCrewProfileDocument, uploadCrewRequirement } from "@/lib/crew/command-client";
import { crewPublicError } from "@/lib/crew/public-error";
import { getFirebaseClient } from "@/lib/firebase/client";
import { dataIsLive } from "@/lib/runtime-mode";
import { crewCommand, text, timeLabel, dayLabel, type Value } from "@/components/crew/kit/crew-data";

const ACCEPTED = new Set(["application/pdf", "image/jpeg", "image/png", "image/heic"]);

/**
 * Send a document: a photo of it with the camera, or a file.
 *
 * Crew scan W-9s and certificates on a phone, so the camera is the first
 * choice rather than a file picker that opens on an empty Downloads folder.
 * One control for a job's requirement and for the profile's own papers; only
 * where the file goes differs.
 */
export function DocumentSend({
  label,
  done,
  send,
  onSent,
}: {
  label: string;
  done: boolean;
  send: (file: File) => Promise<void>;
  onSent?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(done);
  const [error, setError] = useState<string | null>(null);

  async function pick(file: File | undefined) {
    if (!file) return;
    if (!ACCEPTED.has(file.type)) return setError("Send a photo, or a PDF, JPEG or PNG file.");
    if (file.size > 10 * 1024 * 1024) return setError("That file is over 10 MB. Try a photo instead.");
    setBusy(true);
    setError(null);
    try {
      if (dataIsLive) await send(file);
      setSent(true);
      onSent?.();
    } catch (caught: unknown) {
      setError(crewPublicError(caught, "That file couldn't be sent. Try again.", "CREW_DOCUMENT_SUBMIT_FAILED"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="kit-stack-tight">
      {sent ? (
        <p className="kit-caption" style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <CheckCircle2 aria-hidden size={15} /> {`${label} sent. Your studio will check it.`}
        </p>
      ) : null}
      <div className="kit-send-row">
        <label className="kit-button" data-size="compact" data-variant={sent ? "soft" : "secondary"}>
          {busy ? <LoaderCircle aria-hidden className="spin" size={18} /> : <Camera aria-hidden size={18} />}
          {busy ? "Sending…" : sent ? "Retake" : "Take a photo"}
          <input
            accept="image/*"
            capture="environment"
            className="kit-sr"
            disabled={busy}
            onChange={(event) => void pick(event.target.files?.[0])}
            type="file"
          />
        </label>
        <label className="kit-button" data-size="compact" data-variant="soft">
          <FileUp aria-hidden size={18} /> Choose a file
          <input
            accept=".pdf,.jpg,.jpeg,.png"
            className="kit-sr"
            disabled={busy}
            onChange={(event) => void pick(event.target.files?.[0])}
            type="file"
          />
        </label>
      </div>
      {error ? (
        <p className="kit-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function RequirementSend({
  assignment,
  requirement,
  onSent,
}: {
  assignment: Value;
  requirement: Record<string, unknown>;
  onSent?: () => void;
}) {
  return (
    <DocumentSend
      done={false}
      label={text(requirement.name, "Your document")}
      onSent={onSent}
      send={async (file) => {
        const response = await uploadCrewRequirement({
          projectId: text(assignment.projectId),
          assignmentId: assignment.id,
          requirementId: text(requirement.id),
          file,
        });
        if (!response.persisted) throw new Error("Uploads aren't connected in this environment.");
      }}
    />
  );
}

export function ProfileDocumentSend({
  crewProfileId,
  kind,
  status,
  onSent,
}: {
  crewProfileId: string;
  kind: "w9" | "insurance";
  status: string;
  onSent?: () => void;
}) {
  const label = kind === "w9" ? "W-9" : "Certificate of insurance";
  return (
    <DocumentSend
      // "received" and "verified" both mean a file is on hand; only the
      // studio says it's been checked.
      done={["received", "verified"].includes(status)}
      label={label}
      onSent={onSent}
      send={async (file) => {
        try {
          await uploadCrewProfileDocument({ crewProfileId, kind, file });
        } catch (caught: unknown) {
          throw new Error(friendlyError(caught, "That file could not be uploaded."));
        }
      }}
    />
  );
}

/**
 * Message the studio about this job, in a sheet, with the last few messages
 * above it. The subject the studio's inbox needs is derived, as on the
 * couple's chat.
 */
export function StudioMessage({
  assignment,
  jobName,
  eventDay = false,
  studioColor,
}: {
  assignment: Value;
  jobName: string;
  eventDay?: boolean;
  studioColor: string | null;
}) {
  const workspace = useWorkspace();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [thread, setThread] = useState<Value[]>([]);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!open || !dataIsLive || !workspace.tenantId || !workspace.userId) return;
    let active = true;
    void getDocs(
      query(
        collection(getFirebaseClient().firestore, "crewMessages"),
        where("tenantId", "==", workspace.tenantId),
        where("userId", "==", workspace.userId),
        where("assignmentId", "==", assignment.id),
        limit(50),
      ),
    )
      .then((snapshot) => {
        if (active)
          setThread(
            snapshot.docs
              .map((item) => ({ id: item.id, ...item.data() }) as Value)
              .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))),
          );
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [assignment.id, open, version, workspace.tenantId, workspace.userId]);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      await crewCommand("contactStudio", {
        projectId: text(assignment.projectId),
        assignmentId: assignment.id,
        subject: `${eventDay ? "Event day" : "Question"}: ${jobName}`.slice(0, 160),
        message: message.trim(),
        urgency: eventDay ? "event_day" : "normal",
      });
      setMessage("");
      setSent(true);
      setOpen(false);
      setVersion((value) => value + 1);
    } catch (caught: unknown) {
      setError(crewPublicError(caught, "Your message couldn't be sent.", "CREW_MESSAGE_SEND_FAILED"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button icon={MessageCircle} onClick={() => setOpen(true)} variant={eventDay ? "secondary" : "soft"}>
        {eventDay ? "Message the studio now" : "Message the studio"}
      </Button>
      {sent ? <p className="kit-caption">Sent. Replies come by email.</p> : null}
      <SheetDialog label={`Message about ${jobName}`} onClose={() => (busy ? undefined : setOpen(false))} open={open}>
        <KitRoot className="kit-embed kit-sheet" studio={{ color: studioColor }}>
          <div className="kit-stack">
            {thread.length ? (
              <ol aria-label="Recent messages" className="kit-chat">
                {thread.slice(-4).map((item) => (
                  <li className="kit-chat-message" data-from={item.direction === "studio_to_crew" ? "studio" : "you"} key={item.id}>
                    <div className="kit-bubble">{text(item.message)}</div>
                    <span className="kit-bubble-meta">
                      {`${item.direction === "studio_to_crew" ? "Studio" : "You"} · ${dayLabel(item.createdAt)} ${timeLabel(item.createdAt)}`}
                    </span>
                  </li>
                ))}
              </ol>
            ) : null}
            <TextArea
              autoFocus
              label={eventDay ? "What's happening?" : "Your message"}
              maxLength={4000}
              onChange={(event) => setMessage(event.target.value)}
              rows={4}
              value={message}
            />
            {error ? (
              <p className="kit-error" role="alert">
                {error}
              </p>
            ) : null}
            <Button disabled={busy || !message.trim()} onClick={() => void send()}>
              {busy ? "Sending…" : "Send"}
            </Button>
          </div>
        </KitRoot>
      </SheetDialog>
    </>
  );
}
