"use client";

import { type FormEvent, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Images, ScanText, Send, Sparkles } from "lucide-react";
import {
  refreshTenantRecords,
  useTenantDocuments,
} from "@/components/live/tenant-records";
import { splitUpcomingAndPast } from "@/features/ordering/attention";
import { liveProjects } from "@/features/projects/put-away";
import { useWorkspace } from "@/features/auth/workspace-context";
import { requestMessageDraft } from "@/lib/ai/message-draft-client";
import { sendPostEventCommand } from "@/lib/post-event/command-client";
import { useReturnToJob } from "@/lib/projects/return-to-job";
import { parseGalleryAnnouncement } from "@/features/post-event/gallery-announcement";
import {
  DELIVERY_GATE_STEPS,
  POST_PRODUCTION_META,
} from "@/features/post-production/checklist";
import { addCalendarDays, formatEventDate, todayLocalIso } from "@/lib/format/event-date";
import { statusLabel } from "@/features/format/status-label";
import { friendlyError } from "@/lib/ai/friendly-error";

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown) =>
  typeof value === "string" ? value : "";
/**
 * Internally consistent before — `setUTCDate` then `toISOString` — and still
 * UTC's today rather than the studio's, so a delivery recorded on a Friday
 * evening in Providence dated itself Saturday.
 */
const dateFromToday = (days: number) =>
  addCalendarDays(todayLocalIso(), days);
const reviewKey = (label: string) =>
  label === "the_knot" ? "theKnot" : label;

export function DeliveryForm({ projectId }: { projectId?: string }) {
  const workspace = useWorkspace();
  const returnToJob = useReturnToJob(projectId ?? null);
  const { records: projects, loading } = useTenantDocuments("projects");
  // Past events first (most recent first), then anything still ahead.
  const deliverableFirst = useMemo(() => {
    // Archived jobs are not deliverable. This dropdown chooses whose
    // photographs go out, and it was offering five put-away weddings.
    const split = splitUpcomingAndPast(liveProjects(projects), (p) => p.eventDate);
    return [...split.past, ...split.upcoming];
  }, [projects]);
  const { records: tenants } = useTenantDocuments("tenants");
  const { records: packageSnapshots } =
    useTenantDocuments("packageSnapshots");
  const { records: galleryInboxes } = useTenantDocuments("galleryInboxes");
  const { records: deliveryDrafts } = useTenantDocuments("deliveryDrafts");
  const { records: deliveryRecords } = useTenantDocuments("deliveryRecords");
  const { records: productionRecords } = useTenantDocuments(
    "postProductionRecords",
  );
  /**
   * Whether the client has hydrated, so a submit cannot fire against handlers
   * that are not attached yet.
   *
   * This used to be state set inside a `requestAnimationFrame`. Chrome does not
   * run animation frames in a background tab, so a delivery page opened in one
   * — cmd-clicked from Today, or restored with a session — showed a permanently
   * disabled "Record and release delivery" with nothing saying why, until the
   * tab was focused. The same rAF pattern was removed from the event-day
   * copilot for the same reason; this was the other one.
   *
   * `useSyncExternalStore` is the hydration flag without the race: false in the
   * server snapshot, true on the client, no effect and no frame to miss. The
   * subscribe function is a no-op because the answer never changes again.
   */
  const interactive = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const [selectedProjectId, setSelectedProjectId] = useState(projectId ?? "");
  /**
   * What the delivery gate will say, before the form is filled in.
   *
   * The gate is enforced server-side and was only ever announced *after*
   * submitting: ten fields, a click, then "backup, editing and gallery-ready
   * all have to be ticked". `deliveryGateCleared` already existed and was
   * already used by the checklist on this very page — the form simply never
   * asked it.
   */
  /**
   * No post-production record at all is not a cleared gate.
   *
   * `!production` returned an empty list, which reads exactly like "every step
   * is ticked" — so on a job whose event is months away the form was fully
   * enabled, invited a gallery URL, a review URL and a delivery date, and the
   * server refused it. The record is opened by a trigger when the job reaches
   * post-production, so before the event there is nothing to tick and nothing
   * to say so.
   */
  const productionRecord = (productionRecords ?? []).find(
    (item) => item.projectId === selectedProjectId,
  );
  const postProductionOpen = Boolean(selectedProjectId && productionRecord);
  const outstandingGateSteps = (() => {
    if (!productionRecord) return [];
    const steps = (productionRecord.steps ?? {}) as Record<
      string,
      { complete?: boolean } | undefined
    >;
    return DELIVERY_GATE_STEPS.filter((key) => steps[key]?.complete !== true);
  })();
  const gateBlocked = !postProductionOpen || outstandingGateSteps.length > 0;
  /**
   * Each field is `null` until the studio touches it, and then it is theirs.
   * The rendered value falls back to the records — see the derivation below.
   */
  const [providerEdit, setProvider] = useState<string | null>(null);
  const [galleryUrlEdit, setGalleryUrl] = useState<string | null>(null);
  const [accessCodeEdit, setAccessCode] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [expirationDateEdit, setExpirationDate] = useState<string | null>(null);
  const [reviewDestinationLabelEdit, setReviewDestinationLabel] = useState<
    string | null
  >(null);
  const [reviewDestinationUrlEdit, setReviewDestinationUrl] = useState<
    string | null
  >(null);
  // The review-URL and other release fields live in a collapsed <details>. A
  // required field inside a closed <details> makes the browser block submit
  // with no visible bubble — "Record and release delivery" looked like a dead
  // button (audit-2 N6). Controlling the section lets us pop it open the moment
  // native validation flags a hidden field, so the studio sees what is missing.
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [albumIncludedEdit, setAlbumIncluded] = useState<boolean | null>(null);
  const [albumInstructionsUrlEdit, setAlbumInstructionsUrl] = useState<
    string | null
  >(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** Set when the studio deliberately opens the form on an already-delivered job. */
  const [rereleasing, setRereleasing] = useState(false);
  const [busy, setBusy] = useState(false);
  const tenant =
    tenants?.find((candidate) => candidate.id === workspace.tenantId) ??
    tenants?.[0];
  const reviewLinks = record(tenant?.reviewLinks);
  const deliveryDefaults = record(tenant?.deliveryDefaults);
  const galleryInbox = galleryInboxes?.find(
    (item) => item.projectId === selectedProjectId,
  );
  const releasedDelivery = (deliveryRecords ?? [])
    .filter((item) => item.projectId === selectedProjectId)
    .sort((left, right) =>
      text(right.sentAt).localeCompare(text(left.sentAt)),
    )[0];

  /**
   * The form is inert until the client has hydrated, so a submit cannot happen
   * against handlers that are not attached yet.
   *
   * This used to wait for a `requestAnimationFrame`. Chrome does not run
   * animation frames in a background tab, so a delivery page opened in one —
   * cmd-clicked from Today, or restored with a session — showed a permanently
   * disabled "Record and release delivery" with nothing saying why, until the
   * tab was focused. The same rAF pattern was removed from the event-day
   * copilot for the same reason.
   *
   * It was NOT removed from the three hydration effects below this one, which
   * is what that sentence used to claim. So in a background tab a studio also
   * lost their saved provider, expiration and review link; lost the prefill
   * from a gallery notice they had forwarded, AND the notice saying it had
   * arrived, so they concluded nothing had and retyped it; and lost the
   * album-included flag read from the accepted package, which meant no album
   * workflow and no selection reminders were created at all. Every one of
   * those failed silently. They are plain effect bodies now.
   *
   * An effect with no dependencies runs on mount whether or not the tab is
   * visible, which is exactly the signal wanted here.
   */
  /**
   * The defaults are derived, not copied into state.
   *
   * Three effects used to push the studio's saved defaults, a forwarded
   * gallery draft and the album flag into state — each wrapped in a
   * `requestAnimationFrame` to dodge the "no setState in an effect" rule. In a
   * background tab Chrome runs no animation frames, so every one of them
   * silently did nothing: no saved provider, expiration or review link; no
   * prefill from a notice the studio had forwarded AND no notice saying it had
   * arrived, so they concluded nothing had and retyped it; and `albumIncluded`
   * stuck at false even for a package that includes an album, which meant no
   * album workflow and no selection reminders were created at all.
   *
   * Reading them during render is the fix for both problems at once: there is
   * no frame to miss and no effect to lint. Each field is what the studio
   * typed, or — until they type — what the records say it should be. Same
   * shape as the agreed retainer date and the crew offer window.
   */
  const preferredReview = [
    ["google", reviewLinks.google],
    ["weddingwire", reviewLinks.weddingwire],
    ["the_knot", reviewLinks.theKnot],
    ["facebook", reviewLinks.facebook],
    ["custom", reviewLinks.custom],
  ].find(([, value]) => text(value));
  const defaultExpirationDays = Number(
    deliveryDefaults.galleryExpirationDays ?? 90,
  );
  const galleryDraft = [...(deliveryDrafts ?? [])]
    .filter(
      (item) =>
        item.projectId === selectedProjectId &&
        item.status === "review_required",
    )
    .sort((left, right) =>
      String(right.receivedAt ?? right.createdAt ?? "").localeCompare(
        String(left.receivedAt ?? left.createdAt ?? ""),
      ),
    )[0];
  const activeDraftId = galleryDraft ? String(galleryDraft.id) : null;
  const albumInPackage = (() => {
    const project = (projects ?? []).find(
      (candidate) => candidate.id === selectedProjectId,
    );
    const snapshot = (packageSnapshots ?? []).find(
      (candidate) =>
        candidate.id === project?.packageSnapshotId ||
        candidate.projectId === selectedProjectId,
    );
    const deliverables = Array.isArray(snapshot?.includedDeliverables)
      ? snapshot.includedDeliverables.map(String)
      : [];
    return deliverables.some((deliverable) => /album/i.test(deliverable));
  })();

  const provider =
    providerEdit ??
    (text(galleryDraft?.provider) ||
      text(deliveryDefaults.galleryProvider) ||
      "manual");
  const galleryUrl = galleryUrlEdit ?? text(galleryDraft?.galleryUrl);
  const accessCode = accessCodeEdit ?? text(galleryDraft?.accessCode);
  const expirationDate =
    expirationDateEdit ??
    (text(galleryDraft?.expirationDate) ||
      dateFromToday(
        Number.isFinite(defaultExpirationDays) && defaultExpirationDays >= 0
          ? defaultExpirationDays
          : 90,
      ));
  const reviewDestinationLabel =
    reviewDestinationLabelEdit ??
    (preferredReview ? String(preferredReview[0]) : "google");
  const reviewDestinationUrl =
    reviewDestinationUrlEdit ??
    (preferredReview ? text(preferredReview[1]) : "");
  const albumIncluded = albumIncludedEdit ?? albumInPackage;
  const albumInstructionsUrl =
    albumInstructionsUrlEdit ?? text(deliveryDefaults.albumInstructionsUrl);

  async function markDownloaded() {
    if (!releasedDelivery) return;
    setBusy(true);
    setNotice(null);
    try {
      await sendPostEventCommand("markDeliveryDownloaded", {
        projectId: selectedProjectId,
        deliveryRecordId: String(releasedDelivery.id),
      });
      refreshTenantRecords("deliveryRecords", "projectCloseouts");
      setNotice("Recorded. The closeout no longer waits on the gallery.");
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "That could not be recorded."));
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setNotice(null);
    try {
      const response = await sendPostEventCommand("recordDelivery", {
        projectId: String(data.get("projectId")),
        provider: String(data.get("provider")),
        galleryUrl: String(data.get("galleryUrl")),
        accessCode: String(data.get("accessCode")) || null,
        expirationDate: String(data.get("expirationDate")) || null,
        deliveryDate: String(data.get("deliveryDate")),
        notes: String(data.get("notes")) || null,
        reviewDestinationLabel: String(data.get("reviewDestinationLabel")),
        reviewDestinationUrl: String(data.get("reviewDestinationUrl")),
        albumIncluded,
        albumInstructionsUrl:
          albumIncluded && String(data.get("albumInstructionsUrl"))
            ? String(data.get("albumInstructionsUrl"))
            : null,
        saveStudioDefaults: data.get("saveStudioDefaults") === "on",
        deliveryDraftId: activeDraftId,
      });
      // Delivery is the step; whichever notice below lands, the job page is
      // where the studio finds out what is next.
      if (response.persisted) returnToJob({ delayMs: 1400 });
      if (response.persisted && workspace.tenantId) {
        // Chain the delivery email draft automatically — it waits in the AI
        // review queue; nothing sends without approval.
        try {
          await requestMessageDraft({
            tenantId: workspace.tenantId,
            trigger: "delivery_note",
            projectId: String(data.get("projectId")),
          });
          setNotice(
            "Gallery delivery recorded. A delivery email draft is waiting in AI review.",
          );
        } catch {
          setNotice(
            "Gallery delivery recorded. The portal artifact and context-aware follow-ups are ready.",
          );
        }
      } else {
        setNotice(
          response.persisted
            ? "Gallery delivery recorded. The portal artifact and context-aware follow-ups are ready."
            : "Development preview: delivery gates passed; no record, email, or project state was changed.",
        );
      }
    } catch (caught: unknown) {
      setNotice(
        friendlyError(caught, "Delivery could not be recorded."),
      );
    }
  }

  function extractAnnouncement() {
    const parsed = parseGalleryAnnouncement(announcement);
    if (!parsed.galleryUrl) {
      setNotice("No secure gallery link was found. Paste the complete provider email or notification.");
      return;
    }
    setProvider(parsed.provider);
    setGalleryUrl(parsed.galleryUrl);
    setAccessCode(parsed.accessCode);
    if (parsed.expirationDate) setExpirationDate(parsed.expirationDate);
    setNotice(
      "Gallery details extracted. Review the link, code, expiration, and client follow-ups before release.",
    );
  }

  return (
    <form
      className="delivery-form delivery-release-form"
      onSubmit={(event) => void submit(event)}
      onInvalidCapture={() => {
        // A hidden required field (review URL, in the collapsed section) just
        // blocked submit. Open the section so the browser's validation lands on
        // a visible field, and say so instead of leaving the button dead.
        setAdvancedOpen(true);
        setNotice(
          "Add the missing release details below before releasing — the review destination URL is required.",
        );
      }}
    >
      <label className="form-span delivery-project-first">
        Project
        <select
          disabled={loading || Boolean(projectId)}
          name={projectId ? undefined : "projectId"}
          onChange={(event) => setSelectedProjectId(event.target.value)}
          required
          value={selectedProjectId}
        >
          <option value="">Select a project</option>
          {/* Ordered by what can actually be delivered. The list was
              alphabetical, so it offered jobs that had not been shot — one still
              at "Talking" — and put the job Today asks you to deliver 8th of 9.
              Events already past come first, most recent first. */}
          {deliverableFirst.map((project) => (
            <option key={project.id} value={project.id}>
              {String(project.name)}
            </option>
          ))}
        </select>
        {projectId ? <input name="projectId" type="hidden" value={projectId} /> : null}
        <small>The gallery is released to this job&rsquo;s couple.</small>
      </label>
      {selectedProjectId ? (
      <>
      {/**
        * A delivery already went out for this job.
        *
        * The page went on presenting a blank "Record gallery" form as its main
        * event for a job that was already delivered — same project, ready to
        * release a second time — while the delivery that existed was a line of
        * text at the very bottom of the page under "Delivery records". Say it
        * here, first, and let the studio open the form deliberately if they
        * really are re-releasing.
        */}
      {releasedDelivery ? (
        <section className="delivery-already-released form-span">
          <div>
            <Images aria-hidden="true" />
            <span>
              <strong>
                This gallery went out{" "}
                {text(releasedDelivery.deliveryDate)
                  ? formatEventDate(text(releasedDelivery.deliveryDate))
                  : "already"}
              </strong>
              <small>
                {text(releasedDelivery.galleryUrl)
                  ? `${text(releasedDelivery.provider) === "manual" ? "Gallery" : statusLabel(text(releasedDelivery.provider))} · ${text(releasedDelivery.galleryUrl)}`
                  : "The couple have their gallery."}
                {text(releasedDelivery.expirationDate)
                  ? ` · downloads until ${formatEventDate(text(releasedDelivery.expirationDate))}`
                  : ""}
              </small>
            </span>
          </div>
          <div className="delivery-already-released-actions">
            {/**
              * The one control that closes the loop.
              *
              * `markDeliveryDownloaded` existed server-side and only the client
              * portal ever called it, so a couple who downloaded their
              * photographs and said so by text left the closeout requirement
              * "Gallery delivered and accessed" open with no way through but a
              * free-text attestation. A studio knows when their couple has the
              * photographs; let them say it here.
              */}
            {text(releasedDelivery.status) === "downloaded" ? (
              <span className="delivery-downloaded-confirmed">
                They have downloaded it
              </span>
            ) : (
              <button
                className="button button-secondary"
                disabled={busy}
                onClick={() => void markDownloaded()}
                type="button"
              >
                They have downloaded it
              </button>
            )}
            <button
              className="button button-quiet"
              onClick={() => setRereleasing((value) => !value)}
              type="button"
            >
              {rereleasing ? "Never mind" : "Release another gallery"}
            </button>
          </div>
        </section>
      ) : null}
      {releasedDelivery && !rereleasing ? null : (
      <>
      {galleryInbox?.inboundAddress ? (
        <section className="delivery-announcement-import form-span">
          <div>
            <Sparkles aria-hidden="true" />
            <span>
              <strong>Automatic gallery capture is ready</strong>
              <small>
                Forward the gallery provider notification to this project address. StudioCue will extract it and return here for approval.
              </small>
            </span>
          </div>
          <code>{text(galleryInbox.inboundAddress)}</code>
        </section>
      ) : null}
      {/* Derived, not set in an effect: this line and the prefill beneath it
          are the whole point of forwarding a provider notice, and both used to
          vanish in a background tab. */}
      {activeDraftId ? (
        <p className="form-notice form-span" role="status">
          StudioCue received the gallery provider notice and prepared these
          release details for approval. Check them and release.
        </p>
      ) : null}
      <section className="delivery-announcement-import form-span">
        <div>
          <Sparkles aria-hidden="true" />
          <span>
            <strong>Paste the gallery-ready message</strong>
            <small>
              StudioCue extracts the provider, secure link, access code, and expiration so you do not retype them.
            </small>
          </span>
        </div>
        <textarea
          aria-label="Gallery announcement"
          onChange={(event) => setAnnouncement(event.target.value)}
          placeholder="Paste the email or notification from Pixieset, Pic-Time, ShootProof, or another gallery provider…"
          value={announcement}
        />
        <button
          className="button button-secondary"
          disabled={!announcement.trim()}
          onClick={extractAnnouncement}
          type="button"
        >
          <ScanText size={16} /> Extract delivery details
        </button>
      </section>
      <label>
        Gallery provider
        <select
          name="provider"
          onChange={(event) => setProvider(event.target.value)}
          value={provider}
        >
          <option value="manual">Manual / other</option>
          <option value="pixieset">Pixieset</option>
          <option value="pic_time">Pic-Time</option>
          <option value="shootproof">ShootProof</option>
        </select>
      </label>
      <label className="form-span">
        Secure gallery URL
        <input
          name="galleryUrl"
          onChange={(event) => setGalleryUrl(event.target.value)}
          type="url"
          required
          value={galleryUrl}
        />
      </label>
      <details
        className="delivery-advanced-options form-span"
        open={advancedOpen}
        onToggle={(event) =>
          setAdvancedOpen((event.currentTarget as HTMLDetailsElement).open)
        }
      >
        <summary>Follow-ups and studio defaults</summary>
        <div className="delivery-advanced-grid">
      <label>
        Access code
        <input
          name="accessCode"
          onChange={(event) => setAccessCode(event.target.value)}
          value={accessCode}
        />
      </label>
      {/* `toISOString()` is UTC: west of Greenwich the delivery date
          defaulted to *tomorrow* after about 8pm Eastern — exactly when a
          photographer sits down to send a gallery. The recorded date was a
          day out, and the 3-day and 10-day follow-ups are computed from it,
          so they slipped with it. `todayLocalIso` exists for this and says
          so in its own comment. */}
      <label>
        Delivery date
        <input
          defaultValue={todayLocalIso()}
          name="deliveryDate"
          type="date"
          required
        />
      </label>
      <label>
        Gallery expiration
        <input
          name="expirationDate"
          onChange={(event) => setExpirationDate(event.target.value)}
          type="date"
          value={expirationDate}
        />
      </label>
      <label>
        Review destination
        <select
          name="reviewDestinationLabel"
          onChange={(event) => {
            const label = event.target.value;
            setReviewDestinationLabel(label);
            setReviewDestinationUrl(text(reviewLinks[reviewKey(label)]));
          }}
          value={reviewDestinationLabel}
        >
          <option value="google">Google</option>
          <option value="weddingwire">WeddingWire</option>
          <option value="the_knot">The Knot</option>
          <option value="facebook">Facebook</option>
          <option value="custom">Other</option>
        </select>
      </label>
      <label className="form-span">
        Review destination URL
        <input
          name="reviewDestinationUrl"
          onChange={(event) => setReviewDestinationUrl(event.target.value)}
          type="url"
          required
          value={reviewDestinationUrl}
        />
        {/* The empty case is the common one on a studio's first delivery, and
            the old copy asserted the field had been filled from settings that
            do not exist yet. Releasing schedules two review asks, so this is
            genuinely required — say why, rather than implying it is already
            done. */}
        <small>
          {reviewDestinationUrl
            ? "Filled from your studio review settings; edit only for this project."
            : "Required: releasing schedules two review asks, and they need somewhere to point. Set a studio default in Settings to stop retyping it."}
        </small>
      </label>
      <label className="delivery-album-toggle">
        <input
          checked={albumIncluded}
          onChange={(event) => setAlbumIncluded(event.target.checked)}
          type="checkbox"
        />
        <Images /> This project includes an album
      </label>
      {albumIncluded ? (
        <label className="form-span">
          Album selection instructions
          <input
            name="albumInstructionsUrl"
            onChange={(event) => setAlbumInstructionsUrl(event.target.value)}
            type="url"
            required
            value={albumInstructionsUrl}
          />
          <small>Filled from your approved studio delivery instructions.</small>
        </label>
      ) : null}
      <label className="form-span">
        Delivery notes
        <textarea name="notes" />
      </label>
      <label className="delivery-album-toggle">
        <input defaultChecked name="saveStudioDefaults" type="checkbox" />
        Remember the provider, review destination, expiration, and album
        instructions for future projects
      </label>
        </div>
      </details>
      {!postProductionOpen ? (
        <p className="delivery-gate-notice form-span" role="status">
          <strong>Not cleared for release yet.</strong> Post-production opens
          after the event. The gallery can be recorded once the cards are backed
          up, the edit is finished and the gallery is ready.
        </p>
      ) : outstandingGateSteps.length ? (
        <p className="delivery-gate-notice form-span" role="status">
          <strong>Not cleared for release yet.</strong> Tick{" "}
          {outstandingGateSteps
            .map((key) => POST_PRODUCTION_META[key].label)
            .join(", ")}{" "}
          on the post-production checklist above — StudioCue will refuse the
          release until then.
        </p>
      ) : null}
      <button
        className="button button-dark"
        disabled={!interactive || gateBlocked}
        type="submit"
      >
        <Send size={16} /> Record and release delivery
      </button>
      <p className="form-notice form-span">
        Releasing creates the client portal delivery, schedules two review asks,
        starts album-selection reminders when included, and records the project evidence.
        Nothing claims a review was posted without confirmation.
      </p>
      {notice ? <p className="form-notice" role="status">{notice}</p> : null}
      </>
      )}
      </>
      ) : (
        <section className="delivery-project-empty form-span">
          <Images size={20} />
          <span><strong>Choose the project to deliver</strong><small>StudioCue will load its gallery draft, client follow-ups, and approved studio defaults.</small></span>
        </section>
      )}
    </form>
  );
}
