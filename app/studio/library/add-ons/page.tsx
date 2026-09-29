import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { AddOnLibrary } from "@/components/library/add-on-library";

export const metadata: Metadata = { title: "Add-ons" };

export default function AddOnsPage() {
  return (
    <AppShell active="Library">
      <div className="hub-page">
        <header className="page-heading">
          <div>
            <p className="eyebrow">Library</p>
            <h1>Add-ons</h1>
            <p>
              The extras you sell on top of a package. A package can suggest them, and you choose them per job —
              the price a couple already has never changes.
            </p>
          </div>
        </header>
        <AddOnLibrary />
      </div>
    </AppShell>
  );
}
