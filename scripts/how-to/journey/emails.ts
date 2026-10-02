/**
 * The emails a journey film shows, as the email worker rendered them.
 *
 * In mock delivery the worker writes each rendered email to HOW_TO_EMAIL_DIR
 * (functions/src/operations/jobs.ts, captureForHowTo). The story sets that
 * directory and drains the email queue itself, because the emulator never
 * runs the scheduler or the task queue that would otherwise send them.
 */
import { mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { HOW_TO_HOME } from "../lib/voice";

export const EMAIL_DIR = path.join(HOW_TO_HOME, "journey-emails");

export type CapturedEmail = { jobId: string; type: string; to: string; from: string; subject: string; html: string };

export function clearEmails() {
  rmSync(EMAIL_DIR, { recursive: true, force: true });
  mkdirSync(EMAIL_DIR, { recursive: true });
}

export function capturedEmails(): CapturedEmail[] {
  let files: string[] = [];
  try {
    files = readdirSync(EMAIL_DIR).filter((f) => f.endsWith(".json")).sort();
  } catch {
    return [];
  }
  return files.map((f) => JSON.parse(readFileSync(path.join(EMAIL_DIR, f), "utf8")) as CapturedEmail);
}

/** The newest email whose subject matches, optionally to one address. */
export function latestEmail(subject: RegExp, to?: string): CapturedEmail | null {
  return (
    capturedEmails()
      .reverse()
      .find((email) => subject.test(email.subject) && (!to || email.to.toLowerCase() === to.toLowerCase())) ?? null
  );
}
