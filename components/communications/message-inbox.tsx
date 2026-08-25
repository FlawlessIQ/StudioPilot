"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import {
  Inbox,
  Loader2,
  Mail,
  MessageSquare,
  PenLine,
  Search,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { useWorkspace } from "@/features/auth/workspace-context";
import { sendCommunicationsCommand } from "@/lib/communications/command-client";
import { getFirebaseClient } from "@/lib/firebase/client";
import { requestMessageDraft } from "@/lib/ai/message-draft-client";
import type {
  Conversation,
  MessageChannel,
} from "@/features/messaging/conversation";

/**
 * The mailbox. Replaces a screen that put a compose form, an automation
 * settings panel, and a delivery log side by side — three unrelated jobs, none
 * of them a conversation.
 *
 * Threads live in `conversations`, folded server-side, so this reads rather than
 * derives. Both lists are live: the previous screen used a one-shot read, so a
 * client message could sit unseen in an open tab.
 */

const THREAD_LIMIT = 100;
const MESSAGE_LIMIT = 200;

type ThreadMessage = {
  id: string;
  direction: "inbound" | "outbound";
  channel: MessageChannel;
  subject: string | null;
  body: string | null;
  bodyPreview: string | null;
  createdAt: string;
  deliveryStatus: string | null;
};

const channelIcon: Record<MessageChannel, typeof Mail> = {
  email: Mail,
  portal: MessageSquare,
};

/**
 * Delivery vocabulary in the studio's terms. The previous screen showed
 * "Provider accepted" — SendGrid's word for handing the message off, surfaced
 * to a photographer who wants to know whether it arrived.
 */
function deliveryLabel(status: string | null): string | null {
  if (!status) return null;
  const value = status.toLowerCase();
  if (value === "delivered") return "Delivered";
  if (value === "open" || value === "opened") return "Opened";
  if (value === "click" || value === "clicked") return "Link opened";
  if (["sent", "processed", "succeeded"].includes(value)) return "Sent";
  if (value === "queued" || value === "scheduled") return "Waiting to send";
  if (value === "running") return "Sending";
  if (value === "retry_scheduled") return "Retrying";
  if (["failed", "bounce", "bounced", "dropped", "dead_letter", "spamreport"].includes(value))
    return "Did not arrive";
  if (value === "mock") return "Test only";
  return null;
}

function whenLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.valueOf())) return "";
  const now = Date.now();
  const minutes = Math.round((now - date.valueOf()) / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days <= 7) return `${days}d ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function MessageInbox({ initialProjectId }: { initialProjectId?: string }) {
  const workspace = useWorkspace();
  const tenantId = workspace.tenantId;

  const [threads, setThreads] = useState<Conversation[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [loadedThreadId, setLoadedThreadId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [draftNotes, setDraftNotes] = useState<string[]>([]);
  const [draftIsAi, setDraftIsAi] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const streamRef = useRef<HTMLDivElement | null>(null);
  const [composing, setComposing] = useState(false);
  const [projects, setProjects] = useState<
    Array<{ id: string; name: string; clientContactIds: string[] }>
  >([]);
  const [contacts, setContacts] = useState<
    Array<{ id: string; name: string; email: string | null }>
  >([]);
  const [draftProjectId, setDraftProjectId] = useState("");
  const [draftContactId, setDraftContactId] = useState("");
  const [draftSubject, setDraftSubject] = useState("");
  const [draftBody, setDraftBody] = useState("");

  // Live, not one-shot: an open tab has to notice a client writing in.
  useEffect(() => {
    if (!tenantId) return;
    const { firestore } = getFirebaseClient();
    const unsubscribe = onSnapshot(
      query(
        collection(firestore, "conversations"),
        where("tenantId", "==", tenantId),
        orderBy("lastMessageAt", "desc"),
        limit(THREAD_LIMIT),
      ),
      (snapshot) => {
        setThreads(
          snapshot.docs.map((document) => document.data() as Conversation),
        );
        setThreadsLoading(false);
      },
      () => setThreadsLoading(false),
    );
    return unsubscribe;
  }, [tenantId]);

  // Only loaded when the composer opens: a studio replying in a thread never
  // needs the project and contact lists, and the previous screen paid for them
  // on every visit.
  useEffect(() => {
    if (!composing || !tenantId || projects.length) return;
    const { firestore } = getFirebaseClient();
    void (async () => {
      const [projectSnapshot, contactSnapshot] = await Promise.all([
        getDocs(
          query(
            collection(firestore, "projects"),
            where("tenantId", "==", tenantId),
            limit(200),
          ),
        ),
        getDocs(
          query(
            collection(firestore, "contacts"),
            where("tenantId", "==", tenantId),
            limit(500),
          ),
        ),
      ]);
      setProjects(
        projectSnapshot.docs.map((document) => ({
          id: document.id,
          name: String(document.get("name") ?? "Untitled project"),
          clientContactIds: Array.isArray(document.get("clientContactIds"))
            ? (document.get("clientContactIds") as unknown[]).map(String)
            : [],
        })),
      );
      setContacts(
        contactSnapshot.docs.map((document) => ({
          id: document.id,
          name: String(document.get("displayName") ?? document.get("email") ?? "Client"),
          email: (document.get("email") as string | null) ?? null,
        })),
      );
    })();
  }, [composing, tenantId, projects.length]);

  const draftContacts = useMemo(() => {
    const project = projects.find((entry) => entry.id === draftProjectId);
    if (!project) return [];
    return contacts.filter((contact) =>
      project.clientContactIds.includes(contact.id),
    );
  }, [projects, contacts, draftProjectId]);

  const visibleThreads = useMemo(() => {
    const term = search.trim().toLowerCase();
    const scoped = initialProjectId
      ? threads.filter((thread) => thread.projectId === initialProjectId)
      : threads;
    if (!term) return scoped;
    return scoped.filter((thread) =>
      [
        thread.participant.name,
        thread.participant.email,
        thread.subject,
        thread.lastMessagePreview,
      ]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(term)),
    );
  }, [threads, search, initialProjectId]);

  // Derived, not stored: the newest thread is open until one is chosen, so the
  // screen never starts empty with work waiting. Setting this from an effect
  // would mean an extra render pass on every thread-list update.
  const activeThread = useMemo(
    () =>
      visibleThreads.find((thread) => thread.id === activeId) ??
      visibleThreads[0] ??
      null,
    [visibleThreads, activeId],
  );
  const openThreadId = activeThread?.id ?? null;
  const messagesLoading = openThreadId !== loadedThreadId;

  useEffect(() => {
    if (!openThreadId) return;
    const { firestore } = getFirebaseClient();
    const unsubscribe = onSnapshot(
      query(
        collection(firestore, "messages"),
        where("conversationId", "==", openThreadId),
        orderBy("createdAt", "asc"),
        limit(MESSAGE_LIMIT),
      ),
      (snapshot) => {
        setMessages(
          snapshot.docs.map((document) => {
            const value = document.data();
            return {
              id: document.id,
              direction: value.direction === "inbound" ? "inbound" : "outbound",
              channel: (value.channel ?? "email") as MessageChannel,
              subject: (value.subject as string | null) ?? null,
              body: (value.body as string | null) ?? null,
              bodyPreview: (value.bodyPreview as string | null) ?? null,
              createdAt: String(value.createdAt ?? value.sentAt ?? ""),
              deliveryStatus: (value.deliveryStatus as string | null) ?? null,
            };
          }),
        );
        setLoadedThreadId(openThreadId);
      },
      () => setLoadedThreadId(openThreadId),
    );
    return unsubscribe;
  }, [openThreadId]);

  // Opening a thread clears its badge. Fire-and-forget: failing to clear a
  // count must not stop the studio reading the message.
  useEffect(() => {
    if (!activeThread || activeThread.studioUnreadCount === 0) return;
    void sendCommunicationsCommand({
      type: "markConversationRead",
      idempotencyKey: `read_${activeThread.id}_${activeThread.lastMessageAt}`,
      input: { conversationId: activeThread.id },
    }).catch(() => undefined);
  }, [activeThread]);

  // Open a thread at its newest message. Without this the stream sat at the top,
  // so a client's short reply under a long invoice email was below the fold — the
  // thread list showed "How do I pay ?" while the panel showed only the studio's
  // own message, which reads as the reply having vanished.
  useEffect(() => {
    const stream = streamRef.current;
    if (!stream || !messages.length) return;
    stream.scrollTop = stream.scrollHeight;
  }, [messages]);

  const submitReply = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!activeThread || !reply.trim() || sending) return;
      setSending(true);
      setNotice(null);
      try {
        const result = await sendCommunicationsCommand({
          type: "sendMessage",
          idempotencyKey: `reply_${activeThread.id}_${Date.now()}`,
          input: {
            projectId: activeThread.projectId,
            contactId: activeThread.participant.contactId,
            subject: activeThread.subject ?? "Re: your photography project",
            body: reply.trim(),
            actionUrl: null,
            actionLabel: null,
            note: null,
          },
        });
        setReply("");
        setDraftIsAi(false);
        setDraftNotes([]);
        setNotice(
          "mode" in result && result.mode === "preview"
            ? "Preview mode — nothing was sent."
            : "Reply queued for delivery.",
        );
      } catch (caught: unknown) {
        setNotice(
          caught instanceof Error
            ? caught.message
            : "That reply did not send. Try again.",
        );
      } finally {
        setSending(false);
      }
    },
    [activeThread, reply, sending],
  );

  // The draft lands in the reply box, here, rather than sending the studio to
  // another screen to find it. The approval boundary is unchanged and arguably
  // stronger: the draft is read in the thread it answers, edited freely, and only
  // leaves when a person presses Send. Nothing about this auto-sends.
  const draftReply = useCallback(async () => {
    if (!activeThread || drafting || !tenantId) return;
    setDrafting(true);
    setNotice(null);
    setDraftNotes([]);
    try {
      const result = await requestMessageDraft({
        tenantId,
        trigger: "inbound_reply",
        projectId: activeThread.projectId,
        conversationId: activeThread.id,
      });
      if (result.mode === "preview" || !result.actionId) {
        setNotice("Preview mode — no draft was created.");
        return;
      }
      // The command writes the action before it answers, so a single read is
      // enough; no waiting on a subscription.
      const { firestore } = getFirebaseClient();
      const action = await getDoc(doc(firestore, "aiActions", result.actionId));
      const output = action.data()?.structuredOutput as
        | { body?: string; highlights?: string[] }
        | undefined;
      const uncertain = (action.data()?.confidence as
        | { uncertainFields?: string[] }
        | undefined)?.uncertainFields;
      if (!output?.body) {
        setNotice("The draft was created but could not be read back.");
        return;
      }
      setReply(output.body);
      setDraftIsAi(true);
      setDraftNotes([...(uncertain ?? []), ...(output.highlights ?? [])].slice(0, 4));
    } catch (caught: unknown) {
      setNotice(
        caught instanceof Error ? caught.message : "That draft could not be made.",
      );
    } finally {
      setDrafting(false);
    }
  }, [activeThread, drafting, tenantId]);

  const submitNewMessage = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!draftProjectId || !draftContactId || !draftBody.trim() || sending)
        return;
      setSending(true);
      setNotice(null);
      try {
        const result = await sendCommunicationsCommand({
          type: "sendMessage",
          idempotencyKey: `new_${draftProjectId}_${draftContactId}_${Date.now()}`,
          input: {
            projectId: draftProjectId,
            contactId: draftContactId,
            subject: draftSubject.trim() || "A note about your photography",
            body: draftBody.trim(),
            actionUrl: null,
            actionLabel: null,
            note: null,
          },
        });
        setDraftSubject("");
        setDraftBody("");
        setComposing(false);
        // The thread appears on its own — the conversations subscription picks
        // it up as soon as the send is recorded.
        setNotice(
          "mode" in result && result.mode === "preview"
            ? "Preview mode — nothing was sent."
            : "Message queued for delivery.",
        );
      } catch (caught: unknown) {
        setNotice(
          caught instanceof Error
            ? caught.message
            : "That message did not send. Try again.",
        );
      } finally {
        setSending(false);
      }
    },
    [draftProjectId, draftContactId, draftSubject, draftBody, sending],
  );

  const totalUnread = threads.reduce(
    (sum, thread) => sum + (thread.studioUnreadCount ?? 0),
    0,
  );

  return (
    <div className="msg-inbox">
      <aside className="msg-threads">
        <div className="msg-threads-head">
          <label className="msg-search">
            <Search size={14} aria-hidden />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search messages"
              aria-label="Search messages"
            />
          </label>
          <div className="msg-threads-meta">
            <p className="msg-threads-count">
              {totalUnread > 0
                ? `${totalUnread} waiting on you`
                : `${visibleThreads.length} conversation${visibleThreads.length === 1 ? "" : "s"}`}
            </p>
            <button
              type="button"
              className="msg-new-button"
              onClick={() => setComposing((open) => !open)}
              aria-expanded={composing}
            >
              {composing ? <X size={13} aria-hidden /> : <PenLine size={13} aria-hidden />}
              {composing ? "Cancel" : "New message"}
            </button>
          </div>
        </div>

        {composing ? (
          <form className="msg-compose" onSubmit={submitNewMessage}>
            <label>
              Project
              <select
                value={draftProjectId}
                onChange={(event) => {
                  setDraftProjectId(event.target.value);
                  setDraftContactId("");
                }}
                required
              >
                <option value="">Choose a project</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Client
              <select
                value={draftContactId}
                onChange={(event) => setDraftContactId(event.target.value)}
                required
                disabled={!draftProjectId}
              >
                <option value="">
                  {draftProjectId ? "Choose a client" : "Choose a project first"}
                </option>
                {draftContacts.map((contact) => (
                  <option key={contact.id} value={contact.id}>
                    {contact.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Subject
              <input
                type="text"
                value={draftSubject}
                onChange={(event) => setDraftSubject(event.target.value)}
                placeholder="A note about your photography"
                maxLength={120}
              />
            </label>
            <label>
              Message
              <textarea
                value={draftBody}
                onChange={(event) => setDraftBody(event.target.value)}
                rows={4}
                required
              />
            </label>
            <button
              type="submit"
              className="ds-btn ds-btn-primary ds-btn-sm"
              disabled={
                !draftProjectId || !draftContactId || !draftBody.trim() || sending
              }
            >
              {sending ? (
                <Loader2 size={14} className="spin" aria-hidden />
              ) : (
                <Send size={14} aria-hidden />
              )}
              Send message
            </button>
          </form>
        ) : null}

        {threadsLoading ? (
          <p className="msg-empty">
            <Loader2 size={15} className="spin" aria-hidden /> Loading
            conversations…
          </p>
        ) : visibleThreads.length === 0 ? (
          <div className="msg-empty">
            <Inbox size={18} aria-hidden />
            <p>
              {search
                ? "No conversation matches that search."
                : "No conversations yet. Messages you send a client, and their replies, appear here."}
            </p>
          </div>
        ) : (
          <ul className="msg-thread-list">
            {visibleThreads.map((thread) => {
              const Icon = channelIcon[thread.lastMessageChannel] ?? Mail;
              const unread = thread.studioUnreadCount > 0;
              return (
                <li key={thread.id}>
                  <button
                    type="button"
                    className={`msg-thread${thread.id === openThreadId ? " is-active" : ""}${unread ? " is-unread" : ""}`}
                    onClick={() => setActiveId(thread.id)}
                    aria-current={thread.id === openThreadId}
                  >
                    <span className="msg-thread-top">
                      <span className="msg-thread-who">
                        {thread.participant.name ??
                          thread.participant.email ??
                          "Client"}
                      </span>
                      <span className="msg-thread-when">
                        {whenLabel(thread.lastMessageAt)}
                      </span>
                    </span>
                    <span className="msg-thread-subject">
                      <Icon size={13} aria-hidden />
                      {thread.subject ?? "No subject"}
                    </span>
                    <span className="msg-thread-preview">
                      {thread.lastMessageDirection === "outbound" ? "You: " : ""}
                      {thread.lastMessagePreview}
                    </span>
                    {unread ? (
                      <span className="msg-thread-badge">
                        {thread.studioUnreadCount}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </aside>

      <section className="msg-thread-view">
        {!activeThread ? (
          <div className="msg-empty">
            <MessageSquare size={18} aria-hidden />
            <p>Choose a conversation to read it.</p>
          </div>
        ) : (
          <>
            <header className="msg-thread-header">
              <div>
                <h2>
                  {activeThread.participant.name ??
                    activeThread.participant.email ??
                    "Client"}
                </h2>
                <p>
                  {activeThread.subject ?? "No subject"}
                  {activeThread.participant.email
                    ? ` · ${activeThread.participant.email}`
                    : ""}
                </p>
              </div>
              <span className="msg-thread-channels">
                {activeThread.channels.map((channel) => {
                  const Icon = channelIcon[channel] ?? Mail;
                  return (
                    <span key={channel} title={channel}>
                      <Icon size={14} aria-hidden />
                    </span>
                  );
                })}
              </span>
            </header>

            <div className="msg-stream" ref={streamRef}>
              {messagesLoading ? (
                <p className="msg-empty">
                  <Loader2 size={15} className="spin" aria-hidden /> Loading
                  messages…
                </p>
              ) : messages.length === 0 ? (
                <p className="msg-empty">
                  This conversation has no stored messages yet.
                </p>
              ) : (
                messages.map((message) => {
                  const status = deliveryLabel(message.deliveryStatus);
                  return (
                    <article
                      key={message.id}
                      className={`msg-bubble is-${message.direction}`}
                    >
                      <header>
                        <strong>
                          {message.direction === "inbound"
                            ? (activeThread.participant.name ?? "Client")
                            : "You"}
                        </strong>
                        <time dateTime={message.createdAt}>
                          {whenLabel(message.createdAt)}
                        </time>
                      </header>
                      <p>{message.body ?? message.bodyPreview ?? ""}</p>
                      {status ? <footer>{status}</footer> : null}
                    </article>
                  );
                })
              )}
            </div>

            <form className="msg-reply" onSubmit={submitReply}>
              {draftIsAi || draftNotes.length ? (
                <div className="msg-draft-note">
                  <p>
                    <Sparkles size={13} aria-hidden />
                    {draftIsAi
                      ? "Drafted for you — read it before sending."
                      : "Notes on this draft"}
                  </p>
                  {draftNotes.length ? (
                    <ul>
                      {draftNotes.map((note) => (
                        <li key={note}>{note}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
              <label htmlFor="msg-reply-body" className="sr-only">
                Your reply
              </label>
              <textarea
                id="msg-reply-body"
                value={reply}
                onChange={(event) => {
                  setReply(event.target.value);
                  // Once edited it is the studio's words, not a draft awaiting
                  // review, and the banner should stop claiming otherwise.
                  if (draftIsAi) setDraftIsAi(false);
                }}
                placeholder={`Reply to ${activeThread.participant.name ?? "your client"}…`}
                rows={3}
              />
              <div className="msg-reply-actions">
                {notice ? <p className="msg-notice">{notice}</p> : <span />}
                <button
                  type="button"
                  className="msg-draft-button"
                  onClick={() => void draftReply()}
                  disabled={drafting}
                >
                  {drafting ? (
                    <Loader2 size={14} className="spin" aria-hidden />
                  ) : (
                    <Sparkles size={14} aria-hidden />
                  )}
                  Draft a reply
                </button>
                <button
                  type="submit"
                  className="ds-btn ds-btn-primary ds-btn-sm"
                  disabled={!reply.trim() || sending}
                >
                  {sending ? (
                    <Loader2 size={14} className="spin" aria-hidden />
                  ) : (
                    <Send size={14} aria-hidden />
                  )}
                  Send reply
                </button>
              </div>
            </form>
          </>
        )}
      </section>
    </div>
  );
}
