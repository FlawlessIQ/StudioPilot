/**
 * The couple's own shot list ("must-take photos"), uploaded in their portal
 * (functions/src/planning/shot-list-upload.ts asks for it a month out;
 * server/planning/shot-list.ts saves it). Pure, shared by the portal page,
 * the job's Plan tab and Today.
 */

/** What a couple can upload: what the file-safety scanner accepts (storage.rules). */
export const SHOT_LIST_TYPES: Readonly<Record<string, string>> = {
  "application/pdf": "PDF",
  "image/jpeg": "Photo",
  "image/png": "Image",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word document",
  "application/msword": "Word document",
  "text/plain": "Text",
  "text/csv": "Spreadsheet (CSV)",
};

export const SHOT_LIST_ACCEPT = Object.keys(SHOT_LIST_TYPES).join(",") + ",.pdf,.jpg,.jpeg,.png,.docx,.doc,.txt,.csv";
export const SHOT_LIST_MAX_BYTES = 12 * 1024 * 1024;
export const SHOT_LIST_MAX_FILES = 10;
export const SHOT_LIST_NOTE_MAX = 2000;

export type ShotListFile = {
  storagePath: string;
  name: string;
  contentType: string;
  sizeBytes: number;
  uploadedAt: string;
};

export type ShotListStatus = "not_requested" | "requested" | "received";

/** `clientShotLists/{projectId}`, as both sides read it. */
export type ShotListRecord = {
  id?: string;
  tenantId?: string;
  projectId?: string;
  status?: string;
  requestedAt?: string | null;
  dueDate?: string | null;
  files?: ShotListFile[];
  note?: string | null;
  receivedAt?: string | null;
  studioSeenAt?: string | null;
};

export function shotListStatus(record: ShotListRecord | null | undefined): ShotListStatus {
  if (!record) return "not_requested";
  return record.status === "received" && (record.files?.length || record.note) ? "received" : "requested";
}

/** New on Today until the studio opens it. A later upload puts it back. */
export function shotListNeedsStudio(record: ShotListRecord | null | undefined): boolean {
  if (shotListStatus(record) !== "received" || !record?.receivedAt) return false;
  return !record.studioSeenAt || record.studioSeenAt < record.receivedAt;
}

/** The file type a couple can upload, from its MIME type or, when the browser sends none, its name. */
export function shotListContentType(file: { type: string; name: string }): string | null {
  if (SHOT_LIST_TYPES[file.type]) return file.type;
  const extension = file.name.toLowerCase().split(".").pop() ?? "";
  const byExtension: Record<string, string> = {
    pdf: "application/pdf",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    doc: "application/msword",
    txt: "text/plain",
    csv: "text/csv",
  };
  return byExtension[extension] ?? null;
}

/** Only files in this couple's own shot-list folder for this job. */
export function isOwnShotListPath(path: string, input: { tenantId: string; projectId: string; uid: string }): boolean {
  const prefix = `tenants/${input.tenantId}/projects/${input.projectId}/clients/${input.uid}/shot-list/`;
  return path.startsWith(prefix) && path.length > prefix.length && !path.slice(prefix.length).includes("/") && !path.includes("..");
}

export function fileSizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** What the couple sees of their shot list (server/planning/shot-list.ts). */
export type ShotListView = {
  status: ShotListStatus;
  /** Whether this job takes one at all: a wedding at a photo studio. */
  available: boolean;
  dueDate: string | null;
  files: Array<Pick<ShotListFile, "name" | "contentType" | "sizeBytes" | "uploadedAt">>;
  note: string | null;
  receivedAt: string | null;
  /** The studio has opened it. */
  seenByStudio: boolean;
};
