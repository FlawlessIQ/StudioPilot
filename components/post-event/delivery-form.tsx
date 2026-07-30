"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Images, Send } from "lucide-react";
import { useTenantDocuments } from "@/components/live/tenant-records";
import { sendPostEventCommand } from "@/lib/post-event/command-client";

export function DeliveryForm({ projectId }: { projectId?: string }) {
  const { records: projects, loading } = useTenantDocuments("projects");
  const [interactive, setInteractive] = useState(false);
  const [albumIncluded, setAlbumIncluded] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setInteractive(true));
    return () => cancelAnimationFrame(frame);
  }, []);

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

  return (
    <form className="delivery-form delivery-release-form" onSubmit={(event) => void submit(event)}>
      <label>
        Project
        <select
          defaultValue={projectId ?? ""}
          disabled={loading || Boolean(projectId)}
          name={projectId ? undefined : "projectId"}
          required
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
        <select defaultValue="manual" name="provider">
          <option value="manual">Manual / other</option>
          <option value="pixieset">Pixieset</option>
          <option value="pic_time">Pic-Time</option>
          <option value="shootproof">ShootProof</option>
        </select>
      </label>
      <label className="form-span">
        Secure gallery URL
        <input name="galleryUrl" type="url" required />
      </label>
      <label>
        Access code
        <input name="accessCode" />
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
        <input name="expirationDate" type="date" />
      </label>
      <label>
        Review destination
        <select defaultValue="google" name="reviewDestinationLabel">
          <option value="google">Google</option>
          <option value="weddingwire">WeddingWire</option>
          <option value="the_knot">The Knot</option>
          <option value="facebook">Facebook</option>
          <option value="custom">Other</option>
        </select>
      </label>
      <label className="form-span">
        Review destination URL
        <input name="reviewDestinationUrl" type="url" required />
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
          <input name="albumInstructionsUrl" type="url" required />
        </label>
      ) : null}
      <label className="form-span">
        Delivery notes
        <textarea name="notes" />
      </label>
      <button className="button button-dark" disabled={!interactive} type="submit">
        <Send size={16} /> Record and release delivery
      </button>
      {notice ? <p className="form-notice" role="status">{notice}</p> : null}
    </form>
  );
}
