"use client";

import { useCallback, useState } from "react";
import { ExternalLink, FileImage, FileText, FileVideo, LoaderCircle, Paperclip } from "lucide-react";
import { SheetDialog } from "@/components/ui/sheet-dialog";
import { useWorkspace } from "@/features/auth/workspace-context";
import { fileKindOf, fileRefKey, type FileRef } from "@/features/documents/file-ref";
import { previewKind, resolveFile, type ResolvedFile } from "@/lib/documents/resolve-file";

/**
 * One click from a mention to the file (docs/document-access-plan-2026-09-28.md).
 *
 * A chip — type icon, name, "View" — that opens the file in a sheet over the
 * page, so the studio never leaves the job. On a phone it opens a new tab
 * instead: iOS Safari shows only the first page of a PDF in a frame, and the
 * phone's own viewer does it properly. A link to another service (an invoice,
 * a gallery) always opens in a new tab.
 */
export function FileLink({ file, label }: { file: FileRef; label?: string }) {
  const workspace = useWorkspace();
  const [open, setOpen] = useState(false);
  const [resolved, setResolved] = useState<ResolvedFile | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const name = label ?? file.label;
  const kind = file.kind === "external" ? "other" : fileKindOf(("contentType" in file && file.contentType) || name);
  const Icon = kind === "image" ? FileImage : kind === "video" ? FileVideo : kind === "pdf" ? FileText : Paperclip;
  const close = useCallback(() => setOpen(false), []);

  if (file.kind === "external") {
    return (
      <a className="file-link" href={file.url} rel="noopener noreferrer" target="_blank">
        <ExternalLink aria-hidden="true" size={14} />
        <span>{name}</span>
        <em>Open</em>
      </a>
    );
  }

  async function view() {
    setNotice(null);
    const phone = typeof window !== "undefined" && window.matchMedia("(max-width: 760px)").matches;
    if (phone) {
      // Opened now, while the tap still counts as a tap: a window opened after
      // the await is a popup, and Safari blocks it.
      const tab = window.open("", "_blank");
      const result = await resolveFile(file, workspace.tenantId ?? null);
      if (result.status === "ready" && tab) {
        tab.opener = null;
        tab.location.href = result.url;
        return;
      }
      tab?.close();
      setNotice(result.status === "ready" ? "Allow pop-ups to open files." : result.message);
      return;
    }
    setResolved(null);
    setOpen(true);
    setResolved(await resolveFile(file, workspace.tenantId ?? null));
  }

  return (
    <>
      <button className="file-link" onClick={() => void view()} type="button">
        <Icon aria-hidden="true" size={14} />
        <span>{name}</span>
        <em>View</em>
      </button>
      {notice ? (
        <span className="file-link-notice" role="status">
          {notice}
        </span>
      ) : null}
      <SheetDialog label={name} onClose={close} open={open} width="wide">
        <FilePreview name={name} resolved={resolved} />
      </SheetDialog>
    </>
  );
}

/** Several files, as a row of chips. Nothing at all when there are none. */
export function FileLinks({ files }: { files: readonly FileRef[] }) {
  if (!files.length) return null;
  return (
    <span className="file-links">
      {files.map((file) => (
        <FileLink file={file} key={fileRefKey(file)} />
      ))}
    </span>
  );
}

/** The file itself: a PDF in a frame, an image, a video, or a way to open it. */
export function FilePreview({ name, resolved }: { name: string; resolved: ResolvedFile | null }) {
  if (!resolved) {
    return (
      <div className="file-preview">
        <p className="file-preview-state" role="status">
          <LoaderCircle aria-hidden="true" className="spin" size={16} /> Opening {name}…
        </p>
      </div>
    );
  }
  if (resolved.status !== "ready") {
    return (
      <div className="file-preview">
        <h2>{resolved.name}</h2>
        <p className="file-preview-state" role="status">
          {resolved.message}
        </p>
      </div>
    );
  }
  const kind = previewKind(resolved);
  return (
    <div className="file-preview">
      <header className="file-preview-head">
        <h2>{resolved.name}</h2>
        <a className="button button-light" href={resolved.url} rel="noopener noreferrer" target="_blank">
          <ExternalLink aria-hidden="true" size={15} /> Open in new tab
        </a>
      </header>
      <div className="file-preview-body">
        {kind === "pdf" ? (
          <iframe src={resolved.url} title={resolved.name} />
        ) : kind === "image" ? (
          // A user's own file at an unknown size; next/image needs dimensions.
          // eslint-disable-next-line @next/next/no-img-element
          <img alt={resolved.name} src={resolved.url} />
        ) : kind === "video" ? (
          <video controls preload="metadata" src={resolved.url} />
        ) : (
          <p className="file-preview-state">
            This kind of file can&rsquo;t be shown here.{" "}
            <a download href={resolved.url} rel="noopener noreferrer" target="_blank">
              Download {resolved.name}
            </a>
          </p>
        )}
      </div>
    </div>
  );
}
