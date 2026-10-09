"use client";

import { FileLinks } from "@/components/documents/file-link";
import { FILE_BEARING, type FileRef } from "@/features/documents/file-ref";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  ArrowUpRight,
  ChevronLeft,
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
import { tradeVocab } from "@/features/trades/trades";
import { sendCommunicationsCommand } from "@/lib/communications/command-client";
import { getFirebaseClient } from "@/lib/firebase/client";
import { requestMessageDraft } from "@/lib/ai/message-draft-client";
import type {
  Conversation,
  MessageChannel,
} from "@/features/messaging/conversation";
import { friendlyError } from "@/lib/ai/friendly-error";
import { MessageApprovals } from "@/components/communications/message-approvals";
import Link from "next/link";
import {
  defaultThread,
  groupConversations,
  type ThreadGroup,
} from "@/features/messaging/thread-groups";

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
  preparedReply: { body: string; basedOn?: string[] } | null;
  /** What the couple attached; the inbox dropped these entirely. */
  files: FileRef[];
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
  // `deferred` is the receiving server saying "not yet" — SendGrid keeps
  // trying, so it is still on its way, not lost.
  if (value === "queued" || value === "scheduled" || value === "deferred")
    return "Waiting to send";
  if (value === "running") return "Sending";
  if (value === "retry_scheduled") return "Retrying";
  // Parked while the studio's billing is out of date (saas/billing-hold.ts);
  // it goes once payment does.
  if (value === "held_billing") return "Held until billing is updated";
  // `blocked` is a refusal by the receiving server (sendgrid-events.ts,
  // delivery-reconciler.ts); it showed no label at all, so a refused email
  // looked like any other.
  if (["failed", "bounce", "bounced", "blocked", "dropped", "dead_letter", "spamreport"].includes(value))
    return "Did not arrive";
  if (value === "mock") return "Test only";
  return null;
}

// Clock time inside a chat bubble (e.g. "2:14 PM").
function clockLabel(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.valueOf())
    ? ""
    : date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
// A day separator label for the transcript (Today / Yesterday / Mon, Sep 8).
function dayLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.valueOf())) return "";
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (sameDay(date, today)) return "Today";
  if (sameDay(date, yesterday)) return "Yesterday";
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
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

/**
 * Something a studio can act on. A failed command can carry a validation payload,
 * and putting that on screen — an array of zod issues about contactId and
 * scheduledFor — tells a photographer nothing and looks broken.
 */
function readableFailure(caught: unknown): string {
  const raw = friendlyError(caught, "");
  if (raw.includes("RECIPIENT_UNKNOWN")) {
    return "No email address on file for this client. Add one on the project, then reply.";
  }
  if (raw.includes("CONVERSATION_NOT_FOUND")) {
    return "This conversation is no longer available. Reload the page.";
  }
  if (raw.includes("FORBIDDEN")) {
    return "You do not have permission to reply on this project.";
  }
  if (raw.includes("SUBSCRIPTION_READ_ONLY")) {
    return "This studio is read-only until billing is updated, so replies can't be sent yet.";
  }
  if (raw.includes("ACTIVE_SUBSCRIPTION_REQUIRED")) {
    return "Your subscription needs attention before messages can be sent.";
  }
  // A schema payload or anything else unrecognised: say what happened, keep the
  // detail in the console for whoever is debugging.
  if (raw.trimStart().startsWith("[") || raw.trimStart().startsWith("{")) {
    console.error("reply failed", raw);
    return "That reply could not be sent. It has been logged — try again, or send it from your email client.";
  }
  return raw || "That reply could not be sent. Try again.";
}

export function MessageInbox({ initialProjectId }: { initialProjectId?: string }) {
  const workspace = useWorkspace();
  // The subject a new message falls back to, in the studio's trade: "A note
  // about your music", not your photography, for a DJ's client.
  const fallbackSubject = `A note about your ${tradeVocab(workspace.tenantTrade).service}`;
  const tenantId = workspace.tenantId;

  const [threads, setThreads] = useState<ThreadGroup[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  // The thread open before the studio picks one, chosen once when the list
  // first arrives: the newest *unread* one. Pinned, because opening it marks it
  // read — re-deriving would then jump to a different thread under the reader.
  const [defaultId, setDefaultId] = useState<string | null>(null);
  // The open thread's job, by name, for the header link to it.
  const [jobNames, setJobNames] = useState<Record<string, string>>({});
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [loadedThreadId, setLoadedThreadId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [draftNotes, setDraftNotes] = useState<string[]>([]);
  const [draftIsAi, setDraftIsAi] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Bumped after a send so the transcript re-fetches from the server.
  const [messageRefresh, setMessageRefresh] = useState(0);
  // selectThread runs on a click, before openThreadId/visibleThreads are
  // recomputed for that click, so it reads their current values through refs
  // (assigned in render, below) rather than a stale closure.
  const openThreadIdRef = useRef<string | null>(null);
  const visibleThreadsRef = useRef<ThreadGroup[]>([]);
  const defaultIdRef = useRef<string | null>(null);
  const streamRef = useRef<HTMLDivElement | null>(null);
  // Only the drafted case needs state — it arrives from a subscription. The
  // prepared-from-facts case is already on the message, so it is derived.
  const [drafted, setDrafted] = useState<
    { body: string; basedOn: string[]; threadId: string } | null
  >(null);
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
  /**
   * What the message is about. Money, the contract and insurance from a
   * coordinator go to an owner or admin to approve first; this was hardcoded
   * "general", so that approval could never be asked for.
   */
  const [draftCategory, setDraftCategory] = useState<"general" | "financial" | "contract" | "insurance">("general");
  const approvesOwnMessages = ["studio_owner", "studio_admin"].includes(String(workspace.role ?? ""));

  // Switching conversations must NOT carry the previous client's messages or
  // half-written draft across — showing one client's private draft under
  // another client's name is a real risk. Reset every thread-scoped piece of
  // state on a switch. Done here, not in an effect, to satisfy
  // react-hooks/set-state-in-effect and to reset synchronously with the click.
  //
  // But ONLY reset when the DISPLAYED thread actually changes. The newest thread
  // is the fallback-active thread (activeThread ?? visibleThreads[0]), so it is
  // already open before any tap — tapping it (or Back-ing to it) must not wipe
  // its already-loaded messages, because openThreadId would not change and the
  // loader (keyed on openThreadId) would never re-run to repopulate them.
  const selectThread = useCallback((id: string | null) => {
    const current = openThreadIdRef.current;
    const nextId =
      id ??
      (visibleThreadsRef.current.find((thread) => thread.id === defaultIdRef.current) ??
        visibleThreadsRef.current[0])?.id ??
      null;
    setActiveId(id);
    if (nextId === current) return;
    setMessages([]);
    setReply("");
    setDraftNotes([]);
    setDraftIsAi(false);
    setDrafted(null);
    setNotice(null);
  }, []);

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
        const grouped = groupConversations(
          snapshot.docs.map((document) => document.data() as Conversation),
        );
        setThreads(grouped);
        setDefaultId((current) => current ?? defaultThread(grouped)?.id ?? null);
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

  // Derived, not stored: a thread is open until one is chosen, so the screen
  // never starts empty with work waiting — the first unread one, pinned when
  // the list arrived (see defaultId), else the newest.
  const activeThread = useMemo(
    () =>
      visibleThreads.find((thread) => thread.id === activeId) ??
      visibleThreads.find((thread) => thread.id === defaultId) ??
      visibleThreads[0] ??
      null,
    [visibleThreads, activeId, defaultId],
  );
  const openThreadId = activeThread?.id ?? null;
  // Every conversation folded into the open row (thread-groups.ts). A string,
  // so the loader below re-runs on a change of membership, not of identity.
  const openMemberIds = activeThread?.memberIds.join(",") ?? "";
  const openProjectId = activeThread?.projectId ?? null;
  const messagesLoading = openThreadId !== loadedThreadId;
  // Keep the refs selectThread reads in sync with the rendered values. Written
  // in an effect (not during render) so a click, which happens after commit,
  // always sees the latest values.
  useEffect(() => {
    openThreadIdRef.current = openThreadId;
    visibleThreadsRef.current = visibleThreads;
    defaultIdRef.current = defaultId;
  });

  // The open thread's job name, for "Open job" in its header. One read per
  // job, cached; the full project list still loads only for the composer.
  useEffect(() => {
    if (!openProjectId || !tenantId || jobNames[openProjectId]) return;
    let active = true;
    const { firestore } = getFirebaseClient();
    void getDoc(doc(firestore, "projects", openProjectId))
      .then((snapshot) => {
        if (!active || !snapshot.exists() || snapshot.get("tenantId") !== tenantId) return;
        const name = String(snapshot.get("name") ?? "");
        if (name) setJobNames((current) => ({ ...current, [openProjectId]: name }));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [openProjectId, tenantId, jobNames]);

  useEffect(() => {
    if (!openThreadId || !tenantId) return;
    let active = true;
    void (async () => {
      try {
        const { firestore } = getFirebaseClient();
        // One-time getDocs, not onSnapshot: a real-time listener on this
        // two-equality query (with experimentalForceLongPolling) returned an
        // empty result set with no error. A getDocs is a plain server read that
        // resolves correctly and throws clearly on any denial. MUST filter by
        // tenantId — firestore.rules proves message-read access from
        // `resource.data.tenantId`, so an unscoped query is rejected.
        const memberIds = openMemberIds ? openMemberIds.split(",").slice(0, 10) : [openThreadId];
        const snapshot = await getDocs(
          query(
            collection(firestore, "messages"),
            where("tenantId", "==", tenantId),
            memberIds.length > 1
              ? where("conversationId", "in", memberIds)
              : where("conversationId", "==", openThreadId),
            limit(MESSAGE_LIMIT),
          ),
        );
        if (!active) return;
        const mapped = snapshot.docs
          .filter((document) => !document.data().archivedAt)
          .map((document): ThreadMessage => {
            const value = document.data();
            return {
              id: document.id,
              direction:
                value.direction === "inbound" ? "inbound" : "outbound",
              channel: (value.channel ?? "email") as MessageChannel,
              subject: (value.subject as string | null) ?? null,
              body: (value.body as string | null) ?? null,
              bodyPreview: (value.bodyPreview as string | null) ?? null,
              createdAt: String(value.createdAt ?? value.sentAt ?? ""),
              deliveryStatus: (value.deliveryStatus as string | null) ?? null,
              preparedReply: (value.preparedReply ?? null) as
                | { body: string; basedOn?: string[] }
                | null,
              files: FILE_BEARING.messages(value),
            };
          })
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        setMessages(mapped);
        setLoadError(null);
        setLoadedThreadId(openThreadId);
      } catch (error) {
        if (!active) return;
        setLoadedThreadId(openThreadId);
        setLoadError(error instanceof Error ? error.message : String(error));
      }
    })();
    return () => {
      active = false;
    };
  }, [openThreadId, openMemberIds, tenantId, messageRefresh]);

  // Opening a thread clears its badge. Fire-and-forget: failing to clear a
  // count must not stop the studio reading the message.
  useEffect(() => {
    if (!activeThread || activeThread.studioUnreadCount === 0) return;
    for (const conversationId of activeThread.memberIds) {
      void sendCommunicationsCommand({
        type: "markConversationRead",
        idempotencyKey: `read_${conversationId}_${activeThread.lastMessageAt}`,
        input: { conversationId },
      }).catch(() => undefined);
    }
  }, [activeThread]);

  // A reply waiting before the studio asked for one. Either composed from the
  // project's own records on arrival, or — for questions needing judgement —
  // drafted in the background. Both still wait for a person.
  const preparedFromFacts = useMemo(() => {
    const latest = [...messages]
      .reverse()
      .find((message) => message.direction === "inbound");
    const prepared = latest?.preparedReply;
    return prepared?.body
      ? {
          body: prepared.body,
          basedOn: prepared.basedOn ?? [],
          source: "facts" as const,
        }
      : null;
  }, [messages]);

  useEffect(() => {
    if (!openThreadId || !tenantId || preparedFromFacts) return;
    const { firestore } = getFirebaseClient();
    const unsubscribe = onSnapshot(
      query(
        collection(firestore, "aiActions"),
        // tenantId first: firestore.rules proves aiActions read access from
        // resource.data.tenantId, so an unscoped listen is rejected outright.
        where("tenantId", "==", tenantId),
        where("conversationId", "==", openThreadId),
        where("status", "==", "review_required"),
        limit(1),
      ),
      (snapshot) => {
        const action = snapshot.docs[0]?.data();
        const output = action?.structuredOutput as { body?: string } | undefined;
        const uncertain = (action?.confidence as { uncertainFields?: string[] })
          ?.uncertainFields;
        setDrafted(
          output?.body
            ? {
                body: output.body,
                basedOn: uncertain ?? [],
                threadId: openThreadId,
              }
            : null,
        );
      },
      (error) => {
        // Don't hide a rejected listen behind a silent no-op — a missing
        // tenant filter or index shows up here, not as a thrown error.
        console.warn("aiActions draft-waiting listen failed", error);
        setDrafted(null);
      },
    );
    return unsubscribe;
  }, [openThreadId, tenantId, preparedFromFacts]);

  const waiting = useMemo(
    () =>
      preparedFromFacts ??
      (drafted && drafted.threadId === openThreadId
        ? { body: drafted.body, basedOn: drafted.basedOn, source: "draft" as const }
        : null),
    [preparedFromFacts, drafted, openThreadId],
  );

  // Open a thread at its newest message. Without this the stream sat at the top,
  // so a client's short reply under a long invoice email was below the fold — the
  // thread list showed "How do I pay ?" while the panel showed only the studio's
  // own message, which reads as the reply having vanished.
  //
  // Keyed on openThreadId/activeId too, not just messages: the newest thread is
  // already loaded before it is opened (activeThread ?? visibleThreads[0]), so
  // tapping it does not change `messages` — without the open signal the stream
  // would stay pinned at the top. Also re-runs when the prepared-reply panel
  // appears, because it changes the stream's height after the messages render.
  useEffect(() => {
    const stream = streamRef.current;
    if (!stream || !messages.length) return;
    // Two frames: the first lets the (mobile full-screen) thread view lay out,
    // the second scrolls once its real scrollHeight is known. A single frame
    // fires while height is still 0/partial and lands at the top.
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        stream.scrollTop = stream.scrollHeight;
      });
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [openThreadId, activeId, messages, waiting]);

  const submitReply = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!activeThread || !reply.trim() || sending) return;
      const body = reply.trim();
      setSending(true);
      setNotice(null);
      try {
        const result = await sendCommunicationsCommand({
          type: "replyToConversation",
          idempotencyKey: `reply_${activeThread.id}_${Date.now()}`,
          input: { conversationId: activeThread.id, body },
        });
        const previewOnly = "mode" in result && result.mode === "preview";
        setReply("");
        setDraftIsAi(false);
        setDraftNotes([]);
        // The reply is queued as an emailJob; a background worker sends it and
        // only then writes the `messages` doc the thread subscribes to — so the
        // sent message would be invisible for seconds. Show it immediately
        // (optimistically). When the worker's real doc arrives, the snapshot
        // replaces the whole list, swapping this local copy for the stored one.
        if (!previewOnly) {
          setMessages((prev) => [
            ...prev,
            {
              id: `local_${Date.now()}`,
              direction: "outbound",
              channel: "email",
              subject: null,
              body,
              bodyPreview: null,
              createdAt: new Date().toISOString(),
              deliveryStatus: "queued",
              preparedReply: null,
              files: [],
            },
          ]);
        }
        setNotice(
          previewOnly
            ? "Preview mode — nothing was sent."
            : "Reply queued for delivery.",
        );
        // Re-fetch from the server so the stored copy replaces the optimistic
        // one (the worker writes the messages doc a moment after the send).
        if (!previewOnly)
          window.setTimeout(() => setMessageRefresh((value) => value + 1), 2500);
      } catch (caught: unknown) {
        setNotice(readableFailure(caught));
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
        friendlyError(caught, "That draft could not be made."),
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
            subject: draftSubject.trim() || fallbackSubject,
            body: draftBody.trim(),
            // Every field the command requires. These were missing, so the first
            // new message a studio tried to send would have failed the same way
            // a reply did — on a schema it has no way of knowing about.
            category: draftCategory,
            actionLabel: null,
            actionUrl: null,
            scheduledFor: null,
          },
        });
        setDraftSubject("");
        setDraftBody("");
        setDraftCategory("general");
        setComposing(false);
        // The thread appears on its own — the conversations subscription picks
        // it up as soon as the send is recorded.
        const held =
          "payload" in result &&
          (result.payload as Record<string, unknown>).requiresApproval === true;
        setNotice(
          "mode" in result && result.mode === "preview"
            ? "Preview mode — nothing was sent."
            : held
              ? "Sent to the studio owner to approve. It goes out once they do."
              : "Message queued for delivery.",
        );
      } catch (caught: unknown) {
        setNotice(readableFailure(caught));
      } finally {
        setSending(false);
      }
    },
    [draftProjectId, draftContactId, draftSubject, draftBody, draftCategory, sending, fallbackSubject],
  );

  const totalUnread = threads.reduce(
    (sum, thread) => sum + (thread.studioUnreadCount ?? 0),
    0,
  );

  // Master-detail is driven by the EXPLICIT selection (activeId), not
  // openThreadId, which falls back to the first thread for the desktop
  // two-pane — that would make the phone always show a thread, never the list,
  // and stop Back from closing it.
  return (
    <div className="msg-inbox" data-detail={activeId ? "open" : undefined}>
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
              {`${visibleThreads.length} conversation${visibleThreads.length === 1 ? "" : "s"}`}
              {totalUnread > 0 ? ` · ${totalUnread} waiting on you` : ""}
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
                placeholder={fallbackSubject}
                maxLength={120}
              />
            </label>
            <label>
              What it&apos;s about
              <select
                onChange={(event) => setDraftCategory(event.target.value as typeof draftCategory)}
                value={draftCategory}
              >
                <option value="general">Anything else</option>
                <option value="financial">Money — invoices or payments</option>
                <option value="contract">The contract</option>
                <option value="insurance">Insurance</option>
              </select>
            </label>
            {draftCategory !== "general" && !approvesOwnMessages ? (
              <p className="msg-approval-meta">
                The studio owner approves messages about money, the contract or insurance before they go out.
              </p>
            ) : null}
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

        <MessageApprovals />

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
                    onClick={() => selectThread(thread.id)}
                    aria-current={thread.id === openThreadId}
                  >
                    <span className="msg-thread-top">
                      <span className="msg-thread-who">
                        {thread.participant.name ??
                          thread.participant.email ??
                          "Client"}
                      </span>
                      {/* The count sits after the time in the row, not
                          absolutely over it — it covered "ago" (UI audit,
                          2026-10-02). */}
                      <span className="msg-thread-when">
                        {whenLabel(thread.lastMessageAt)}
                        {unread ? (
                          <span className="msg-thread-badge">
                            {thread.studioUnreadCount}
                          </span>
                        ) : null}
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
              {/* Phone master-detail: return to the conversation list. */}
              <button
                type="button"
                className="msg-back"
                onClick={() => selectThread(null)}
                aria-label="Back to conversations"
              >
                <ChevronLeft size={18} aria-hidden />
              </button>
              <div>
                <h2>
                  {activeThread.participant.name ??
                    activeThread.participant.email ??
                    "Client"}
                </h2>
                {/* This showed the last message's subject, which is written
                    for the client — so the studio's own mailbox read "FlawlessIQ
                    sent you an update" about their own outgoing message. The
                    subject is already on each message in the stream; what the
                    studio needs here is which job this is and how to reach them. */}
                <p>
                  {[
                    activeThread.projectId
                      ? (jobNames[activeThread.projectId] ??
                        projects.find((entry) => entry.id === activeThread.projectId)?.name)
                      : null,
                    activeThread.participant.email,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "No job linked"}
                </p>
              </div>
              {/* The corner held a channel icon that looked like a button and
                  did nothing; there was no way from a conversation to the
                  wedding it is about (UI audit, 2026-10-02). */}
              {activeThread.projectId ? (
                <Link
                  className="msg-thread-job"
                  href={`/studio/projects/${activeThread.projectId}`}
                >
                  Open job <ArrowUpRight size={14} aria-hidden />
                </Link>
              ) : null}
            </header>

            <div className="msg-stream" ref={streamRef}>
              {messagesLoading ? (
                <p className="msg-empty">
                  <Loader2 size={15} className="spin" aria-hidden /> Loading
                  messages…
                </p>
              ) : messages.length === 0 ? (
                <p className="msg-empty">
                  {loadError
                    ? "Couldn't load this conversation's messages. Try again in a moment."
                    : "This conversation has no stored messages yet."}
                </p>
              ) : (
                messages.map((message, index) => {
                  const status = deliveryLabel(message.deliveryStatus);
                  const previous = index > 0 ? messages[index - 1] : undefined;
                  // A date separator when the day changes (or on the first).
                  const newDay =
                    !previous ||
                    new Date(previous.createdAt).toDateString() !==
                      new Date(message.createdAt).toDateString();
                  // Name only at the start of an inbound run — grouped like a
                  // chat, not repeated "You · time" on every bubble.
                  const showWho =
                    message.direction === "inbound" &&
                    (newDay || previous?.direction !== "inbound");
                  return (
                    <Fragment key={message.id}>
                      {newDay ? (
                        <div className="msg-day">
                          <span>{dayLabel(message.createdAt)}</span>
                        </div>
                      ) : null}
                      {showWho ? (
                        <strong className="msg-bubble-who">
                          {activeThread.participant.name ?? "Client"}
                        </strong>
                      ) : null}
                      <article className={`msg-bubble is-${message.direction}`}>
                        <p>{message.body ?? message.bodyPreview ?? ""}</p>
                        {message.files.length ? (
                          <div className="msg-bubble-files">
                            <FileLinks files={message.files} />
                          </div>
                        ) : null}
                        <span className="msg-bubble-meta">
                          <time dateTime={message.createdAt}>
                            {clockLabel(message.createdAt)}
                          </time>
                          {status ? <em>· {status}</em> : null}
                        </span>
                      </article>
                    </Fragment>
                  );
                })
              )}
            </div>

            <form className="msg-reply" onSubmit={submitReply}>
              {waiting && !reply ? (
                <div className="msg-suggestion">
                  <span className="msg-suggestion-icon">
                    <Sparkles size={14} aria-hidden />
                  </span>
                  <span className="msg-suggestion-text">
                    <strong>
                      {waiting.source === "facts"
                        ? "A reply is ready from your project records"
                        : "A reply has been drafted for you"}
                    </strong>
                    {waiting.basedOn.length ? (
                      <small>{waiting.basedOn.join(" · ")}</small>
                    ) : null}
                  </span>
                  <button
                    type="button"
                    className="msg-suggestion-use"
                    onClick={() => {
                      setReply(waiting.body);
                      setDraftIsAi(waiting.source === "draft");
                      setDraftNotes(waiting.basedOn);
                    }}
                  >
                    Use this reply
                  </button>
                </div>
              ) : null}
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
                  // Clearing the field dismisses the draft entirely — the
                  // "notes on this draft" panel should go with it.
                  if (!event.target.value.trim() && draftNotes.length)
                    setDraftNotes([]);
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
