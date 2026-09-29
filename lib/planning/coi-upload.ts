"use client";

import { ref, uploadBytes } from "firebase/storage";
import { studioStorage } from "@/lib/documents/resolve-file";

/**
 * A certificate the studio made in its insurer's portal, uploaded to the job
 * (H3 self-serve mode). The request id in the metadata is what the scanner
 * keys on, so it is checked by the same scan and AI review as one an agent
 * emails. The storage rules take a studio upload of a PDF marked pending.
 */
export async function uploadCoiPdf(input: {
  tenantId: string;
  projectId: string;
  requestId: string;
  file: File;
}): Promise<{ storagePath: string; filename: string }> {
  if (input.file.type !== "application/pdf") throw new Error("COI_UPLOAD_MUST_BE_PDF");
  if (input.file.size > 12 * 1024 * 1024) throw new Error("COI_UPLOAD_TOO_LARGE");
  const safe = input.file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "certificate.pdf";
  const storagePath = `tenants/${input.tenantId}/projects/${input.projectId}/coi/uploads/${input.requestId}_${Date.now()}_${safe}`;
  await uploadBytes(ref(studioStorage(), storagePath), input.file, {
    contentType: "application/pdf",
    customMetadata: {
      scanStatus: "pending",
      visibility: "studio",
      tenantId: input.tenantId,
      projectId: input.projectId,
      coiRequestId: input.requestId,
    },
  });
  return { storagePath, filename: input.file.name };
}
