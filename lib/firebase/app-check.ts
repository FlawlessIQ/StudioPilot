import { getToken } from "firebase/app-check";
import { withTimeout } from "@/lib/async/with-timeout";
import { getFirebaseClient } from "./client";

/**
 * How long to wait for an App Check token before giving up with an error.
 *
 * There was no limit. On a production walk (2026-09-25) a client opening their
 * contract from the email on a phone sat on "Opening your workspace" with no
 * request ever reaching the server: the token never arrived (reCAPTCHA can
 * stall in an in-app browser), and everything waiting on it waited forever. A
 * stalled token now becomes an error the screen can offer "Try again" for.
 */
export const APP_CHECK_TOKEN_TIMEOUT_MS = 10_000;

export async function getAppCheckToken(): Promise<string | null> {
  if (process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true") return null;
  const { appCheck } = getFirebaseClient();
  if (!appCheck) return null;
  const result = await withTimeout(
    getToken(appCheck),
    APP_CHECK_TOKEN_TIMEOUT_MS,
    "StudioCue couldn't confirm this browser in time. Check your connection and try again — if you opened this from an email app, try opening it in Safari or Chrome.",
  );
  return result.token;
}

export async function getOptionalAppCheckToken(): Promise<string | null> {
  try {
    return await getAppCheckToken();
  } catch {
    return null;
  }
}
