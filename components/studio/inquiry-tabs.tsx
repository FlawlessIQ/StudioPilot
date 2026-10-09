"use client";

import Link from "next/link";
import { useWorkspace } from "@/features/auth/workspace-context";
import { inquiryViews } from "@/features/inquiries/stages";
import { inquiryViewsFor } from "@/components/studio/trade-words";

/**
 * The Inquiries tabs, named the way the studio's trade names its stages. A
 * makeup or hair studio has no call before the quote, so it gets no tab for
 * one; the page is a server component and can't know the trade itself.
 */
export function InquiryTabs({ view, q }: { view: string; q: string }) {
  const trade = useWorkspace().tenantTrade;
  return (
    <div className="crm-tabs">
      {inquiryViewsFor(inquiryViews, trade).map(([value, label]) => (
        <Link
          className={view === value ? "active" : ""}
          href={`?${new URLSearchParams(q ? { view: value, q } : { view: value })}`}
          key={value}
        >
          {label}
        </Link>
      ))}
    </div>
  );
}
