import { useMemo, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { EmptyState, Input, Spinner } from './core';

export interface Column<T> {
  key: string;
  header: ReactNode;
  /** Render cell; defaults to row[key] */
  render?: (row: T) => ReactNode;
  /** Value used for sorting & searching; defaults to row[key] */
  value?: (row: T) => string | number | null | undefined;
  sortable?: boolean;
  className?: string;
  /** hide on small screens */
  hideOnMobile?: boolean;
  align?: 'left' | 'right' | 'center';
}

interface Props<T> {
  rows: T[] | null | undefined;
  columns: Column<T>[];
  loading?: boolean;
  rowKey?: (row: T) => string | number;
  onRowClick?: (row: T) => void;
  searchable?: boolean;
  searchPlaceholder?: string;
  /** Extra filter controls rendered next to the search box */
  toolbar?: ReactNode;
  pageSize?: number;
  empty?: ReactNode;
  initialSort?: { key: string; dir: 'asc' | 'desc' };
  className?: string;
}

/** Client-side sortable, searchable, paginated table. */
export function DataTable<T extends Record<string, any>>({ rows, columns, loading, rowKey = (r) => r.id, onRowClick, searchable = true, searchPlaceholder = 'Search...', toolbar, pageSize = 15, empty, initialSort, className }: Props<T>) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(initialSort || null);
  const [page, setPage] = useState(1);

  const getVal = (c: Column<T>, r: T) => (c.value ? c.value(r) : r[c.key]);

  const filtered = useMemo(() => {
    let list = rows || [];
    if (q.trim()) {
      const s = q.trim().toLowerCase();
      list = list.filter((r) => columns.some((c) => String(getVal(c, r) ?? '').toLowerCase().includes(s)));
    }
    if (sort) {
      const col = columns.find((c) => c.key === sort.key);
      if (col) {
        list = [...list].sort((a, b) => {
          const va = getVal(col, a);
          const vb = getVal(col, b);
          const na = typeof va === 'number' ? va : Number(va);
          const nb = typeof vb === 'number' ? vb : Number(vb);
          const cmp = !isNaN(na) && !isNaN(nb) && va !== '' && vb !== '' && va != null && vb != null ? na - nb : String(va ?? '').localeCompare(String(vb ?? ''));
          return sort.dir === 'asc' ? cmp : -cmp;
        });
      }
    }
    return list;
  }, [rows, q, sort, columns]);

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const current = Math.min(page, pages);
  const visible = filtered.slice((current - 1) * pageSize, current * pageSize);

  const toggleSort = (key: string) => {
    setSort((s) => (!s || s.key !== key ? { key, dir: 'asc' } : s.dir === 'asc' ? { key, dir: 'desc' } : null));
  };

  return (
    <div className={clsx('card overflow-hidden', className)}>
      {(searchable || toolbar) && (
        <div className="flex flex-col gap-2 border-b border-ink-100 p-3 sm:flex-row sm:items-center">
          {searchable && (
            <div className="sm:w-72">
              <Input
                icon={<Search className="h-4 w-4" />}
                placeholder={searchPlaceholder}
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setPage(1);
                }}
              />
            </div>
          )}
          {toolbar && <div className="flex flex-1 flex-wrap items-center gap-2 sm:justify-end">{toolbar}</div>}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-ink-100 text-sm">
          <thead className="bg-ink-50/80">
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={clsx(
                    'whitespace-nowrap px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-ink-500',
                    c.hideOnMobile && 'hidden md:table-cell',
                    c.align === 'right' && 'text-right',
                    c.align === 'center' && 'text-center',
                    c.className
                  )}
                >
                  {c.sortable !== false && c.header ? (
                    <button type="button" className="inline-flex items-center gap-1 hover:text-ink-800" onClick={() => toggleSort(c.key)}>
                      {c.header}
                      {sort?.key === c.key ? sort.dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" /> : <ArrowUpDown className="h-3 w-3 opacity-40" />}
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100 bg-white">
            {loading && !rows ? (
              <tr>
                <td colSpan={columns.length}>
                  <Spinner />
                </td>
              </tr>
            ) : visible.length === 0 ? (
              <tr>
                <td colSpan={columns.length}>{empty || <EmptyState title={q ? 'No matching results' : 'Nothing here yet'} />}</td>
              </tr>
            ) : (
              visible.map((r) => (
                <tr key={rowKey(r)} onClick={onRowClick ? () => onRowClick(r) : undefined} className={clsx('transition', onRowClick && 'cursor-pointer hover:bg-brand-50/40')}>
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={clsx('px-4 py-3 align-middle text-ink-700', c.hideOnMobile && 'hidden md:table-cell', c.align === 'right' && 'text-right', c.align === 'center' && 'text-center', c.className)}
                    >
                      {c.render ? c.render(r) : (r[c.key] ?? '-')}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {filtered.length > pageSize && (
        <div className="flex items-center justify-between border-t border-ink-100 px-4 py-2.5 text-sm text-ink-500">
          <span>
            {(current - 1) * pageSize + 1}-{Math.min(current * pageSize, filtered.length)} of {filtered.length}
          </span>
          <div className="flex items-center gap-1">
            <button className="rounded-md p-1.5 hover:bg-ink-100 disabled:opacity-40" disabled={current === 1} onClick={() => setPage(current - 1)} aria-label="Previous page">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="px-2">
              {current} / {pages}
            </span>
            <button className="rounded-md p-1.5 hover:bg-ink-100 disabled:opacity-40" disabled={current === pages} onClick={() => setPage(current + 1)} aria-label="Next page">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
