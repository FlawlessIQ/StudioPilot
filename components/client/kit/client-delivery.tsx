"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  BookOpenCheck,
  Check,
  CheckCircle2,
  Clock3,
  Copy,
  ExternalLink,
  FolderDown,
  Images,
  MessageCircle,
  PencilLine,
  Play,
  type LucideIcon,
} from "lucide-react";
import { Button, Card, KitRoot, Main, Note, Pill, PoweredBy, TextArea } from "@/components/kit/kit";
import { SheetDialog } from "@/components/ui/sheet-dialog";
import { useWorkspace } from "@/features/auth/workspace-context";
import {
  clientDeliverables,
  daysLeft,
  deliveriesHeading,
  type ClientDeliverable,
} from "@/features/client/deliverables";
import { friendlyError } from "@/lib/ai/friendly-error";
import { sendPostEventCommand } from "@/lib/post-event/command-client";
import { dataIsLive } from "@/lib/runtime-mode";
import { date, text, useProjectRecords } from "@/components/client/live-client-views";
import { EmptyMoment } from "@/components/client/kit/empty-moment";
import { InfoHint } from "@/components/ui/info-hint";

/** Mock mode answers locally, so every step can be walked. */
async function postEvent(type: string, input: Record<string, unknown>) {
  if (!dataIsLive) return;
  await sendPostEventCommand(type, input);
}

const MEDIA_ICON: Record<ClientDeliverable["mediaType"], LucideIcon> = {
  photo: Images,
  video: Play,
  files: FolderDown,
  other: Images,
};

/**
 * The couple's photos and film, then their album (M5 of
 * docs/mobile-first-client-crew-plan-2026-09-28.md; the portal half of H4).
 *
 * It was one "gallery" card, two columns until 760 px, with an 11 px Copy
 * button, and a five-column album track with 9 px labels. Now each delivery
 * is its own card (photos, a highlight film, a sneak peek), with the code in
 * a large copy box and one button that says what it opens. The album is a
 * vertical set of steps, and approving a design is a deliberate step in a
 * sheet.
 */
export function ClientDelivery() {
  const workspace = useWorkspace();
  const deliveries = useProjectRecords("deliveryRecords");
  const albums = useProjectRecords("albumWorkflows");
  const [renderedAt] = useState(() => Date.now());
  const deliverables = useMemo(() => clientDeliverables(deliveries.value), [deliveries.value]);
  const album = albums.value[0];
  const studioName =
    workspace.tenantName && !workspace.tenantName.startsWith("Loading") ? workspace.tenantName : "your studio";

  if (!deliverables.length && !album)
    return (
      <Main label="Your photos">
        <div className="kit-stack-tight">
          <p className="kit-eyebrow">After the wedding</p>
          <h1 className="kit-title">Your photos</h1>
        </div>
        <EmptyMoment
          area="delivery"
          error={deliveries.error}
          loading={deliveries.loading}
          loadingText="Opening your deliveries…"
          upcoming="Your photos (and film, if it’s part of your package) will be here the moment they’re ready. You’ll get an email too."
        />
        <PoweredBy />
      </Main>
    );

  return (
    <Main label="Your photos">
      <div className="kit-stack-tight">
        <p className="kit-eyebrow">After the wedding</p>
        <h1 className="kit-title">{deliveriesHeading(deliverables)}</h1>
        {deliverables.length ? (
          <p className="kit-body">Keep your codes private, and save everything before access closes.</p>
        ) : null}
      </div>

      {deliverables.map((deliverable) => (
        <DeliverableCard deliverable={deliverable} key={deliverable.id} now={renderedAt} />
      ))}

      {album ? (
        <AlbumSection album={album} studioColor={workspace.tenantBrand?.primaryColor ?? null} studioName={studioName} />
      ) : null}

      <Link
        className="kit-caption"
        href="/client/messages?context=Gallery%20and%20delivery"
        style={{ display: "inline-flex", gap: 6, alignItems: "center" }}
      >
        <MessageCircle aria-hidden size={15} /> {`Ask ${studioName} about your delivery`}
      </Link>
      <PoweredBy />
    </Main>
  );
}

function DeliverableCard({ deliverable, now }: { deliverable: ClientDeliverable; now: number }) {
  const [copied, setCopied] = useState(false);
  const [downloaded, setDownloaded] = useState(deliverable.downloaded);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const left = daysLeft(deliverable.expiresAt, now);
  const expired = left !== null && left < 0;
  const Icon = MEDIA_ICON[deliverable.mediaType];
  const open =
    deliverable.mediaType === "video"
      ? "Watch your film"
      : deliverable.mediaType === "files"
        ? "Download your files"
        : deliverable.kind === "sneak_peek"
          ? "See your sneak peek"
          : "Open your gallery";

  async function confirmDownloaded() {
    setBusy(true);
    setError(null);
    try {
      await postEvent("markDeliveryDownloaded", {
        projectId: deliverable.projectId,
        deliveryRecordId: deliverable.id,
      });
      setDownloaded(true);
    } catch (caught: unknown) {
      setError(friendlyError(caught, "That couldn’t be saved. Try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card as="article">
      <div aria-hidden className="kit-cover">
        <Icon size={30} />
        {deliverable.hostName ? <span className="kit-cover-host">{deliverable.hostName}</span> : null}
      </div>
      <div className="kit-stack-tight">
        <p className="kit-eyebrow">
          {deliverable.deliveredAt ? `Delivered ${date(deliverable.deliveredAt)}` : "Delivered"}
        </p>
        <h2 className="kit-section">{deliverable.title}</h2>
      </div>

      {deliverable.code ? (
        <div className="kit-code">
          <span className="kit-code-value">
            <span className="kit-caption">
              {deliverable.codeLabel}
              <InfoHint label={deliverable.codeLabel}>
                The gallery asks for this when you open it. Tap Copy, then paste it there. Keep it private.
              </InfoHint>
            </span>
            <strong>{deliverable.code}</strong>
          </span>
          <Button
            aria-label={`Copy ${deliverable.codeLabel.toLowerCase()}`}
            icon={copied ? Check : Copy}
            onClick={() => {
              void navigator.clipboard?.writeText(deliverable.code ?? "");
              setCopied(true);
            }}
            size="compact"
            variant="secondary"
          >
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      ) : null}

      {left !== null && left <= 14 ? (
        <Note icon={Clock3} tone="danger">
          {expired
            ? "Access has closed. Ask your studio to open it again."
            : `${left === 1 ? "1 day" : `${left} days`} left. Download and back everything up before ${date(deliverable.expiresAt)}.`}
        </Note>
      ) : deliverable.expiresAt ? (
        <p className="kit-caption">Available until {date(deliverable.expiresAt)}.</p>
      ) : null}

      {deliverable.href && !expired ? (
        <a className="kit-button" href={deliverable.href} rel="noreferrer" target="_blank">
          {open} <ExternalLink aria-hidden size={18} />
        </a>
      ) : (
        <Button href="/client/messages?context=Gallery%20access" variant="secondary">
          Ask for access
        </Button>
      )}

      {deliverable.mediaType !== "video" && deliverable.kind !== "sneak_peek" ? (
        downloaded ? (
          <Pill icon={CheckCircle2} tone="accent">
            You’ve saved these
          </Pill>
        ) : (
          <Button disabled={busy} onClick={() => void confirmDownloaded()} variant="soft">
            {busy ? "Saving…" : "I’ve downloaded everything"}
          </Button>
        )
      ) : null}
      {error ? (
        <p className="kit-error" role="alert">
          {error}
        </p>
      ) : null}
    </Card>
  );
}

const ALBUM_STEPS = [
  { title: "Choose your photos", statuses: ["instructions_available", "instructions_viewed", "selections_pending"] },
  { title: "Selections sent", statuses: ["selections_received"] },
  { title: "Review the design", statuses: ["design_sent", "revision_requested"] },
  { title: "Design approved", statuses: ["approved"] },
  { title: "Album made", statuses: ["fulfilled"] },
] as const;

function AlbumSection({
  album,
  studioName,
  studioColor,
}: {
  album: Record<string, unknown> & { id: string };
  studioName: string;
  studioColor: string | null;
}) {
  const [status, setStatus] = useState(text(album.status, "instructions_available"));
  const [sheet, setSheet] = useState<"approve" | "changes" | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const at = Math.max(
    0,
    ALBUM_STEPS.findIndex((step) => (step.statuses as readonly string[]).includes(status)),
  );
  const link = (value: unknown) => (typeof value === "string" && value ? value : null);
  const instructionsUrl = link(album.instructionsUrl);
  const proofUrl = link(album.designProofUrl);

  async function move(next: string, notes: string) {
    setBusy(true);
    setError(null);
    try {
      await postEvent("updateAlbumStatus", {
        projectId: album.projectId,
        albumWorkflowId: album.id,
        status: next,
        evidenceUrl: null,
        evidenceId: null,
        notes,
      });
      setStatus(next);
      setSheet(null);
      setNote("");
    } catch (caught: unknown) {
      setError(friendlyError(caught, "That couldn’t be saved. Try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Your album" className="kit-stack-tight">
      <h2 className="kit-subsection">
        Your album
        <InfoHint label="Your album">
          Choose photos from your gallery, tell your studio here when you’ve sent them, then approve the design. Once
          approved, it’s made exactly as shown.
        </InfoHint>
      </h2>
      <Card>
        <ol className="kit-journey">
          {ALBUM_STEPS.map((step, index) => {
            const state = index < at || status === "fulfilled" ? "complete" : index === at ? "current" : "upcoming";
            return (
              <li data-state={state} key={step.title}>
                <span className="kit-journey-dot">
                  {state === "complete" ? <Check aria-hidden size={14} /> : null}
                </span>
                <span className="kit-row-text">
                  <span className="kit-row-title">{step.title}</span>
                  {state === "current" && status === "revision_requested" ? (
                    <span className="kit-row-subtitle">{`${studioName === "your studio" ? "Your studio" : studioName} is making your changes`}</span>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ol>

        {["instructions_available", "instructions_viewed", "selections_pending"].includes(status) ? (
          <div className="kit-stack-tight">
            <p className="kit-body">Pick the photos you’d like in your album from your gallery.</p>
            {instructionsUrl ? (
              <a
                className="kit-button"
                data-variant="secondary"
                href={instructionsUrl}
                onClick={() => {
                  if (status === "instructions_available")
                    void move("instructions_viewed", "Client opened the selection instructions in the portal.");
                }}
                rel="noreferrer"
                target="_blank"
              >
                How to choose <ExternalLink aria-hidden size={18} />
              </a>
            ) : null}
            <Button
              disabled={busy}
              onClick={() => void move("selections_received", "Client confirmed album selections were submitted.")}
            >
              {busy ? "Saving…" : "I’ve sent my selections"}
            </Button>
          </div>
        ) : status === "design_sent" ? (
          <div className="kit-stack-tight">
            <p className="kit-body">Your album design is ready for you to look through.</p>
            {proofUrl ? (
              <a className="kit-button" data-variant="secondary" href={proofUrl} rel="noreferrer" target="_blank">
                Open the design <ExternalLink aria-hidden size={18} />
              </a>
            ) : null}
            <Button icon={CheckCircle2} onClick={() => setSheet("approve")}>
              Approve design
            </Button>
            <Button icon={PencilLine} onClick={() => setSheet("changes")} variant="soft">
              Ask for changes
            </Button>
          </div>
        ) : status === "fulfilled" ? (
          <Note icon={BookOpenCheck} tone="accent">
            Your album is finished.
          </Note>
        ) : (
          <p className="kit-caption">
            {status === "approved"
              ? "Approved. Your album is being made; nothing more is needed from you."
              : "Nothing to do for now. You’ll hear as soon as there’s a design to look at."}
          </p>
        )}
        {error && !sheet ? (
          <p className="kit-error" role="alert">
            {error}
          </p>
        ) : null}
      </Card>

      <SheetDialog
        label={sheet === "approve" ? "Approve your album design?" : "Ask for changes"}
        onClose={() => (busy ? undefined : setSheet(null))}
        open={sheet !== null}
      >
        <KitRoot className="kit-embed kit-sheet" studio={{ color: studioColor }}>
          {sheet === "approve" ? (
            <div className="kit-stack">
              <p className="kit-body">
                {`${studioName === "your studio" ? "Your studio" : studioName} will send it to be made exactly as it is now. Changes after this may not be possible.`}
              </p>
              {error ? (
                <p className="kit-error" role="alert">
                  {error}
                </p>
              ) : null}
              <Button
                disabled={busy}
                icon={CheckCircle2}
                onClick={() => void move("approved", "Client approved the album design in the portal.")}
              >
                {busy ? "Approving…" : "Approve design"}
              </Button>
              <Button disabled={busy} onClick={() => setSheet(null)} variant="secondary">
                Not yet
              </Button>
            </div>
          ) : sheet === "changes" ? (
            <div className="kit-stack">
              <TextArea
                autoFocus
                hint="Name the page or photo, and what you’d like instead."
                label="What would you like changed?"
                maxLength={2000}
                onChange={(event) => setNote(event.target.value)}
                rows={4}
                value={note}
              />
              {error ? (
                <p className="kit-error" role="alert">
                  {error}
                </p>
              ) : null}
              <Button
                disabled={busy || note.trim().length < 10}
                onClick={() => void move("revision_requested", note.trim())}
              >
                {busy ? "Sending…" : "Send to your studio"}
              </Button>
            </div>
          ) : null}
        </KitRoot>
      </SheetDialog>
    </section>
  );
}
