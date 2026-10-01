import { AdminShell } from "@/components/platform/admin-shell";
import { FeedbackTriage } from "@/components/platform/feedback-triage";

export default function FeedbackPage() {
  return (
    <AdminShell active="Feedback">
      <header>
        <div>
          <p className="eyebrow">Studio feedback</p>
          <h1>Feedback</h1>
          <p>
            Everything studios send from the Feedback button. Moving one to
            Planned or Shipped emails the studio that sent it, with your note.
          </p>
        </div>
      </header>
      <FeedbackTriage />
    </AdminShell>
  );
}
