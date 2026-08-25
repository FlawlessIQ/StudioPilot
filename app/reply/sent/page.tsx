import type { Metadata } from "next";

export const metadata: Metadata = { title: "Reply sent" };

export default function ReplySentPage() {
  return (
    <main className="ds-root legal-page" data-ds-theme="emerald">
      <article>
        <p className="eyebrow">Reply</p>
        <h1>Sent</h1>
        <p>
          Your client has it, and the exchange is on the project record. You can
          close this page.
        </p>
        <p>
          <a href="/studio/messages">See the conversation</a>
        </p>
      </article>
    </main>
  );
}
