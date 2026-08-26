import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, type Auth } from "firebase/auth";
import {
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
  type AppCheck,
} from "firebase/app-check";
import {
  connectFirestoreEmulator,
  initializeFirestore,
  type Firestore,
} from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

let emulatorConnected = false;
let appCheck: AppCheck | null = null;
let firestoreClient: Firestore | null = null;

export function getFirebaseClient(): {
  app: FirebaseApp;
  auth: Auth;
  firestore: Firestore;
  appCheck: AppCheck | null;
} {
  const missing = Object.entries(firebaseConfig)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new Error(`Firebase client configuration is incomplete: ${missing.join(", ")}`);
  }

  const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
  const auth = getAuth(app);
  firestoreClient ??= initializeFirestore(app, {
    // StudioCue is commonly used on venue, hotel, and mobile networks where
    // proxies can interrupt Firestore's streaming WebChannel transport. The
    // forced long-polling transport trades a little latency for predictable
    // signed-in reads and writes on those networks.
    experimentalForceLongPolling: true,
    experimentalLongPollingOptions: { timeoutSeconds: 15 },
  });
  const firestore = firestoreClient;
  const useEmulators =
    process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true";

  if (!useEmulators && !appCheck) {
    const siteKey = process.env.NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY;
    if (!siteKey) {
      throw new Error("Firebase App Check is not configured.");
    }
    appCheck = initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(siteKey),
      isTokenAutoRefreshEnabled: true,
    });
  }

  if (
    useEmulators &&
    !emulatorConnected
  ) {
    // Ports are overridable because the default block collides with any other
    // Firebase project's emulator suite on the same machine. When that happens
    // the browser silently authenticates against the *other* project rather
    // than failing, so sign-in appears broken for reasons nothing reports.
    const authEmulator =
      process.env.NEXT_PUBLIC_AUTH_EMULATOR_URL ?? "http://127.0.0.1:9099";
    const firestorePort = Number(
      process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_PORT ?? 8080,
    );
    connectAuthEmulator(auth, authEmulator, { disableWarnings: true });
    connectFirestoreEmulator(firestore, "127.0.0.1", firestorePort);
    emulatorConnected = true;
  }

  return { app, auth, firestore, appCheck };
}
