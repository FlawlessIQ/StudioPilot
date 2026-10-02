"use client";

import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { useWorkspace } from "@/features/auth/workspace-context";
import { getFirebaseClient } from "@/lib/firebase/client";
import { dataIsLive } from "@/lib/runtime-mode";
import { normaliseInquiryFormConfig } from "@/features/leads/inquiry-form-config";
import {
  JOB_KIND_LABELS,
  JOB_KINDS,
  jobKindOf,
  type JobKind,
} from "@/features/job-kinds/job-kinds";

/** One of the studio's own job types: its label, and the kind it is. */
export type StudioJobType = {
  /** The type's id on the inquiry form; the kind itself for the defaults. */
  key: string;
  label: string;
  kind: JobKind;
};

/** Every kind, named the product's way — the list when a studio has none of its own. */
export function defaultJobTypes(): StudioJobType[] {
  return JOB_KINDS.map((kind) => ({ key: kind, label: JOB_KIND_LABELS[kind], kind }));
}

/**
 * The studio's job types — "Cheer", "Mini sessions", "Headshots" — each
 * pointing at one kind (docs/job-types-plan-2026-10-02.md). One list: the
 * inquiry form's types, so a family who picked "Mini sessions" on the form
 * and a job the studio starts by hand are the same type.
 *
 * `leadCaptureSettings` is readable by owners and admins only; anyone else
 * gets the kinds themselves, which is still every choice that matters.
 * The inquiry-only "General question" is never a job type.
 */
export function useStudioJobTypes(): StudioJobType[] {
  const workspace = useWorkspace();
  const [types, setTypes] = useState<StudioJobType[]>(defaultJobTypes);
  useEffect(() => {
    if (!dataIsLive || workspace.loading || !workspace.tenantId) return;
    let active = true;
    const { firestore } = getFirebaseClient();
    void getDoc(doc(firestore, "leadCaptureSettings", workspace.tenantId))
      .then((snapshot) => {
        if (!active || !snapshot.exists()) return;
        const config = normaliseInquiryFormConfig(snapshot.get("inquiryForm"));
        const own = config.eventTypes
          .filter((type) => type.kind !== "general")
          .map((type) => ({ key: type.id, label: type.label, kind: jobKindOf({ eventKind: type.kind }) }));
        if (own.length) setTypes(own);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [workspace.loading, workspace.tenantId]);
  return types;
}

/** The studio's type a job is filed under: by its key, else the first of its kind. */
export function jobTypeFor(
  types: readonly StudioJobType[],
  record: { eventTypeKey?: unknown; eventKind?: unknown; eventTypeId?: unknown; eventType?: unknown } | null | undefined,
): StudioJobType | null {
  if (!record) return null;
  const key = typeof record.eventTypeKey === "string" ? record.eventTypeKey : "";
  const byKey = key ? types.find((type) => type.key === key) : undefined;
  if (byKey) return byKey;
  const kind = jobKindOf(record);
  const label = typeof record.eventType === "string" ? record.eventType.trim().toLowerCase() : "";
  return (
    types.find((type) => type.kind === kind && type.label.toLowerCase() === label) ??
    types.find((type) => type.kind === kind) ??
    null
  );
}
