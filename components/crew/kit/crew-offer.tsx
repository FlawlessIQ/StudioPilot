"use client";

import { useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CalendarPlus,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  MapPin,
  XCircle,
} from "lucide-react";
import {
  Actions,
  Button,
  ButtonRow,
  Card,
  Choices,
  KitRoot,
  List,
  Main,
  Note,
  PoweredBy,
  Row,
  TextArea,
} from "@/components/kit/kit";
import { SheetDialog } from "@/components/ui/sheet-dialog";
import { useWorkspace } from "@/features/auth/workspace-context";
import { offerLapse, offerLapseNotice } from "@/features/crew/offer-moment";
import { downloadAssignmentCalendar } from "@/lib/crew/calendar-file";
import { crewPublicError } from "@/lib/crew/public-error";
import {
  assignmentLocation,
  assignmentPlace,
  crewCommand,
  CrewLoadState,
  dayLabel,
  jobName,
  list,
  money,
  projectFor,
  text,
  timeLabel,
  useAssignmentParam,
  useCrewData,
  type CrewData,
  type Value,
} from "@/components/crew/kit/crew-data";

const REASONS = [
  { value: "date", label: "I'm not free" },
  { value: "fee", label: "The fee" },
  { value: "role", label: "Not my kind of job" },
  { value: "other", label: "Something else" },
] as const;

/** "2 days left", "5 hours left", "closes soon". */
function timeLeft(iso: string, now: number): string {
  const ms = Date.parse(iso) - now;
  if (Number.isNaN(ms)) return "";
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 48) return `${Math.floor(hours / 24)} days left`;
  if (hours >= 1) return `${hours} ${hours === 1 ? "hour" : "hours"} left`;
  return "closes soon";
}

/**
 * An offer (M6 of docs/mobile-first-client-crew-plan-2026-09-28.md).
 *
 * The facts that decide it (when, where, the fee, how long there is to
 * answer), what the job involves, and a sticky Accept / Decline. Decline asks
 * why in a sheet, so the studio re-staffs knowing whether it was the date or
 * the fee. It used to be three columns of facts and a Decline with no
 * confirmation at all.
 */
export function CrewOffer() {
  const data = useCrewData();
  const named = useAssignmentParam(data);
  const [now] = useState(() => Date.now());
  if (data.loading || data.error) return <CrewLoadState data={data} title="Offer" />;
  const offers = data.assignments.filter((item) => ["invited", "viewed"].includes(String(item.status)));
  const offer = named ?? offers[0] ?? null;
  if (!offer)
    return (
      <Main label="Offer">
        <h1 className="kit-title">Offers</h1>
        <Card>
          <p className="kit-body" role="status">
            No offers to answer right now. New ones arrive by email and appear on Today.
          </p>
        </Card>
        <Button href="/crew/jobs" variant="secondary">
          See your jobs
        </Button>
        <PoweredBy />
      </Main>
    );
  return <OfferDetail data={data} key={offer.id} now={now} offer={offer} />;
}

function OfferDetail({ data, offer, now }: { data: CrewData; offer: Value; now: number }) {
  const workspace = useWorkspace();
  const [status, setStatus] = useState(String(offer.status));
  const [sheet, setSheet] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const project = projectFor(data, offer);
  const zone = text(project?.timezone) || undefined;
  const place = assignmentPlace(offer, project);
  const address = text(assignmentLocation(offer)?.address);
  const responsibilities = list(offer.responsibilities).map(String);
  const name = jobName(data, offer);
  const lapse = offerLapse({
    status,
    inviteExpiresAt: text(offer.inviteExpiresAt),
    arrivalAt: text(offer.arrivalAt),
    now: new Date(now),
  });
  const pending = ["invited", "viewed"].includes(status);

  async function respond(decision: "accepted" | "declined") {
    setBusy(decision === "accepted" ? "accept" : "decline");
    setError(null);
    try {
      const label = REASONS.find((item) => item.value === reason)?.label;
      await crewCommand("respondAssignment", {
        projectId: text(offer.projectId),
        assignmentId: offer.id,
        decision,
        reason: decision === "declined" ? [label, note.trim()].filter(Boolean).join(": ") || null : null,
      });
      setStatus(decision);
      setSheet(false);
      window.scrollTo({ top: 0 });
      data.refresh();
    } catch (caught: unknown) {
      setError(crewPublicError(caught, "Your answer couldn't be sent. Try again.", "CREW_ASSIGNMENT_UPDATE_FAILED"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Main label="Offer">
        <div className="kit-stack-tight">
          <p className="kit-eyebrow">{status === "accepted" ? "Booked" : status === "declined" ? "Declined" : "New offer"}</p>
          <h1 className="kit-title">{name}</h1>
          <p className="kit-body">{text(offer.role, "Crew")}</p>
        </div>

        {status === "accepted" ? (
          <Note icon={CheckCircle2} tone="accent">
            You&rsquo;re booked. The job is in your Jobs, and its day sheet appears once the studio shares the run of show.
          </Note>
        ) : status === "declined" ? (
          <Note icon={XCircle}>Declined. The studio has been told, so they can ask someone else.</Note>
        ) : lapse ? (
          <Note icon={AlertTriangle}>
            <strong>{offerLapseNotice(lapse).title}</strong> {offerLapseNotice(lapse).detail}
          </Note>
        ) : null}

        <List label="The job">
          <Row
            icon={Clock3}
            subtitle={`${timeLabel(offer.arrivalAt, zone)} to ${timeLabel(offer.departureAt, zone) || "wrap"}`}
            title={dayLabel(offer.arrivalAt, zone)}
          />
          <Row icon={MapPin} subtitle={address || undefined} title={place} />
          <Row
            icon={CircleDollarSign}
            subtitle={text(offer.compensationType) ? `${text(offer.compensationType)} rate` : undefined}
            title={offer.compensationVisibleToCrew ? money(offer.compensationCents, offer.currency) : "Fee: ask the studio"}
          />
          {pending && !lapse && text(offer.inviteExpiresAt) ? (
            <Row
              icon={AlertTriangle}
              subtitle={timeLeft(text(offer.inviteExpiresAt), now)}
              title={`Answer by ${dayLabel(offer.inviteExpiresAt)}, ${timeLabel(offer.inviteExpiresAt)}`}
            />
          ) : null}
        </List>

        <section aria-label="What you'd do" className="kit-stack-tight">
          <h2 className="kit-subsection">What you&rsquo;d do</h2>
          {responsibilities.length ? (
            <ul className="kit-inclusions">
              {responsibilities.map((item) => (
                <li key={item}>
                  <CheckCircle2 aria-hidden size={16} /> {item}
                </li>
              ))}
            </ul>
          ) : (
            <Note icon={AlertTriangle}>The studio hasn&rsquo;t listed what the job involves. Ask them before you accept.</Note>
          )}
        </section>

        {status === "accepted" ? (
          <>
            <Button href={`/crew/prep?assignment=${encodeURIComponent(offer.id)}`}>
              Open the job <ArrowRight aria-hidden size={18} />
            </Button>
            {text(offer.arrivalAt) && text(offer.departureAt) ? (
              <Button
                icon={CalendarPlus}
                onClick={() => {
                  downloadAssignmentCalendar({
                    assignmentId: offer.id,
                    startsAt: text(offer.arrivalAt),
                    endsAt: text(offer.departureAt),
                    projectName: name,
                    role: text(offer.role, "Crew"),
                    sequence: typeof offer.calendarSequence === "number" ? offer.calendarSequence : 0,
                    location: place,
                  });
                  void crewCommand("acknowledgeCalendar", { projectId: text(offer.projectId), assignmentId: offer.id }).catch(
                    () => undefined,
                  );
                }}
                variant="secondary"
              >
                Add to my calendar
              </Button>
            ) : null}
          </>
        ) : null}
        {error && !sheet ? (
          <p className="kit-error" role="alert">
            {error}
          </p>
        ) : null}
        <PoweredBy />
      </Main>

      {pending && !lapse ? (
        <Actions>
          <ButtonRow>
            <Button disabled={busy !== null} onClick={() => setSheet(true)} size="compact" variant="secondary">
              Decline
            </Button>
            <Button disabled={busy !== null} icon={CheckCircle2} onClick={() => void respond("accepted")}>
              {busy === "accept" ? "Accepting…" : "Accept"}
            </Button>
          </ButtonRow>
        </Actions>
      ) : null}

      <SheetDialog label="Decline this offer?" onClose={() => (busy ? undefined : setSheet(false))} open={sheet}>
        <KitRoot className="kit-embed kit-sheet" studio={{ color: workspace.tenantBrand?.primaryColor ?? null }}>
          <div className="kit-stack">
            <Choices
              legend="What's the reason? (optional)"
              onChange={(next) => setReason(next as string)}
              options={REASONS}
              value={reason as (typeof REASONS)[number]["value"] | null}
            />
            <TextArea
              label="Anything to add? (optional)"
              maxLength={400}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              value={note}
            />
            {error ? (
              <p className="kit-error" role="alert">
                {error}
              </p>
            ) : null}
            <Button disabled={busy !== null} onClick={() => void respond("declined")} variant="danger">
              {busy === "decline" ? "Declining…" : "Decline offer"}
            </Button>
            <Button disabled={busy !== null} onClick={() => setSheet(false)} variant="secondary">
              Keep it open
            </Button>
          </div>
        </KitRoot>
      </SheetDialog>
    </>
  );
}
