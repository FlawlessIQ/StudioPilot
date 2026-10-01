"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CircleCheck,
  ImagePlus,
  LoaderCircle,
  MessageSquareHeart,
  Trash2,
} from "lucide-react";
import { SheetDialog } from "@/components/ui/sheet-dialog";
import { useWorkspace } from "@/features/auth/workspace-context";
import {
  FEEDBACK_KINDS,
  FEEDBACK_KIND_LABELS,
  FEEDBACK_KIND_PROMPTS,
  FEEDBACK_MESSAGE_MAX,
  FEEDBACK_ROLES,
  type FeedbackKind,
} from "@/features/feedback/model";
import {
  feedbackErrorMessage,
  submitFeedback,
} from "@/lib/feedback/command-client";
import { captureScreen, imageFileToDataUrl } from "@/lib/feedback/screenshot";
import {
  listenForFeedback,
  recentPageError,
  rememberPageErrors,
} from "./feedback-events";

/**
 * The studio's way to tell the StudioCue team anything: a Feedback button in
 * the corner of every studio screen (on a phone, "Send feedback" in the More
 * drawer, since a floating button would sit on the tab bar), and the sheet it
 * opens.
 *
 * The screen is captured as the button is pressed, before the sheet covers
 * it, so a "Something's broken" report shows what they were looking at. The
 * screen they're on, their device and the last error on the page go with it,
 * so nobody has to describe where they were.
 */
export function FeedbackLauncher() {
  const workspace = useWorkspace();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const busy = useRef(false);

  const allowed =
    Boolean(workspace.tenantId) &&
    (FEEDBACK_ROLES as readonly string[]).includes(workspace.role ?? "");

  const start = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setCapturing(true);
    const shot = await captureScreen();
    setScreenshot(shot);
    setCapturing(false);
    setOpen(true);
  }, []);

  useEffect(() => {
    rememberPageErrors();
    return listenForFeedback(() => void start());
  }, [start]);

  const close = useCallback(() => {
    setOpen(false);
    setScreenshot(null);
    busy.current = false;
  }, []);

  if (!allowed) return null;

  return (
    <>
      {open ? null : (
        <button
          className="feedback-fab"
          data-feedback-exclude="true"
          disabled={capturing}
          onClick={() => void start()}
          type="button"
        >
          {capturing ? (
            <LoaderCircle
              aria-hidden="true"
              className="feedback-spin"
              size={16}
            />
          ) : (
            <MessageSquareHeart aria-hidden="true" size={16} />
          )}
          <span>Feedback</span>
        </button>
      )}
      {open ? (
        <SheetDialog label="Send feedback" onClose={close} open>
          <FeedbackForm
            initialScreenshot={screenshot}
            onDone={close}
            route={pathname}
            tenantId={workspace.tenantId ?? ""}
          />
        </SheetDialog>
      ) : null}
    </>
  );
}

function FeedbackForm({
  tenantId,
  route,
  initialScreenshot,
  onDone,
}: {
  tenantId: string;
  route: string;
  initialScreenshot: string | null;
  onDone: () => void;
}) {
  const [kind, setKind] = useState<FeedbackKind>("idea");
  const [message, setMessage] = useState("");
  const [followUpOk, setFollowUpOk] = useState(true);
  const [screenshot, setScreenshot] = useState<string | null>(
    initialScreenshot,
  );
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<"sent" | "preview" | null>(null);
  // One key per sheet: a retry after a dropped connection is the same feedback.
  const [idempotencyKey] = useState(() => `feedback_${crypto.randomUUID()}`);

  async function attach(file: File | undefined) {
    if (!file) return;
    const dataUrl = await imageFileToDataUrl(file);
    if (dataUrl) {
      setScreenshot(dataUrl);
      setError(null);
    } else setError("That image couldn't be used. Try a PNG or JPEG.");
  }

  async function send() {
    if (!message.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      const outcome = await submitFeedback(
        {
          tenantId,
          kind,
          message: message.trim(),
          followUpOk,
          context: {
            route,
            viewport: `${window.innerWidth}×${window.innerHeight}`,
            userAgent: navigator.userAgent.slice(0, 400),
            lastError: recentPageError(),
          },
          screenshot,
        },
        idempotencyKey,
      );
      setResult(outcome.mode === "live" ? "sent" : "preview");
    } catch (caught) {
      setError(feedbackErrorMessage(caught));
    } finally {
      setSending(false);
    }
  }

  if (result) {
    return (
      <div className="feedback-panel feedback-done" role="status">
        <CircleCheck aria-hidden="true" size={34} />
        <h2>
          {result === "sent"
            ? "Thank you. It's with the StudioCue team."
            : "Nothing was sent"}
        </h2>
        <p>
          {result === "sent"
            ? "We read every message. A copy is on its way to your inbox, and you can see where it stands under Your feedback in Help & guides."
            : "Feedback isn't connected in this preview, so this one didn't go anywhere."}
        </p>
        <div className="feedback-actions">
          {result === "sent" ? (
            <Link
              className="feedback-secondary"
              href="/studio/help#feedback"
              onClick={onDone}
            >
              See your feedback
            </Link>
          ) : null}
          <button className="feedback-primary" onClick={onDone} type="button">
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <form
      className="feedback-panel"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <header className="feedback-head">
        <p className="feedback-eyebrow">Feedback</p>
        <h2>Tell the StudioCue team</h2>
        <p>We read every message, and it shapes what we build next.</p>
      </header>

      <fieldset className="feedback-kinds">
        <legend>What&apos;s it about?</legend>
        {FEEDBACK_KINDS.map((option) => (
          <label
            className="feedback-kind"
            data-active={option === kind ? "true" : "false"}
            key={option}
          >
            <input
              checked={option === kind}
              name="feedback-kind"
              onChange={() => setKind(option)}
              type="radio"
              value={option}
            />
            {FEEDBACK_KIND_LABELS[option]}
          </label>
        ))}
      </fieldset>

      <label className="feedback-field">
        <span>{FEEDBACK_KIND_PROMPTS[kind]}</span>
        <textarea
          autoFocus
          maxLength={FEEDBACK_MESSAGE_MAX}
          onChange={(event) => setMessage(event.target.value)}
          rows={5}
          value={message}
        />
      </label>

      <div className="feedback-shot">
        {screenshot ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- a local data URL */}
            <img alt="Screenshot of the screen you were on" src={screenshot} />
            <div>
              <strong>Screenshot of this screen</strong>
              <small>
                It can show client details. Only the StudioCue team sees it.
              </small>
              <button
                className="feedback-link"
                onClick={() => setScreenshot(null)}
                type="button"
              >
                <Trash2 aria-hidden="true" size={14} /> Remove
              </button>
            </div>
          </>
        ) : (
          <label className="feedback-attach">
            <ImagePlus aria-hidden="true" size={18} />
            <span>
              <strong>Add a screenshot</strong>
              <small>Optional. A picture often says it faster.</small>
            </span>
            <input
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={(event) => void attach(event.target.files?.[0])}
              type="file"
            />
          </label>
        )}
      </div>

      <label className="feedback-check">
        <input
          checked={followUpOk}
          onChange={(event) => setFollowUpOk(event.target.checked)}
          type="checkbox"
        />
        <span>You can contact me about this</span>
      </label>

      {error ? (
        <p className="feedback-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="feedback-actions">
        <button className="feedback-secondary" onClick={onDone} type="button">
          Cancel
        </button>
        <button
          className="feedback-primary"
          disabled={!message.trim() || sending}
          type="submit"
        >
          {sending ? (
            <LoaderCircle
              aria-hidden="true"
              className="feedback-spin"
              size={16}
            />
          ) : null}
          {sending ? "Sending…" : "Send feedback"}
        </button>
      </div>
    </form>
  );
}
