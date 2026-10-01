"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type RowSelectionState,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button, Empty } from "./ui";

/**
 * The Console's one table (docs/console.md, "Tables").
 *
 * Fixed column widths and truncation, so no cell wraps into its neighbour;
 * names left, numbers right; a select column when the page has bulk actions;
 * sorting, paging, a loading state, an empty state, and on a phone the same
 * rows as compact two-line rows instead of a table you scroll sideways.
 *
 * Columns fit the window instead of scrolling sideways: one column (the
 * name) flexes, and columns with a `priority` drop out, highest number first,
 * when the table is too narrow to show them all.
 *
 * Filtering is the page's job (view tabs and chips decide what `rows` is), so
 * the counts in those tabs and the rows here can never disagree.
 */

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData, TValue> {
    align?: "right";
    /** Fixed width in px; for the flexing column, its minimum. */
    width?: number;
    /** Takes the space left over. One per table, usually the name. */
    flex?: boolean;
    /** Dropped when the table is too narrow; higher numbers go first. */
    priority?: number;
  }
}

export type MobileRow = { lead?: ReactNode; title: ReactNode; meta?: ReactNode; end?: ReactNode };

type DataTableProps<Row> = {
  rows: Row[] | null;
  columns: ColumnDef<Row, unknown>[];
  getRowId: (row: Row) => string;
  /** Accessible name for the table. */
  label: string;
  initialSort?: SortingState;
  selectable?: boolean;
  selection?: RowSelectionState;
  onSelectionChange?: (selection: RowSelectionState) => void;
  onRowClick?: (row: Row) => void;
  activeRowId?: string | null;
  mobile?: (row: Row) => MobileRow;
  empty?: ReactNode;
  footer?: ReactNode;
  pageSize?: number;
  /** Rows to draw while loading. */
  skeletonRows?: number;
};

export function DataTable<Row>({
  rows,
  columns,
  getRowId,
  label,
  initialSort = [],
  selectable = false,
  selection,
  onSelectionChange,
  onRowClick,
  activeRowId,
  mobile,
  empty,
  footer,
  pageSize = 50,
  skeletonRows = 8,
}: DataTableProps<Row>) {
  const [sorting, setSorting] = useState<SortingState>(initialSort);
  const [ownSelection, setOwnSelection] = useState<RowSelectionState>({});
  const rowSelection = selection ?? ownSelection;
  const data = useMemo(() => rows ?? [], [rows]);
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    const element = wrap.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => setWidth(entries[0]?.contentRect.width ?? null));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const allColumns = useMemo<ColumnDef<Row, unknown>[]>(() => {
    if (!selectable) return columns;
    const select: ColumnDef<Row, unknown> = {
      id: "__select",
      enableSorting: false,
      meta: { width: 36 },
      header: ({ table }) => (
        <input
          aria-label="Select all on this page"
          checked={table.getIsAllPageRowsSelected()}
          className="cx-checkbox"
          onChange={table.getToggleAllPageRowsSelectedHandler()}
          ref={(element) => {
            if (element) element.indeterminate = table.getIsSomePageRowsSelected();
          }}
          type="checkbox"
        />
      ),
      cell: ({ row }) => (
        <input
          aria-label="Select row"
          checked={row.getIsSelected()}
          className="cx-checkbox"
          onChange={row.getToggleSelectedHandler()}
          onClick={(event) => event.stopPropagation()}
          type="checkbox"
        />
      ),
    };
    return [select, ...columns];
  }, [columns, selectable]);

  const columnVisibility = useMemo<VisibilityState>(() => {
    if (!width) return {};
    const cell = (column: ColumnDef<Row, unknown>) => (column.meta?.width ?? 120) + (column.meta?.flex ? 40 : 0);
    const idOf = (column: ColumnDef<Row, unknown>) => column.id ?? String((column as { accessorKey?: string }).accessorKey ?? "");
    let total = allColumns.reduce((sum, column) => sum + cell(column), 0);
    const hidden: VisibilityState = {};
    const droppable = allColumns
      .filter((column) => (column.meta?.priority ?? 0) > 0)
      .sort((a, b) => (b.meta?.priority ?? 0) - (a.meta?.priority ?? 0));
    for (const column of droppable) {
      if (total <= width) break;
      hidden[idOf(column)] = false;
      total -= cell(column);
    }
    return hidden;
  }, [allColumns, width]);

  const table = useReactTable({
    data,
    columns: allColumns,
    getRowId,
    state: { sorting, rowSelection, columnVisibility },
    onSortingChange: setSorting,
    onRowSelectionChange: (updater) => {
      const next = typeof updater === "function" ? updater(rowSelection) : updater;
      if (onSelectionChange) onSelectionChange(next);
      else setOwnSelection(next);
    },
    enableRowSelection: selectable,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageIndex: 0, pageSize } },
    autoResetPageIndex: false,
  });

  // A filter that shrinks the list must not leave the table on an empty page.
  const pageCount = table.getPageCount();
  const pageIndex = table.getState().pagination.pageIndex;
  useEffect(() => {
    if (pageIndex > 0 && pageIndex >= pageCount) table.setPageIndex(Math.max(0, pageCount - 1));
  }, [pageCount, pageIndex, table]);

  const loading = rows === null;
  const pageRows = table.getRowModel().rows;
  const total = data.length;
  const first = total === 0 ? 0 : pageIndex * pageSize + 1;
  const last = Math.min(total, (pageIndex + 1) * pageSize);

  return (
    <div className="cx-table-wrap" ref={wrap}>
      <div className="cx-table-scroll" data-mobile={mobile ? "list" : undefined}>
        <table aria-busy={loading} aria-label={label} className="cx-table">
          <colgroup>
            {table.getVisibleLeafColumns().map((column) => (
              <col key={column.id} style={column.columnDef.meta?.width && !column.columnDef.meta.flex ? { width: column.columnDef.meta.width } : undefined} />
            ))}
          </colgroup>
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => {
                  const sorted = header.column.getIsSorted();
                  const align = header.column.columnDef.meta?.align;
                  return (
                    <th
                      aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined}
                      className="cx-th"
                      data-align={align}
                      data-select={header.column.id === "__select" ? "true" : undefined}
                      data-sorted={sorted ? "true" : undefined}
                      key={header.id}
                      scope="col"
                    >
                      {header.isPlaceholder ? null : header.column.getCanSort() ? (
                        <button className="cx-sort" onClick={header.column.getToggleSortingHandler()} type="button">
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {sorted ? <span aria-hidden className="cx-sort-mark">{sorted === "asc" ? "↑" : "↓"}</span> : null}
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: skeletonRows }, (_, index) => (
                  <tr className="cx-row" key={`skeleton-${index}`}>
                    {table.getVisibleLeafColumns().map((column) => (
                      <td className="cx-td" key={column.id}>
                        <span className="cx-skeleton" style={{ width: column.id === "__select" ? 14 : `${50 + ((index * 17 + column.id.length * 7) % 40)}%` }} />
                      </td>
                    ))}
                  </tr>
                ))
              : pageRows.map((row) => (
                  <tr
                    className="cx-row"
                    data-active={activeRowId && row.id === activeRowId ? "true" : undefined}
                    data-clickable={onRowClick ? "true" : undefined}
                    data-selected={row.getIsSelected() ? "true" : undefined}
                    key={row.id}
                    onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                    onKeyDown={(event) => {
                      if (event.target !== event.currentTarget) return;
                      // j/k or the arrows move between rows, Enter opens, x selects.
                      const step = event.key === "ArrowDown" || event.key === "j" ? 1 : event.key === "ArrowUp" || event.key === "k" ? -1 : 0;
                      if (step) {
                        event.preventDefault();
                        const sibling = (step > 0 ? event.currentTarget.nextElementSibling : event.currentTarget.previousElementSibling) as HTMLElement | null;
                        sibling?.focus();
                      } else if (event.key === "Enter" && onRowClick) onRowClick(row.original);
                      else if (event.key === "x" && selectable) {
                        event.preventDefault();
                        row.toggleSelected();
                      }
                    }}
                    tabIndex={onRowClick || selectable ? 0 : undefined}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td
                        className="cx-td"
                        data-align={cell.column.columnDef.meta?.align}
                        data-select={cell.column.id === "__select" ? "true" : undefined}
                        key={cell.id}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))}
          </tbody>
        </table>
      </div>

      {mobile ? (
        <div className="cx-mlist">
          {loading
            ? Array.from({ length: 5 }, (_, index) => (
                <div className="cx-mrow" key={`m-skeleton-${index}`}>
                  <span className="cx-skeleton" style={{ width: "60%", gridColumn: "1 / 4" }} />
                </div>
              ))
            : pageRows.map((row) => {
                const item = mobile(row.original);
                return (
                  <div
                    className="cx-mrow"
                    data-selected={row.getIsSelected() ? "true" : undefined}
                    key={row.id}
                    onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                    onKeyDown={onRowClick ? (event) => event.key === "Enter" && onRowClick(row.original) : undefined}
                    role={onRowClick ? "button" : undefined}
                    tabIndex={onRowClick ? 0 : undefined}
                  >
                    {item.lead ? <span className="cx-mrow-lead">{item.lead}</span> : null}
                    <span className="cx-mrow-title" style={item.lead ? undefined : { gridColumn: "1 / 3" }}>
                      {item.title}
                    </span>
                    {item.end ? <span className="cx-mrow-end">{item.end}</span> : <span />}
                    {item.meta ? (
                      <span className="cx-mrow-meta" style={item.lead ? undefined : { gridColumn: "1 / 4" }}>
                        {item.meta}
                      </span>
                    ) : null}
                  </div>
                );
              })}
        </div>
      ) : null}

      {!loading && total === 0 ? empty ?? <Empty title="Nothing here">No rows match this view.</Empty> : null}

      {total > 0 || footer ? (
        <div className="cx-table-foot">
          <span className="cx-num">{total > 0 ? (total > pageSize ? `${first}–${last} of ${total}` : `${total} ${total === 1 ? "row" : "rows"}`) : ""}</span>
          {footer}
          {pageCount > 1 ? (
            <span className="cx-table-foot-end">
              <Button aria-label="Previous page" disabled={!table.getCanPreviousPage()} icon onClick={() => table.previousPage()} size="sm" variant="ghost">
                <ChevronLeft size={14} />
              </Button>
              <Button aria-label="Next page" disabled={!table.getCanNextPage()} icon onClick={() => table.nextPage()} size="sm" variant="ghost">
                <ChevronRight size={14} />
              </Button>
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
