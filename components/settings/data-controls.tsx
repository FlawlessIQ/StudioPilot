"use client";
import { useEffect, useState, type FormEvent } from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  where,
} from "firebase/firestore";
import { Download, ShieldAlert } from "lucide-react";
import { getAppCheckToken } from "@/lib/firebase/app-check";
import { getFirebaseClient } from "@/lib/firebase/client";
import { dataIsLive } from "@/lib/runtime-mode";
import { activeMembership } from "@/lib/firebase/active-membership";
type Context = { tenantId: string; businessName: string };
export function DataControls() {
  const [context, setContext] = useState<Context | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [exports, setExports] = useState<Array<{ id: string; status: string }>>(
    [],
  );
  useEffect(() => {
    let active = true;
    async function load() {
      if (!dataIsLive) return;
      try {
        const { auth, firestore } = getFirebaseClient();
        const user = auth.currentUser;
        if (!user) return;
        const membership = await activeMembership(firestore, user.uid);
        const tenantId = membership.data().tenantId;
        if (typeof tenantId !== "string") return;
        const [tenant, jobs] = await Promise.all([
          getDoc(doc(firestore, "tenants", tenantId)),
          getDocs(
            query(
              collection(firestore, "exportJobs"),
              where("tenantId", "==", tenantId),
              limit(10),
            ),
          ),
        ]);
        if (active) {
          setContext({
            tenantId,
            businessName: String(tenant.data()?.businessName ?? ""),
          });
          setExports(
            jobs.docs.map((value) => ({
              id: value.id,
              status: String(value.data().status),
            })),
          );
        }
      } catch {
        if (active) setNotice("Data controls are unavailable.");
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, []);
  async function command(body: Record<string, unknown>) {
    const endpoint = process.env.NEXT_PUBLIC_DATA_FUNCTIONS_URL;
    if (!endpoint) {
      setNotice(
        "Development preview: the request was validated, but no data operation was created.",
      );
      return null;
    }
    const { auth } = getFirebaseClient();
    const user = auth.currentUser;
    if (!user || !context) throw new Error("Sign in as the Studio Owner.");
    const appCheckToken = await getAppCheckToken();
    const response = await fetch(
      `${endpoint.replace(/\/$/, "")}/tenantDataCommand`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${await user.getIdToken()}`,
          ...(appCheckToken ? { "x-firebase-appcheck": appCheckToken } : {}),
        },
        body: JSON.stringify({
          ...body,
          tenantId: context.tenantId,
          idempotencyKey: crypto.randomUUID(),
        }),
      },
    );
    const result = (await response.json()) as Record<string, unknown>;
    if (!response.ok)
      throw new Error(
        typeof result.error === "string"
          ? result.error
          : "Data request failed.",
      );
    return result;
  }
  async function requestExport() {
    try {
      const result = await command({ type: "requestExport" });
      if (result) {
        setNotice(
          "Encrypted tenant export queued. It will appear here when ready.",
        );
        setExports((value) => [
          { id: String(result.exportJobId), status: "queued" },
          ...value,
        ]);
      }
    } catch (caught: unknown) {
      setNotice(
        caught instanceof Error ? caught.message : "Export request failed.",
      );
    }
  }
  async function requestDeletion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      const result = await command({
        type: "requestDeletion",
        reason: String(data.get("reason")),
        confirmation: String(data.get("confirmation")),
      });
      if (result)
        setNotice(
          `Deletion cooling-off period started. Earliest deletion: ${String(result.deleteAfter)}.`,
        );
    } catch (caught: unknown) {
      setNotice(
        caught instanceof Error ? caught.message : "Deletion request failed.",
      );
    }
  }
  async function download(id: string) {
    try {
      const endpoint = process.env.NEXT_PUBLIC_DATA_FUNCTIONS_URL;
      const { auth } = getFirebaseClient();
      const user = auth.currentUser;
      if (!endpoint || !user)
        throw new Error("Live export download is not configured.");
      const appCheckToken = await getAppCheckToken();
      const response = await fetch(
        `${endpoint.replace(/\/$/, "")}/tenantExportDownload?id=${encodeURIComponent(id)}`,
        {
          headers: {
            authorization: `Bearer ${await user.getIdToken()}`,
            ...(appCheckToken ? { "x-firebase-appcheck": appCheckToken } : {}),
          },
        },
      );
      const result = (await response.json()) as {
        url?: string;
        error?: string;
      };
      if (!response.ok || !result.url)
        throw new Error(result.error ?? "Export is not ready.");
      window.location.assign(result.url);
    } catch (caught: unknown) {
      setNotice(
        caught instanceof Error ? caught.message : "Export download failed.",
      );
    }
  }
  return (
    <div className="data-controls">
      <section className="panel data-control-card">
        <span className="data-control-icon"><Download /></span>
        <div>
          <h2>Tenant export</h2>
          <p>
            Create a compressed archive of your studio data. Download links expire
            after 15 minutes.
          </p>
        </div>
        <button
          className="button button-dark"
          type="button"
          onClick={() => void requestExport()}
        >
          Request export
        </button>
        {exports.length ? (
          <ul>
            {exports.map((item) => (
              <li key={item.id}>
                <code>{item.id.slice(0, 12)}</code>
                <span>{item.status}</span>
                {item.status === "complete" ? (
                  <button type="button" onClick={() => void download(item.id)}>
                    Download
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </section>
      <section className="panel deletion-control data-control-card data-control-danger">
        <span className="data-control-icon"><ShieldAlert /></span>
        <div>
          <h2>Request account deletion</h2>
          <p>
            This begins a 30-day cooling-off period. It does not immediately
            erase records and can be cancelled before approval.
          </p>
        </div>
        <form onSubmit={(event) => void requestDeletion(event)}>
          <label>
            Business reason
            <textarea name="reason" required minLength={10} />
          </label>
          <label>
            Type the exact business name
            <input
              name="confirmation"
              required
              placeholder={context?.businessName ?? "Your business name"}
            />
          </label>
          <button className="button button-danger" type="submit">
            Begin cooling-off period
          </button>
        </form>
      </section>
      {notice ? (
        <p className="form-notice" role="status">
          {notice}
        </p>
      ) : null}
    </div>
  );
}
