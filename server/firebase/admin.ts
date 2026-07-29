import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getAppCheck } from "firebase-admin/app-check";
import { getFirestore } from "firebase-admin/firestore";
import type { App } from "firebase-admin/app";
import type { Auth } from "firebase-admin/auth";
import type { AppCheck } from "firebase-admin/app-check";
import type { Firestore } from "firebase-admin/firestore";
import { z } from "zod";

function getCredential() {
  const encodedServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  if (!encodedServiceAccount) {
    return applicationDefault();
  }

  const serviceAccountSchema = z.object({
    project_id: z.string().min(1),
    client_email: z.string().email(),
    private_key: z.string().min(1),
  });
  const json = Buffer.from(encodedServiceAccount, "base64").toString("utf8");
  const serviceAccount = serviceAccountSchema.parse(JSON.parse(json));
  return cert({
    projectId: serviceAccount.project_id,
    clientEmail: serviceAccount.client_email,
    privateKey: serviceAccount.private_key,
  });
}

let cachedApp: App | undefined;

function getAdminApp(): App {
  cachedApp ??=
    getApps()[0] ??
    initializeApp({
      credential: getCredential(),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    });

  return cachedApp;
}

function lazyAdminService<T extends object>(resolve: () => T): T {
  let service: T | undefined;

  return new Proxy({} as T, {
    get(_target, property) {
      service ??= resolve();
      const value = Reflect.get(service, property, service);
      return typeof value === "function" ? value.bind(service) : value;
    },
  });
}

// Firestore creates request tags with crypto randomness during construction.
// Keep every Admin SDK service lazy so Cloudflare initializes it inside a
// request handler rather than in the Worker's global module scope.
export const adminAuth = lazyAdminService<Auth>(() => getAuth(getAdminApp()));
export const adminAppCheck = lazyAdminService<AppCheck>(() =>
  getAppCheck(getAdminApp()),
);
export const adminFirestore = lazyAdminService<Firestore>(() =>
  getFirestore(getAdminApp()),
);
