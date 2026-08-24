import { getFirestore } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import {
  requireAppCheckOrAppHostingProxy,
  requireIdentity,
} from "../crm/security.js";
import { studioHubCors } from "../security/cors.js";
import { connection } from "../operations/provider-runtime.js";
import { requireProviderForTenant } from "./capability-resolution.js";

/**
 * The studio's agreement templates, by name.
 *
 * Sending a contract needs a Dropbox Sign template id, and until now the
 * only way to supply one was to find the GUID in Dropbox Sign and paste it
 * into a text box on every project. The studio default it offered instead —
 * `tenants/{id}.defaultContractSettings.templateId` — was read in two
 * places and written in none, so the "set the studio default in Settings"
 * advice went nowhere and the whole booking chain stopped at a blank field.
 *
 * This is the missing half: ask the provider what templates exist so a
 * person can choose one by its name.
 *
 * A query rather than a command — it reads from a provider and caches
 * nothing, so the idempotency machinery in integrationsCommand would be
 * actively wrong here (a cached "list" is a stale list).
 */
const requestSchema = z.object({ tenantId: z.string().min(1) });

const allowedRoles = ["studio_owner", "studio_admin"];

/** What the provider is asked for at most; a studio has a handful. */
const PAGE_SIZE = 50;

export const signingTemplatesQuery = onRequest(
  { cors: studioHubCors, invoker: "private" },
  async (request, response) => {
    if (request.method !== "POST") {
      response.status(405).json({ error: "METHOD_NOT_ALLOWED" });
      return;
    }

    let identity;
    try {
      await requireAppCheckOrAppHostingProxy(request);
      identity = await requireIdentity(request);
    } catch {
      response.status(401).json({ error: "AUTHENTICATION_REQUIRED" });
      return;
    }

    const parsed = requestSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "INVALID_REQUEST" });
      return;
    }
    const { tenantId } = parsed.data;

    const db = getFirestore();
    const membership = await db
      .doc(`memberships/${tenantId}_${identity.uid}`)
      .get();
    const membershipData = membership.data() as
      | { role: string; status: string }
      | undefined;
    if (
      !membershipData ||
      membershipData.status !== "active" ||
      !allowedRoles.includes(membershipData.role)
    ) {
      response.status(403).json({ error: "FORBIDDEN" });
      return;
    }

    try {
      // Throws `SIGNING_<REASON>` when nothing usable serves signing, which
      // is a different answer from "connected but has no templates" and the
      // UI says so differently.
      const provider = await requireProviderForTenant(db, tenantId, "signing");
      if (provider !== "dropbox_sign") {
        response
          .status(200)
          .json({ provider, templates: [], listable: false });
        return;
      }

      const link = await connection(tenantId, "dropbox_sign");
      if (link.mock) {
        response.status(200).json({
          provider,
          listable: true,
          templates: [
            { id: "mock-template-wedding", name: "Wedding agreement (mock)" },
            { id: "mock-template-portrait", name: "Portrait agreement (mock)" },
          ],
        });
        return;
      }

      const result = await fetch(
        `https://api.hellosign.com/v3/template/list?page=1&page_size=${PAGE_SIZE}`,
        {
          headers: {
            authorization: `Bearer ${link.credential?.accessToken ?? ""}`,
          },
        },
      );
      if (!result.ok) {
        console.error(
          JSON.stringify({
            severity: "ERROR",
            event: "integration.signing_templates_failed",
            provider,
            status: result.status,
            detail: (await result.text()).slice(0, 300),
          }),
        );
        response
          .status(502)
          .json({ error: "SIGNING_TEMPLATE_LIST_FAILED" });
        return;
      }
      const body = (await result.json()) as {
        templates?: Array<{ template_id?: string; title?: string }>;
      };
      const templates = (body.templates ?? [])
        .map((template) => ({
          id: String(template.template_id ?? ""),
          // Dropbox Sign allows an untitled template; showing an empty row
          // would be worse than showing the id.
          name: String(template.title ?? "").trim() ||
            String(template.template_id ?? "Untitled template"),
        }))
        .filter((template) => template.id);

      response.status(200).json({ provider, listable: true, templates });
    } catch (caught: unknown) {
      const message =
        caught instanceof Error ? caught.message : "SIGNING_TEMPLATES_FAILED";
      response.status(200).json({
        provider: null,
        listable: false,
        templates: [],
        unavailable: message,
      });
    }
  },
);
