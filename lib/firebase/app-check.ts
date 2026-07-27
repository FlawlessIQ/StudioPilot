import { getToken } from "firebase/app-check";
import { getFirebaseClient } from "./client";

export async function getAppCheckToken(): Promise<string | null> {
  if (process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true") return null;
  const { appCheck } = getFirebaseClient();
  if (!appCheck) return null;
  return (await getToken(appCheck)).token;
}
