"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, ClipboardCheck } from "lucide-react";
import { Button, ButtonRow, Card, List, Row } from "@/components/kit/kit";
import { useWorkspace } from "@/features/auth/workspace-context";
import { dataIsLive } from "@/lib/runtime-mode";
import { confirmFinalDetailsRequest, getFinalDetails } from "@/lib/client/portal-client";
import type { FinalDetailsView } from "@/features/planning/final-details-view";

/**
 * "Confirm your final details" — four weeks before, on the couple's home.
 *
 * Every location and time from their forms, and the timeline the studio
 * published, confirmed by typed name (server/planning/final-details.ts). From
 * then a change to where or when is a request the studio agrees; little
 * things stay theirs. Once confirmed it folds to one line, with any change
 * agreed since.
 */
export function ClientFinalDetails() {
  const workspace = useWorkspace();
  const [details, setDetails] = useState<FinalDetailsView | null>(null);
  const [reload, setReload] = useState(0);
  const [typedName, setTypedName] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const card = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!dataIsLive || !workspace.tenantId || !workspace.projectId) return;
    let live = true;
    void getFinalDetails(workspace.tenantId, workspace.projectId)
      .then((result) => live && setDetails(result.details))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [workspace.tenantId, workspace.projectId, reload]);

  useEffect(() => {
    if (details?.status !== "awaiting_couple" || typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).has("final-details")) card.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [details?.status]);

  if (!details) return null;
  const studio = workspace.tenantName && !workspace.tenantName.startsWith("Loading") ? workspace.tenantName : "Your studio";

  if (details.status === "confirmed")
    return (
      <Card tone="accent">
        <p className="kit-eyebrow" style={{ color: "var(--kit-accent)" }}>
          <CheckCircle2 aria-hidden size={14} /> Final details confirmed
        </p>
        <p className="kit-body">
          {details.confirmedAt
            ? `You confirmed them on ${new Date(details.confirmedAt).toLocaleDateString("en-US", { month: "long", day: "numeric" })}.`
            : "They're confirmed."}{" "}
          {`To change a location or time, ask ${studio} from your planning form.`}
        </p>
        {details.changes.length ? (
          <ul className="kit-body">
            {details.changes.map((change) => (
              <li key={`${change.at}-${change.label}`}>{`${change.label}: now ${change.to} (was ${change.from})`}</li>
            ))}
          </ul>
        ) : null}
      </Card>
    );

  async function confirm() {
    if (!workspace.tenantId || !workspace.projectId || !details) return;
    if (typedName.trim().length < 2) return setError("Type your full name to confirm.");
    if (!agreed) return setError("Tick the box to confirm these are your final details.");
    setBusy(true);
    setError(null);
    try {
      await confirmFinalDetailsRequest(workspace.tenantId, workspace.projectId, typedName, details.snapshotHash);
      setReload((value) => value + 1);
    } catch (caught) {
      const code = caught instanceof Error ? caught.message : "";
      if (code === "FINAL_DETAILS_CHANGED") {
        setError(`${studio} updated something since you opened this. Here it is again — please check it once more.`);
        setReload((value) => value + 1);
      } else setError("That didn't go through. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={card}>
      <Card tone="accent">
        <p className="kit-eyebrow" style={{ color: "var(--kit-accent)" }}>
          <ClipboardCheck aria-hidden size={14} /> Confirm your final details
        </p>
        <h2 className="kit-section">Everything for your day, in one place</h2>
        <p className="kit-body">
          {`Check each location and time. Once you confirm, small things you can still change yourself; a change to where or when goes to ${studio} to agree.`}
        </p>
        <List>
          {details.rows.map((row) => (
            <Row key={`${row.label}-${row.value}`} subtitle={row.value} title={row.label} />
          ))}
        </List>
        {details.timeline.length ? (
          <>
            <h3 className="kit-subsection">The timeline</h3>
            <List>
              {details.timeline.map((item, index) => (
                <Row key={`${index}-${item.title}`} subtitle={item.location ?? undefined} title={`${item.time} · ${item.title}`} />
              ))}
            </List>
          </>
        ) : null}
        <label className="kit-field">
          <span className="kit-field-label">Type your full name to confirm</span>
          <input
            autoComplete="name"
            className="kit-input"
            maxLength={200}
            onChange={(event) => setTypedName(event.target.value)}
            value={typedName}
          />
        </label>
        <label className="kit-check">
          <input checked={agreed} onChange={(event) => setAgreed(event.target.checked)} type="checkbox" />
          <span>{`These are our final details. Changes to locations or times from here are agreed with ${studio}.`}</span>
        </label>
        {error ? (
          <p className="kit-error" role="alert">
            {error}
          </p>
        ) : null}
        <ButtonRow>
          <Button disabled={busy} onClick={() => void confirm()}>
            {busy ? "Confirming…" : "Confirm our final details"}
          </Button>
        </ButtonRow>
      </Card>
    </div>
  );
}
