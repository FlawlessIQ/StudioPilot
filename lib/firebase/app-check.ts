import {
  getToken,
  initializeAppCheck,
  ReCaptchaV3Provider,
  type AppCheck,
} from "firebase/app-check";
import { getFirebaseClient } from "./client";

let appCheck: AppCheck | null = null;

export async function getAppCheckToken(): Promise<string | null> {
  if (process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true") return null;
  const siteKey = process.env.NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY;
  if (!siteKey) throw new Error("Firebase App Check is not configured.");

  const { app } = getFirebaseClient();
  appCheck ??= initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(siteKey),
    isTokenAutoRefreshEnabled: true,
  });
  return (await getToken(appCheck)).token;
}
