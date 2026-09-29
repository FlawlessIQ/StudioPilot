"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Paperclip, X } from "lucide-react";
import { Main, PoweredBy } from "@/components/kit/kit";
import { useWorkspace } from "@/features/auth/workspace-context";
import { chatDayLabel, chatSubject, chatThread } from "@/features/messaging/client-chat";
import { friendlyError } from "@/lib/ai/friendly-error";
import {
  uploadClientMessageAttachment,
  type ClientMessageAttachment,
} from "@/lib/client/message-upload";
import { sendClientPortalMessage } from "@/lib/client/portal-client";
import { dataIsLive } from "@/lib/runtime-mode";
import { text, useProjectRecords } from "@/components/client/live-client-views";

type Message = Record<string, unknown> & { id: string };

const time = (iso: string) => {
  const when = new Date(iso);
  return Number.isNaN(when.valueOf())
    ? ""
    : when.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
};

/**
 * The couple's messages as a chat (M4 of
 * docs/mobile-first-client-crew-plan-2026-09-28.md).
 *
 * It was an email form: a Subject field, a five-row box, and a 12 px "Reply"
 * link on each message. Now it is a thread of bubbles with a composer pinned
 * above the tabs. The subject the studio's inbox files it under is derived
 * (features/messaging/client-chat.ts); attachments still go through the same
 * scanned upload, keyed to the message they belong to.
 */
export function ClientMessages() {
  const workspace = useWorkspace();
  const messages = useProjectRecords("messages");
  const [sent, setSent] = useState<Message[]>([]);
  const [context, setContext] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [attachments, setAttachments] = useState<ClientMessageAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key per message: the attachments' storage folder and the send's
  // idempotency key are the same value, and the server checks that they are.
  const draftId = useRef<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const studioName =
    workspace.tenantName && !workspace.tenantName.startsWith("Loading") ? workspace.tenantName : "Your studio";

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("context");
    if (requested) queueMicrotask(() => setContext(requested.slice(0, 120)));
  }, []);

  // Mock mode keeps what was sent on the page, so the thread can be walked.
  const all = useMemo(() => {
    const known = new Set(messages.value.map((message) => message.id));
    return [...messages.value, ...sent.filter((message) => !known.has(message.id))];
  }, [messages.value, sent]);
  const thread = useMemo(() => chatThread(all), [all]);
  const lastFromStudio = [...thread].reverse().find((entry) => entry.message.direction === "outbound")?.message;

  // Open at the newest message, and follow the thread as it grows.
  useEffect(() => {
    if (thread.length) window.scrollTo({ top: document.body.scrollHeight });
  }, [thread.length]);

  function grow() {
    const element = box.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 140)}px`;
  }

  async function attach(files: FileList | null) {
    if (!files?.length) return;
    const chosen = Array.from(files).slice(0, 5 - attachments.length);
    if (!chosen.length) return;
    draftId.current ??= crypto.randomUUID();
    setUploading(true);
    setError(null);
    try {
      const uploaded: ClientMessageAttachment[] = [];
      for (const file of chosen) {
        if (!dataIsLive) {
          uploaded.push({
            storagePath: `preview/${draftId.current}/${file.name}`,
            name: file.name,
            contentType: file.type,
            sizeBytes: file.size,
            scanStatus: "pending",
          });
          continue;
        }
        if (!workspace.tenantId || !workspace.projectId) throw new Error("Sign in to attach a file.");
        uploaded.push(
          await uploadClientMessageAttachment({
            tenantId: workspace.tenantId,
            projectId: workspace.projectId,
            draftId: draftId.current,
            file,
          }),
        );
      }
      setAttachments((existing) => [...existing, ...uploaded]);
    } catch (caught: unknown) {
      setError(friendlyError(caught, "That file couldn’t be attached."));
    } finally {
      setUploading(false);
    }
  }

  async function send() {
    const message = body.trim();
    if (!message || sending || uploading) return;
    draftId.current ??= crypto.randomUUID();
    // A question started from a page is its own topic; otherwise this
    // answers the studio's latest message.
    const replyTo = context ? null : (lastFromStudio ?? null);
    const subject = chatSubject({
      body: message,
      context,
      replyToSubject: replyTo ? text(replyTo.subject, "") : null,
    });
    setSending(true);
    setError(null);
    try {
      let id = draftId.current;
      if (dataIsLive) {
        if (!workspace.tenantId || !workspace.projectId) throw new Error("Sign in to send a message.");
        const result = await sendClientPortalMessage(workspace.tenantId, workspace.projectId, {
          subject,
          body: message,
          context,
          replyToMessageId: replyTo?.id ?? null,
          attachments,
          idempotencyKey: draftId.current,
        });
        id = result.id;
      }
      const now = new Date().toISOString();
      setSent((existing) => [
        ...existing,
        {
          id,
          subject,
          body: message,
          context,
          direction: "inbound",
          attachmentReferences: attachments,
          createdAt: now,
          sentAt: now,
        },
      ]);
      setBody("");
      setContext(null);
      setAttachments([]);
      draftId.current = null;
      if (box.current) box.current.style.height = "auto";
      messages.refresh?.();
    } catch (caught: unknown) {
      setError(friendlyError(caught, "Your message couldn’t be sent. Check your connection and try again."));
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <Main label="Messages">
        <div className="kit-stack-tight">
          <p className="kit-eyebrow">Messages</p>
          <h1 className="kit-title">{studioName}</h1>
          <p className="kit-caption">Replies come here and to your email.</p>
        </div>

        {messages.error ? (
          <p className="kit-note" data-tone="danger" role="alert">
            {messages.error}
          </p>
        ) : null}

        {thread.length ? (
          <ol aria-label="Conversation" className="kit-chat">
            {thread.map(({ message, at, newDay }) => {
              const fromStudio = message.direction === "outbound";
              const files = Array.isArray(message.attachmentReferences)
                ? (message.attachmentReferences as Array<Record<string, unknown>>)
                : [];
              return (
                <Fragment key={message.id}>
                  {newDay ? (
                    <li aria-hidden className="kit-chat-day">
                      {chatDayLabel(at)}
                    </li>
                  ) : null}
                  <li className="kit-chat-message" data-from={fromStudio ? "studio" : "you"}>
                    <div className="kit-bubble">
                      {message.context ? <span className="kit-bubble-context">{text(message.context)}</span> : null}
                      {text(message.body ?? message.bodyPreview, "Open the email from your studio for the full message.")}
                      {files.length ? (
                        <span className="kit-bubble-files">
                          {files.map((file, index) => (
                            <span className="kit-bubble-file" key={`${text(file.name)}-${index}`}>
                              <Paperclip aria-hidden size={13} /> {text(file.name, "Attachment")}
                            </span>
                          ))}
                        </span>
                      ) : null}
                    </div>
                    {/* The stored status is the studio's side of it: a
                        couple's message is `received`. Their own says Sent. */}
                    <span className="kit-bubble-meta">
                      {fromStudio
                        ? `${studioName} · ${time(at)}${message.clientReadAt ? "" : " · New"}`
                        : `You · ${time(at)} · Sent`}
                    </span>
                  </li>
                </Fragment>
              );
            })}
          </ol>
        ) : (
          <div className="kit-card">
            <p className="kit-body" role="status">
              {messages.loading
                ? "Opening your messages…"
                : `Ask ${studioName} anything about your wedding. They’ll reply here and by email.`}
            </p>
          </div>
        )}
        <PoweredBy />
      </Main>

      <div className="kit-actions kit-composer">
        {context ? (
          <span className="kit-composer-context">
            <span>
              About: <strong>{context}</strong>
            </span>
            <button aria-label="Not about this" onClick={() => setContext(null)} type="button">
              <X aria-hidden size={16} />
            </button>
          </span>
        ) : null}
        {attachments.length ? (
          <span className="kit-bubble-files">
            {attachments.map((attachment) => (
              <span className="kit-bubble-file" key={attachment.storagePath}>
                <Paperclip aria-hidden size={13} /> {attachment.name}
                <button
                  aria-label={`Remove ${attachment.name}`}
                  onClick={() =>
                    setAttachments((existing) =>
                      existing.filter((item) => item.storagePath !== attachment.storagePath),
                    )
                  }
                  type="button"
                >
                  <X aria-hidden size={14} />
                </button>
              </span>
            ))}
          </span>
        ) : null}
        {error ? (
          <p className="kit-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="kit-composer-row">
          <label
            aria-label={uploading ? "Attaching…" : "Attach a file or photo"}
            className="kit-icon-button"
            data-busy={uploading || undefined}
          >
            <Paperclip aria-hidden size={22} />
            <input
              accept=".pdf,.docx,.jpg,.jpeg,.png"
              className="kit-sr"
              disabled={uploading || attachments.length >= 5}
              multiple
              onChange={(event) => {
                void attach(event.target.files);
                event.target.value = "";
              }}
              type="file"
            />
          </label>
          <textarea
            aria-label={`Message ${studioName}`}
            className="kit-input kit-composer-input"
            maxLength={5000}
            onChange={(event) => {
              setBody(event.target.value);
              grow();
            }}
            placeholder="Message"
            ref={box}
            rows={1}
            value={body}
          />
          <button
            aria-label={sending ? "Sending…" : "Send"}
            className="kit-send"
            disabled={!body.trim() || sending || uploading}
            onClick={() => void send()}
            type="button"
          >
            <ArrowUp aria-hidden size={22} />
          </button>
        </div>
      </div>
    </>
  );
}
