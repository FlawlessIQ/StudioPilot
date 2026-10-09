"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, ExternalLink, LockKeyhole, MessageCircle, RotateCw } from "lucide-react";
import type { BookingStepsView } from "@/features/client/booking-steps";
import { invoicePayNote } from "@/features/client/invoice-pay-route";
import { Actions, Button, Card, List, Main, PoweredBy, Row, Steps } from "@/components/kit/kit";
import { ClientContractSigning } from "@/components/client/contract-signing";
import { resolveFile } from "@/lib/documents/resolve-file";
import { useWorkspace } from "@/features/auth/workspace-context";
import { TRADE_LABELS, tradeOf, tradeProfile, tradeVocab } from "@/features/trades/trades";
import { statusLabel } from "@/features/format/status-label";
import {
  money,
  refreshClientRecords,
  text,
  useBookingNeeds,
  useBookingStepsView,
  useProjectRecords,
} from "@/components/client/live-client-views";
import { EmptyMoment } from "@/components/client/kit/empty-moment";
import { ClientBookingChange } from "@/components/client/kit/client-booking-change";
import { ClientAddPackage } from "@/components/client/kit/client-add-package";
import { InfoHint } from "@/components/ui/info-hint";
import { coupleContract } from "@/features/contracts/couple-view";

/**
 * The couple's agreement, on a phone (M3 of
 * docs/mobile-first-client-crew-plan-2026-09-28.md).
 *
 * Two paths, as before. A StudioCue agreement is read and signed here (the
 * signing itself is components/client/contract-signing.tsx, unchanged in what
 * it sends). A signing vendor's, or one the studio recorded, shows who has
 * signed and hands off to the vendor, re-checking when the couple returns.
 */
export function ClientContract() {
  const workspace = useWorkspace();
  const contracts = useProjectRecords("contracts");
  // The steps as useReserveYourDate reads them, and once booked too: the
  // deposit handed on after signing says so when it's paid.
  const bookingView = useBookingStepsView();
  const reserve = bookingView && !bookingView.booked ? bookingView : null;
  const needs = useBookingNeeds();
  // A vendor's client books in one link (trades.ts): signs, then pays the
  // deposit on this same screen. A photographer's keeps the link to Payments.
  const oneLink = tradeProfile(workspace.tenantTrade).journey.oneLinkBooking && needs.agreement;
  const [providerOpened, setProviderOpened] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const refreshContracts = contracts.refresh;
  // The agreement that stands, not merely the newest write (see coupleContract).
  const contract = useMemo(() => coupleContract(contracts.value), [contracts.value]);
  const contractStatus = text(contract?.status);
  // No deposit invoice follows the signature: the studio takes it directly
  // (app/api/client/portal/route.ts `depositByStudio`).
  const depositByStudio = contract?.depositByStudio === true;

  useEffect(() => {
    if (!providerOpened) return;
    const checkOnReturn = () => {
      if (document.visibilityState !== "visible") return;
      setNotice("Checking the signing provider for your latest status…");
      refreshContracts?.();
    };
    window.addEventListener("focus", checkOnReturn);
    document.addEventListener("visibilitychange", checkOnReturn);
    return () => {
      window.removeEventListener("focus", checkOnReturn);
      document.removeEventListener("visibilitychange", checkOnReturn);
    };
  }, [providerOpened, refreshContracts]);

  const progress = reserve ? (
    <div className="kit-stack-tight">
      <Steps step={reserve.steps.filter((step) => step.state === "done").length} total={reserve.steps.length} />
      <p className="kit-caption">Reserve your date · {reserve.next.title}</p>
    </div>
  ) : null;

  if (contracts.error || !contract)
    return (
      <Main label="Your agreement">
        {progress}
        <ClientBookingChange />
        <div className="kit-stack-tight">
          <p className="kit-eyebrow">Agreement</p>
          <h1 className="kit-title">Your agreement</h1>
        </div>
        <EmptyMoment
          area="contract"
          error={contracts.error}
          loading={contracts.loading}
          loadingText="Opening your agreement…"
          upcoming="Your agreement will appear after the studio sends it for signature."
        />
        <PoweredBy />
      </Main>
    );

  if (contract.provider === "studiocue") {
    const studioName =
      workspace.tenantName && !workspace.tenantName.startsWith("Loading") ? workspace.tenantName : null;
    return (
      <Main label="Your agreement">
        {progress}
        <ClientBookingChange />
        <div className="kit-stack-tight">
          <p className="kit-eyebrow">Agreement</p>
          <h1 className="kit-title">
            Your agreement <InfoHint term="couple-agreement" />
          </h1>
          <p className="kit-body">
            {contractStatus === "completed"
              ? "Signed by you and your studio."
              : contractStatus === "voided"
                ? "This version was withdrawn."
                : contractStatus === "superseded"
                  ? "Your studio has your signed agreement — there's nothing to sign here."
                : contract.mode === "combined"
                  ? tradeProfile(workspace.tenantTrade).family === "photo"
                    ? "Your terms and your coverage and price, in two parts. Read both, then tap Review & sign — you sign each part, and that books it."
                    : oneLink && needs.payment && !depositByStudio
                      ? `Your terms, then what’s included and the price, in two parts. Read both, then tap Review & sign — you sign each part, then ${needs.paidInFull ? "make your payment" : "pay your deposit"} right here, and your date is booked.`
                      : oneLink && needs.payment
                        ? `Your terms, then what’s included and the price, in two parts. Read both, then tap Review & sign — you sign each part, then arrange your ${needs.paidInFull ? "payment" : "deposit"} with ${studioName ?? "your studio"}, and paying it books your date.`
                        : "Your terms, then what’s included and the price, in two parts. Read both, then tap Review & sign — you sign each part, and that books it."
                  : `Read it through, then tap Review & sign. It’s written from the ${tradeVocab(workspace.tenantTrade).proposal.toLowerCase()} you accepted.`}
          </p>
        </div>
        <ClientContractSigning
          afterSigning={
            oneLink ? (
              <PayAfterSigning
                byStudio={depositByStudio}
                paidInFull={needs.paidInFull}
                payment={needs.payment}
                studioName={studioName}
                view={bookingView}
              />
            ) : null
          }
          contract={contract}
          // Booking in one link, every list on the page is read again: the
          // steps above and the deposit below follow the signature too.
          onChanged={() => (oneLink ? refreshClientRecords() : refreshContracts?.())}
          studioColor={workspace.tenantBrand?.primaryColor ?? null}
          studioName={studioName}
        />
        <ClientAddPackage place="agreement" />
        <PoweredBy />
      </Main>
    );
  }

  /**
   * Who actually witnessed this signature. A contract the studio recorded by
   * hand (provider null) is never presented as a signing vendor's word.
   */
  const attested = contract.completionAuthority === "manual_attested";
  const signingProvider =
    contract.provider === "dropbox_sign" ? "Dropbox Sign" : contract.provider === "docusign" ? "Docusign" : null;
  const signers = Array.isArray(contract.signers) ? (contract.signers as Array<Record<string, unknown>>) : [];
  const signingUrl = typeof contract.signingUrl === "string" ? contract.signingUrl : null;
  const complete = ["completed", "signed"].includes(contractStatus);
  const signedCopyPath = typeof contract.signedCopyPath === "string" ? contract.signedCopyPath : null;

  // Opened while the tap still counts as one; after the await it's a popup.
  async function openSignedCopy() {
    if (!signedCopyPath) return;
    const tab = window.open("", "_blank");
    const result = await resolveFile(
      { kind: "storage", path: signedCopyPath, label: "Signed agreement" },
      workspace.tenantId ?? null,
    );
    if (result.status === "ready" && tab) {
      tab.opener = null;
      tab.location.href = result.url;
      return;
    }
    tab?.close();
    setNotice(result.status === "ready" ? "Allow pop-ups to open the signed copy." : result.message);
  }

  return (
    <>
      <Main label="Your agreement">
        {progress}
        <ClientBookingChange />
        <div className="kit-stack-tight">
          <p className="kit-eyebrow">Agreement · {statusLabel(contract.status)}</p>
          <h1 className="kit-title">{TRADE_LABELS[tradeOf(workspace.tenantTrade)]} services agreement</h1>
          <p className="kit-body">
            {attested
              ? "Your studio recorded this signature and holds the signed copy."
              : signingProvider
                ? `Your secure signature status from ${signingProvider}.`
                : "Your signature status for this agreement."}
          </p>
        </div>

        <Card tone={complete ? "accent" : undefined}>
          <h2 className="kit-section">
            {complete
              ? "Every required signature is complete"
              : signingProvider
                ? `${signingProvider} is collecting signatures`
                : "Signatures are still being collected"}
          </h2>
          {signers.length ? (
            <List label="Signers">
              {signers.map((signer) => (
                <Row
                  icon={signer.status === "completed" ? CheckCircle2 : undefined}
                  key={`${String(signer.email)}-${String(signer.order)}`}
                  title={text(signer.name)}
                  trailing={statusLabel(signer.status)}
                />
              ))}
            </List>
          ) : null}
          {!complete && !signingUrl && signingProvider ? (
            <p className="kit-body">{signingProvider} sends each signer their secure signing link directly.</p>
          ) : null}
          {signingUrl && !complete ? (
            <p className="kit-note">
              <LockKeyhole aria-hidden size={18} />
              <span>
                <strong>{`You’re opening ${signingProvider ?? "the signing page"}.`}</strong>
                {" Sign there, then come back: this page updates once you’ve signed."}
              </span>
            </p>
          ) : null}
          {notice ? (
            <p className="kit-caption" role="status">
              {notice}
            </p>
          ) : null}
        </Card>

        <p className="kit-caption">
          {attested
            ? "Your studio recorded this signature, and the record names who confirmed it."
            : signingProvider
              ? `Only ${signingProvider} completion evidence can mark this agreement complete.`
              : "Only verified completion evidence can mark this agreement complete."}
          {complete && !signedCopyPath ? " Your studio holds the signed agreement; ask below if you’d like a copy." : ""}
        </p>
        {/* A contract signed on paper, shared by the studio (on by default):
            it was theirs and they could only ask for it. */}
        {complete && signedCopyPath ? (
          <Button icon={ExternalLink} onClick={() => void openSignedCopy()} variant="secondary">
            Open the signed copy
          </Button>
        ) : null}
        <Link
          className="kit-caption"
          href="/client/messages?context=Contract%20signing"
          style={{ display: "inline-flex", gap: 6, alignItems: "center" }}
        >
          <MessageCircle aria-hidden size={15} /> Ask your studio about this agreement
        </Link>
        <ClientAddPackage place="agreement" />
        <PoweredBy />
      </Main>

      {signingUrl && !complete ? (
        <Actions>
          {providerOpened ? (
            <Button
              disabled={contracts.loading}
              icon={RotateCw}
              onClick={() => {
                setNotice("Checking the signing provider for your latest status…");
                refreshContracts?.();
              }}
              variant="secondary"
            >
              {contracts.loading ? "Checking…" : "Check signature status"}
            </Button>
          ) : null}
          <a
            className="kit-button"
            href={signingUrl}
            onClick={() => {
              setProviderOpened(true);
              setNotice(null);
            }}
            rel="noreferrer"
            target="_blank"
          >
            Continue to secure signing <ExternalLink aria-hidden size={18} />
          </a>
        </Actions>
      ) : null}
    </>
  );
}

/**
 * The deposit, on the screen they've just signed on (vendor journeys,
 * 2026-10-09): a client who books in one link reads, signs and pays in one
 * visit, never sent back to an email or the Payments tab to finish.
 *
 * The signature raises the deposit invoice on its own when the studio's
 * accounting app is connected (bookingContractCompleted), and the steps hook
 * watches for it for the first few minutes. Until it lands this says so
 * plainly; once paid, the date is booked.
 */
function PayAfterSigning({
  view,
  payment,
  paidInFull,
  studioName,
  byStudio,
}: {
  view: BookingStepsView | null;
  payment: boolean;
  paidInFull: boolean;
  studioName: string | null;
  /** No invoice follows the signature: the studio takes the payment itself. */
  byStudio: boolean;
}) {
  const [opened, setOpened] = useState(false);

  // Back from the payment page: read again, so "booked" appears without a reload.
  useEffect(() => {
    if (!opened) return;
    const checkOnReturn = () => {
      if (document.visibilityState === "visible") refreshClientRecords();
    };
    window.addEventListener("focus", checkOnReturn);
    document.addEventListener("visibilitychange", checkOnReturn);
    return () => {
      window.removeEventListener("focus", checkOnReturn);
      document.removeEventListener("visibilitychange", checkOnReturn);
    };
  }, [opened]);

  if (view?.booked)
    return (
      <Card tone="accent">
        <p className="kit-eyebrow" style={{ color: "var(--kit-accent)" }}>
          <CheckCircle2 aria-hidden size={14} /> Booked
        </p>
        <h2 className="kit-section">Your date is booked</h2>
        <p className="kit-body">{view.next.detail}</p>
      </Card>
    );
  if (!payment) return null;

  const deposit = view?.deposit ?? null;
  const name = paidInFull ? "Payment" : "Deposit";
  const title = paidInFull ? "Make your payment" : "Pay your deposit";

  if (deposit?.route === "online" && deposit.hostedUrl)
    return (
      <>
        <Card tone="accent">
          <p className="kit-eyebrow" style={{ color: "var(--kit-accent)" }}>
            Last step
          </p>
          <h2 className="kit-section">{title}</h2>
          <p className="kit-amount">{money(deposit.balanceCents, deposit.currency)}</p>
          <p className="kit-caption">
            <LockKeyhole aria-hidden size={14} />{" "}
            {invoicePayNote("online", { studioName, invoiceName: name, providerName: null })}
          </p>
          <p className="kit-body">Your date is booked the moment it&rsquo;s paid.</p>
          {opened ? (
            <p className="kit-caption" role="status">
              Paid already? This page updates when you come back to it.
            </p>
          ) : null}
        </Card>
        <Actions>
          {opened ? (
            <Button icon={RotateCw} onClick={() => refreshClientRecords()} variant="secondary">
              Check payment status
            </Button>
          ) : null}
          <a
            className="kit-button"
            href={deposit.hostedUrl}
            onClick={() => setOpened(true)}
            rel="noreferrer"
            target="_blank"
          >
            Pay {money(deposit.balanceCents, deposit.currency)} securely <ExternalLink aria-hidden size={18} />
          </a>
        </Actions>
      </>
    );

  if (deposit?.route === "direct")
    return (
      <>
        <Card tone="accent">
          <p className="kit-eyebrow" style={{ color: "var(--kit-accent)" }}>
            Last step
          </p>
          <h2 className="kit-section">{`Your ${paidInFull ? "invoice" : "deposit invoice"} is ready`}</h2>
          <p className="kit-amount">{money(deposit.balanceCents, deposit.currency)}</p>
          <p className="kit-caption">
            {`${studioName ?? "Your studio"} takes this payment directly — by check, cash or bank transfer. Message ${studioName ?? "them"} to arrange it. Your date is booked the moment it’s paid.`}
          </p>
        </Card>
        <Actions>
          <Button href="/client/messages?context=Payments" icon={MessageCircle}>
            {`Message ${studioName ?? "your studio"} to arrange payment`}
          </Button>
        </Actions>
      </>
    );

  // The studio bills this itself: its invoice comes from the studio (own
  // invoicing), not from an accounting app on this screen.
  if (byStudio)
    return (
      <>
        <Card tone="accent">
          <p className="kit-eyebrow" style={{ color: "var(--kit-accent)" }}>
            Last step
          </p>
          <h2 className="kit-section">{paidInFull ? "Your invoice comes next" : "Your deposit invoice comes next"}</h2>
          <p className="kit-body">
            {`${studioName ?? "Your studio"} sends your ${paidInFull ? "invoice" : "deposit invoice"} next, with how to pay — it will appear here and in your email. Your date is booked the moment it’s paid.`}
          </p>
        </Card>
        <Actions>
          <Button href="/client/messages?context=Payments" icon={MessageCircle}>
            {`Message ${studioName ?? "your studio"} to arrange payment`}
          </Button>
        </Actions>
      </>
    );

  // Not raised yet, or still on its way to the studio's accounting app.
  return (
    <Card>
      <p className="kit-eyebrow">Next</p>
      <h2 className="kit-section">{`Your ${paidInFull ? "invoice" : "deposit invoice"} is on its way`}</h2>
      <p className="kit-body">
        {`It will appear right here in a moment, and in your email too. ${paidInFull ? "Paying it" : "Paying your deposit"} books your date.`}
      </p>
    </Card>
  );
}
