import { createHash } from "node:crypto";
import type { Metadata } from "next";
import { adminFirestore } from "@/server/firebase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Send this reply" };

/**
 * What the studio sees when it taps the link in its notification email.
 *
 * The reply is shown in full, with the client's question above it and the facts
 * it was built from below, and nothing happens until the form is submitted. A
 * link that sent on load would fire from a mail client fetching previews — and a
 * studio should read words before a client does, which is the whole point.
 */
export default async function ReplyApprovalPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const snapshot = await adminFirestore
    .doc(`replyApprovals/${tokenHash}`)
    .get();
  const approval = snapshot.data();
  const expired =
    approval && String(approval.expiresAt ?? "") < new Date().toISOString();

  if (!approval || expired || approval.usedAt) {
    return (
      <main className="ds-root legal-page" data-ds-theme="emerald">
        <article>
          <p className="eyebrow">Reply</p>
          <h1>
            {approval?.usedAt
              ? "Already sent"
              : expired
                ? "This link has expired"
                : "Link not found"}
          </h1>
          <p>
            {approval?.usedAt
              ? "This reply has already gone to your client."
              : "Open the conversation in StudioCue to reply there instead."}
          </p>
          <p>
            <a href="/studio/messages">Go to your messages</a>
          </p>
        </article>
      </main>
    );
  }

  const basedOn = Array.isArray(approval.basedOn)
    ? (approval.basedOn as unknown[]).map(String)
    : [];

  return (
    <main className="ds-root legal-page" data-ds-theme="emerald">
      <article>
        <p className="eyebrow">Ready to send</p>
        <h1>Send this reply?</h1>

        <h2>They asked</h2>
        <p className="reply-quote">{String(approval.question ?? "")}</p>

        <h2>You would send</h2>
        <p className="reply-body">{String(approval.replyBody ?? "")}</p>

        {basedOn.length ? (
          <>
            <h2>Built from</h2>
            <ul className="legal-list">
              {basedOn.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </>
        ) : null}

        <form method="post" action="/api/reply-approval" className="reply-form">
          <input type="hidden" name="token" value={token} />
          <button type="submit" className="ds-btn ds-btn-primary">
            Send to {String(approval.recipientName ?? "your client")}
          </button>
          <a href="/studio/messages">Edit it instead</a>
        </form>
      </article>
    </main>
  );
}
