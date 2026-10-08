"use client";

import { type FormEvent, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { refreshTenantRecords } from "@/components/live/tenant-records";
import { friendlyError } from "@/lib/ai/friendly-error";
import { sendCrewCommand } from "@/lib/crew/command-client";

/**
 * What the makeup or hair trial settled, on the job's trial card
 * (docs/vendor-journeys-plan.md, 3.2): the look and the products used. Saved
 * on the job and put on the crew's brief (functions/src/crew/commands.ts,
 * setTrialNotes), so whoever does the bride on the day repeats the trial.
 */
export function TrialNotes({
  projectId,
  trialWord,
  notes,
}: {
  projectId: string;
  /** "Makeup trial" or "Hair trial" (trades.ts). */
  trialWord: string;
  notes: { look?: unknown; products?: unknown } | null | undefined;
}) {
  const [look, setLook] = useState(typeof notes?.look === "string" ? notes.look : "");
  const [products, setProducts] = useState(typeof notes?.products === "string" ? notes.products : "");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await sendCrewCommand("setTrialNotes", { projectId, look, products });
      refreshTenantRecords("projects");
      setSaved(true);
    } catch (caught: unknown) {
      setError(friendlyError(caught, "The notes couldn't be saved. Try again."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="trial-notes" onSubmit={(event) => void save(event)}>
      <p>{`After the ${trialWord.toLowerCase()}, note what you settled on — it goes on your crew's brief for the day.`}</p>
      <label>
        The look
        <textarea
          maxLength={1500}
          onChange={(event) => setLook(event.target.value)}
          placeholder="Soft glam, warm brown smoky eye, nude lip"
          rows={3}
          value={look}
        />
      </label>
      <label>
        Products used
        <textarea
          maxLength={1500}
          onChange={(event) => setProducts(event.target.value)}
          placeholder="Foundation shade, lashes, setting spray"
          rows={3}
          value={products}
        />
      </label>
      <div>
        <button className="button button-light button-sm" disabled={busy} type="submit">
          {busy ? <LoaderCircle className="spin" size={14} /> : null}
          Save the notes
        </button>
        {saved ? <small>Saved — on your crew&rsquo;s brief.</small> : null}
      </div>
      {error ? <small role="alert">{error}</small> : null}
    </form>
  );
}
