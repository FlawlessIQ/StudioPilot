"use client";

import { useState } from "react";
import { UploadCloud } from "lucide-react";
import { uploadCrewRequirement } from "@/lib/crew/command-client";

const acceptedTypes = new Set(["application/pdf", "image/jpeg", "image/png"]);

export function CrewDocumentUpload({
  projectId,
  assignmentId,
  requirementId,
  requirementName = "required document",
}: {
  projectId: string;
  assignmentId: string;
  requirementId: string;
  requirementName?: string;
}) {
  const [notice, setNotice] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const selectFile = async (file: File | undefined) => {
    setNotice(null);
    if (!file) return;
    if (!acceptedTypes.has(file.type)) { setNotice("Use a PDF, JPEG, or PNG file."); return; }
    if (file.size > 10 * 1024 * 1024) { setNotice("Files must be 10 MB or smaller."); return; }
    try {
      const response = await uploadCrewRequirement({
        projectId,
        assignmentId,
        requirementId,
        file,
      });
      setSubmitted(true);
      setNotice(response.persisted
        ? "Document submitted for studio review."
        : `Development preview: ${file.name} passed file checks, but no file was uploaded or record changed.`);
    } catch (caught: unknown) {
      setNotice(caught instanceof Error ? caught.message : "The document could not be submitted.");
    }
  };
  return <div className="crew-upload-control">
    <label className={submitted ? "is-submitted" : ""}><UploadCloud size={20}/><span><strong>{submitted?"Submitted for review":`Upload ${requirementName}`}</strong><small>PDF, JPEG, or PNG · 10 MB maximum</small></span><input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={event=>void selectFile(event.target.files?.[0])}/></label>
    {notice?<p className="form-notice" role="status">{notice}</p>:null}
  </div>;
}
