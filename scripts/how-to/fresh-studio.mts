/**
 * A studio that has just signed up, for the how-to stack: the world the setup
 * video starts from (scripts/how-to/videos/setup.ts).
 *
 * The demo studio is set up already, so setup shows nothing to do. This makes
 * a new owner, verifies their email, creates their studio through the real
 * tenantOnboardingCommand (starter forms, membership, trial subscription), and
 * writes what Stripe's webhook writes when checkout completes. Then it saves
 * the emulators as their own snapshot:
 *
 *   scripts/how-to/stack.sh reset
 *   npx tsx scripts/how-to/fresh-studio.mts
 *   scripts/how-to/stack.sh export ~/.cache/studiocue-how-to/snapshots/fresh-studio
 *
 * Emulator only: it refuses to run without the how-to stack's emulator hosts.
 */
import { readFileSync } from "node:fs";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "127.0.0.1:19099";
process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:18080";
if (!process.env.FIREBASE_AUTH_EMULATOR_HOST.startsWith("127.0.0.1")) throw new Error("Emulator only.");

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
  if (match && !process.env[match[1]!]) process.env[match[1]!] = match[2]!.replace(/^["']|["']$/g, "");
}
const password = process.env.SEED_DEMO_PASSWORD;
if (!password) throw new Error("SEED_DEMO_PASSWORD is not set (it's in .env.local).");

const EMAIL = "new@studiohub.test";
const STUDIO = "Willow Lane Photography";
const FUNCTIONS = "http://127.0.0.1:15001/studiohub-dev/us-east4";

initializeApp({ projectId: "studiohub-dev" });
const auth = getAuth();
const db = getFirestore();

const existing = await auth.getUserByEmail(EMAIL).catch(() => null);
if (existing) throw new Error(`${EMAIL} exists already: reset the stack first (stack.sh reset).`);
await auth.createUser({ email: EMAIL, password, displayName: "Sam Reyes", emailVerified: true });

const signIn = await fetch(
  `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo`,
  { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: EMAIL, password, returnSecureToken: true }) },
);
const { idToken } = (await signIn.json()) as { idToken: string };

const created = await fetch(`${FUNCTIONS}/tenantOnboardingCommand`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${idToken}` },
  body: JSON.stringify({
    businessName: STUDIO,
    legalName: STUDIO,
    timezone: "America/New_York",
    currency: "USD",
    trade: "photographer",
    businessAddress: null,
    attribution: { heard: null, heardDetail: null },
  }),
});
const result = (await created.json()) as { tenantId?: string; error?: string };
if (!result.tenantId) throw new Error(`Onboarding refused: ${JSON.stringify(result)}`);

// What the Stripe webhook writes once checkout completes (functions/src/saas/stripe.ts).
const now = new Date();
await db.doc(`subscriptions/${result.tenantId}`).update({
  status: "trialing",
  stripeCustomerId: "cus_how_to",
  stripeSubscriptionId: "sub_how_to",
  currentPeriodEnd: new Date(now.getTime() + 14 * 86_400_000).toISOString(),
  updatedAt: now.toISOString(),
  updatedBy: "stripe",
});

console.log(`✓ ${STUDIO} (${result.tenantId}), signed in as ${EMAIL}`);
