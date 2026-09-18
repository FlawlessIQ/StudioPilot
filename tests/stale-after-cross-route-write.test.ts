import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import {
  cacheEntryPredatesWrite,
  markTenantRecordsWritten,
  resetTenantRecordWrites,
} from "../lib/live/record-writes";

/**
 * A page must never render tenant records read before the last command.
 *
 * F52 fixed the half where a refresh was served an in-flight read. This is the
 * other half, and it needs no concurrency to happen: /studio/tasks/new creates
 * a task on its own route and invalidates nothing, so a client-side navigation
 * back to /studio/tasks — where the 15s module cache is still warm — renders a
 * list read before the task existed. Nothing is late or racing; the cache is
 * simply answering a question from before the write.
 *
 * Every command goes through one of the twelve command clients under lib/, so
 * that is where the moment is recorded, rather than at the ~30 call sites that
 * would each have to remember.
 */

test("an entry cached before the last write is not usable", () => {
  resetTenantRecordWrites();
  const cachedAt = 1_000;
  assert.equal(cacheEntryPredatesWrite(cachedAt), false);
  markTenantRecordsWritten(2_000);
  assert.equal(cacheEntryPredatesWrite(cachedAt), true);
  // Read after the write: usable again, and the TTL resumes being the only
  // thing that retires it.
  assert.equal(cacheEntryPredatesWrite(3_000), false);
});

test("an entry cached in the same millisecond as a write is not trusted", () => {
  resetTenantRecordWrites();
  markTenantRecordsWritten(5_000);
  // It may have been read fractionally before the write landed. Re-reading one
  // collection once is cheaper than being wrong the other way.
  assert.equal(cacheEntryPredatesWrite(5_000), true);
});

test("no write at all leaves every entry usable", () => {
  resetTenantRecordWrites();
  assert.equal(cacheEntryPredatesWrite(0), true);
  assert.equal(cacheEntryPredatesWrite(1), false);
});

/**
 * Source-level: a command client that forgets is invisible until a studio
 * reports a list missing the thing they just made.
 */
test("every command client records that a command persisted", () => {
  const clients = readdirSync(`${process.cwd()}/lib`, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `lib/${entry.name}/command-client.ts`)
    .filter((path) => {
      try {
        readFileSync(`${process.cwd()}/${path}`);
        return true;
      } catch {
        return false;
      }
    });
  assert.ok(clients.length >= 12, `found only ${clients.length} command clients`);
  for (const client of clients) {
    const source = readFileSync(`${process.cwd()}/${client}`, "utf8");
    assert.match(
      source,
      /markTenantRecordsWritten\(\)/,
      `${client} relays commands and must mark the write, or a page that navigates after using it renders pre-write records`,
    );
  }
});

/** And the cache must actually consult the watermark, on both read paths. */
test("the record cache refuses an entry that predates a write", () => {
  const source = readFileSync(
    `${process.cwd()}/components/live/tenant-records.tsx`,
    "utf8",
  );
  assert.match(source, /cacheEntryPredatesWrite\(entry\.cachedAt\)/);
  // Entries must carry when they were taken, not only when they expire.
  assert.match(source, /cachedAt: Date\.now\(\)/);
  // The served read and the optimistic first paint both go through `usable`.
  assert.match(source, /if \(cached && usable\(cached\)\) return cached\.records;/);
  assert.match(source, /setRecords\(usable\(cached\) \? cached!\.records : null\)/);
});
