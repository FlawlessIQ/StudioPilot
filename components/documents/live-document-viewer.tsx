"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ExternalLink, FileText } from "lucide-react";
import { doc, getDoc } from "firebase/firestore";
import { getDownloadURL, getStorage, ref } from "firebase/storage";
import { useWorkspace } from "@/features/auth/workspace-context";
import { getFirebaseClient } from "@/lib/firebase/client";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDueDate } from "@/lib/format/event-date";
import { statusLabel } from "@/features/format/status-label";

type DocRecord = Record<string, unknown> & { id: string };

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

/**
 * A studio document, opened.
 *
 * The Documents list rendered every file as a non-clickable row — there was no
 * way to actually open one. Files live in cloud storage under `storagePath`
 * (or `providerFileId`), which is a path, not a URL, so opening one means
 * resolving a download URL first. Provider-delivered files instead carry a
 * ready `downloadUrl`. This resolves whichever is present and gives one clear
 * way to open the file, with the metadata beside it.
 */
export function LiveDocumentViewer({ id }: { id: string }) {
  const workspace = useWorkspace();
  const [record, setRecord] = useState<DocRecord | null | undefined>(undefined);
  const [url, setUrl] = useState<string | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);

  useEffect(() => {
    if (workspace.loading) return;
    let active = true;
    void (async () => {
      const { app, firestore } = getFirebaseClient();
      const snapshot = await getDoc(doc(firestore, "documents", id));
      if (!active) return;
      if (!snapshot.exists() || snapshot.get("tenantId") !== workspace.tenantId) {
        setRecord(null);
        return;
      }
      const data = { id: snapshot.id, ...snapshot.data() } as DocRecord;
      setRecord(data);
      // A provider-delivered file already has a URL; a stored file has a path.
      const direct = str(data.downloadUrl) ?? str(data.url) ?? str(data.fileUrl);
      if (direct) {
        setUrl(direct);
        return;
      }
      const path =
        str(data.storagePath) ?? str(data.providerFileId) ?? str(data.filePath);
      if (!path) {
        setUrlError("No file is attached to this document yet.");
        return;
      }
      try {
        const resolved = await getDownloadURL(ref(getStorage(app), path));
        if (active) setUrl(resolved);
      } catch {
        if (active)
          setUrlError(
            "This file could not be opened — it may still be processing, or it was moved.",
          );
      }
    })();
    return () => {
      active = false;
    };
  }, [id, workspace.loading, workspace.tenantId]);

  if (record === undefined) {
    return (
      <div className="live-detail-page">
        <p className="live-domain-state">Loading document…</p>
      </div>
    );
  }
  if (!record) {
    return (
      <div className="live-detail-page">
        <Link className="back-link" href="/studio/documents">
          <ArrowLeft /> Back to documents
        </Link>
        <h1>Document unavailable</h1>
        <p>This document is not available in the active studio.</p>
      </div>
    );
  }

  const name =
    str(record.name) ?? str(record.fileName) ?? str(record.kind) ?? "Document";
  const updated = str(record.updatedAt);
  const facts: Array<[string, string]> = [];
  if (str(record.category)) facts.push(["Category", String(record.category)]);
  if (str(record.provider)) facts.push(["Provider", String(record.provider)]);
  if (str(record.visibility)) facts.push(["Visibility", String(record.visibility)]);
  if (record.version != null && record.version !== "")
    facts.push(["Version", String(record.version)]);
  if (updated) {
    let when = updated;
    try {
      when = formatDueDate(updated);
    } catch {
      /* keep the raw value */
    }
    facts.push(["Updated", when]);
  }
  const isPdf =
    /\.pdf(?:$|\?)/i.test(name) || /\.pdf(?:$|\?)/i.test(String(url ?? ""));

  return (
    <div className="live-detail-page document-viewer">
      <Link className="back-link" href="/studio/documents">
        <ArrowLeft /> Back to documents
      </Link>
      <header className="page-heading">
        <div>
          <p className="eyebrow">Document</p>
          <h1>{name}</h1>
        </div>
        {str(record.status) ? (
          <div className="live-detail-header-actions">
            <StatusBadge>{statusLabel(record.status)}</StatusBadge>
          </div>
        ) : null}
      </header>

      <div className="document-viewer-open">
        {url ? (
          <a
            className="button button-dark"
            href={url}
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLink size={15} /> Open document
          </a>
        ) : urlError ? (
          <p className="form-notice" role="status">
            {urlError}
          </p>
        ) : (
          <p className="form-notice" role="status">
            Preparing file…
          </p>
        )}
      </div>

      {facts.length ? (
        <section className="live-detail-grid">
          {facts.map(([label, value]) => (
            <article className="panel" key={label}>
              <small>{label}</small>
              <strong>{value}</strong>
            </article>
          ))}
        </section>
      ) : null}

      {url ? (
        <div className="document-viewer-frame">
          {isPdf ? (
            <iframe title={name} src={url} />
          ) : (
            <a href={url} target="_blank" rel="noopener noreferrer">
              <FileText size={17} /> Open this file in a new tab
            </a>
          )}
        </div>
      ) : null}
    </div>
  );
}
