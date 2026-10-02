"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, CalendarDays, Clock3, PlusCircle } from "lucide-react";
import { Button, ButtonRow, Card, Field, List, Pill, Row, TextArea } from "@/components/kit/kit";
import { useWorkspace } from "@/features/auth/workspace-context";
import { friendlyError } from "@/lib/ai/friendly-error";
import {
  getClientPackageAdditions,
  requestClientDateChange,
  requestClientPackage,
  type ClientPackageAdditions,
} from "@/lib/client/portal-client";
import { dataIsLive } from "@/lib/runtime-mode";
import { money, text, useClientVocab } from "@/components/client/live-client-views";

/**
 * "Add to your booking" — the couple asks for another package.
 *
 * A couple who wanted video on top of their photography had to write to the
 * studio and hope; the portal refused a second package outright. This is a
 * request, not a change: the studio approves it on Today and the couple gets
 * a revised proposal to accept, so the studio still decides what it can cover
 * and nothing about the deal moves until they accept.
 *
 * After they've signed, the same request is still open to them — for a
 * package or a new date — and the studio answers it with a booking change for
 * them to sign (client-booking-change.tsx). On the agreement page
 * (`place="agreement"`) it shows only then.
 */
function longDate(value: string | null | undefined) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })
    : "a new date";
}

export function ClientAddPackage({
  allowNew = true,
  place = "proposal",
}: { allowNew?: boolean; place?: "proposal" | "agreement" } = {}) {
  const workspace = useWorkspace();
  const words = useClientVocab();
  const [additions, setAdditions] = useState<ClientPackageAdditions | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [movingDate, setMovingDate] = useState(false);
  const [newDate, setNewDate] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!dataIsLive || !workspace.tenantId || !workspace.projectId) return;
    let active = true;
    void getClientPackageAdditions(workspace.tenantId, workspace.projectId)
      .then((result) => {
        if (active) setAdditions(result);
      })
      .catch(() => {
        // Optional: a failed read leaves the proposal exactly as it was.
      });
    return () => {
      active = false;
    };
  }, [workspace.tenantId, workspace.projectId, reload]);

  if (!additions) return null;
  const pending = additions.requests.filter((request) => request.status === "pending");
  const recent = additions.requests.filter((request) => request.status !== "pending").slice(0, 1);
  const choosing = asking ? additions.options.find((option) => option.id === asking) : undefined;
  if (place === "agreement" && !additions.signed) return null;
  if (!additions.canRequest && !additions.canRequestDate && !pending.length && !recent.length) return null;
  const signed = Boolean(additions.signed);
  const whatFollows = signed
    ? "They'll send you the change to sign. Your booking stays as it is until you do."
    : "They'll send you an updated proposal to accept.";
  const nameOf = (request: ClientPackageAdditions["requests"][number]) =>
    request.kind === "date_change" ? `moving your date to ${longDate(request.requestedDate)}` : request.packageName;

  async function send() {
    if (!asking || !workspace.tenantId || !workspace.projectId) return;
    setBusy(true);
    setNotice(null);
    try {
      await requestClientPackage(workspace.tenantId, workspace.projectId, asking, note.trim() || null);
      setAsking(null);
      setNote("");
      setNotice(`Sent to your studio. ${whatFollows}`);
      setReload((value) => value + 1);
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "Your request couldn't be sent. Please message your studio instead."));
    } finally {
      setBusy(false);
    }
  }

  async function sendDate() {
    if (!newDate || !workspace.tenantId || !workspace.projectId) return;
    setBusy(true);
    setNotice(null);
    try {
      await requestClientDateChange(workspace.tenantId, workspace.projectId, newDate, note.trim() || null);
      setMovingDate(false);
      setNewDate("");
      setNote("");
      // The "Requested" card below says what happens next.
      setNotice("Sent to your studio.");
      setReload((value) => value + 1);
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "Your request couldn't be sent. Please message your studio instead."));
    } finally {
      setBusy(false);
    }
  }

  const heading = signed ? "Need to change your booking?" : "Add to your booking";
  return (
    <section className="kit-stack-tight" aria-label={heading}>
      <h2 className="kit-subsection">{heading}</h2>
      {notice ? (
        <p className="kit-note" role="status">
          {notice}
        </p>
      ) : null}
      {pending.map((request) => (
        <Card key={request.id}>
          <Pill icon={Clock3}>Requested</Pill>
          <p className="kit-body">
            {request.kind === "date_change" ? "You asked about " : "You asked to add "}
            <strong>{nameOf(request)}</strong>. Your studio is reviewing it. {whatFollows}
          </p>
        </Card>
      ))}
      {recent.map((request) =>
        request.status === "approved" && !allowNew ? (
          <Card key={request.id}>
            <p className="kit-body">
              {`Your studio added ${request.packageName}. Your updated proposal, with the new total, is on its way.`}
            </p>
          </Card>
        ) : request.status === "declined" ? (
          <Card key={request.id}>
            <p className="kit-body">
              {request.kind === "date_change"
                ? `Your studio couldn't move your date to ${longDate(request.requestedDate)} — they'll be in touch.`
                : `Your studio couldn't add ${request.packageName} this time — they'll be in touch.`}
            </p>
          </Card>
        ) : null,
      )}
      {choosing ? (
        <Card>
          <p className="kit-body">
            Ask your studio to add <strong>{text(choosing.name, "this package")}</strong> (
            {money(choosing.basePriceCents, choosing.currency)})?{" "}
            {signed
              ? "They'll send you the change, with the new total, to sign. Nothing changes until you do."
              : "They'll send you an updated proposal with the new total. Nothing changes until you accept it."}
          </p>
          <TextArea
            label="Anything they should know? (optional)"
            onChange={(event) => setNote(event.target.value)}
            rows={3}
            value={note}
          />
          <ButtonRow>
            <Button disabled={busy} icon={ArrowLeft} onClick={() => setAsking(null)} size="compact" variant="secondary">
              Go back
            </Button>
            <Button disabled={busy} onClick={() => void send()}>
              {busy ? "Sending…" : "Send request"}
            </Button>
          </ButtonRow>
        </Card>
      ) : movingDate ? (
        <Card>
          <Field
            label="The date you'd like"
            min={new Date().toISOString().slice(0, 10)}
            onChange={(event) => setNewDate(event.target.value)}
            type="date"
            value={newDate}
          />
          <TextArea
            label="Anything they should know? (optional)"
            onChange={(event) => setNote(event.target.value)}
            rows={3}
            value={note}
          />
          <p className="kit-caption">{`Your studio checks they're free first. ${whatFollows}`}</p>
          <ButtonRow>
            <Button disabled={busy} icon={ArrowLeft} onClick={() => setMovingDate(false)} size="compact" variant="secondary">
              Go back
            </Button>
            <Button disabled={busy || !newDate} onClick={() => void sendDate()}>
              {busy ? "Sending…" : "Send request"}
            </Button>
          </ButtonRow>
        </Card>
      ) : allowNew && ((additions.canRequest && additions.options.length) || (signed && additions.canRequestDate)) ? (
        <List label={signed ? "Changes you can ask for" : "Packages you can add"}>
          {signed && additions.canRequestDate && !pending.some((request) => request.kind === "date_change") ? (
            <Row
              icon={CalendarDays}
              onClick={() => setMovingDate(true)}
              subtitle="Ask your studio about a new date"
              title={`Move ${words.yourEvent} date`}
            />
          ) : null}
          {additions.options
            .filter((option) => additions.canRequest && !pending.some((request) => request.packageId === option.id))
            .map((option) => (
              <Row
                icon={PlusCircle}
                key={option.id}
                onClick={() => setAsking(option.id)}
                subtitle={text(option.description, "") || undefined}
                title={text(option.name, "Package")}
                trailing={money(option.basePriceCents, option.currency)}
              />
            ))}
        </List>
      ) : null}
    </section>
  );
}
