"use client";

import { useEffect, useState } from "react";
import { collection, getDocs, limit, orderBy, query, where } from "firebase/firestore";
import { MessageSquareHeart } from "lucide-react";
import { getFirebaseClient } from "@/lib/firebase/client";
import { useWorkspace } from "@/features/auth/workspace-context";
import {
  FEEDBACK_KIND_LABELS,
  FEEDBACK_ROLES,
  isFeedbackKind,
  isFeedbackStatus,
  type FeedbackKind,
  type FeedbackStatus,
} from "@/features/feedback/model";
import { openFeedback } from "./feedback-events";

/**
 * "Your feedback" in Help & guides: everything this person has sent the team,
 * and where each one stands. Seeing an idea move to Planned, then Shipped, is
 * most of what tells a studio they were heard.
 */

type Item = {
  id: string;
  kind: FeedbackKind;
  message: string;
  status: FeedbackStatus;
  statusNote: string | null;
  createdAt: string;
};

type Reply = { id: string; fromTeam: boolean; body: string; createdAt: string };

/** "Closed" is the team's triage word; to the person who sent it, it was reviewed. */
const STUDIO_STATUS_LABELS: Record<FeedbackStatus, string> = {
  received: "Received",
  planned: "Planned",
  shipped: "Shipped",
  closed: "Reviewed",
};

export function YourFeedback() {
  const workspace = useWorkspace();
  const [items, setItems] = useState<Item[] | null>(null);
  const [failed, setFailed] = useState(false);
  // The team's replies and yours, by feedback id (Console inbox).
  const [thread, setThread] = useState<Record<string, Reply[]>>({});
  const tenantId = workspace.tenantId;
  const userId = workspace.userId;
  const allowed = Boolean(tenantId && userId) && (FEEDBACK_ROLES as readonly string[]).includes(workspace.role ?? "");

  useEffect(() => {
    if (!allowed || !tenantId || !userId) return;
    let live = true;
    (async () => {
      try {
        const { firestore } = getFirebaseClient();
        // tenantId and userId in the query, or the rules reject all of it.
        const snapshot = await getDocs(
          query(
            collection(firestore, "feedback"),
            where("tenantId", "==", tenantId),
            where("userId", "==", userId),
            orderBy("createdAt", "desc"),
            limit(25),
          ),
        );
        if (!live) return;
        // Both filters, or the rules refuse the whole query: only replies sent
        // to this person, never the team's internal notes.
        getDocs(
          query(collection(firestore, "feedbackMessages"), where("senderUserId", "==", userId), where("visibleToSender", "==", true), limit(200)),
        )
          .then((messages) => {
            if (!live) return;
            const grouped: Record<string, Reply[]> = {};
            for (const message of messages.docs) {
              const data = message.data();
              const feedbackId = String(data.feedbackId ?? "");
              if (!feedbackId || typeof data.body !== "string") continue;
              (grouped[feedbackId] ??= []).push({
                id: message.id,
                fromTeam: data.direction === "outbound",
                body: data.body,
                createdAt: typeof data.createdAt === "string" ? data.createdAt : "",
              });
            }
            for (const list of Object.values(grouped)) list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
            setThread(grouped);
          })
          .catch(() => undefined);
        setItems(
          snapshot.docs.map((document) => {
            const data = document.data();
            return {
              id: document.id,
              kind: isFeedbackKind(data.kind) ? data.kind : "idea",
              message: typeof data.message === "string" ? data.message : "",
              status: isFeedbackStatus(data.status) ? data.status : "received",
              statusNote: typeof data.statusNote === "string" && data.statusNote ? data.statusNote : null,
              createdAt: typeof data.createdAt === "string" ? data.createdAt : "",
            };
          }),
        );
      } catch {
        if (live) setFailed(true);
      }
    })();
    return () => {
      live = false;
    };
  }, [allowed, tenantId, userId]);

  if (!allowed) return null;

  return (
    <div className="panel your-feedback">
      <div className="your-feedback-head">
        <span>
          <strong>Tell us what would make StudioCue better</strong>
          <small>The team reads every message. What you send shows up here with where it stands.</small>
        </span>
        <button className="button button-dark" onClick={() => openFeedback()} type="button">
          <MessageSquareHeart aria-hidden="true" size={16} /> Send feedback
        </button>
      </div>
      {failed ? (
        <p className="your-feedback-empty">Your feedback couldn&apos;t be loaded just now.</p>
      ) : items === null ? null : items.length === 0 ? (
        <p className="your-feedback-empty">Nothing sent yet.</p>
      ) : (
        <ul className="your-feedback-list">
          {items.map((item) => (
            <li key={item.id}>
              <div className="your-feedback-meta">
                <span>{FEEDBACK_KIND_LABELS[item.kind]}</span>
                {item.createdAt ? (
                  <time dateTime={item.createdAt}>
                    {new Date(item.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                  </time>
                ) : null}
                <b className="your-feedback-status" data-status={item.status}>
                  {STUDIO_STATUS_LABELS[item.status]}
                </b>
              </div>
              <p>{item.message.length > 280 ? `${item.message.slice(0, 279).trimEnd()}…` : item.message}</p>
              {item.statusNote ? <p className="your-feedback-note">From the team: {item.statusNote}</p> : null}
              {(thread[item.id] ?? []).map((reply) => (
                <p className="your-feedback-note" key={reply.id}>
                  {reply.fromTeam ? "From the team" : "You replied"}: {reply.body.length > 400 ? `${reply.body.slice(0, 399).trimEnd()}…` : reply.body}
                </p>
              ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
