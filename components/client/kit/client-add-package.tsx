"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Clock3, PlusCircle } from "lucide-react";
import { Button, ButtonRow, Card, List, Pill, Row, TextArea } from "@/components/kit/kit";
import { useWorkspace } from "@/features/auth/workspace-context";
import { friendlyError } from "@/lib/ai/friendly-error";
import {
  getClientPackageAdditions,
  requestClientPackage,
  type ClientPackageAdditions,
} from "@/lib/client/portal-client";
import { dataIsLive } from "@/lib/runtime-mode";
import { money, text } from "@/components/client/live-client-views";

/**
 * "Add to your booking" — the couple asks for another package.
 *
 * A couple who wanted video on top of their photography had to write to the
 * studio and hope; the portal refused a second package outright. This is a
 * request, not a change: the studio approves it on Today and the couple gets
 * a revised proposal to accept, so the studio still decides what it can cover
 * and nothing about the deal moves until they accept. Shown only while the
 * booking can still change — before the agreement or an invoice goes out.
 */
export function ClientAddPackage({ allowNew = true }: { allowNew?: boolean } = {}) {
  const workspace = useWorkspace();
  const [additions, setAdditions] = useState<ClientPackageAdditions | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
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
  if (!additions.canRequest && !pending.length && !recent.length) return null;

  async function send() {
    if (!asking || !workspace.tenantId || !workspace.projectId) return;
    setBusy(true);
    setNotice(null);
    try {
      await requestClientPackage(workspace.tenantId, workspace.projectId, asking, note.trim() || null);
      setAsking(null);
      setNote("");
      setNotice("Sent to your studio. They'll send you an updated proposal to accept.");
      setReload((value) => value + 1);
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "Your request couldn't be sent. Please message your studio instead."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="kit-stack-tight" aria-label="Add to your booking">
      <h2 className="kit-subsection">Add to your booking</h2>
      {notice ? (
        <p className="kit-note" role="status">
          {notice}
        </p>
      ) : null}
      {pending.map((request) => (
        <Card key={request.id}>
          <Pill icon={Clock3}>Requested</Pill>
          <p className="kit-body">
            You asked to add <strong>{request.packageName}</strong>. Your studio is reviewing it and will send you an
            updated proposal to accept.
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
              {`Your studio couldn't add ${request.packageName} this time — they'll be in touch.`}
            </p>
          </Card>
        ) : null,
      )}
      {choosing ? (
        <Card>
          <p className="kit-body">
            Ask your studio to add <strong>{text(choosing.name, "this package")}</strong> (
            {money(choosing.basePriceCents, choosing.currency)})? They&apos;ll send you an updated proposal with the new
            total. Nothing changes until you accept it.
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
      ) : allowNew && additions.canRequest && additions.options.length ? (
        <List label="Packages you can add">
          {additions.options
            .filter((option) => !pending.some((request) => request.packageId === option.id))
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
