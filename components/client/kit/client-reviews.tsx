"use client";

import { useState } from "react";
import { CheckCircle2, ExternalLink, Heart } from "lucide-react";
import { Button, Card, Main, Note, PoweredBy } from "@/components/kit/kit";
import { useWorkspace } from "@/features/auth/workspace-context";
import { friendlyError } from "@/lib/ai/friendly-error";
import { sendPostEventCommand } from "@/lib/post-event/command-client";
import { dataIsLive } from "@/lib/runtime-mode";
import { text, useClientVocab, useProjectRecords } from "@/components/client/live-client-views";
import { EmptyMoment } from "@/components/client/kit/empty-moment";
import { InfoHint } from "@/components/ui/info-hint";

/**
 * The review ask (M5 of docs/mobile-first-client-crew-plan-2026-09-28.md).
 *
 * A thank-you and one button. It used to tell the couple that "opening the
 * review site records engagement only", which is true and is for the studio,
 * not them. Saying they've left one stops the reminders; StudioCue still
 * never claims a review was posted from a click.
 */
export function ClientReviews() {
  const workspace = useWorkspace();
  const reviews = useProjectRecords("reviewRequests");
  const words = useClientVocab();
  const review = reviews.value.find((item) => item.status !== "skipped");
  const [confirmed, setConfirmed] = useState(false);
  const [opened, setOpened] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const studioName =
    workspace.tenantName && !workspace.tenantName.startsWith("Loading") ? workspace.tenantName : "your studio";

  if (!review)
    return (
      <Main label="Review">
        <div className="kit-stack-tight">
          <p className="kit-eyebrow">{words.afterwards}</p>
          <h1 className="kit-title">Thank you</h1>
        </div>
        <EmptyMoment
          area="reviews"
          error={reviews.error}
          loading={reviews.loading}
          loadingText="Opening…"
          upcoming="Nothing to do here yet. Enjoy your photos."
        />
        <PoweredBy />
      </Main>
    );

  const done = confirmed || ["client_confirmed", "manually_confirmed"].includes(text(review.status));
  const site = text(review.destinationLabel, "") || "their review page";
  const url = typeof review.destinationUrl === "string" && review.destinationUrl ? review.destinationUrl : null;

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      if (dataIsLive)
        await sendPostEventCommand("confirmReview", { projectId: review!.projectId, reviewRequestId: review!.id });
      setConfirmed(true);
    } catch (caught: unknown) {
      setError(friendlyError(caught, "That couldn’t be saved. Try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Main label="Review">
      <div className="kit-stack-tight">
        <p className="kit-eyebrow">{words.afterwards}</p>
        <h1 className="kit-title">{`Thank you for choosing ${studioName}`}</h1>
      </div>

      {done ? (
        <Note icon={CheckCircle2} tone="accent">
          {`Thank you. That means a lot to ${studioName}, and you won’t be asked again.`}
        </Note>
      ) : (
        <Card tone="accent">
          <Heart aria-hidden size={26} />
          <h2 className="kit-section">
            Would you share a few words?
            <InfoHint label="Leaving a review">
              Your review is posted on the review site, not here. Tapping “I’ve left my review” just tells your studio
              and stops the reminders.
            </InfoHint>
          </h2>
          <p className="kit-body">
            {`If you loved working with ${studioName}, a short review on ${site} helps ${words.event === "wedding" ? "other couples" : "others"} find them. It takes a minute.`}
          </p>
          {url ? (
            <a
              className="kit-button"
              href={url}
              onClick={() => {
                setOpened(true);
                if (dataIsLive)
                  void sendPostEventCommand("markReviewOpened", {
                    projectId: review.projectId,
                    reviewRequestId: review.id,
                  }).catch(() => undefined);
              }}
              rel="noreferrer"
              target="_blank"
            >
              {`Leave a review on ${site}`} <ExternalLink aria-hidden size={18} />
            </a>
          ) : null}
          <Button disabled={busy} onClick={() => void confirm()} variant={opened ? "primary" : "soft"}>
            {busy ? "Saving…" : "I’ve left my review"}
          </Button>
          {error ? (
            <p className="kit-error" role="alert">
              {error}
            </p>
          ) : null}
        </Card>
      )}
      <PoweredBy />
    </Main>
  );
}
