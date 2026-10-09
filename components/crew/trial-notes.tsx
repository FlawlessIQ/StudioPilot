"use client";

import { type FormEvent, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { refreshTenantRecords } from "@/components/live/tenant-records";
import { friendlyError } from "@/lib/ai/friendly-error";
import { sendCrewCommand } from "@/lib/crew/command-client";
import { EXTENSION_PLANS, EXTENSION_PLAN_LABELS, extensionPlanOf, extensionsToOrder, type ExtensionPlan } from "@/features/trades/extensions";

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
  extensions = false,
}: {
  projectId: string;
  /** "Makeup trial" or "Hair trial" (trades.ts). */
  trialWord: string;
  notes: { look?: unknown; products?: unknown; extensions?: unknown; colorMatch?: unknown } | null | undefined;
  /**
   * A hair stylist's trial also settles extensions: the plan and the color
   * match. Buying or renting them makes an order task, due eight weeks out
   * (features/trades/extensions.ts).
   */
  extensions?: boolean;
}) {
  const [look, setLook] = useState(typeof notes?.look === "string" ? notes.look : "");
  const [products, setProducts] = useState(typeof notes?.products === "string" ? notes.products : "");
  const [plan, setPlan] = useState<ExtensionPlan | "">(extensionPlanOf(notes?.extensions) ?? "");
  const [colorMatch, setColorMatch] = useState(typeof notes?.colorMatch === "string" ? notes.colorMatch : "");
  // A hair trial's examples are a style and its tools, not a face.
  const hair = /^hair/i.test(trialWord);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await sendCrewCommand("setTrialNotes", {
        projectId,
        look,
        products,
        ...(extensions ? { extensions: plan || null, colorMatch } : {}),
      });
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
          placeholder={hair ? "Low textured bun, face-framing pieces, veil under the bun" : "Soft glam, warm brown smoky eye, nude lip"}
          rows={3}
          value={look}
        />
      </label>
      <label>
        Products used
        <textarea
          maxLength={1500}
          onChange={(event) => setProducts(event.target.value)}
          placeholder={hair ? "Texturizing spray, 1¼-inch iron, 20 pins" : "Foundation shade, lashes, setting spray"}
          rows={3}
          value={products}
        />
      </label>
      {extensions ? (
        <>
          <label>
            Extensions
            <select onChange={(event) => setPlan(event.target.value as ExtensionPlan | "")} value={plan}>
              <option value="">Not decided</option>
              {EXTENSION_PLANS.map((value) => (
                <option key={value} value={value}>
                  {EXTENSION_PLAN_LABELS[value]}
                </option>
              ))}
            </select>
          </label>
          {plan && plan !== "none" ? (
            <label>
              Color match
              <input
                maxLength={200}
                onChange={(event) => setColorMatch(event.target.value)}
                placeholder="#6/8 balayage, 18 inches"
                value={colorMatch}
              />
            </label>
          ) : null}
          {extensionsToOrder(plan) ? (
            <small>Saving adds a task to order them eight weeks before the day{plan === "rent" ? ", and one to collect them after" : ""}.</small>
          ) : null}
        </>
      ) : null}
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
