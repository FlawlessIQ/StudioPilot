"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, ExternalLink, LockKeyhole, MessageCircle, RotateCw } from "lucide-react";
import { Actions, Button, Card, List, Main, PoweredBy, Row, Steps } from "@/components/kit/kit";
import { ClientContractSigning } from "@/components/client/contract-signing";
import { useWorkspace } from "@/features/auth/workspace-context";
import { statusLabel } from "@/features/format/status-label";
import {
  text,
  useProjectRecords,
  useReserveYourDate,
} from "@/components/client/live-client-views";

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
  const reserve = useReserveYourDate();
  const [providerOpened, setProviderOpened] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const refreshContracts = contracts.refresh;
  const contract = useMemo(
    () => [...contracts.value].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0],
    [contracts.value],
  );
  const contractStatus = text(contract?.status);

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
        <div className="kit-stack-tight">
          <p className="kit-eyebrow">Agreement</p>
          <h1 className="kit-title">Your agreement</h1>
        </div>
        <Card>
          <p className="kit-body" role={contracts.error ? "alert" : "status"}>
            {contracts.loading
              ? "Opening your agreement…"
              : contracts.error ?? "Your agreement will appear after the studio sends it for signature."}
          </p>
        </Card>
        <PoweredBy />
      </Main>
    );

  if (contract.provider === "studiocue") {
    const studioName =
      workspace.tenantName && !workspace.tenantName.startsWith("Loading") ? workspace.tenantName : null;
    return (
      <Main label="Your agreement">
        {progress}
        <div className="kit-stack-tight">
          <p className="kit-eyebrow">Agreement</p>
          <h1 className="kit-title">Your agreement</h1>
          <p className="kit-body">
            {contractStatus === "completed"
              ? "Signed by you and your studio."
              : contractStatus === "voided"
                ? "This version was withdrawn."
                : "Read it through, then tap Review & sign. It’s written from the proposal you accepted."}
          </p>
        </div>
        <ClientContractSigning
          contract={contract}
          onChanged={() => refreshContracts?.()}
          studioColor={workspace.tenantBrand?.primaryColor ?? null}
          studioName={studioName}
        />
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

  return (
    <>
      <Main label="Your agreement">
        {progress}
        <div className="kit-stack-tight">
          <p className="kit-eyebrow">Agreement · {statusLabel(contract.status)}</p>
          <h1 className="kit-title">Photography services agreement</h1>
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
          {complete ? " Your studio holds the signed agreement; ask below if you’d like a copy." : ""}
        </p>
        <Link
          className="kit-caption"
          href="/client/messages?context=Contract%20signing"
          style={{ display: "inline-flex", gap: 6, alignItems: "center" }}
        >
          <MessageCircle aria-hidden size={15} /> Ask your studio about this agreement
        </Link>
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
