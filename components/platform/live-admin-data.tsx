"use client";

import { useEffect, useState } from "react";
import {
  Activity,
  Building2,
  CircleAlert,
  CloudCog,
  CreditCard,
  Flag,
  LoaderCircle,
  ScrollText,
  Users,
} from "lucide-react";
import {
  collection,
  getDocs,
  limit,
  query,
} from "firebase/firestore";
import type { LucideIcon } from "lucide-react";
import { AdminCommandAction } from "@/components/saas/admin-actions";
import { StatusBadge } from "@/components/ui/status-badge";
import { getFirebaseClient } from "@/lib/firebase/client";
import { dataIsLive } from "@/lib/runtime-mode";
import { friendlyError } from "@/lib/ai/friendly-error";

type RecordValue = Record<string, unknown> & { id: string };
type AdminDomain =
  | "tenants"
  | "users"
  | "subscriptions"
  | "integrations"
  | "failed_jobs"
  | "feature_flags"
  | "audit"
  | "health";

type Config = {
  collection: string | string[];
  icon: LucideIcon;
  primary: string[];
  secondary: string[];
  facts: Array<{ label: string; fields: string[] }>;
  status: string[];
  filter?: (record: RecordValue) => boolean;
};

const configurations: Record<AdminDomain, Config> = {
  tenants: {
    collection: "tenants",
    icon: Building2,
    primary: ["businessName", "brandName", "id"],
    secondary: ["legalName", "slug"],
    facts: [
      { label: "Plan", fields: ["subscriptionPlan"] },
      { label: "Timezone", fields: ["timezone"] },
    ],
    status: ["status"],
  },
  users: {
    collection: "users",
    icon: Users,
    primary: ["displayName", "email", "id"],
    secondary: ["email"],
    facts: [
      { label: "Created", fields: ["createdAt"] },
      { label: "Last updated", fields: ["updatedAt"] },
    ],
    status: ["status", "emailVerified"],
  },
  subscriptions: {
    collection: "subscriptions",
    icon: CreditCard,
    primary: ["tenantId", "id"],
    secondary: ["stripeCustomerId"],
    facts: [
      // The record's field is `plan`; `planKey` does not exist on it, so every
      // subscription read "Plan —" while the tenants page said "studio".
      { label: "Plan", fields: ["plan", "planKey"] },
      { label: "Period ends", fields: ["currentPeriodEnd"] },
    ],
    status: ["status"],
  },
  integrations: {
    collection: "integrationConnections",
    icon: CloudCog,
    primary: ["provider"],
    secondary: ["tenantId"],
    facts: [
      { label: "Account", fields: ["displayName", "providerAccountId"] },
      { label: "Checked", fields: ["lastHealthCheckAt", "updatedAt"] },
      { label: "Latency", fields: ["lastHealthLatencyMs"] },
      { label: "Recommendation", fields: ["diagnosticRecommendation", "lastError"] },
    ],
    status: ["status"],
  },
  failed_jobs: {
    collection: [
      "providerJobs",
      "emailJobs",
      "aiJobs",
      "pdfJobs",
      "automationRuns",
      "domainEvents",
    ],
    icon: CircleAlert,
    primary: ["type", "action", "id"],
    secondary: ["tenantId"],
    facts: [
      { label: "Queue", fields: ["recordCollection"] },
      { label: "Attempts", fields: ["attempts"] },
      { label: "Last error", fields: ["lastError", "error"] },
    ],
    status: ["status", "processingStatus"],
    filter: (record) =>
      ["failed", "dead_letter", "publish_retry", "processing_failed"].includes(
        String(record.status ?? record.processingStatus),
      ),
  },
  feature_flags: {
    collection: "featureFlags",
    icon: Flag,
    primary: ["key", "id"],
    secondary: ["description"],
    facts: [
      { label: "Tenants", fields: ["tenantIds"] },
      { label: "Updated", fields: ["updatedAt"] },
    ],
    status: ["enabled"],
  },
  audit: {
    collection: "auditEvents",
    icon: ScrollText,
    primary: ["action"],
    secondary: ["entityType", "entityId"],
    facts: [
      { label: "Tenant", fields: ["tenantId"] },
      { label: "Actor", fields: ["actorId"] },
    ],
    status: ["actorType"],
  },
  health: {
    collection: "systemHealth",
    icon: Activity,
    primary: ["component"],
    secondary: ["message", "category"],
    facts: [
      { label: "Failures", fields: ["failureCount"] },
      { label: "Checked", fields: ["checkedAt"] },
    ],
    status: ["status"],
  },
};

function value(record: RecordValue, fields: string[]) {
  for (const field of fields) {
    const result = record[field];
    if (result !== undefined && result !== null && result !== "") return result;
  }
  return null;
}

/**
 * One value, for a page an operator opens when something is broken.
 *
 * @param humanise Whether to soften `dead_letter` into "dead letter". True for
 *   the status chip this was written for, false everywhere else — applied to
 *   every value it turned `demo_e2e` into "demo e2e", `cus_mock_alder` into
 *   "cus mock alder" and `America/New_York` into "America/New York", mangling
 *   the identifiers an operator needs to paste into Stripe or a support ticket.
 */
function text(input: unknown, humanise = false) {
  if (input === null || input === undefined || input === "") return "—";
  if (typeof input === "boolean") return input ? "Enabled" : "Disabled";
  if (Array.isArray(input)) return input.length ? input.join(", ") : "All tenants";
  /**
   * A structured error, which is what every queue actually stores.
   *
   * `String({code, message, retryable})` is "[object Object]", and that is what
   * the dead-letter console printed under "Last error" — on the one page whose
   * entire job is to say why something died.
   */
  if (typeof input === "object") {
    const record = input as Record<string, unknown>;
    const message = typeof record.message === "string" ? record.message : "";
    const code = typeof record.code === "string" ? record.code : "";
    if (message || code) {
      return [code, message].filter(Boolean).join(" · ");
    }
    try {
      const json = JSON.stringify(input);
      return json && json !== "{}" ? json.slice(0, 300) : "—";
    } catch {
      return "Unreadable error payload";
    }
  }
  const result = String(input);
  if (/^\d{4}-\d{2}-\d{2}T/.test(result)) {
    const parsed = new Date(result);
    if (!Number.isNaN(parsed.valueOf())) return parsed.toLocaleString();
  }
  return humanise ? result.replaceAll("_", " ") : result;
}

function tone(input: unknown) {
  const status = String(input).toLowerCase();
  if (["true", "active", "connected", "healthy", "verified"].includes(status))
    return "success" as const;
  if (["failed", "dead_letter", "suspended", "false"].includes(status))
    return "danger" as const;
  return "warning" as const;
}

export function LiveAdminCollection({
  domain,
  onRecords,
}: {
  domain: AdminDomain;
  onRecords?: (records: RecordValue[]) => void;
}) {
  const config = configurations[domain];
  const [records, setRecords] = useState<RecordValue[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!dataIsLive) {
      queueMicrotask(() => {
        setRecords([]);
        onRecords?.([]);
      });
      return;
    }
    let active = true;
    const { firestore } = getFirebaseClient();
    const collections = Array.isArray(config.collection)
      ? config.collection
      : [config.collection];
    void Promise.all(
      collections.map(async (collectionName) => {
        const snapshot = await getDocs(
          query(collection(firestore, collectionName), limit(100)),
        );
        return snapshot.docs.map((item) => ({
          id: item.id,
          recordCollection: collectionName,
          ...item.data(),
        }));
      }),
    )
      .then((collectionRecords) => {
        if (!active) return;
        const values = collectionRecords
          .flat()
          .filter((item) => (config.filter ? config.filter(item) : true));
        setRecords(values);
        onRecords?.(values);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setRecords([]);
        setError(
          friendlyError(caught, "Platform records could not be loaded."),
        );
      });
    return () => {
      active = false;
    };
  }, [config, onRecords]);

  if (records === null)
    return (
      <section className="panel live-domain-state">
        <LoaderCircle className="spin" />
        <span>
          <strong>Loading platform records…</strong>
          <small>Verifying platform-admin access.</small>
        </span>
      </section>
    );
  if (error)
    return (
      <section className="panel live-domain-state live-domain-error">
        <CircleAlert />
        <span>
          <strong>Platform records unavailable</strong>
          <small>{error}</small>
        </span>
      </section>
    );
  if (!records.length)
    return (
      <section className="panel live-domain-state">
        <Activity />
        <span>
          <strong>No matching records</strong>
          <small>No production records currently require display.</small>
        </span>
      </section>
    );
  const Icon = config.icon;
  return (
    <section className="panel ops-table">
      {records.map((record) => {
        const status = value(record, config.status);
        return (
          <article className="ops-row admin-live-row" key={record.id}>
            <span>
              <Icon size={17} />
              <span>
                <strong>{text(value(record, config.primary))}</strong>
                <small>{text(value(record, config.secondary))}</small>
              </span>
            </span>
            {config.facts.map((fact) => (
              <span key={fact.label}>
                <small>{fact.label}</small>
                <strong>{text(value(record, fact.fields))}</strong>
              </span>
            ))}
            <StatusBadge tone={tone(status)}>{text(status, true)}</StatusBadge>
            {domain === "failed_jobs" ? (
              <AdminCommandAction
                label="Rerun"
                complete="Dead-letter job queued for a controlled rerun."
                command={{
                  type: "rerunJob",
                  input: {
                    collectionName: String(record.recordCollection) as
                      | "providerJobs"
                      | "emailJobs"
                      | "aiJobs"
                      | "pdfJobs"
                      | "automationRuns"
                      | "domainEvents",
                    jobId: record.id,
                  },
                }}
              />
            ) : null}
            {domain === "feature_flags" ? (
              <AdminCommandAction
                label={record.enabled === true ? "Disable" : "Enable"}
                complete={`Feature flag ${record.enabled === true ? "disabled" : "enabled"} and audited.`}
                command={{
                  type: "setFeatureFlag",
                  input: {
                    key: String(record.key ?? record.id),
                    enabled: record.enabled !== true,
                    tenantIds: Array.isArray(record.tenantIds)
                      ? record.tenantIds.map(String)
                      : [],
                    description: String(record.description ?? ""),
                  },
                }}
              />
            ) : null}
          </article>
        );
      })}
    </section>
  );
}
