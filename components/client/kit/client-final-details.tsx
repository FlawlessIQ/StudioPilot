"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { CheckCircle2, ClipboardCheck, UserPlus } from "lucide-react";
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
 *
 * A makeup artist's or hair stylist's client is asked one thing instead:
 * still this many getting ready? One tap confirms it; anyone new goes on
 * their party list first (simpler vendor journeys, Phase 2).
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

  if (details.kind === "headcount")
    return <FinalHeadcount details={details} onChanged={() => setReload((value) => value + 1)} studio={studio} cardRef={card} />;

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
    if (!agreed) return setError("Check the box to confirm these are your final details.");
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

/**
 * "Still 6 getting ready?" — the final headcount for a client priced per
 * person (server/planning/final-details.ts, `kind: "headcount"`).
 *
 * The names come from their party list as it stands, so someone added there
 * a minute ago is counted here. Confirming is one tap: no typed name, no
 * checkbox. The count can go up from here, not down, as their agreement says.
 */
function FinalHeadcount({
  details,
  studio,
  onChanged,
  cardRef,
}: {
  details: FinalDetailsView;
  studio: string;
  onChanged: () => void;
  cardRef: RefObject<HTMLDivElement | null>;
}) {
  const workspace = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const people = details.people ?? [];
  const locked = details.lockedHeadcount ?? 0;
  const word = (count: number) => (count === 1 ? "person" : "people");

  if (details.status === "confirmed") {
    const confirmed = details.confirmedHeadcount ?? people.length;
    return (
      <Card tone="accent">
        <p className="kit-eyebrow" style={{ color: "var(--kit-accent)" }}>
          <CheckCircle2 aria-hidden size={14} /> Final headcount confirmed
        </p>
        <p className="kit-body">
          {`${confirmed} ${word(confirmed)} getting ready${
            details.confirmedAt
              ? `, confirmed on ${new Date(details.confirmedAt).toLocaleDateString("en-US", { month: "long", day: "numeric" })}`
              : ""
          }. Someone new? Add them to your party list and ${studio} will see it.`}
        </p>
      </Card>
    );
  }

  async function confirm() {
    if (!workspace.tenantId || !workspace.projectId || !people.length) return;
    setBusy(true);
    setError(null);
    try {
      // No typed name: the tap is the answer, recorded with their sign-in.
      await confirmFinalDetailsRequest(workspace.tenantId, workspace.projectId, "", details.snapshotHash);
      onChanged();
    } catch (caught) {
      const code = caught instanceof Error ? caught.message : "";
      if (code === "FINAL_DETAILS_CHANGED") {
        setError("Your party list changed since you opened this. Here it is again — please check it once more.");
        onChanged();
      } else setError("That didn't go through. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={cardRef}>
      <Card tone="accent">
        <p className="kit-eyebrow" style={{ color: "var(--kit-accent)" }}>
          <ClipboardCheck aria-hidden size={14} /> Final headcount
        </p>
        <h2 className="kit-section">
          {people.length ? `Still ${people.length} ${word(people.length)} getting ready?` : "Who's getting ready?"}
        </h2>
        <p className="kit-body">
          {people.length
            ? "If that's everyone, one tap confirms it. Anyone new? Add them to your party list first. From here, people can be added but not taken off."
            : "Your party list has nobody on it yet. Add everyone getting ready, then come back to confirm."}
        </p>
        {people.length ? (
          <List>
            {people.map((name, index) => (
              <Row key={`${index}-${name}`} title={name} />
            ))}
          </List>
        ) : null}
        {locked > people.length ? (
          <p className="kit-caption">{`Your booking stays at ${locked}, the number when your details locked, as your agreement says.`}</p>
        ) : null}
        {error ? (
          <p className="kit-error" role="alert">
            {error}
          </p>
        ) : null}
        <ButtonRow>
          {people.length ? (
            <Button disabled={busy} icon={CheckCircle2} onClick={() => void confirm()}>
              {busy ? "Confirming…" : `Yes, still ${people.length}`}
            </Button>
          ) : null}
          <Button href="/client/questionnaire" icon={UserPlus} variant={people.length ? "secondary" : "primary"}>
            {people.length ? "Someone's been added" : "Open your party list"}
          </Button>
        </ButtonRow>
      </Card>
    </div>
  );
}
