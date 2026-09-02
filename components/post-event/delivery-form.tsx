"use client";

import { type FormEvent, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Images, ScanText, Send, Sparkles } from "lucide-react";
import { useTenantDocuments } from "@/components/live/tenant-records";
import { splitUpcomingAndPast } from "@/features/ordering/attention";
import { useWorkspace } from "@/features/auth/workspace-context";
import { requestMessageDraft } from "@/lib/ai/message-draft-client";
import { sendPostEventCommand } from "@/lib/post-event/command-client";
import { useReturnToJob } from "@/lib/projects/return-to-job";
import { parseGalleryAnnouncement } from "@/features/post-event/gallery-announcement";
import {
  DELIVERY_GATE_STEPS,
  POST_PRODUCTION_META,
} from "@/features/post-production/checklist";
import { addCalendarDays, todayLocalIso } from "@/lib/format/event-date";
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
    const split = splitUpcomingAndPast(projects ?? [], (p) => p.eventDate);
    return [...split.past, ...split.upcoming];
  }, [projects]);
  const { records: tenants } = useTenantDocuments("tenants");
  const { records: packageSnapshots } =
    useTenantDocuments("packageSnapshots");
  const { records: galleryInboxes } = useTenantDocuments("galleryInboxes");
  const { records: deliveryDrafts } = useTenantDocuments("deliveryDrafts");
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
  const [provider, setProvider] = useState("manual");
  const [galleryUrl, setGalleryUrl] = useState("");
  const [accessCode, setAccessCode] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [expirationDate, setExpirationDate] = useState("");
  const [reviewDestinationLabel, setReviewDestinationLabel] =
    useState("google");
  const [reviewDestinationUrl, setReviewDestinationUrl] = useState("");
  const [albumIncluded, setAlbumIncluded] = useState(false);
  const [albumInstructionsUrl, setAlbumInstructionsUrl] = useState("");
  const [studioDefaultsHydrated, setStudioDefaultsHydrated] = useState(false);
  const [projectDefaultsHydrated, setProjectDefaultsHydrated] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);
  const [draftHydrated, setDraftHydrated] = useState("");
  const tenant =
    tenants?.find((candidate) => candidate.id === workspace.tenantId) ??
    tenants?.[0];
  const reviewLinks = record(tenant?.reviewLinks);
  const deliveryDefaults = record(tenant?.deliveryDefaults);
  const galleryInbox = galleryInboxes?.find(
    (item) => item.projectId === selectedProjectId,
  );

  /**
   * The form is inert until the client has hydrated, so a submit cannot happen
   * against handlers that are not attached yet.
   *
   * This used to wait for a `requestAnimationFrame`. Chrome does not run
   * animation frames in a background tab, so a delivery page opened in one —
   * cmd-clicked from Today, or restored with a session — showed a permanently
   * disabled "Record and release delivery" with nothing saying why, until the
   * tab was focused. The same rAF pattern was removed from the event-day
   * copilot for the same reason; this was the other one.
   *
   * An effect with no dependencies runs on mount whether or not the tab is
   * visible, which is exactly the signal wanted here.
   */
  useEffect(() => {
    if (!tenant || studioDefaultsHydrated) return;
    const preferredReview = [
      ["google", reviewLinks.google],
      ["weddingwire", reviewLinks.weddingwire],
      ["the_knot", reviewLinks.theKnot],
      ["facebook", reviewLinks.facebook],
      ["custom", reviewLinks.custom],
    ].find(([, value]) => text(value));
    const expirationDays = Number(deliveryDefaults.galleryExpirationDays ?? 90);
    const frame = requestAnimationFrame(() => {
      if (preferredReview) {
        setReviewDestinationLabel(String(preferredReview[0]));
        setReviewDestinationUrl(text(preferredReview[1]));
      }
      setProvider(text(deliveryDefaults.galleryProvider) || "manual");
      setExpirationDate(
        dateFromToday(
          Number.isFinite(expirationDays) && expirationDays >= 0
            ? expirationDays
            : 90,
        ),
      );
      setAlbumInstructionsUrl(
        text(deliveryDefaults.albumInstructionsUrl),
      );
      setStudioDefaultsHydrated(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [
    deliveryDefaults,
    reviewLinks,
    studioDefaultsHydrated,
    tenant,
  ]);

  useEffect(() => {
    if (!selectedProjectId || !deliveryDrafts || draftHydrated === selectedProjectId)
      return;
    const draft = [...deliveryDrafts]
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
    const frame = requestAnimationFrame(() => {
      if (draft) {
        setActiveDraftId(draft.id);
        setProvider(text(draft.provider) || "manual");
        setGalleryUrl(text(draft.galleryUrl));
        setAccessCode(text(draft.accessCode));
        if (text(draft.expirationDate)) setExpirationDate(text(draft.expirationDate));
        setNotice("StudioCue received the gallery provider notice and prepared these release details for approval.");
      } else {
        setActiveDraftId(null);
      }
      setDraftHydrated(selectedProjectId);
    });
    return () => cancelAnimationFrame(frame);
  }, [deliveryDrafts, draftHydrated, selectedProjectId]);

  useEffect(() => {
    if (
      !selectedProjectId ||
      !projects ||
      !packageSnapshots ||
      projectDefaultsHydrated === selectedProjectId
    ) {
      return;
    }
    const project = projects.find(
      (candidate) => candidate.id === selectedProjectId,
    );
    const snapshot = packageSnapshots.find(
      (candidate) =>
        candidate.id === project?.packageSnapshotId ||
        candidate.projectId === selectedProjectId,
    );
    const deliverables = Array.isArray(snapshot?.includedDeliverables)
      ? snapshot.includedDeliverables.map(String)
      : [];
    const frame = requestAnimationFrame(() => {
      setAlbumIncluded(
        deliverables.some((deliverable) => /album/i.test(deliverable)),
      );
      setProjectDefaultsHydrated(selectedProjectId);
    });
    return () => cancelAnimationFrame(frame);
  }, [
    packageSnapshots,
    projectDefaultsHydrated,
    projects,
    selectedProjectId,
  ]);

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
    <form className="delivery-form delivery-release-form" onSubmit={(event) => void submit(event)}>
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
        <small>Delivery stays attached to one project and its verified completion gate.</small>
      </label>
      {selectedProjectId ? (
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
      {activeDraftId ? (
        <p className="form-notice form-span">
          Provider notice captured automatically · Review and release once below.
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
      <details className="delivery-advanced-options form-span">
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
      ) : (
        <section className="delivery-project-empty form-span">
          <Images size={20} />
          <span><strong>Choose the project to deliver</strong><small>StudioCue will load its gallery draft, client follow-ups, and approved studio defaults.</small></span>
        </section>
      )}
    </form>
  );
}
