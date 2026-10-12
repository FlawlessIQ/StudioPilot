"use client";

import { useEffect, useState } from "react";
import { Phone, Store } from "lucide-react";
import { collection, getDocs, limit, query, where } from "firebase/firestore";
import { useWorkspace } from "@/features/auth/workspace-context";
import { normalizePhone } from "@/features/contacts/schema";
import { spokenClock } from "@/features/schedules/day-clock";
import { vendorCategoryLabel } from "@/features/vendors/team";
import { getFirebaseClient } from "@/lib/firebase/client";
import { dataIsLive } from "@/lib/runtime-mode";

type Contact = {
  entryId: string;
  category: string;
  roleLabel: string | null;
  company: string;
  contactName: string;
  phone: string;
  arrivalTime: string | null;
  loadInTime: string | null;
};

const DEMO: Contact[] = [
  { entryId: "demo_florist", category: "florist", roleLabel: null, company: "Petal & Stem", contactName: "Rosa Diaz", phone: "+1 908 555 0117", arrivalTime: "13:30", loadInTime: "14:00" },
  { entryId: "demo_dj", category: "dj", roleLabel: null, company: "Spin Theory DJs", contactName: "Jay Okafor", phone: "+1 973 555 0190", arrivalTime: null, loadInTime: "15:00" },
];

const contacts = (value: unknown): Contact[] =>
  Array.isArray(value)
    ? value.filter((item): item is Contact => typeof item?.company === "string" && item.company.trim() !== "")
    : [];

function subtitle(contact: Contact): string {
  const when = contact.arrivalTime
    ? `arrives ${spokenClock(contact.arrivalTime)}`
    : contact.loadInTime
      ? `loads in ${spokenClock(contact.loadInTime)}`
      : "";
  return [contact.roleLabel || vendorCategoryLabel(contact.category), contact.contactName, when].filter(Boolean).join(" · ");
}

/**
 * The wedding's other vendors on the crew's day sheet: who they are, when
 * they arrive and the number to ring. Read from `crewVendorContacts`, the
 * projection of the job's vendor team that leaves out what the couple pays
 * each of them (functions/src/planning/vendor-team.ts). Kept on the phone
 * like the rest of the sheet, because a barn venue has no signal.
 */
export function CrewVendorContacts({ projectId, offline = false }: { projectId: string; offline?: boolean }) {
  const workspace = useWorkspace();
  const [list, setList] = useState<Contact[]>(() => (dataIsLive ? [] : DEMO));
  const userId = workspace.userId ?? (dataIsLive ? getFirebaseClient().auth.currentUser?.uid ?? null : null);
  const cacheKey = userId && projectId ? `studiocue:crew-vendor-contacts:${userId}:${projectId}` : null;

  useEffect(() => {
    if (!cacheKey) return;
    const timer = window.setTimeout(() => {
      try {
        const saved = window.localStorage.getItem(cacheKey);
        if (saved) setList((current) => (current.length ? current : contacts(JSON.parse(saved))));
      } catch {
        // A blocked or malformed copy never replaces the live list.
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [cacheKey]);

  useEffect(() => {
    if (offline || !dataIsLive || !workspace.tenantId || !projectId) return;
    let active = true;
    void getDocs(
      query(
        collection(getFirebaseClient().firestore, "crewVendorContacts"),
        where("tenantId", "==", workspace.tenantId),
        where("projectId", "==", projectId),
        limit(1),
      ),
    )
      .then((snapshot) => {
        // From the phone's cache with no signal: keep the saved copy.
        if (!active || snapshot.metadata.fromCache) return;
        const next = contacts(snapshot.docs[0]?.get("vendors"));
        setList(next);
        if (cacheKey) {
          try {
            window.localStorage.setItem(cacheKey, JSON.stringify(next));
          } catch {
            // Storage full or blocked: the live list still shows.
          }
        }
      })
      .catch((caught: unknown) => console.warn("crew vendor contacts could not be loaded", caught));
    return () => {
      active = false;
    };
  }, [cacheKey, offline, projectId, workspace.tenantId]);

  if (!list.length) return null;
  return (
    <section aria-label="Vendors" className="kit-stack-tight">
      <h2 className="kit-subsection">Vendors</h2>
      <ul className="kit-list">
        {list.map((contact) => (
          <li key={contact.entryId || contact.company}>
            <div className="kit-row">
              <span className="kit-row-icon">
                <Store aria-hidden size={20} />
              </span>
              <span className="kit-row-text">
                <span className="kit-row-title">{contact.company}</span>
                <span className="kit-row-subtitle">{subtitle(contact)}</span>
              </span>
              {contact.phone ? (
                <a className="kit-button" data-size="compact" data-variant="soft" href={`tel:${normalizePhone(contact.phone)}`}>
                  <Phone aria-hidden size={16} /> Call
                </a>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
