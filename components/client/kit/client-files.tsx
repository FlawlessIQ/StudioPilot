"use client";

import { useState } from "react";
import {
  CalendarClock,
  ExternalLink,
  FileImage,
  FileSignature,
  FileText,
  Images,
  Play,
  Receipt,
  type LucideIcon,
} from "lucide-react";
import { KitRoot, List, Main, Pill, PoweredBy, Row } from "@/components/kit/kit";
import { SheetDialog } from "@/components/ui/sheet-dialog";
import { resolveFile } from "@/lib/documents/resolve-file";
import { useWorkspace } from "@/features/auth/workspace-context";
import { EmptyMoment } from "@/components/client/kit/empty-moment";
import { clientDeliverables } from "@/features/client/deliverables";
import { isStandingInvoice } from "@/features/booking/invoice-standing";
import { statusLabel } from "@/features/format/status-label";
import {
  date,
  invoiceOverdue,
  money,
  number,
  sentenceCase,
  text,
  useProjectRecords,
} from "@/components/client/live-client-views";

type Shared = { id: string; name: string; detail: string; url: string | null; path: string | null; image: boolean };

/** Category keys are the studio's filing words; a couple reads these. */
const CATEGORY: Record<string, string> = {
  coi: "Insurance certificate",
  contract: "Agreement",
  invoice: "Invoice",
  timeline: "Timeline",
};
const categoryLabel = (value: unknown) => {
  const key = text(value, "shared_file");
  return CATEGORY[key] ?? sentenceCase(key.replaceAll("_", " "));
};

function isImage(record: Record<string, unknown>): boolean {
  const type = text(record.contentType, "");
  if (type) return type.startsWith("image/");
  return /\.(jpe?g|png|gif|webp|heic)$/i.test(text(record.fileName ?? record.name, ""));
}

/**
 * The couple's files (M4 of docs/mobile-first-client-crew-plan-2026-09-28.md).
 *
 * Two lists: what the studio shared with them, and the records of their
 * booking (agreement, invoices, timeline, gallery), each opening the screen
 * it belongs to. A shared photo previews in a sheet; a PDF opens in the
 * phone's own viewer, because iOS shows only a PDF's first page inside a
 * frame (the mobile rule in docs/document-access-plan-2026-09-28.md).
 */
export function ClientFiles() {
  const workspace = useWorkspace();
  const documents = useProjectRecords("documents");
  const contracts = useProjectRecords("contracts");
  const invoices = useProjectRecords("invoiceReferences");
  const schedules = useProjectRecords("schedules");
  const deliveries = useProjectRecords("deliveryRecords");
  const albums = useProjectRecords("albumWorkflows");
  const [preview, setPreview] = useState<Shared | null>(null);
  const [openNotice, setOpenNotice] = useState<string | null>(null);

  /**
   * A stored file, opened: its path becomes a link through the Storage rules
   * (lib/documents/resolve-file.ts). A photo previews in the sheet; anything
   * else opens in the phone's own viewer, in a tab opened while the tap still
   * counts as one — after the await it would be a blocked popup.
   */
  async function openStored(file: Shared) {
    if (!file.path) return;
    setOpenNotice(null);
    const tab = file.image ? null : window.open("", "_blank");
    const result = await resolveFile(
      { kind: "storage", path: file.path, label: file.name },
      workspace.tenantId ?? null,
    );
    if (result.status !== "ready") {
      tab?.close();
      setOpenNotice(result.message);
      return;
    }
    if (file.image) {
      setPreview({ ...file, url: result.url });
      return;
    }
    if (tab) {
      tab.opener = null;
      tab.location.href = result.url;
    } else {
      setOpenNotice("Allow pop-ups to open files.");
    }
  }
  const all = [documents, contracts, invoices, schedules, deliveries, albums];
  const loading = all.some((collection) => collection.loading);
  const error = all.map((collection) => collection.error).find(Boolean) ?? null;

  const shared: Shared[] = documents.value
    .filter((record) => record.clientVisible !== false)
    .map((record) => ({
      id: record.id,
      name: text(record.name ?? record.fileName, "Shared file"),
      detail: [
        categoryLabel(record.category),
        record.updatedAt ? date(record.updatedAt) : null,
      ]
        .filter(Boolean)
        .join(" · "),
      url:
        typeof record.temporaryUrl === "string"
          ? record.temporaryUrl
          : typeof record.downloadUrl === "string"
            ? record.downloadUrl
            : null,
      path: typeof record.storagePath === "string" ? record.storagePath : null,
      image: isImage(record),
    }));

  const records: Array<{ id: string; icon: LucideIcon; title: string; subtitle: string; href: string; trailing?: React.ReactNode }> = [
    ...contracts.value
      .filter((record) => ["completed", "signed"].includes(text(record.status)))
      .map((record) => ({
        id: `contract-${record.id}`,
        icon: FileSignature,
        title: "Signed agreement",
        subtitle: `Signed ${date(record.completedAt ?? record.updatedAt)}`,
        href: "/client/contract",
      })),
    ...invoices.value
      .filter((record) => isStandingInvoice(record.status))
      .map((record) => ({
        id: `invoice-${record.id}`,
        icon: Receipt,
        title: `${sentenceCase(text(record.kind, "Project"))} invoice`,
        subtitle:
          number(record.balanceCents) > 0
            ? `${money(record.balanceCents, record.currency)} due ${date(record.dueDate)}`
            : `${money(record.amountCents, record.currency)} · paid`,
        href: "/client/payments",
        trailing: invoiceOverdue(record) ? <Pill tone="danger">Overdue</Pill> : undefined,
      })),
    ...schedules.value
      .filter((record) => ["approved", "published"].includes(text(record.status)))
      .map((record) => ({
        id: `schedule-${record.id}`,
        icon: CalendarClock,
        title: `Wedding-day timeline · version ${number(record.version)}`,
        subtitle: statusLabel(record.status),
        href: "/client/schedule",
      })),
    // Named as the delivery screen names them: a film is not "Your gallery".
    ...clientDeliverables(deliveries.value).map((deliverable) => ({
      id: `delivery-${deliverable.id}`,
      icon: deliverable.mediaType === "video" ? Play : Images,
      title: deliverable.title,
      subtitle: deliverable.deliveredAt ? `Delivered ${date(deliverable.deliveredAt)}` : "Delivered",
      href: "/client/delivery",
    })),
    ...albums.value.map((record) => ({
      id: `album-${record.id}`,
      icon: FileImage,
      title: "Your album",
      subtitle: statusLabel(record.status),
      href: "/client/delivery",
    })),
  ];

  const nothing = !shared.length && !records.length;

  return (
    <>
      <Main label="Files">
        <div className="kit-stack-tight">
          <p className="kit-eyebrow">Files</p>
          <h1 className="kit-title">Your files</h1>
          <p className="kit-body">Everything your studio has shared, and the records of your booking.</p>
        </div>

        {error ? (
          <p className="kit-note" data-tone="danger" role="alert">
            {error}
          </p>
        ) : null}

        {nothing ? (
          <EmptyMoment
            area="documents"
            error={null}
            loading={loading}
            loadingText="Opening your files…"
            upcoming="Files your studio shares, your signed agreement and your invoices will all be kept here."
          />
        ) : null}

        {shared.length ? (
          <section aria-label="Shared with you" className="kit-stack-tight">
            <h2 className="kit-subsection">Shared with you</h2>
            <List>
              {shared.map((file) =>
                file.url && file.image ? (
                  <Row
                    icon={FileImage}
                    key={file.id}
                    onClick={() => setPreview(file)}
                    subtitle={file.detail}
                    title={file.name}
                  />
                ) : file.url ? (
                  <li key={file.id}>
                    <a className="kit-row" href={file.url} rel="noreferrer" target="_blank">
                      <span className="kit-row-icon">
                        <FileText aria-hidden size={20} />
                      </span>
                      <span className="kit-row-text">
                        <span className="kit-row-title">{file.name}</span>
                        <span className="kit-row-subtitle">{file.detail}</span>
                      </span>
                      <span className="kit-row-trailing">
                        <ExternalLink aria-hidden size={18} />
                      </span>
                    </a>
                  </li>
                ) : file.path ? (
                  <Row
                    icon={file.image ? FileImage : FileText}
                    key={file.id}
                    onClick={() => void openStored(file)}
                    subtitle={file.detail}
                    title={file.name}
                    trailing={<ExternalLink aria-hidden size={18} />}
                  />
                ) : (
                  <Row
                    icon={FileText}
                    key={file.id}
                    subtitle={file.detail}
                    title={file.name}
                    trailing={<Pill>Being checked</Pill>}
                  />
                ),
              )}
            </List>
            {openNotice ? (
              <p className="kit-caption" role="status">
                {openNotice}
              </p>
            ) : null}
          </section>
        ) : null}

        {records.length ? (
          <section aria-label="Your booking" className="kit-stack-tight">
            <h2 className="kit-subsection">Your booking</h2>
            <List>
              {records.map((record) => (
                <Row
                  href={record.href}
                  icon={record.icon}
                  key={record.id}
                  subtitle={record.subtitle}
                  title={record.title}
                  trailing={record.trailing}
                />
              ))}
            </List>
          </section>
        ) : null}
        <PoweredBy />
      </Main>

      <SheetDialog label={preview?.name ?? "Preview"} onClose={() => setPreview(null)} open={preview !== null}>
        <KitRoot className="kit-embed kit-sheet" studio={{ color: workspace.tenantBrand?.primaryColor ?? null }}>
          {preview?.url ? (
            <div className="kit-stack">
              {/* eslint-disable-next-line @next/next/no-img-element -- a signed, per-file URL; not for the image optimiser */}
              <img alt={preview.name} className="kit-preview-image" src={preview.url} />
              <a className="kit-button" data-variant="secondary" href={preview.url} rel="noreferrer" target="_blank">
                <ExternalLink aria-hidden size={20} /> Open full size
              </a>
            </div>
          ) : null}
        </KitRoot>
      </SheetDialog>
    </>
  );
}
