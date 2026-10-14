import { createHash, randomBytes } from "node:crypto";
import type { DocumentSnapshot, Firestore } from "firebase-admin/firestore";
import { holderMatches } from "../operations/certificate-review.js";

/**
 * What a studio that makes its own certificates gets instead of an agent
 * (self-serve kit, 2026-10-14): an address on the job its insurer's email can
 * go to, and the certificate it already sent a venue, re-sent when it still
 * covers the date.
 */

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

/**
 * The job's own address for its certificate. Only the hash finds the request
 * (planning/inbound.ts); the address itself is kept on the request so the
 * studio can paste it into its insurer's form, as the agent's email carries
 * it. Null when inbound mail isn't configured: the upload still works.
 */
export function selfServeInbox(): { address: string; tokenHash: string } | null {
  const domain = process.env.SENDGRID_INBOUND_DOMAIN;
  if (!domain) return null;
  const token = randomBytes(32).toString("base64url");
  return { address: `coi+${token}@${domain}`, tokenHash: hash(token) };
}

/**
 * Whether a certificate already sent to this venue covers a new date: it
 * names no event date of its own and the policy on it runs past the new date.
 * A copy of features/insurance/certificate-kit.ts `certificateCovers`;
 * tests/coi-self-serve.test.ts keeps them equal.
 */
export function certificateCovers(input: {
  extractedEventDate?: unknown;
  policyExpirationDate?: unknown;
  eventDate: string;
}): boolean {
  if (typeof input.extractedEventDate === "string" && input.extractedEventDate.trim()) return false;
  const ends = typeof input.policyExpirationDate === "string" ? input.policyExpirationDate.slice(0, 10) : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ends)) return false;
  return ends >= input.eventDate.slice(0, 10);
}

const SENT = ["sent_to_venue", "venue_acknowledged"];

/**
 * The most recent certificate sent to this venue that still covers the new
 * event, with the holder the venue asks for. Repeat venues are most of a
 * wedding photographer's year; the second wedding there needs no new
 * certificate at all if the first one wasn't dated to its own event.
 */
export async function findReusableCertificate(
  db: Firestore,
  input: { tenantId: string; venueKeys: string[]; certificateHolder: string; eventDate: string; projectId: string },
): Promise<DocumentSnapshot | null> {
  if (!input.venueKeys.length) return null;
  const requirements = (
    await Promise.all(
      input.venueKeys.map((key) =>
        db.collection("insuranceRequirements").where("tenantId", "==", input.tenantId).where("venueKey", "==", key).limit(10).get(),
      ),
    )
  ).flatMap((snapshot) => snapshot.docs);
  const candidates: DocumentSnapshot[] = [];
  for (const requirement of requirements) {
    if (text(requirement.get("projectId")) === input.projectId) continue;
    const requests = await db
      .collection("insuranceRequests")
      .where("tenantId", "==", input.tenantId)
      .where("requirementId", "==", requirement.id)
      .limit(3)
      .get();
    for (const request of requests.docs) {
      const extracted = (request.get("extractedData") ?? {}) as Record<string, unknown>;
      if (
        SENT.includes(text(request.get("status"))) &&
        text(request.get("temporaryObject")).startsWith("gs://") &&
        holderMatches(input.certificateHolder, extracted.certificateHolder) &&
        certificateCovers({
          extractedEventDate: extracted.eventDate,
          policyExpirationDate: extracted.policyExpirationDate,
          eventDate: input.eventDate,
        })
      ) {
        candidates.push(request);
      }
    }
  }
  candidates.sort((left, right) => text(right.get("sentToVenueAt")).localeCompare(text(left.get("sentToVenueAt"))));
  return candidates[0] ?? null;
}
