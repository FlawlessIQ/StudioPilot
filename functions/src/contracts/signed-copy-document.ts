/**
 * A signed contract that arrived as a file — recorded by hand, or brought in
 * with an imported booking — filed as a `documents` record, the same way a
 * contract signed in StudioCue is (contracts/seal.ts).
 *
 * Before this, `signedDocumentId` held a document id for a sealed contract and
 * a raw storage path for the other two, and nothing could open the second kind
 * (docs/document-access-plan-2026-09-28.md). With a record for every signed
 * copy, `signedDocumentId` is a document id going forward; readers still
 * accept a legacy path (features/documents/file-ref.ts).
 *
 * The couple sees their own contract by default (Q6): it is theirs. The file is
 * already stored with `visibility: "client"`; `clientVisible` is the switch the
 * studio can turn off.
 */
export function signedCopyDocumentId(contractId: string): string {
  return `signed_contract_${contractId}`;
}

/** The folder a signed copy for this job must be in. */
export function signedCopyPrefix(tenantId: string, projectId: string): string {
  return `tenants/${tenantId}/projects/${projectId}/contracts/`;
}

function fileNameOf(path: string): string {
  const last = path.split("/").pop() ?? "signed-contract.pdf";
  // Uploads are filed as `<uuid>-<original name>`.
  return last.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i, "") || last;
}

function contentTypeOf(name: string): string {
  const extension = name.toLowerCase().split(".").pop() ?? "";
  if (extension === "pdf") return "application/pdf";
  if (extension === "png") return "image/png";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  return "application/octet-stream";
}

export function signedCopyDocument(input: {
  tenantId: string;
  projectId: string;
  contractId: string;
  path: string;
  authority: "manual_attested" | "imported";
  actorId: string;
  now: string;
}): { id: string; data: Record<string, unknown> } {
  const id = signedCopyDocumentId(input.contractId);
  const name = fileNameOf(input.path);
  return {
    id,
    data: {
      id,
      tenantId: input.tenantId,
      projectId: input.projectId,
      provider: "cloud_storage",
      providerFileId: input.path,
      providerRevision: null,
      canonicalPath: input.path,
      name,
      category: "contract",
      contentType: contentTypeOf(name),
      sizeBytes: null,
      visibility: "client",
      clientVisible: true,
      status: "available",
      contractId: input.contractId,
      completionAuthority: input.authority,
      createdAt: input.now,
      updatedAt: input.now,
      createdBy: input.actorId,
      updatedBy: input.actorId,
      archivedAt: null,
    },
  };
}
