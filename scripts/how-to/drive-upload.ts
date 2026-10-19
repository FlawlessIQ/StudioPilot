/**
 * Mirrors a local folder into Google Drive, under a folder you name by ID:
 * one Drive folder per local folder, files uploaded once (a file already
 * there by name is skipped, so a re-run finishes an interrupted upload).
 *
 *   npx tsx scripts/how-to/drive-upload.ts <local dir> <parent folder id> [name in Drive]
 *
 * Auth is gcloud's application-default credentials with the drive.file scope,
 * which sees only files these credentials made (the "StudioCue videos" tree
 * is one): gcloud auth application-default login --scopes=...,drive.file.
 * Billed to studiohub-prod, where the Drive API is on.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const QUOTA_PROJECT = "studiohub-prod";
const FOLDER = "application/vnd.google-apps.folder";
const TYPES: Record<string, string> = { ".mp4": "video/mp4", ".jpg": "image/jpeg", ".png": "image/png", ".txt": "text/plain", ".pdf": "application/pdf" };

let token = "";
let tokenAt = 0;
function auth() {
  if (Date.now() - tokenAt > 30 * 60_000) {
    token = execFileSync("gcloud", ["auth", "application-default", "print-access-token"]).toString().trim();
    tokenAt = Date.now();
  }
  return { Authorization: `Bearer ${token}`, "x-goog-user-project": QUOTA_PROJECT };
}

async function drive<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { ...init, headers: { ...auth(), ...(init.headers ?? {}) } });
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${url}: ${response.status} ${await response.text()}`);
  return (await response.json()) as T;
}

async function children(parent: string) {
  const q = encodeURIComponent(`'${parent}' in parents and trashed = false`);
  const found: Array<{ id: string; name: string; mimeType: string }> = [];
  let page = "";
  do {
    const result = await drive<{ files: typeof found; nextPageToken?: string }>(
      `https://www.googleapis.com/drive/v3/files?q=${q}&fields=nextPageToken,files(id,name,mimeType)&pageSize=200${page ? `&pageToken=${page}` : ""}`,
    );
    found.push(...result.files);
    page = result.nextPageToken ?? "";
  } while (page);
  return found;
}

async function folder(parent: string, name: string) {
  const existing = (await children(parent)).find((f) => f.name === name && f.mimeType === FOLDER);
  if (existing) return existing.id;
  const made = await drive<{ id: string }>("https://www.googleapis.com/drive/v3/files?fields=id", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, mimeType: FOLDER, parents: [parent] }),
  });
  return made.id;
}

/** A resumable upload: one session, then the bytes in one PUT. */
async function upload(parent: string, file: string) {
  const type = TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
  const size = statSync(file).size;
  const start = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id", {
    method: "POST",
    headers: { ...auth(), "content-type": "application/json", "x-upload-content-type": type, "x-upload-content-length": String(size) },
    body: JSON.stringify({ name: path.basename(file), parents: [parent] }),
  });
  const session = start.headers.get("location");
  if (!start.ok || !session) throw new Error(`Couldn't start uploading ${file}: ${start.status} ${await start.text()}`);
  const put = await fetch(session, { method: "PUT", headers: { "content-type": type, "content-length": String(size) }, body: readFileSync(file) });
  if (!put.ok) throw new Error(`Uploading ${file}: ${put.status} ${await put.text()}`);
}

async function mirror(local: string, parent: string, name: string): Promise<{ id: string; files: number; skipped: number }> {
  const id = await folder(parent, name);
  const there = new Set((await children(id)).map((f) => f.name));
  let files = 0, skipped = 0;
  for (const entry of readdirSync(local, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(local, entry.name);
    if (entry.isDirectory()) {
      const inner = await mirror(full, id, entry.name);
      files += inner.files;
      skipped += inner.skipped;
    } else if (there.has(entry.name)) {
      skipped++;
    } else {
      await upload(id, full);
      files++;
      console.log(`   ↑ ${path.relative(process.cwd(), full)}`);
    }
  }
  return { id, files, skipped };
}

const [local, parent, name] = process.argv.slice(2);
if (!local || !parent) throw new Error("Usage: drive-upload.ts <local dir> <parent folder id> [name in Drive]");
const result = await mirror(path.resolve(local), parent, name ?? path.basename(path.resolve(local)));
console.log(`✓ ${result.files} uploaded, ${result.skipped} already there → https://drive.google.com/drive/folders/${result.id}`);
