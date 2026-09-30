"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, BadgeCheck, MessageCircle, ShieldCheck, XCircle } from "lucide-react";
import {
  Actions,
  Button,
  ButtonRow,
  Card,
  List,
  Main,
  Note,
  PoweredBy,
  Row,
  Steps,
  TextArea,
} from "@/components/kit/kit";
import { useWorkspace } from "@/features/auth/workspace-context";
import { friendlyError } from "@/lib/ai/friendly-error";
import { decideClientProposal } from "@/lib/client/portal-client";
import { dataIsLive } from "@/lib/runtime-mode";
import {
  date,
  money,
  number,
  proposalErrorMessage,
  text,
  useProjectRecords,
  useReserveYourDate,
} from "@/components/client/live-client-views";
import { EmptyMoment } from "@/components/client/kit/empty-moment";
import { ClientAddPackage } from "@/components/client/kit/client-add-package";
import { InfoHint } from "@/components/ui/info-hint";

/**
 * The proposal, on a phone (M3 of docs/mobile-first-client-crew-plan-2026-09-28.md).
 *
 * The decision used to sit at the very bottom of a long page beside a 300 px
 * aside; it is now the sticky bar, with the total beside it. Everything the
 * old view did is kept: newest version first, expiry, accept then confirm,
 * a change request of at least ten characters, the result states, and the
 * server's refusals in words. Add-ons arrive as lines after the package.
 */
export function ClientProposal() {
  const workspace = useWorkspace();
  const proposals = useProjectRecords("proposals");
  const reserve = useReserveYourDate();
  const proposal = useMemo(
    () => [...proposals.value].sort((a, b) => number(b.version) - number(a.version))[0],
    [proposals.value],
  );
  const [mode, setMode] = useState<"idle" | "accept" | "changes">("idle");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [localStatus, setLocalStatus] = useState<string | null>(null);
  const [renderedAt] = useState(() => Date.now());

  if (proposals.loading || proposals.error || !proposal) {
    return (
      <Main label="Your proposal">
        <div className="kit-stack-tight">
          <p className="kit-eyebrow">Your offer</p>
          <h1 className="kit-title">Your proposal</h1>
        </div>
        <EmptyMoment
          area="proposal"
          error={proposals.error}
          loading={proposals.loading}
          loadingText="Opening your proposal…"
          upcoming="Your studio is still preparing your proposal. You’ll be told as soon as it’s ready."
        />
        <PoweredBy />
      </Main>
    );
  }

  const pricing =
    proposal.pricingSnapshot && typeof proposal.pricingSnapshot === "object"
      ? (proposal.pricingSnapshot as Record<string, unknown>)
      : {};
  const event =
    proposal.eventSnapshot && typeof proposal.eventSnapshot === "object"
      ? (proposal.eventSnapshot as Record<string, unknown>)
      : {};
  const lines = Array.isArray(pricing.lineItems)
    ? (pricing.lineItems as Array<Record<string, unknown>>)
    : [];
  const payments = Array.isArray(proposal.paymentSchedule)
    ? (proposal.paymentSchedule as Array<Record<string, unknown>>)
    : [];
  const currency = pricing.currency;
  const storedStatus = text(proposal.status, "sent");
  const expired =
    !["accepted", "declined", "superseded"].includes(storedStatus) &&
    new Date(String(proposal.expiresAt)).valueOf() <= renderedAt;
  const status = localStatus ?? (expired ? "expired" : storedStatus);
  const actionable = ["sent", "viewed"].includes(status);

  async function submitDecision(decision: "accepted" | "declined") {
    setSubmitting(true);
    setNotice(null);
    try {
      if (!dataIsLive) {
        // Mock mode answers locally, so the flow can be walked and tested.
        setLocalStatus(decision);
      } else {
        if (!workspace.tenantId || !workspace.projectId) return;
        const result = await decideClientProposal(
          workspace.tenantId,
          workspace.projectId,
          proposal.id,
          decision,
          decision === "declined" ? reason.trim() : null,
        );
        setLocalStatus(result.status);
      }
      setMode("idle");
      setNotice(
        decision === "accepted"
          ? "Proposal accepted. Your studio can now prepare the agreement."
          : "Your change request was sent to your studio.",
      );
      window.scrollTo({ top: 0 });
    } catch (caught: unknown) {
      // The proposal's own words first: through friendlyError alone, codes it
      // doesn't know (PROJECT_STATE_CONFLICT, PROPOSAL_EXPIRED…) became "could
      // not be saved" before these could name them (found by the local UAT
      // run, 2026-09-29).
      const code = caught instanceof Error ? caught.message : "";
      const specific = proposalErrorMessage(code);
      setNotice(specific !== code ? specific : friendlyError(caught, "Your decision could not be saved."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Main label="Your proposal">
        {reserve ? (
          <div className="kit-stack-tight">
            <Steps
              step={reserve.steps.filter((step) => step.state === "done").length}
              total={reserve.steps.length}
            />
            <p className="kit-caption">Reserve your date · {reserve.next.title}</p>
          </div>
        ) : null}
        <div className="kit-stack-tight">
          <p className="kit-eyebrow">Proposal · version {number(proposal.version)}</p>
          <h1 className="kit-title">{text(pricing.packageName, "Photography proposal")}</h1>
          <p className="kit-body">
            Prepared for {text(event.name, "your project")} ·{" "}
            {actionable ? `valid until ${date(proposal.expiresAt)}` : status.replaceAll("_", " ")}
          </p>
        </div>

        {notice ? (
          <p className="kit-note" data-tone={localStatus ? "accent" : "danger"} role="status">
            {notice}
          </p>
        ) : null}

        {status === "accepted" ? (
          <Card tone="accent">
            <p className="kit-eyebrow" style={{ color: "var(--kit-accent)" }}>
              <BadgeCheck aria-hidden="true" size={14} /> Accepted
            </p>
            <h2 className="kit-section">Next, sign your agreement</h2>
            <p className="kit-body">
              Your agreement arrives by email with a secure signing link. Once it’s signed, the
              retainer is the last step to reserve your date.
            </p>
            <Button href="/client/contract">See your agreement</Button>
          </Card>
        ) : status === "declined" ? (
          <Card>
            <p className="kit-eyebrow">
              <MessageCircle aria-hidden="true" size={14} /> Changes requested
            </p>
            <h2 className="kit-section">Your studio is reviewing your note</h2>
            <p className="kit-body">This doesn’t cancel your project or reserve a date.</p>
            <Button href="/client/messages" variant="secondary">
              Message your studio
            </Button>
          </Card>
        ) : status === "expired" || status === "superseded" ? (
          <Card>
            <p className="kit-eyebrow">
              <XCircle aria-hidden="true" size={14} /> Proposal unavailable
            </p>
            <h2 className="kit-section">
              {status === "expired" ? "This proposal has expired" : "A newer proposal replaced this one"}
            </h2>
            <p className="kit-body">Ask your studio to share the current offer before deciding.</p>
            <Button href="/client/messages" variant="secondary">
              Message your studio
            </Button>
          </Card>
        ) : null}

        <section className="kit-stack-tight" aria-label="What’s included">
          <h2 className="kit-subsection">What’s included</h2>
          <List>
            {lines.map((line, index) => (
              <Row
                key={`${String(line.description)}-${index}`}
                subtitle={
                  number(line.quantity) > 1
                    ? `${number(line.quantity)} × ${money(line.unitPriceCents, currency)}`
                    : undefined
                }
                title={text(line.description, "Photography services")}
                // Package snapshots store `lineTotalCents`; proposals rename it
                // `totalCents`. Reading one name rendered $0.00 on the other.
                trailing={money(line.lineTotalCents ?? line.totalCents, currency)}
              />
            ))}
          </List>
        </section>

        <Card>
          <dl className="kit-totals">
            <div>
              <dt>Subtotal</dt>
              <dd>{money(pricing.subtotalCents, currency)}</dd>
            </div>
            {number(pricing.discountCents) > 0 ? (
              <div>
                <dt>Discount</dt>
                <dd>−{money(pricing.discountCents, currency)}</dd>
              </div>
            ) : null}
            {number(pricing.taxCents) > 0 ? (
              <div>
                <dt>Tax</dt>
                <dd>{money(pricing.taxCents, currency)}</dd>
              </div>
            ) : null}
            <div data-total="">
              <dt>Total</dt>
              <dd>{money(pricing.totalCents, currency)}</dd>
            </div>
          </dl>
        </Card>

        {payments.length ? (
          <section className="kit-stack-tight" aria-label="Payment plan">
            <h2 className="kit-subsection">
              Payment plan
              <InfoHint label="Payment plan">
                When each part of the total is due. Accepting doesn’t charge anything; each payment comes later as its
                own secure invoice.
              </InfoHint>
            </h2>
            <List>
              {payments.map((payment, index) => (
                <Row
                  key={`${String(payment.label)}-${index}`}
                  subtitle={payment.dueDate ? `Due ${date(payment.dueDate)}` : "Due date on the invoice"}
                  title={text(payment.label, "Payment")}
                  trailing={money(payment.amountCents, currency)}
                />
              ))}
            </List>
            <p className="kit-caption">
              {proposal.combinedContractId
                ? "These prices are Part 2 of your booking agreement. Signing it accepts them — no payment is taken until the retainer."
                : "Accepting doesn’t sign an agreement or take a payment. Those are separate, secure steps."}
            </p>
          </section>
        ) : null}

        {["sent", "viewed", "accepted"].includes(status) ? (
          <ClientAddPackage />
        ) : status === "superseded" ? (
          // Replaced while the studio updates it: say what's coming, offer nothing new.
          <ClientAddPackage allowNew={false} />
        ) : null}

        <Note icon={ShieldCheck}>
          <strong>Before you decide:</strong>{" "}
          {text(proposal.termsSummary, "Your studio will send the full agreement as the next step.")}{" "}
          The signed agreement, not this summary, governs the photography.
        </Note>

        {mode === "changes" ? (
          <TextArea
            autoFocus
            hint="At least ten characters, so your studio knows what to change."
            label="What would you like your studio to change?"
            onChange={(event) => setReason(event.target.value)}
            rows={4}
            value={reason}
          />
        ) : null}
        <PoweredBy />
      </Main>

      {actionable ? (
        <Actions
          note={
            mode === "accept"
              ? "This locks this proposal to your project and asks your studio for the agreement. No charge is made now."
              : undefined
          }
        >
          {mode === "idle" ? (
            <>
              <div className="kit-total-bar">
                <span>
                  <span className="kit-caption">Total</span>
                  <strong>{money(pricing.totalCents, currency)}</strong>
                </span>
                {proposal.combinedContractId ? (
                  // Sent inside the booking agreement (H2): accepting is
                  // signing, on the agreement, never a separate step here.
                  <Button href="/client/contract">Review &amp; sign the agreement</Button>
                ) : (
                  <Button onClick={() => setMode("accept")}>Accept proposal</Button>
                )}
              </div>
              <Button onClick={() => setMode("changes")} variant="secondary">
                Request changes
              </Button>
            </>
          ) : mode === "accept" ? (
            <ButtonRow>
              <Button disabled={submitting} icon={ArrowLeft} onClick={() => setMode("idle")} size="compact" variant="secondary">
                Go back
              </Button>
              <Button disabled={submitting} onClick={() => void submitDecision("accepted")}>
                {submitting ? "Saving…" : "Confirm acceptance"}
              </Button>
            </ButtonRow>
          ) : (
            <ButtonRow>
              <Button disabled={submitting} icon={ArrowLeft} onClick={() => setMode("idle")} size="compact" variant="secondary">
                Go back
              </Button>
              <Button
                disabled={submitting || reason.trim().length < 10}
                onClick={() => void submitDecision("declined")}
              >
                {submitting ? "Sending…" : "Send change request"}
              </Button>
            </ButtonRow>
          )}
        </Actions>
      ) : null}
    </>
  );
}
