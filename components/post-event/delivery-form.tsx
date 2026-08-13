"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Images, ScanText, Send, Sparkles } from "lucide-react";
import { useTenantDocuments } from "@/components/live/tenant-records";
import { useWorkspace } from "@/features/auth/workspace-context";
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
  const tenant =
    tenants?.find((candidate) => candidate.id === workspace.tenantId) ??
    tenants?.[0];
  const reviewLinks = record(tenant?.reviewLinks);
  const deliveryDefaults = record(tenant?.deliveryDefaults);

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
      });
      setNotice(
        response.persisted
          ? "Gallery delivery recorded. The portal artifact and context-aware follow-ups are ready."
          : "Development preview: delivery gates passed; no record, email, or project state was changed.",
      );
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
      </label>
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
      <button className="button button-dark" disabled={!interactive} type="submit">
        <Send size={16} /> Record and release delivery
      </button>
      <p className="form-notice form-span">
        Releasing creates the client portal delivery, schedules two review asks,
        starts album-selection reminders when included, and records the project evidence.
        Nothing claims a review was posted without confirmation.
      </p>
      {notice ? <p className="form-notice" role="status">{notice}</p> : null}
    </form>
  );
}
