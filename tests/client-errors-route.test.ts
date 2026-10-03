import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { POST } from "../app/api/client-errors/route";
import { sanitizeClientErrorReport, scrubClientErrorText, scrubRoute } from "../lib/observability/client-error";

/**
 * Launch plan 2.3: browser errors reach Cloud Logging at ERROR without Sentry,
 * and without personal data — no emails, no query strings, no link tokens.
 */

let address = 0;
const post = (body: string, headers: Record<string, string> = {}) =>
  POST(
    new Request("https://studio-cue.com/api/client-errors", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": `203.0.113.${++address}`, ...headers },
      body,
    }),
  );

async function captureConsoleError(run: () => Promise<Response>) {
  const lines: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    const response = await run();
    return { response, lines };
  } finally {
    console.error = original;
  }
}

test("emails, query strings, fragments and link tokens are scrubbed", () => {
  assert.equal(
    scrubClientErrorText("No contact for jane.doe+wed@example.co.uk on /studio/jobs?project=p1&email=a@b.com"),
    "No contact for [email] on /studio/jobs",
  );
  assert.equal(
    scrubClientErrorText("at render (https://studio-cue.com/_next/static/chunks/app-4f9a2b.js?v=3:1:2345)"),
    "at render (https://studio-cue.com/_next/static/chunks/app-4f9a2b.js)",
  );
  assert.equal(scrubClientErrorText("https://studio-cue.com/i/Xk29fLq0aZ8bN7cV6dM5eR4#top"), "https://studio-cue.com/i/[token]");
  assert.equal(scrubClientErrorText("token eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJl"), "token [token]");
  // A long readable slug is a route, not a token.
  assert.equal(scrubClientErrorText("/studio/integration-diagnostics-overview"), "/studio/integration-diagnostics-overview");
});

test("the route is the pathname alone", () => {
  assert.equal(scrubRoute("/studio/jobs?project=abc&email=a@b.com"), "/studio/jobs");
  assert.equal(scrubRoute("https://studio-cue.com/client/proposal#sign"), "/client/proposal");
  assert.equal(scrubRoute("/d/9f8e7d6c5b4a39281706f5e4"), "/d/[token]");
  assert.equal(scrubRoute(""), "/");
});

test("reports are bounded, unknown fields dropped, empty ones refused", () => {
  const report = sanitizeClientErrorReport({
    message: "x".repeat(5000),
    name: "TypeError",
    stack: "y".repeat(20_000),
    route: "/studio",
    userAgent: "z".repeat(1000),
    email: "jane@example.com",
    cookies: "session=1",
  });
  assert.ok(report);
  assert.equal(report.message.length, 1000);
  assert.equal(report.stack.length, 4000);
  assert.equal(report.userAgent.length, 300);
  assert.deepEqual(Object.keys(report).sort(), ["message", "name", "route", "stack", "userAgent"]);
  assert.equal(sanitizeClientErrorReport({ name: "Error" }), null);
  assert.equal(sanitizeClientErrorReport([1, 2]), null);
  assert.equal(sanitizeClientErrorReport("boom"), null);
});

test("a good report logs one ERROR line, scrubbed, and answers 204", async () => {
  const { response, lines } = await captureConsoleError(() =>
    post(
      JSON.stringify({
        message: "Cannot read 'name' of undefined for jane@example.com",
        name: "TypeError",
        stack: "TypeError: boom\n    at x (https://studio-cue.com/_next/static/chunks/a.js?q=jane@example.com:1:2)",
        route: "/studio/jobs?project=abc",
        userAgent: "Mozilla/5.0",
      }),
    ),
  );
  assert.equal(response.status, 204);
  assert.equal(lines.length, 1);
  const entry = JSON.parse(lines[0]!) as Record<string, unknown> & { error: Record<string, string> };
  assert.equal(entry.severity, "ERROR");
  assert.equal(entry.message, "client_error");
  assert.equal(entry.route, "/studio/jobs");
  assert.doesNotMatch(lines[0]!, /jane@example\.com|project=abc|\?q=/);
  assert.match(entry.error.message, /\[email\]/);
  assert.doesNotMatch(lines[0]!, /203\.0\.113/);
});

test("oversized, malformed and empty bodies are refused without logging", async () => {
  const big = JSON.stringify({ message: "m", stack: "s".repeat(17 * 1024) });
  const tooBig = await captureConsoleError(() => post(big));
  assert.equal(tooBig.response.status, 413);
  assert.equal(tooBig.lines.length, 0);
  const declared = await captureConsoleError(() => post("{}", { "content-length": "999999" }));
  assert.equal(declared.response.status, 413);
  const malformed = await captureConsoleError(() => post("not json"));
  assert.equal(malformed.response.status, 400);
  const empty = await captureConsoleError(() => post(JSON.stringify({ name: "Error" })));
  assert.equal(empty.response.status, 400);
  assert.equal(malformed.lines.length + empty.lines.length, 0);
});

test("one address is rate limited", async () => {
  const headers = { "x-forwarded-for": "198.51.100.7" };
  const body = JSON.stringify({ message: "boom" });
  const statuses: number[] = [];
  await captureConsoleError(async () => {
    for (let index = 0; index < 25; index += 1) statuses.push((await post(body, headers)).status);
    return new Response(null);
  });
  assert.equal(statuses.filter((status) => status === 204).length, 20);
  assert.equal(statuses.at(-1), 429);
});

test("the reporter posts without a DSN, de-duplicated and capped; error.tsx reports", () => {
  const reporter = readFileSync("components/observability/error-reporter.tsx", "utf8");
  assert.match(reporter, /fetch\("\/api\/client-errors"/);
  assert.match(reporter, /MAX_REPORTS_PER_PAGE_LOAD = 5/);
  assert.match(reporter, /reported\.has\(key\)/);
  assert.match(reporter, /NEXT_PUBLIC_SENTRY_DSN/);
  assert.match(reporter, /window\.location\.pathname/);
  for (const page of ["app/error.tsx", "app/global-error.tsx"]) {
    const source = readFileSync(page, "utf8");
    assert.match(source, /^"use client";/, page);
    assert.match(source, /reportClientError\(error\)/, page);
    assert.match(source, /onClick=\{reset\}/, page);
  }
  for (const page of ["components/observability/status-page.tsx", "app/global-error.tsx"]) {
    const source = readFileSync(page, "utf8");
    assert.match(source, /href="\/support"/, page);
    assert.match(source, /mailto:support@studio-cue\.com/, page);
  }
  assert.match(readFileSync("app/not-found.tsx", "utf8"), /StatusPage/);
  // The status pages must not pull the app's stylesheets onto every page.
  for (const page of ["app/not-found.tsx", "app/error.tsx", "app/global-error.tsx", "components/observability/status-page.tsx"])
    assert.doesNotMatch(readFileSync(page, "utf8"), /import\s+["'][^"']*(?:app-styles|\.css)["']/, page);
});
