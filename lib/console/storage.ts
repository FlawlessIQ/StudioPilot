"use client";

import { connectStorageEmulator, getDownloadURL, getStorage, ref } from "firebase/storage";
import { getFirebaseClient } from "@/lib/firebase/client";

let emulatorConnected = false;

/**
 * A download URL for a file only platform admins may read (storage.rules), such
 * as a feedback screenshot.
 */
export async function adminFileUrl(path: string): Promise<string> {
  const storage = getStorage(getFirebaseClient().app);
  if (process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true" && !emulatorConnected) {
    try {
      connectStorageEmulator(storage, "127.0.0.1", Number(process.env.NEXT_PUBLIC_STORAGE_EMULATOR_PORT ?? 9199));
    } catch {
      // Already connected by another page in this tab.
    }
    emulatorConnected = true;
  }
  return getDownloadURL(ref(storage, path));
}
