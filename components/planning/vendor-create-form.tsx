"use client";

import { FormEvent, useState } from "react";
import { Handshake } from "lucide-react";
import { useTenantDocuments } from "@/components/live/tenant-records";
import { useWorkspace } from "@/features/auth/workspace-context";
import { sendPlanningCommand } from "@/lib/planning/command-client";

export function VendorCreateForm() {
  const workspace = useWorkspace();
  const { records: projects } = useTenantDocuments("projects");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  if (
    !["studio_owner", "studio_admin", "studio_coordinator"].includes(
      workspace.role ?? "",
    )
  )
    return null;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      await sendPlanningCommand("createVendor", {
        projectId: String(form.get("projectId")),
        company: String(form.get("company")),
        contactName: String(form.get("contactName")),
        email: String(form.get("email")) || null,
        type: String(form.get("type")),
      });
      setNotice("Vendor created and associated with the selected project.");
      event.currentTarget.reset();
    } catch (caught: unknown) {
      setNotice(caught instanceof Error ? caught.message : "Vendor creation failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel vendor-create-panel">
      <div className="panel-heading"><div><p className="eyebrow">Project network</p><h2>Add vendor or venue</h2></div><Handshake /></div>
      <form onSubmit={(event) => void submit(event)}>
        <label>Project<select name="projectId" required><option value="">Select project</option>{projects?.map((project) => <option key={project.id} value={project.id}>{String(project.name)}</option>)}</select></label>
        <label>Type<select name="type" defaultValue="venue"><option value="venue">Venue</option><option value="planner">Planner</option><option value="florist">Florist</option><option value="dj">DJ</option><option value="videographer">Videographer</option><option value="insurance_agent">Insurance agent</option><option value="corporate_contact">Corporate contact</option><option value="sports_organizer">Sports organizer</option><option value="other">Other</option></select></label>
        <label>Company<input name="company" required /></label>
        <label>Contact name<input name="contactName" /></label>
        <label>Email<input name="email" type="email" /></label>
        <button className="button button-dark" disabled={busy} type="submit"><Handshake /> {busy ? "Creating…" : "Add vendor"}</button>
      </form>
      {notice ? <p className="form-notice" role="status">{notice}</p> : null}
    </section>
  );
}
