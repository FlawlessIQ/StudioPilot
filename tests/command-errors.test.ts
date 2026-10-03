import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { z } from "zod";
import {
  classifyCommandError,
  commandTypeOf,
  isKnownCommandError,
  respondToCommandError,
} from "../functions/src/security/command-errors";
import { friendlyError } from "../lib/ai/friendly-error";

/**
 * Launch plan 2.2: a command endpoint's catch keeps a business refusal a 400
 * with its code, and turns anything unexpected into a logged 500 that names
 * nothing internal — so Cloud Run's 5xx alert fires and the browser never
 * shows an exception's text.
 */

const firebaseError = (code: string, message: string) =>
  Object.assign(new Error(message), { code });

test("business codes, schema failures and token refusals are known", () => {
  assert.equal(isKnownCommandError(new Error("FORBIDDEN")), true);
  assert.equal(isKnownCommandError(new Error("PROJECT_VERSION_CONFLICT")), true);
  assert.equal(isKnownCommandError(new Error("APP_CHECK_REQUIRED")), true);
  assert.equal(isKnownCommandError(new Error("INVALID_TRANSITION:BOOKED>READY,PLANNING")), true);
  assert.equal(isKnownCommandError(new Error("DATE_TAKEN:The Smith wedding")), true);
  assert.equal(isKnownCommandError(new Error("OPEN_PROPOSAL_EXISTS:proposal_123")), true);
  const zod = z.object({ businessName: z.string().min(2) }).safeParse({ businessName: "x" });
  assert.equal(zod.success, false);
  assert.equal(isKnownCommandError(zod.error), true);
  assert.equal(isKnownCommandError(firebaseError("auth/id-token-expired", "Firebase ID token has expired.")), true);
  assert.equal(isKnownCommandError(firebaseError("app-check/invalid-argument", "Decoding App Check token failed.")), true);
});

test("anything else is unexpected", () => {
  for (const caught of [
    new TypeError("Cannot read properties of undefined (reading 'get')"),
    new Error("10 ABORTED: Too much contention on these documents."),
    new Error("9 FAILED_PRECONDITION: The query requires an index."),
    new Error("No such price: 'price_123'"),
    new Error("fetch failed"),
    new Error(""),
    new Error("lowercase_code"),
    "a thrown string",
    undefined,
    { message: "FORBIDDEN" },
  ])
    assert.equal(isKnownCommandError(caught), false, String((caught as Error)?.message ?? caught));
});

test("known errors keep their status and code; Zod failures name the field", () => {
  assert.deepEqual(classifyCommandError(new Error("PROJECT_NOT_FOUND")), {
    kind: "known",
    status: 400,
    body: { error: "PROJECT_NOT_FOUND" },
  });
  const forbidden = classifyCommandError(new Error("FORBIDDEN"), {
    status: (message) => (message === "FORBIDDEN" ? 403 : 400),
  });
  assert.equal(forbidden.status, 403);
  const zod = z.object({ input: z.object({ businessName: z.string().min(2) }) }).safeParse({ input: { businessName: "x" } });
  assert.equal(zod.success, false);
  const outcome = classifyCommandError(zod.error);
  assert.equal(outcome.status, 400);
  assert.equal(outcome.body.error, "INVALID_COMMAND:business name");
  const token = classifyCommandError(firebaseError("auth/argument-error", "Decoding Firebase ID token failed."));
  assert.equal(token.status, 400);
});

test("unexpected errors are logged and answered 500 INTERNAL, with nothing leaked", () => {
  const sent: { status?: number; body?: unknown } = {};
  const response = {
    status(code: number) {
      sent.status = code;
      return {
        json(body: unknown) {
          sent.body = body;
          return undefined;
        },
      };
    },
  };
  const logged: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  const originalErr = process.stderr.write.bind(process.stderr);
  const capture = (chunk: unknown) => {
    logged.push(String(chunk));
    return true;
  };
  process.stdout.write = capture as typeof process.stdout.write;
  process.stderr.write = capture as typeof process.stderr.write;
  try {
    respondToCommandError(response, new TypeError("secret internals at /srv/app.js"), {
      name: "bookingCommand",
      commandType: "recordRetainer",
    });
  } finally {
    process.stdout.write = original;
    process.stderr.write = originalErr;
  }
  assert.equal(sent.status, 500);
  assert.deepEqual(sent.body, { error: "INTERNAL" });
  const line = logged.join("");
  assert.match(line, /bookingCommand_unexpected/);
  assert.match(line, /recordRetainer/);
  assert.match(line, /"severity":"ERROR"/);
});

test("commandTypeOf reads a bounded type from any body", () => {
  assert.equal(commandTypeOf({ type: "sendProposal" }), "sendProposal");
  assert.equal(commandTypeOf({ type: "x".repeat(200) })?.length, 80);
  assert.equal(commandTypeOf(null), undefined);
  assert.equal(commandTypeOf({ type: 4 }), undefined);
});

test("the six endpoints route their catch through the shared helper", () => {
  for (const file of [
    "functions/src/saas/onboarding.ts",
    "functions/src/saas/stripe.ts",
    "functions/src/booking/commands.ts",
    "functions/src/booking/proposals.ts",
    "functions/src/booking/public-scheduling.ts",
  ]) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /respondToCommandError\(response, caught,/, file);
    assert.doesNotMatch(source, /\.json\(\{ error: message \}\)/, file);
  }
  // The Stripe webhook's own failures stay as they were.
  assert.match(readFileSync("functions/src/saas/stripe.ts", "utf8"), /status\(401\)\.send\("INVALID_SIGNATURE"\)/);
});

test("the browser says INTERNAL calmly, and never shows a parser's sentence", () => {
  const calm = "Something went wrong on our side. It's been logged — please try again in a minute.";
  assert.equal(friendlyError(new Error("INTERNAL")), calm);
  assert.equal(friendlyError(new Error(`Unexpected token '<', "<!DOCTYPE "... is not valid JSON`)), calm);
  assert.match(friendlyError(new Error("APP_CHECK_REQUIRED")), /verify this browser/);
  assert.match(friendlyError(new Error("INVALID_COMMAND:business name")), /business name/);
});

test("onboarding shows friendly copy and caps the studio name at the server's 120", () => {
  const form = readFileSync("features/auth/onboarding-form.tsx", "utf8");
  assert.match(form, /friendlyError\(caught,/);
  assert.doesNotMatch(form, /caught instanceof Error \? caught\.message/);
  assert.match(form, /name="businessName"[\s\S]{0,120}maxLength=\{120\}/);
  assert.match(readFileSync("functions/src/saas/onboarding.ts", "utf8"), /businessName: z\.string\(\)\.trim\(\)\.min\(2\)\.max\(120\)/);
});
