import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
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

const app =
  getApps().length > 0
    ? getApps()[0]
    : initializeApp({
        credential: getCredential(),
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
      });

if (!app) {
  throw new Error("Firebase Admin failed to initialize");
}

export const adminAuth = getAuth(app);
export const adminFirestore = getFirestore(app);
