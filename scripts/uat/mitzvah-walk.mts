/**
 * The bar and bat mitzvah walk (docs/mitzvah-journey-plan-2026-10-14.md), kept
 * so the commands in the docs still run: it is now `kind-walk.mts --kind
 * mitzvah`, with the mitzvah's answers and assertions in kind-fixtures.mts.
 *
 *   set -a; . functions/.env.local; set +a
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
 *     npx tsx scripts/uat/mitzvah-walk.mts
 */
if (!process.argv.includes("--kind")) process.argv.push("--kind", "mitzvah");
await import("./kind-walk.mts");
