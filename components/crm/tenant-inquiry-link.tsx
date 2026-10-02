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
    // Secondary: looking at the form is not the page's main act, and a big
    // green "Preview" was the loudest thing on Inquiries (UI audit, 2026-10-02).
    <Link className="button button-light" href={href}>
      <ExternalLink size={16} />
      {workspace.tenantSlug ? "Preview inquiry form" : "Finish inquiry setup"}
    </Link>
  );
}
