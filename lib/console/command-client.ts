"use client";

import { getAuth } from "firebase/auth";
import { getAppCheckToken } from "@/lib/firebase/app-check";
import { getFirebaseClient } from "@/lib/firebase/client";
import { markTenantRecordsWritten } from "@/lib/live/record-writes";

/**
 * The one caller for every Console command (functions/src/saas/admin.ts).
 *
 * `{type, input}` posts to saasAdminCommand through the /api/functions relay
 * in production. With no Functions URL configured nothing can change, and the
 * caller is told so in words rather than shown a success that didn't happen.
 */
export class ConsoleCommandError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export const consoleCommandsAvailable = Boolean(process.env.NEXT_PUBLIC_SAAS_ADMIN_FUNCTIONS_URL);

export async function runConsoleCommand<Result = Record<string, unknown>>(
  type: string,
  input: Record<string, unknown> = {},
): Promise<Result> {
  const endpoint = process.env.NEXT_PUBLIC_SAAS_ADMIN_FUNCTIONS_URL;
  if (!endpoint) throw new ConsoleCommandError("CONSOLE_COMMANDS_NOT_CONFIGURED");
  const client = getFirebaseClient();
  const user = getAuth(client.app).currentUser;
  if (!user) throw new ConsoleCommandError("AUTHENTICATION_REQUIRED");
  const appCheckToken = await getAppCheckToken();
  let response: Response;
  try {
    response = await fetch(`${endpoint.replace(/\/$/, "")}/saasAdminCommand`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${await user.getIdToken()}`,
        ...(appCheckToken ? { "x-firebase-appcheck": appCheckToken } : {}),
      },
      body: JSON.stringify({ type, input }),
    });
  } catch {
    throw new ConsoleCommandError("NETWORK_UNAVAILABLE");
  }
  const text = await response.text();
  let payload: Record<string, unknown> = {};
  try {
    payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    // An HTML body is the invoker-IAM 403 (docs/deployment.md), not our error.
    throw new ConsoleCommandError(response.status === 403 ? "FUNCTION_ACCESS_DENIED" : "CONSOLE_COMMAND_FAILED");
  }
  if (!response.ok) throw new ConsoleCommandError(typeof payload.error === "string" ? payload.error : "CONSOLE_COMMAND_FAILED");
  // Console pages read live, but a studio page opened next must not use records cached before this.
  markTenantRecordsWritten();
  return payload as Result;
}
