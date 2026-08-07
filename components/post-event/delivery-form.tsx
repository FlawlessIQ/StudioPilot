"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Images, ScanText, Send, Sparkles } from "lucide-react";
import { useTenantDocuments } from "@/components/live/tenant-records";
import { useWorkspace } from "@/features/auth/workspace-context";
import { requestMessageDraft } from "@/lib/ai/message-draft-client";
import { sendPostEventCommand } from "@/lib/post-event/command-client";
import { parseGalleryAnnouncement } from "@/features/post-event/gallery-announcement";

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown) =>
  typeof value === "string" ? value : "";
const dateFromToday = (days: number) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
const reviewKey = (label: string) =>
  label === "the_knot" ? "theKnot" : label;

export function DeliveryForm({ projectId }: { projectId?: string }) {
  const workspace = useWorkspace();
  const { records: projects, loading } = useTenantDocuments("projects");
  const { records: tenants } = useTenantDocuments("tenants");
  const { records: packageSnapshots } =
    useTenantDocuments("packageSnapshots");
  const { records: galleryInboxes } = useTenantDocuments("galleryInboxes");
  const { records: deliveryDrafts } = useTenantDocuments("deliveryDrafts");
  const [interactive, setInteractive] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState(projectId ?? "");
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

  useEffect(() => {
    const frame = requestAnimationFrame(() => setInteractive(true));
    return () => cancelAnimationFrame(frame);
  }, []);

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
            "Gallery delivery recorded. A delivery email draft is waiting in your AI review queue.",
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
        caught instanceof Error ? caught.message : "Delivery could not be recorded.",
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
          {projects?.map((project) => (
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
      <label>
        Delivery date
        <input
          defaultValue={new Date().toISOString().slice(0, 10)}
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
        <small>Filled from your studio review settings; edit only for this project.</small>
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
      <button className="button button-dark" disabled={!interactive} type="submit">
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
