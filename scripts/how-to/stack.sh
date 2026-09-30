#!/bin/zsh
# The how-to video stack: StudioCue running on its own, for recording.
#
# Other sessions run the emulators and a dev server in this checkout on the
# default ports, reseed them, and sign in and out of the shared browser. A
# recording made against that drifts mid-take. So this runs a separate copy:
#   - a git worktree at $HOW_TO_HOME/app (node_modules cloned copy-on-write,
#     so it costs no disk), checked out at this checkout's HEAD;
#   - its own emulators on the 1xxxx ports, seeded with the demo studio
#     (scripts/seed.ts + scripts/demo-workspace.ts) and snapshotted, so every
#     take starts from the same world;
#   - its own production build, served on :3100.
# Nothing here touches the checkout's .next, its ports or production.
#
#   scripts/how-to/stack.sh up        # build if needed, start, seed once
#   scripts/how-to/stack.sh reset     # restart the emulators from the snapshot
#   scripts/how-to/stack.sh reseed    # throw the snapshot away and seed again
#   scripts/how-to/stack.sh down
#
# Needs Java 21+ (emulators) and SEED_DEMO_PASSWORD in .env.local.
set -e
ROOT=$(git rev-parse --show-toplevel)
H=${HOW_TO_HOME:-$HOME/.cache/studiocue-how-to}
APP=$H/app
SNAP=$H/emulator-snapshot
LOGS=$H/logs
PORT=3100
mkdir -p $H $LOGS

AUTH=19099 FIRESTORE=18080 FUNCTIONS=15001 STORAGE=19199
FN_URL="http://127.0.0.1:$FUNCTIONS/studiohub-dev/us-east4"

prepare() {
  if [ ! -d $APP ]; then
    git -C $ROOT worktree add --detach $APP HEAD
  fi
  local head=$(git -C $ROOT rev-parse HEAD)
  if [ "$(git -C $APP rev-parse HEAD)" != "$head" ]; then
    git -C $APP checkout --quiet --detach $head
    rm -f $H/built-at
  fi
  [ -d $APP/node_modules ] || cp -cR $ROOT/node_modules $APP/node_modules
  [ -d $APP/functions/node_modules ] || cp -cR $ROOT/functions/node_modules $APP/functions/node_modules

  # The checkout's env, re-pointed at this stack's ports.
  sed -E \
    -e "s#http://127\.0\.0\.1:5001/studiohub-dev/us-east4#$FN_URL#g" \
    -e "s#^(NEXT_PUBLIC_APP_URL)=.*#\1=http://localhost:$PORT#" \
    -e "s#^(FIRESTORE_EMULATOR_HOST)=.*#\1=127.0.0.1:$FIRESTORE#" \
    -e "s#^(FIREBASE_AUTH_EMULATOR_HOST)=.*#\1=127.0.0.1:$AUTH#" \
    -e "s#^(FIREBASE_STORAGE_EMULATOR_HOST)=.*#\1=127.0.0.1:$STORAGE#" \
    -e "s#^(NEXT_PUBLIC_AUTH_EMULATOR_URL)=.*#\1=http://127.0.0.1:$AUTH#" \
    -e "s#^(NEXT_PUBLIC_FIRESTORE_EMULATOR_PORT)=.*#\1=$FIRESTORE#" \
    $ROOT/.env.local > $APP/.env.local
  grep -q '^NEXT_PUBLIC_FIRESTORE_EMULATOR_PORT=' $APP/.env.local || echo "NEXT_PUBLIC_FIRESTORE_EMULATOR_PORT=$FIRESTORE" >> $APP/.env.local
  grep -q '^NEXT_PUBLIC_AUTH_EMULATOR_URL=' $APP/.env.local || echo "NEXT_PUBLIC_AUTH_EMULATOR_URL=http://127.0.0.1:$AUTH" >> $APP/.env.local
  sed -E "s#^(NEXT_PUBLIC_APP_URL)=.*#\1=http://localhost:$PORT#" $ROOT/functions/.env.local > $APP/functions/.env.local
  # Inbound mail, so the studio's forwarding address exists to be shown. Local
  # only: nothing reaches this stack from the real inbound domain.
  { echo "SENDGRID_INBOUND_DOMAIN=inbound.studio-cue.com"; echo "INBOUND_REPLY_SIGNING_SECRET=how-to-stack-local-only"; } >> $APP/functions/.env.local

  node -e '
    const fs = require("fs"); const f = process.argv[1]; const c = JSON.parse(fs.readFileSync(f, "utf8"));
    c.emulators = { singleProjectMode: true, ui: { enabled: false },
      auth: { port: +process.argv[2] }, firestore: { port: +process.argv[3] }, functions: { port: +process.argv[4] },
      storage: { port: +process.argv[5] }, hub: { port: 14400 }, logging: { port: 14500 }, eventarc: { port: 19299 }, tasks: { port: 19499 } };
    fs.writeFileSync(f, JSON.stringify(c, null, 2));
  ' $APP/firebase.json $AUTH $FIRESTORE $FUNCTIONS $STORAGE

  if [ ! -f $H/built-at ]; then
    echo "Building functions and the app at $(git -C $APP rev-parse --short HEAD)…"
    (cd $APP/functions && npm run build > $LOGS/functions-build.log 2>&1)
    (cd $APP && npm run build > $LOGS/app-build.log 2>&1)
    git -C $APP rev-parse HEAD > $H/built-at
  fi
}

emulators_up() {
  local import=()
  [ -d $SNAP ] && import=(--import $SNAP)
  (cd $APP && nohup firebase emulators:start --project studiohub-dev --only auth,firestore,functions,storage $import > $LOGS/emulators.log 2>&1 &)
  for i in $(seq 1 120); do grep -q "All emulators ready" $LOGS/emulators.log && return 0; sleep 2; done
  echo "Emulators did not start; see $LOGS/emulators.log" && return 1
}

emulators_down() {
  pkill -f "firebase emulators:start --project studiohub-dev --only auth,firestore,functions,storage" 2>/dev/null || true
  for i in $(seq 1 30); do lsof -ti :$FIRESTORE >/dev/null 2>&1 || return 0; sleep 1; done
}

seed() {
  echo "Seeding the demo studio…"
  (cd $APP && set -a && . ./.env.local && set +a && \
    SEED_WEDDING_PACKAGE_CENTS=650000 npx tsx scripts/seed.ts > $LOGS/seed.log && \
    npx tsx scripts/demo-workspace.ts > $LOGS/demo-workspace.log && \
    TENANT=$(grep -o '"tenantId": "[^"]*"' $LOGS/seed.log | head -1 | cut -d'"' -f4) && \
    npx tsx scripts/uat/fixture.mts $TENANT > $LOGS/fixture.log && \
    npx tsx $ROOT/scripts/how-to/fixture-tidy.mts $TENANT >> $LOGS/fixture.log)
  (cd $APP && firebase emulators:export $SNAP --project studiohub-dev --force > $LOGS/export.log 2>&1)
}

# The PDF service (cloud-run/pdf) on :8090, where functions/.env.local points
# PDF_SERVICE_URL. Without it every proposal shows "PDF generation failed".
pdf_up() {
  lsof -ti :8090 >/dev/null 2>&1 && return 0
  [ -d $H/pdf-venv ] || { python3 -m venv $H/pdf-venv && $H/pdf-venv/bin/pip install -q -r $ROOT/cloud-run/pdf/requirements.txt; }
  (cd $APP/cloud-run/pdf && nohup $H/pdf-venv/bin/uvicorn main:app --port 8090 > $LOGS/pdf.log 2>&1 &)
  for i in $(seq 1 30); do curl -s localhost:8090/health >/dev/null && return 0; sleep 1; done
  echo "PDF service did not start; see $LOGS/pdf.log" && return 1
}

app_up() {
  lsof -ti :$PORT >/dev/null 2>&1 && return 0
  (cd $APP && nohup npx next start -p $PORT > $LOGS/app.log 2>&1 &)
  for i in $(seq 1 60); do curl -s -o /dev/null -w "%{http_code}" localhost:$PORT/auth/login | grep -q 200 && return 0; sleep 1; done
  echo "App did not start; see $LOGS/app.log" && return 1
}

case ${1:-up} in
  up)
    prepare
    lsof -ti :$FIRESTORE >/dev/null 2>&1 || emulators_up
    [ -d $SNAP ] || seed
    pdf_up
    app_up
    echo "How-to stack ready: http://localhost:$PORT (owner@studiohub.test)"
    ;;
  reset)
    emulators_down; emulators_up; echo "Emulators restored from the snapshot."
    ;;
  reseed)
    emulators_down; rm -rf $SNAP; emulators_up; seed; echo "Reseeded."
    ;;
  down)
    emulators_down
    kill $(lsof -ti :$PORT) 2>/dev/null || true
    kill $(lsof -ti :8090) 2>/dev/null || true
    echo "Stopped."
    ;;
  *) echo "usage: $0 up|reset|reseed|down" && exit 2 ;;
esac
