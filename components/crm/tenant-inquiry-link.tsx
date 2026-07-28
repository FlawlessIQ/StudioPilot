"use client";

import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { useWorkspace } from "@/features/auth/workspace-context";

export function TenantInquiryLink() {
  const workspace = useWorkspace();
  const href = workspace.tenantSlug
    ? `/inquiry?studio=${encodeURIComponent(workspace.tenantSlug)}&preview=studio`
    : "/studio/setup";
  return (
    <Link className="button button-dark" href={href}>
      <ExternalLink size={16} />
      {workspace.tenantSlug ? "Preview inquiry form" : "Finish inquiry setup"}
    </Link>
  );
}
