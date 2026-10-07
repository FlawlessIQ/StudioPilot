"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { collection, limit, query, where } from "firebase/firestore";
import type { ColumnDef } from "@tanstack/react-table";
import { Download } from "lucide-react";
import { PERSON_TYPE_LABELS, PROVIDER_LABELS, ROLE_LABELS, type ConsolePerson } from "@/features/console/model";
import { CONSOLE_ROLE_LABELS } from "@/features/console/roles";
import { relative } from "@/lib/console/format";
import { useLiveQuery } from "@/lib/console/live";
import { downloadCsv, personHref, toCsv } from "@/lib/console/studio-display";
import { Topbar } from "../console-frame";
import { DataTable } from "../data-table";
import { FilterBar, SearchInput, matches } from "../filters";
import { ActionMenu } from "../menu";
import { PeopleDialogs, usePeopleActions } from "../people-actions";
import { Button, Empty, NameCell, Notice, PageHead, Pill, Tabs, When } from "../ui";

/** Every account across StudioCue: studio staff, couples, crew, Console admins. */

type View = "all" | "studio" | "client" | "crew" | "unverified" | "disabled" | "admin";

const VIEWS: Array<{ key: View; label: string; test: (person: ConsolePerson) => boolean }> = [
  { key: "all", label: "All", test: () => true },
  { key: "studio", label: "Studio users", test: (person) => person.type === "studio" },
  { key: "client", label: "Clients", test: (person) => person.type === "client" },
  { key: "crew", label: "Crew", test: (person) => person.type === "crew" },
  { key: "unverified", label: "Unverified", test: (person) => !person.emailVerified && !person.disabled },
  { key: "disabled", label: "Disabled", test: (person) => person.disabled },
  { key: "admin", label: "Console admins", test: (person) => Boolean(person.consoleRole) },
];

function membershipsText(person: ConsolePerson): string {
  const active = person.memberships.filter((item) => item.status === "active");
  if (!active.length) return "—";
  const [first, ...rest] = active;
  return `${first!.tenantName} · ${ROLE_LABELS[first!.role] ?? first!.role}${rest.length ? ` +${rest.length}` : ""}`;
}

export function PeoplePage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const view = (VIEWS.some((item) => item.key === params.get("view")) ? params.get("view") : "all") as View;
  const [search, setSearch] = useState("");
  const actions = usePeopleActions();
  const people = useLiveQuery<ConsolePerson>("console:people", (firestore) =>
    query(collection(firestore, "consolePeople"), where("removed", "==", false), limit(5000)),
  );
  const all = people.rows;
  const counts = useMemo(() => Object.fromEntries(VIEWS.map((item) => [item.key, (all ?? []).filter(item.test).length])), [all]);
  const rows = useMemo(() => {
    if (!all) return null;
    const test = VIEWS.find((item) => item.key === view)!.test;
    return all.filter((person) => test(person) && matches(search, person.name, person.email, person.uid, ...person.memberships.map((item) => item.tenantName)));
  }, [all, view, search]);
  const setView = (next: View) => {
    const query = new URLSearchParams(params.toString());
    if (next === "all") query.delete("view");
    else query.set("view", next);
    router.replace(`${pathname}${query.size ? `?${query}` : ""}`, { scroll: false });
  };

  const columns = useMemo<ColumnDef<ConsolePerson, unknown>[]>(
    () => [
      {
        id: "person",
        header: "Person",
        accessorFn: (person) => (person.name ?? person.email ?? "").toLowerCase(),
        meta: { width: 230, flex: true },
        cell: ({ row }) => <NameCell name={row.original.name ?? row.original.email ?? "No name"} round sub={row.original.name ? row.original.email : null} />,
      },
      {
        id: "type",
        header: "Type",
        accessorFn: (person) => person.type,
        meta: { width: 124 },
        cell: ({ row }) =>
          row.original.consoleRole ? (
            <Pill tone="accent">{CONSOLE_ROLE_LABELS[row.original.consoleRole as keyof typeof CONSOLE_ROLE_LABELS] ?? "Admin"}</Pill>
          ) : (
            <Pill dot={false}>{PERSON_TYPE_LABELS[row.original.type]}</Pill>
          ),
      },
      { id: "studios", header: "Studios", accessorFn: (person) => membershipsText(person), meta: { width: 220, priority: 3 }, cell: ({ row }) => membershipsText(row.original) },
      {
        id: "method",
        header: "Sign-in",
        accessorFn: (person) => person.providers.join(","),
        meta: { width: 96, priority: 5 },
        cell: ({ row }) => row.original.providers.map((provider) => PROVIDER_LABELS[provider] ?? provider).join(", ") || "—",
      },
      {
        id: "state",
        header: "Account",
        accessorFn: (person) => (person.disabled ? 0 : person.emailVerified ? 2 : 1),
        meta: { width: 108 },
        cell: ({ row }) =>
          row.original.disabled ? <Pill tone="bad">Disabled</Pill> : row.original.emailVerified ? <Pill tone="ok">Verified</Pill> : <Pill tone="warn">Unverified</Pill>,
      },
      { id: "signin", header: "Last sign-in", accessorFn: (person) => person.lastSignInAt ?? "", meta: { width: 104, priority: 2 }, cell: ({ row }) => <When at={row.original.lastSignInAt} /> },
      { id: "active", header: "Last active", accessorFn: (person) => person.lastActiveAt ?? "", meta: { width: 100 }, cell: ({ row }) => <When at={row.original.lastActiveAt} /> },
      { id: "created", header: "Joined", accessorFn: (person) => person.createdAt ?? "", meta: { width: 92, priority: 4 }, cell: ({ row }) => <When at={row.original.createdAt} /> },
      {
        id: "menu",
        header: "",
        enableSorting: false,
        meta: { width: 44 },
        cell: ({ row }) => (
          <ActionMenu
            iconOnly
            items={[{ label: "Open", onSelect: () => router.push(personHref(row.original.uid)) }, ...actions.menuItems(row.original)]}
            label={`Actions for ${row.original.name ?? row.original.email}`}
          />
        ),
      },
    ],
    [actions, router],
  );

  return (
    <>
      <Topbar crumbs={[{ label: "Customers" }, { label: "People" }]}>
        <Button
          disabled={!rows?.length}
          onClick={() =>
            rows &&
            downloadCsv(
              `studiocue-people-${new Date().toISOString().slice(0, 10)}.csv`,
              toCsv(
                ["Name", "Email", "Type", "Console role", "Studios", "Verified", "Disabled", "Sign-in", "Last sign-in", "Last active", "Joined", "Uid"],
                rows.map((person) => [
                  person.name,
                  person.email,
                  PERSON_TYPE_LABELS[person.type],
                  person.consoleRole,
                  person.memberships.map((item) => `${item.tenantName} (${item.role})`).join("; "),
                  person.emailVerified ? "yes" : "no",
                  person.disabled ? "yes" : "",
                  person.providers.join(" "),
                  person.lastSignInAt,
                  person.lastActiveAt,
                  person.createdAt,
                  person.uid,
                ]),
              ),
            )
          }
        >
          <Download size={13} />
          Export CSV
        </Button>
      </Topbar>
      <div className="cx-content">
        <PageHead count={all?.length ?? null} title="People" />
        {people.error ? <Notice tone="bad">{people.error}</Notice> : null}
        <Tabs label="People views" onChange={setView} tabs={VIEWS.map((item) => ({ key: item.key, label: item.label, count: all ? counts[item.key] : null }))} value={view} />
        <FilterBar>
          <SearchInput id="people-search" onChange={setSearch} placeholder="Filter by name, email or studio" value={search} />
        </FilterBar>
        <DataTable
          columns={columns}
          empty={all?.length === 0 ? <Empty title="No people rows yet">Open Studios and choose Refresh to build them.</Empty> : <Empty title="No one matches" />}
          getRowId={(person) => person.uid}
          initialSort={[{ id: "active", desc: true }]}
          label="People"
          mobile={(person) => ({
            title: person.name ?? person.email ?? "No name",
            end: person.disabled ? <Pill tone="bad">Disabled</Pill> : <Pill dot={false}>{PERSON_TYPE_LABELS[person.type]}</Pill>,
            meta: [person.email, membershipsText(person), relative(person.lastActiveAt ?? person.lastSignInAt)].filter(Boolean).join(" · "),
          })}
          onRowClick={(person) => router.push(personHref(person.uid))}
          rows={rows}
        />
      </div>
      <PeopleDialogs actions={actions} />
    </>
  );
}
