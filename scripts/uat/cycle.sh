#!/bin/zsh
# Claude's local UAT run (docs/mobile-first-client-crew-plan-2026-09-28.md,
# "Claude's local UAT run"): fresh emulators, seed, the UAT scenario, a
# production build, then the runner. Emulator only: every script refuses to
# run without emulator hosts. Run from the repo root:
#   scripts/uat/cycle.sh
# Results: $UAT_OUT/results.json (default /tmp/studiocue-uat), screenshots of
# failures in $UAT_OUT/shots. Needs Java 21+ and SEED_DEMO_PASSWORD in .env.local.
set -e
OUT=${UAT_OUT:-/tmp/studiocue-uat}
mkdir -p $OUT
kill $(lsof -i :3000 -t) 2>/dev/null || true
pkill -f "firebase emulators:start" || true; sleep 8
(cd functions && npm run build >/dev/null)
nohup firebase emulators:start --project studiohub-dev > $OUT/emulators.log 2>&1 &
for i in $(seq 1 90); do grep -q "All emulators ready" $OUT/emulators.log && break; sleep 2; done
set -a; . ./.env.local; set +a
SEED_WEDDING_PACKAGE_CENTS=650000 npx tsx scripts/seed.ts > $OUT/seed.log
TENANT=$(grep -o '"tenantId": "[^"]*"' $OUT/seed.log | head -1 | cut -d'"' -f4)
npx tsx scripts/uat/fixture.mts $TENANT > $OUT/fixture.log
NEXT_PUBLIC_CLIENT_MAGIC_LINK=1 npm run build > $OUT/build.log
(NEXT_PUBLIC_CLIENT_MAGIC_LINK=1 nohup npm run start > $OUT/start.log 2>&1 &)
for i in $(seq 1 40); do curl -s -o /dev/null -w "%{http_code}" localhost:3000/auth/login | grep -q 200 && break; sleep 1; done
rm -rf $OUT/shots
UAT_OUT=$OUT npx tsx scripts/uat/runner.mts $TENANT ${1:-} | tee $OUT/run.log | grep -E "^(PASS|FAIL|BLOCKED|TALLY)"
