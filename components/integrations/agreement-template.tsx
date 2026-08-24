"use client";

import { useEffect, useState } from "react";
import {
  CheckCircle2,
  FileSignature,
  LoaderCircle,
  TriangleAlert,
} from "lucide-react";
import { useWorkspace } from "@/features/auth/workspace-context";
import { useTenantDocuments } from "@/components/live/tenant-records";
import {
  listSigningTemplates,
  setContractTemplate,
  type SigningTemplate,
} from "@/lib/integrations/command-client";

/**
 * The studio's default agreement, chosen by name.
 *
 * Sending a contract needs a Dropbox Sign template id. The booking
 * workspace read a studio default from
 * `tenants/{id}.defaultContractSettings.templateId` and told people to set
 * it "in Settings → Integrations" — but nothing in the product could write
 * that field, and no screen offered it. The only way through was to find a
 * GUID in Dropbox Sign and paste it into a text box on every project, which
 * is why a booked job could sit at an accepted proposal with no way to send
 * the agreement.
 *
 * The setup checklist reads the same field, so its "agreement" step could
 * never be completed either.
 */
export function AgreementTemplate() {
  const workspace = useWorkspace();
  const tenantId = workspace.tenantId;
  const { records: tenants } = useTenantDocuments("tenants");
  const tenant = tenants?.find((entry) => entry.id === tenantId);
  const saved =
    (tenant?.defaultContractSettings as
      { templateId?: string; templateName?: string } | undefined) ?? {};

  const [templates, setTemplates] = useState<SigningTemplate[] | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "unavailable">(
    "loading",
  );
  const [reason, setReason] = useState<string | null>(null);
  // Derived, not stored: the saved default arrives asynchronously with the
  // tenant document, and copying it into state from an effect is how you
  // get a cascading render and a picker that flickers back to "no default".
  // An override only exists once someone has chosen something.
  const [override, setOverride] = useState<string | null>(null);
  const choice = override ?? saved.templateId ?? "";
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    // The whole fetch lives in the effect, and every setState happens after
    // an await: calling one synchronously here is a cascading render, and
    // the `active` guard keeps a slow response from landing on a component
    // whose tenant has since changed.
    let active = true;
    void (async () => {
      try {
        const result = await listSigningTemplates(tenantId);
        if (!active) return;
        if (!result.listable) {
          setState("unavailable");
          setReason(result.unavailable ?? "NOT_LISTABLE");
          return;
        }
        setTemplates(result.templates);
        setState("ready");
      } catch (caught: unknown) {
        if (!active) return;
        setState("unavailable");
        setReason(caught instanceof Error ? caught.message : "LOAD_FAILED");
      }
    })();
    return () => {
      active = false;
    };
  }, [tenantId]);

  async function save(templateId: string) {
    if (!tenantId) return;
    setSaving(true);
    setNotice(null);
    try {
      const picked = templates?.find((template) => template.id === templateId);
      const response = await setContractTemplate(
        {
          templateId: templateId || null,
          templateName: picked?.name ?? null,
        },
        tenantId,
      );
      setOverride(templateId);
      setNotice(
        !response.persisted
          ? "Development preview: the choice was not saved."
          : templateId
            ? "Saved. New contracts use this agreement unless a project overrides it."
            : "Cleared. Each project will ask for a template.",
      );
    } catch (caught: unknown) {
      setNotice(
        caught instanceof Error
          ? caught.message
          : "The agreement template could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="integration-routing agreement-template">
      <header>
        <h2>Agreement template</h2>
        <p>
          The agreement StudioCue sends for signature. Choose it once and every
          booking uses it; a project can still override it.
        </p>
      </header>

      {state === "loading" ? (
        <p className="agreement-template-state">
          <LoaderCircle className="spin" size={15} /> Loading your templates…
        </p>
      ) : state === "unavailable" ? (
        <p className="agreement-template-state is-attention">
          <TriangleAlert size={15} />
          {reason === "PREVIEW_MODE"
            ? "Connect a signing provider to choose an agreement."
            : reason?.startsWith("SIGNING_")
              ? "Nothing is connected to send agreements for signature yet. Connect Dropbox Sign above."
              : "Your templates could not be loaded. Check the Dropbox Sign connection above."}
        </p>
      ) : templates && templates.length === 0 ? (
        <p className="agreement-template-state is-attention">
          <TriangleAlert size={15} />
          Dropbox Sign has no templates yet. Create one there, then reload this
          page.
        </p>
      ) : (
        <div className="agreement-template-picker">
          <label>
            Default agreement
            <select
              disabled={saving}
              onChange={(event) => void save(event.target.value)}
              value={choice}
            >
              <option value="">No default — ask on every project</option>
              {templates?.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
          </label>
          {choice ? (
            <span className="agreement-template-current">
              <CheckCircle2 size={15} />
              {templates?.find((template) => template.id === choice)?.name ??
                saved.templateName ??
                choice}
            </span>
          ) : (
            <span className="agreement-template-current is-muted">
              <FileSignature size={15} />
              Not set
            </span>
          )}
        </div>
      )}

      {notice ? (
        <p className="form-notice" role="status">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
