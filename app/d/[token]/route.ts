import { adminFirestore } from "@/server/firebase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A couple opening their delivery: stamp "viewed", then go to it.
 *
 * `viewed` was never written, and neither was "Couple opened it", so closeout
 * could only pass on a download the studio typed in or an attestation (D6 of
 * docs/delivery-plan-2026-09-28.md). Every link the couple is sent — email and
 * portal — goes through here first.
 *
 * Not an open redirect: the token finds one delivery record and the only place
 * it can send anyone is that record's own stored link. An unknown token goes to
 * StudioCue's home page.
 *
 * Mail scanners and link previews fetch links too. Only a browser navigation
 * (`Sec-Fetch-Mode: navigate`) counts as the couple opening it; anything else
 * is redirected without being recorded.
 */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await params;
  const home = (process.env.NEXT_PUBLIC_APP_URL ?? "https://studio-cue.com").replace(/\/$/, "");
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return Response.redirect(home, 302);

  const matches = await adminFirestore
    .collection("deliveryRecords")
    .where("viewToken", "==", token)
    .limit(1)
    .get();
  const delivery = matches.docs[0];
  const target = typeof delivery?.get("galleryUrl") === "string" ? String(delivery.get("galleryUrl")) : "";
  if (!delivery || !target.startsWith("https://") || ["revoked"].includes(String(delivery.get("status")))) {
    return Response.redirect(home, 302);
  }

  const navigation =
    request.headers.get("sec-fetch-mode") === "navigate" || request.headers.get("sec-fetch-dest") === "document";
  if (navigation && !delivery.get("viewedAt")) {
    const now = new Date().toISOString();
    const projectId = String(delivery.get("projectId") ?? "");
    try {
      await adminFirestore.runTransaction(async (transaction) => {
        const productionRef = adminFirestore.doc(`postProductionRecords/${projectId}`);
        const [current, production] = await Promise.all([
          transaction.get(delivery.ref),
          projectId ? transaction.get(productionRef) : Promise.resolve(null),
        ]);
        if (!current.exists || current.get("viewedAt")) return;
        transaction.update(delivery.ref, {
          viewedAt: now,
          // "downloaded" is stronger and stays; only a plain "sent" moves.
          ...(current.get("status") === "sent" ? { status: "viewed" } : {}),
          updatedAt: now,
          updatedBy: "delivery-view-link",
        });
        const steps = (production?.get("steps") ?? {}) as Record<string, { complete?: boolean } | undefined>;
        if (production?.exists && production.get("tenantId") === current.get("tenantId") && steps.client_downloaded?.complete !== true) {
          transaction.update(productionRef, {
            "steps.client_downloaded": {
              complete: true,
              completedAt: now,
              completedBy: "delivery-view-link",
              evidenceId: current.id,
              notes: null,
            },
            updatedAt: now,
            updatedBy: "delivery-view-link",
          });
        }
      });
    } catch {
      // Recording the view must never stand between a couple and their photos.
    }
  }
  return Response.redirect(target, 302);
}
