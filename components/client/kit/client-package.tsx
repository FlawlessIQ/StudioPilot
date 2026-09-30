"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, LockKeyhole } from "lucide-react";
import { Actions, Button, Card, KitRoot, List, Main, Note, PoweredBy, Row } from "@/components/kit/kit";
import { SheetDialog } from "@/components/ui/sheet-dialog";
import { useWorkspace } from "@/features/auth/workspace-context";
import { couplePackageView, snapshotInclusions } from "@/features/packages/job-packages";
import { friendlyError } from "@/lib/ai/friendly-error";
import { getClientAvailablePackages, selectClientPackage } from "@/lib/client/portal-client";
import { dataIsLive } from "@/lib/runtime-mode";
import { date, money, number, text, useProjectRecords } from "@/components/client/live-client-views";

type Pkg = Record<string, unknown> & { id: string };

/** Mock mode has packages to choose from, so the page can be walked. */
const MOCK_PACKAGES: Pkg[] = [
  {
    id: "essential",
    name: "Essential",
    description: "The ceremony, portraits and first hour of the reception.",
    basePriceCents: 420000,
    currency: "USD",
    includedCoverageMinutes: 360,
    includedCoverage: [{ role: "photographer", count: 1 }],
    includedDeliverables: ["Online gallery", "Print release"],
    addOns: [{ id: "engagement", name: "Engagement session", unitPriceCents: 60000 }],
  },
  {
    id: "signature",
    name: "Signature",
    description: "Getting ready to the last dance, with a second photographer and a highlight film.",
    basePriceCents: 650000,
    currency: "USD",
    includedCoverageMinutes: 540,
    includedCoverage: [
      { role: "photographer", count: 2 },
      { role: "videographer", count: 1 },
    ],
    includedDeliverables: ["Online gallery", "Sneak peek in 72 hours", "Print release"],
    addOns: [
      { id: "engagement", name: "Engagement session", unitPriceCents: 50000 },
      { id: "album", name: "Heirloom album", unitPriceCents: 120000 },
    ],
  },
];

const inclusions = snapshotInclusions;

/**
 * The package, on a phone (M5 of docs/mobile-first-client-crew-plan-2026-09-28.md
 * brings the last couple pages into the kit).
 *
 * Once chosen it is locked, and the page says so. Before that, a couple
 * picks one (add-ons as toggles, the total beside the button) and confirms in
 * a sheet, because choosing fixes the price.
 *
 * A job can carry more than one package — GR Productions sells photo and
 * video together — and this page showed only the first snapshot the portal
 * returned, with that one package's total. It shows every package on the job
 * now, with the accepted proposal's bullets and combined total when there is
 * one (features/packages/job-packages.ts, couplePackageView).
 */
export function ClientPackage() {
  const workspace = useWorkspace();
  const snapshots = useProjectRecords("packageSnapshots");
  const proposals = useProjectRecords("proposals");
  const snapshot = snapshots.value[0];
  const [packages, setPackages] = useState<Pkg[]>(dataIsLive ? [] : MOCK_PACKAGES);
  const [loading, setLoading] = useState(dataIsLive);
  const [chosen, setChosen] = useState<string | null>(null);
  const [addOns, setAddOns] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    if (!dataIsLive || workspace.loading || !workspace.tenantId || !workspace.projectId || snapshot) {
      if (!dataIsLive || snapshot) queueMicrotask(() => setLoading(false));
      return;
    }
    let active = true;
    void getClientAvailablePackages(workspace.tenantId, workspace.projectId)
      .then((result) => active && setPackages(result.packages as Pkg[]))
      .catch((caught: unknown) => active && setError(friendlyError(caught, "Packages couldn’t be loaded.")))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [snapshot, workspace.loading, workspace.projectId, workspace.tenantId]);

  const selected = packages.find((item) => item.id === chosen) ?? null;
  const selectedAddOns = useMemo(() => {
    const list = selected && Array.isArray(selected.addOns) ? (selected.addOns as Array<Record<string, unknown>>) : [];
    return list.filter((addOn) => addOns.includes(String(addOn.id)));
  }, [addOns, selected]);
  const total = selected
    ? number(selected.basePriceCents) + selectedAddOns.reduce((sum, addOn) => sum + number(addOn.unitPriceCents), 0)
    : 0;

  const held = couplePackageView({
    snapshots: locked ? [{ id: "chosen", ...locked }] : snapshots.value,
    proposals: locked ? [] : proposals.value,
  });
  if (held) {
    const several = held.packages.length > 1;
    return (
      <Main label={several ? "Your packages" : "Your package"}>
        <div className="kit-stack-tight">
          <p className="kit-eyebrow">{several ? "Your packages" : "Your package"}</p>
          <h1 className="kit-title">
            {several ? held.packages.map((item) => item.name).join(" + ") : text(held.packages[0]?.name, "Your package")}
          </h1>
          {held.chosenAt ? (
            <p className="kit-body">
              {held.fromAcceptedProposal ? "Accepted" : "Chosen"} {date(held.chosenAt)}.
            </p>
          ) : null}
        </div>
        <Card tone="accent">
          <p className="kit-caption">{several ? "Total for everything" : "Total"}</p>
          <p className="kit-amount">{money(held.totalCents, held.currency)}</p>
          <Note icon={LockKeyhole}>Your price is locked. Changes to the studio’s packages won’t affect it.</Note>
        </Card>
        {held.packages.map((item) => (
          <div className="kit-stack-tight" key={item.key}>
            {several ? <h2 className="kit-section">{item.name}</h2> : null}
            <List label={several ? `What’s included in ${item.name}` : "What’s included"}>
              {item.items.map((line) => (
                <Row icon={Check} key={line} title={line} />
              ))}
            </List>
          </div>
        ))}
        <PoweredBy />
      </Main>
    );
  }

  async function choose() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      if (dataIsLive) {
        if (!workspace.tenantId || !workspace.projectId) throw new Error("Sign in to choose a package.");
        await selectClientPackage(
          workspace.tenantId,
          workspace.projectId,
          selected.id,
          selectedAddOns.map((addOn) => ({ addOnId: String(addOn.id), quantity: 1 })),
        );
        snapshots.refresh?.();
      }
      setLocked({
        ...selected,
        packageName: selected.name,
        totalCents: total,
        includedDeliverables: [
          ...(Array.isArray(selected.includedDeliverables) ? selected.includedDeliverables : []),
          ...selectedAddOns.map((addOn) => String(addOn.name)),
        ],
        selectionDate: new Date().toISOString(),
      });
      setConfirming(false);
      window.scrollTo({ top: 0 });
    } catch (caught: unknown) {
      setError(friendlyError(caught, "Your package couldn’t be chosen. Try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Main label="Choose your package">
        <div className="kit-stack-tight">
          <p className="kit-eyebrow">Your package</p>
          <h1 className="kit-title">Choose your coverage</h1>
          <p className="kit-body">Tap a package to choose it. Your price is fixed once you confirm.</p>
        </div>
        {error && !confirming ? (
          <p className="kit-error" role="alert">
            {error}
          </p>
        ) : null}
        {loading ? (
          <Card>
            <p className="kit-body" role="status">
              Opening packages…
            </p>
          </Card>
        ) : !packages.length ? (
          <Card>
            <p className="kit-body" role="status">
              Your studio is preparing your options. You’ll hear from them soon.
            </p>
          </Card>
        ) : null}
        {packages.map((item) => {
          const on = item.id === chosen;
          const extras = Array.isArray(item.addOns) ? (item.addOns as Array<Record<string, unknown>>) : [];
          return (
            <Card as="article" key={item.id} tone={on ? "accent" : undefined}>
              <button
                aria-pressed={on}
                className="kit-package-pick"
                onClick={() => {
                  setChosen(item.id);
                  setAddOns([]);
                }}
                type="button"
              >
                <span className="kit-section">{text(item.name, "Package")}</span>
                <strong>{money(item.basePriceCents, item.currency)}</strong>
              </button>
              {item.description ? <p className="kit-body">{text(item.description)}</p> : null}
              <ul className="kit-inclusions">
                {inclusions(item).map((line) => (
                  <li key={line}>
                    <Check aria-hidden size={16} /> {line}
                  </li>
                ))}
              </ul>
              {on && extras.length ? (
                <fieldset className="kit-stack-tight kit-fieldset">
                  <legend className="kit-subsection">Add-ons</legend>
                  {extras.map((addOn) => {
                    const id = String(addOn.id);
                    return (
                      <label className="kit-check" key={id}>
                        <input
                          checked={addOns.includes(id)}
                          onChange={(event) =>
                            setAddOns((current) =>
                              event.target.checked ? [...current, id] : current.filter((value) => value !== id),
                            )
                          }
                          type="checkbox"
                        />
                        <span>
                          {`${text(addOn.name)} · ${money(addOn.unitPriceCents, item.currency)}`}
                        </span>
                      </label>
                    );
                  })}
                </fieldset>
              ) : null}
            </Card>
          );
        })}
        <PoweredBy />
      </Main>

      {selected ? (
        <Actions>
          <div className="kit-total-bar">
            <span>
              <span className="kit-caption">Before tax</span>
              <strong>{money(total, selected.currency)}</strong>
            </span>
            <Button onClick={() => setConfirming(true)}>{`Choose ${text(selected.name, "this")}`}</Button>
          </div>
        </Actions>
      ) : null}

      <SheetDialog label={`Choose ${text(selected?.name, "this package")}?`} onClose={() => (busy ? undefined : setConfirming(false))} open={confirming && Boolean(selected)}>
        <KitRoot className="kit-embed kit-sheet" studio={{ color: workspace.tenantBrand?.primaryColor ?? null }}>
          <div className="kit-stack">
            <p className="kit-body">
              {`${money(total, selected?.currency)} before tax${selectedAddOns.length ? `, with ${selectedAddOns.map((addOn) => text(addOn.name)).join(" and ")}` : ""}. The price is fixed from now on, and your studio prepares your proposal from it.`}
            </p>
            {error ? (
              <p className="kit-error" role="alert">
                {error}
              </p>
            ) : null}
            <Button disabled={busy} onClick={() => void choose()}>
              {busy ? "Choosing…" : "Confirm"}
            </Button>
            <Button disabled={busy} onClick={() => setConfirming(false)} variant="secondary">
              Not yet
            </Button>
          </div>
        </KitRoot>
      </SheetDialog>
    </>
  );
}
