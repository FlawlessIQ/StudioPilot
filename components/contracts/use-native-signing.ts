"use client";

import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { useWorkspace } from "@/features/auth/workspace-context";
import { getFirebaseClient } from "@/lib/firebase/client";
import { dataIsLive } from "@/lib/runtime-mode";
import { nativeSigningOn } from "@/features/contracts/rollout";

export type NativeSigningState = {
  loading: boolean;
  /** StudioCue may write and sign contracts for this studio. */
  enabled: boolean;
  /** The studio's saved agreement, when there is one. */
  agreementTemplateId: string | null;
  autoSend: { enabled: boolean; signerName: string | null };
};

/**
 * Whether this studio writes its contracts in StudioCue, and with which
 * agreement. Read once per mount; `generation` re-reads after a save.
 */
export function useNativeSigning(generation = 0): NativeSigningState {
  const workspace = useWorkspace();
  const [state, setState] = useState<NativeSigningState>({
    loading: dataIsLive,
    enabled: !dataIsLive,
    agreementTemplateId: null,
    autoSend: { enabled: false, signerName: null },
  });
  useEffect(() => {
    if (!dataIsLive || workspace.loading || !workspace.tenantId) return;
    let active = true;
    void (async () => {
      const { firestore } = getFirebaseClient();
      const [features, tenant] = await Promise.all([
        getDoc(doc(firestore, "tenantFeatures", workspace.tenantId!)).catch(() => null),
        getDoc(doc(firestore, "tenants", workspace.tenantId!)).catch(() => null),
      ]);
      if (!active) return;
      const settings = (tenant?.data()?.defaultContractSettings ?? {}) as Record<string, unknown>;
      const autoSend = (settings.nativeAutoSend ?? {}) as Record<string, unknown>;
      setState({
        loading: false,
        enabled: nativeSigningOn(features?.exists() ? features.data() : null),
        agreementTemplateId:
          typeof settings.agreementTemplateId === "string" ? settings.agreementTemplateId : null,
        autoSend: {
          enabled: autoSend.enabled === true,
          signerName: typeof autoSend.signerName === "string" ? autoSend.signerName : null,
        },
      });
    })();
    return () => {
      active = false;
    };
  }, [workspace.loading, workspace.tenantId, generation]);
  return state;
}
