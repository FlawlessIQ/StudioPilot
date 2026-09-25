"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { FileInput, LoaderCircle, Save } from "lucide-react";
import { ContractDocumentView } from "@/components/contracts/contract-document-view";
import { useNativeSigning } from "@/components/contracts/use-native-signing";
import { useTenantDocuments } from "@/components/live/tenant-records";
import {
  contractMergeFields,
  customFieldKey,
  resolveContractDocument,
  templateFieldKeys,
  type ContractCustomField,
} from "@/features/contracts/document";
import { STUDIO_SIGNING_STATEMENT } from "@/features/contracts/esign-consent";
import { sampleContractSources, STARTER_AGREEMENT } from "@/features/contracts/sample";
import { normaliseTypedName } from "@/features/contracts/signing-policy";
import { useWorkspace } from "@/features/auth/workspace-context";
import { friendlyError } from "@/lib/ai/friendly-error";
import {
  agreementDraftFromImport,
  saveAgreementTemplate,
  setContractAutoSend,
} from "@/lib/contracts/command-client";
import { getFirebaseClient } from "@/lib/firebase/client";
import { dataIsLive } from "@/lib/runtime-mode";

type Loaded = {
  templateId: string | null;
  name: string;
  title: string;
  body: string;
  customFields: ContractCustomField[];
  version: number | null;
};

/**
 * The studio's agreement: the text StudioCue writes every contract from.
 *
 * The editor is a textarea because the agreement is the studio's own legal
 * wording and should be edited as text, beside a live preview filled with
 * stand-in details. `{{field}}` tokens are where the couple's details go;
 * anything StudioCue can't fill from records becomes a named field the studio
 * fills per contract.
 *
 * An imported agreement is brought in as a draft — placeholders mapped,
 * paper signature lines dropped — and only becomes the studio's agreement
 * when they save it.
 */
export function AgreementEditor() {
  const workspace = useWorkspace();
  const [generation, setGeneration] = useState(0);
  const native = useNativeSigning(generation);
  const { records: templates } = useTenantDocuments("agreementTemplates", {
    enabled: native.enabled,
  });
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoSendOn, setAutoSendOn] = useState<boolean | null>(null);
  const [autoSendName, setAutoSendName] = useState("");
  const [autoSendConsent, setAutoSendConsent] = useState(false);
  const textarea = useRef<HTMLTextAreaElement | null>(null);

  const importedTemplates = (templates ?? []).filter(
    (template) => String(template.id).startsWith("imported_agreement_") && template.body,
  );

  // Load the saved agreement, once the default is known.
  useEffect(() => {
    if (native.loading || loaded) return;
    let active = true;
    void (async () => {
      let next: Loaded = {
        templateId: null,
        name: "Wedding agreement",
        title: "Photography Services Agreement",
        body: STARTER_AGREEMENT,
        customFields: [],
        version: null,
      };
      if (dataIsLive && native.agreementTemplateId) {
        try {
          const { firestore } = getFirebaseClient();
          const head = await getDoc(doc(firestore, "agreementTemplates", native.agreementTemplateId));
          const versionId = head.exists() ? String(head.get("currentVersionId") ?? "") : "";
          const version = versionId
            ? await getDoc(doc(firestore, "agreementTemplateVersions", versionId))
            : null;
          if (head.exists() && version?.exists()) {
            next = {
              templateId: head.id,
              name: String(head.get("name") ?? "Agreement"),
              title: String(version.get("title") ?? "Agreement"),
              body: String(version.get("body") ?? ""),
              customFields: (version.get("customFields") as ContractCustomField[] | undefined) ?? [],
              version: Number(version.get("version") ?? 1),
            };
          }
        } catch {
          // Fall through to the starter; the studio can still write one.
        }
      }
      if (!active) return;
      setLoaded(next);
      setName(next.name);
      setTitle(next.title);
      setBody(next.body);
      setLabels(Object.fromEntries(next.customFields.map((field) => [field.key, field.label])));
    })();
    return () => {
      active = false;
    };
  }, [loaded, native.agreementTemplateId, native.loading]);

  const customFields: ContractCustomField[] = useMemo(
    () =>
      templateFieldKeys(body)
        .filter((key) => key.startsWith("custom."))
        .map((key) => ({
          key,
          label: labels[key]?.trim() || key.replace(/^custom\./, "").replace(/_/g, " "),
        })),
    [body, labels],
  );

  const preview = useMemo(
    () =>
      resolveContractDocument({
        template: { title: title || "Agreement", body, customFields },
        sources: sampleContractSources(workspace.tenantName, new Date().toISOString().slice(0, 10)),
        overrides: Object.fromEntries(customFields.map((field) => [field.key, `(${field.label})`])),
      }),
    [body, customFields, title, workspace.tenantName],
  );

  function insert(token: string) {
    const element = textarea.current;
    const text = `{{${token}}}`;
    if (!element) {
      setBody((current) => `${current}${text}`);
      return;
    }
    const start = element.selectionStart ?? body.length;
    const end = element.selectionEnd ?? body.length;
    const next = `${body.slice(0, start)}${text}${body.slice(end)}`;
    setBody(next);
    queueMicrotask(() => {
      element.focus();
      element.setSelectionRange(start + text.length, start + text.length);
    });
  }

  function addCustomField() {
    const label = window.prompt("What should this field be called? (e.g. Second location)");
    if (!label?.trim()) return;
    const key = customFieldKey(label);
    setLabels((current) => ({ ...current, [key]: label.trim() }));
    insert(key);
  }

  async function importAgreement(templateId: string) {
    setBusy("import");
    setError(null);
    try {
      const draft = await agreementDraftFromImport(templateId);
      if (!draft) {
        setError("Development preview: the import could not be read.");
        return;
      }
      setName(draft.name);
      // The agreement's own title, or its name — never the starter's.
      setTitle(draft.title ?? draft.name);
      setBody(draft.body);
      setLabels(Object.fromEntries(draft.customFields.map((field) => [field.key, field.label])));
      setLoaded((current) => (current ? { ...current, templateId: draft.templateId } : current));
      const mapped = draft.mapped.filter((entry) => !entry.key.startsWith("custom.")).length;
      setNotice(
        [
          `Brought in "${draft.name}".`,
          mapped ? `${mapped} placeholder${mapped === 1 ? "" : "s"} now fill themselves from the job.` : null,
          draft.customFields.length
            ? `${draft.customFields.length} you'll fill per contract.`
            : null,
          draft.signatureLinesRemoved
            ? `${draft.signatureLinesRemoved} paper signature line${draft.signatureLinesRemoved === 1 ? "" : "s"} removed — StudioCue adds the signatures.`
            : null,
          draft.clausesRestored
            ? `It arrived as one block of text, so it was split back into its ${draft.clausesRestored} clauses.`
            : null,
          draft.detailsAdded
            ? "It had no place for the couple's names, the date or the price, so a details section was added at the top — filled from each job."
            : null,
          "Read it through, then save.",
        ]
          .filter(Boolean)
          .join(" "),
      );
    } catch (caught: unknown) {
      setError(friendlyError(caught, "The imported agreement couldn't be read."));
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setBusy("save");
    setError(null);
    setNotice(null);
    try {
      const result = await saveAgreementTemplate({
        templateId: loaded?.templateId ?? null,
        name: name.trim() || "Agreement",
        title: title.trim() || "Agreement",
        body,
        customFields,
        makeDefault: true,
      });
      if (result.mode === "preview") {
        setNotice("Development preview: the agreement was not saved.");
        return;
      }
      const payload = result.payload as { templateId: string; version: number };
      setLoaded((current) =>
        current ? { ...current, templateId: payload.templateId, version: payload.version } : current,
      );
      setGeneration((current) => current + 1);
      setNotice(
        `Saved as version ${payload.version}. New contracts are written from it; contracts already sent keep the version they were sent with.`,
      );
    } catch (caught: unknown) {
      setError(friendlyError(caught, "The agreement couldn't be saved."));
    } finally {
      setBusy(null);
    }
  }

  async function saveAutoSend(enabled: boolean) {
    setBusy("autosend");
    setError(null);
    try {
      const result = await setContractAutoSend({
        enabled,
        signerName: enabled ? autoSendName.trim() : null,
        consent: enabled ? autoSendConsent : false,
      });
      if (result.mode === "preview") {
        setNotice("Development preview: the setting was not saved.");
        return;
      }
      setAutoSendOn(enabled);
      setGeneration((current) => current + 1);
      setNotice(
        enabled
          ? "On. When a couple accepts a proposal, StudioCue signs for you and sends the contract — unless something in it needs filling in."
          : "Off. Accepted proposals get a contract ready for you to read and send.",
      );
    } catch (caught: unknown) {
      setError(friendlyError(caught, "The setting couldn't be saved."));
    } finally {
      setBusy(null);
    }
  }

  if (native.loading || (!loaded && native.enabled)) {
    return (
      <p className="native-contract-note">
        <LoaderCircle className="spin" aria-hidden size={15} /> Loading your agreement…
      </p>
    );
  }

  if (!native.enabled) {
    return (
      <section className="panel">
        <p className="eyebrow">Not switched on yet</p>
        <h2>Contracts written and signed in StudioCue</h2>
        <p>
          This isn&rsquo;t switched on for your studio yet. Until it is, send your agreement the way you
          do today and record the signature on the job.
        </p>
      </section>
    );
  }

  const autoSendEnabled = autoSendOn ?? native.autoSend.enabled;
  const tokensUsed = new Set(templateFieldKeys(body));

  return (
    <div className="agreement-editor">
      {importedTemplates.length && !loaded?.version ? (
        <section className="panel">
          <p className="eyebrow">From your import</p>
          <h2>Start from the agreement you already use</h2>
          <p>
            StudioCue maps its placeholders to the job&rsquo;s details and removes the paper signature
            lines. Nothing is saved until you save.
          </p>
          <div className="agreement-editor-actions">
            {importedTemplates.map((template) => (
              <button
                className="button button-dark"
                disabled={busy !== null}
                key={template.id}
                onClick={() => void importAgreement(template.id)}
                type="button"
              >
                <FileInput aria-hidden size={15} />
                {busy === "import" ? "Bringing it in…" : `Use “${String(template.name ?? "Imported agreement")}”`}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {notice ? <p className="agreement-editor-notice" role="status">{notice}</p> : null}
      {error ? <p className="client-contract-error" role="alert">{error}</p> : null}

      <div className="agreement-editor-grid">
        <section className="panel">
          <div className="agreement-editor-meta">
            <label>
              Name (only you see this)
              <input maxLength={120} onChange={(event) => setName(event.target.value)} type="text" value={name} />
            </label>
            <label>
              Title on the contract
              <input maxLength={200} onChange={(event) => setTitle(event.target.value)} type="text" value={title} />
            </label>
          </div>
          <p className="native-contract-note">
            Insert a detail StudioCue fills from the job. Money and dates always come from the accepted
            proposal.
          </p>
          <div className="agreement-field-picker" aria-label="Insert a detail">
            {contractMergeFields.map((field) => (
              <button
                aria-pressed={tokensUsed.has(field.key)}
                key={field.key}
                onClick={() => insert(field.key)}
                title={`e.g. ${field.example}`}
                type="button"
              >
                {field.label}
              </button>
            ))}
            <button onClick={addCustomField} type="button">
              + Your own field
            </button>
          </div>
          <label>
            Your agreement
            <textarea
              onChange={(event) => setBody(event.target.value)}
              ref={textarea}
              spellCheck
              value={body}
            />
          </label>
          <p className="native-contract-note">
            <code>#</code> or <code>##</code> starts a heading, <code>-</code> a bullet, <code>**bold**</code>{" "}
            makes text bold. Put <code>{"{{payment.schedule}}"}</code> or{" "}
            <code>{"{{package.deliverables}}"}</code> on a line of its own for a table or a list.
          </p>
          {customFields.length ? (
            <div className="agreement-custom-fields">
              <p className="native-contract-note">Your own fields — filled in on each contract:</p>
              {customFields.map((field) => (
                <label className="agreement-custom-field" key={field.key}>
                  <code>{`{{${field.key}}}`}</code>
                  <input
                    maxLength={80}
                    onChange={(event) =>
                      setLabels((current) => ({ ...current, [field.key]: event.target.value }))
                    }
                    type="text"
                    value={labels[field.key] ?? field.label}
                  />
                </label>
              ))}
            </div>
          ) : null}
          <div className="agreement-editor-actions">
            <button
              className="button button-dark"
              disabled={busy !== null || body.trim().length < 50}
              onClick={() => void save()}
              type="button"
            >
              {busy === "save" ? <LoaderCircle className="spin" aria-hidden size={15} /> : <Save aria-hidden size={15} />}
              {busy === "save" ? "Saving…" : loaded?.version ? "Save a new version" : "Save your agreement"}
            </button>
            {loaded?.version ? (
              <span className="native-contract-note">Current version: {loaded.version}</span>
            ) : null}
          </div>
        </section>

        <section className="panel agreement-editor-preview" aria-label="Preview">
          <p className="eyebrow">Preview with sample details</p>
          <div className="contract-sheet">
            <ContractDocumentView document={preview.document} showFields />
          </div>
        </section>
      </div>

      <section className="panel">
        <p className="eyebrow">When a proposal is accepted</p>
        <h2>{autoSendEnabled ? "StudioCue signs and sends for you" : "StudioCue prepares it for you to send"}</h2>
        <p>
          A contract is always written from this agreement the moment a couple accepts. By default it
          waits for you to read it and sign. You can let StudioCue sign with your name and send it
          straight away instead — any contract with a detail to fill in still waits for you.
        </p>
        {autoSendEnabled ? (
          <div className="agreement-editor-actions">
            <span className="native-contract-note">
              Signing as {native.autoSend.signerName ?? autoSendName}.
            </span>
            <button className="button button-light" disabled={busy !== null} onClick={() => void saveAutoSend(false)} type="button">
              Turn off
            </button>
          </div>
        ) : (
          <div className="native-contract-send">
            <label>
              Your full name, as it will appear on every contract sent for you
              <input
                maxLength={160}
                onChange={(event) => setAutoSendName(event.target.value)}
                type="text"
                value={autoSendName}
              />
            </label>
            <label className="native-contract-consent">
              <input checked={autoSendConsent} onChange={(event) => setAutoSendConsent(event.target.checked)} type="checkbox" />
              <span>
                {`${STUDIO_SIGNING_STATEMENT} StudioCue may apply it for me to each contract sent when a proposal is accepted.`}
              </span>
            </label>
            <div className="agreement-editor-actions">
              <button
                className="button button-dark"
                disabled={busy !== null || !autoSendConsent || !normaliseTypedName(autoSendName)}
                onClick={() => void saveAutoSend(true)}
                type="button"
              >
                Sign and send automatically
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
