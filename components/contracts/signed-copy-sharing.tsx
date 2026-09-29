"use client";

import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { FileLinks } from "@/components/documents/file-link";
import { FILE_BEARING } from "@/features/documents/file-ref";
import { getFirebaseClient } from "@/lib/firebase/client";
import { setSignedCopyShared } from "@/lib/contracts/command-client";
import { friendlyError } from "@/lib/ai/friendly-error";
import { dataIsLive } from "@/lib/runtime-mode";

type ContractRecord = Record<string, unknown> & { id: string };

/**
 * A contract signed outside StudioCue: its file, and whether the couple sees it.
 *
 * Recorded by hand or imported, the signed copy had no link anywhere in the
 * studio (docs/document-access-plan-2026-09-28.md). It is the couple's
 * contract, so it is shown to them by default (Q6); this is where the studio
 * can turn that off. A contract signed in StudioCue has no switch — it is
 * always theirs to keep.
 */
export function SignedCopySharing({
  contract,
  showFiles,
}: {
  contract: ContractRecord;
  /** False where the contract step already shows the file. */
  showFiles: boolean;
}) {
  const files = FILE_BEARING.contracts(contract);
  const filed =
    contract.provider !== "studiocue" && contract.signedDocumentId === `signed_contract_${contract.id}`;
  const [shared, setShared] = useState<boolean | null>(dataIsLive ? null : true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!dataIsLive || !filed) return;
    let active = true;
    const { firestore } = getFirebaseClient();
    void getDoc(doc(firestore, "documents", `signed_contract_${contract.id}`))
      .then((snapshot) => {
        if (active) setShared(snapshot.exists() ? snapshot.get("clientVisible") !== false : null);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [contract.id, filed]);

  if (!files.length) return null;
  async function toggle(next: boolean) {
    setBusy(true);
    setNotice(null);
    try {
      await setSignedCopyShared({ contractId: contract.id, shared: next });
      setShared(next);
      setNotice(next ? "The couple can open this in their portal." : "Hidden from the couple's portal.");
    } catch (caught) {
      setNotice(friendlyError(caught, "That couldn't be changed. Try again."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="signed-copy-sharing">
      {showFiles ? <FileLinks files={files} /> : null}
      {filed && shared !== null ? (
        <label className="signed-copy-sharing-toggle">
          <input
            checked={shared}
            disabled={busy}
            onChange={(event) => void toggle(event.target.checked)}
            type="checkbox"
          />
          <span>Show the signed copy to the couple in their portal</span>
        </label>
      ) : null}
      {notice ? (
        <small className="signed-copy-sharing-notice" role="status">
          {notice}
        </small>
      ) : null}
    </div>
  );
}
