"use client";

import { getAuth } from "firebase/auth";
import { getAppCheckToken } from "@/lib/firebase/app-check";
import { getFirebaseClient } from "@/lib/firebase/client";

export type LifecycleTriggerSetting = {
  enabled: boolean;
  offsetDays: number;
  autoSend: boolean;
};

export type LifecycleSettings = {
  schedule_confirmation: LifecycleTriggerSetting;
  final_invoice_notice: LifecycleTriggerSetting;
  day_before_checklist: LifecycleTriggerSetting;
};

export async function saveLifecycleSettings(input: {
  tenantId: string;
  settings: LifecycleSettings;
}): Promise<{ mode: "preview" | "live" }> {
  const endpoint = process.env.NEXT_PUBLIC_BOOKING_FUNCTIONS_URL;
  if (!endpoint) return { mode: "preview" };
  const client = getFirebaseClient();
  const user = getAuth(client.app).currentUser;
  if (!user) throw new Error("Sign in before changing settings.");
  const appCheckToken = await getAppCheckToken();
  const response = await fetch(
    `${endpoint.replace(/\/$/, "")}/lifecycleSettingsCommand`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${await user.getIdToken()}`,
        ...(appCheckToken ? { "x-firebase-appcheck": appCheckToken } : {}),
      },
      body: JSON.stringify(input),
    },
  );
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(payload.error ?? "SETTINGS_SAVE_FAILED");
  }
  return { mode: "live" };
}
