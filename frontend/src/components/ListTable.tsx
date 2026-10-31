import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { buttonClass, inputClass } from './ui'

type SortDirection = 'asc' | 'desc' | null

export type ListTableColumn<T> = {
  key: string
  label: string
  value: (row: T) => string | number | boolean | null | undefined
  render?: (row: T) => ReactNode
  /** Right-align with tabular figures so quantities and counts line up. */
  numeric?: boolean
}

type ListTableProps<T> = {
  rows: T[]
  columns: ListTableColumn<T>[]
  searchPlaceholder: string
  getRowKey: (row: T) => string | number
  emptyMessage: string
  /** Extra filter controls shown beside the search field. */
  filters?: ReactNode
}

export function ListTable<T>({ rows, columns, searchPlaceholder, getRowKey, emptyMessage, filters }: ListTableProps<T>) {
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState('')
  const [sortDirection, setSortDirection] = useState<SortDirection>(null)

  const visibleRows = useMemo(() => {
    const term = search.trim().toLowerCase()
    const filtered = term
      ? rows.filter(row => columns.some(column => String(column.value(row) ?? '').toLowerCase().includes(term)))
      : rows
    const column = columns.find(column => column.key === sortKey)
    if (!column || !sortDirection) return filtered
    const sorted = [...filtered].sort((left, right) => compareValues(
      column.value(left),
      column.value(right),
    ))
    return sortDirection === 'asc' ? sorted : sorted.reverse()
  }, [columns, rows, search, sortDirection, sortKey])

  function updateSort(nextKey: string) {
    if (nextKey === sortKey) {
      if (sortDirection === 'asc') {
        setSortDirection('desc')
        return
      }
      setSortKey('')
      setSortDirection(null)
      return
    }
    setSortKey(nextKey)
    setSortDirection('asc')
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="relative w-full max-w-md">
          <SearchIcon />
          <input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder={searchPlaceholder} aria-label="Filter" className={`${inputClass} w-full pl-8`} />
        </div>
        {filters}
        <p className="ml-auto text-xs text-slate-500 tabular-nums" aria-live="polite">
          {visibleRows.length === rows.length ? `${rows.length} ${rows.length === 1 ? 'row' : 'rows'}` : `${visibleRows.length} of ${rows.length} rows`}
        </p>
      </div>
      <div className="max-h-[calc(100vh-11rem)] min-h-40 overflow-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full border-separate border-spacing-0 text-left text-sm">
          <thead>
            <tr>
              {columns.map((column, index) => {
                const direction = sortKey === column.key ? sortDirection : null
                return (
                  <th
                    key={column.key}
                    scope="col"
                    aria-sort={direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : 'none'}
                    className={`sticky top-0 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold tracking-wide whitespace-nowrap text-slate-500 uppercase ${index === 0 ? 'left-0 z-20 border-r border-r-slate-100' : 'z-10'}`}
                  >
                    <button type="button" onClick={() => updateSort(column.key)} className={`group inline-flex items-center gap-1 rounded hover:text-slate-900 ${column.numeric ? 'w-full justify-end' : ''} ${direction ? 'text-slate-900' : ''}`}>
                      {column.label}
                      <SortIndicator direction={direction} />
                    </button>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map(row => (
              <tr key={getRowKey(row)} className="group">
                {columns.map((column, index) => (
                  // Opaque cell backgrounds so the pinned first column stays readable while the table scrolls sideways.
                  <td key={column.key} className={`border-b border-slate-100 bg-white px-3 py-2 whitespace-nowrap text-slate-700 group-hover:bg-slate-50 ${column.numeric ? 'text-right tabular-nums' : ''} ${index === 0 ? 'sticky left-0 z-[1] border-r border-r-slate-100' : ''}`}>
                    {column.render ? column.render(row) : formatValue(column.value(row))}
                  </td>
                ))}
              </tr>
            ))}
            {visibleRows.length === 0 && (
              <tr>
                <td className="px-3 py-10 text-center text-sm text-slate-500" colSpan={columns.length}>
                  {emptyMessage}
                  {search && <button type="button" onClick={() => setSearch('')} className={`${buttonClass.quiet} ml-2`}>Clear search</button>}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SearchIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-slate-400">
      <circle cx="8.5" cy="8.5" r="5.5" />
      <path d="m13 13 4 4" strokeLinecap="round" />
    </svg>
  )
}

// A small arrow shows the active sort; unsorted columns show a faint double arrow on hover. The <th> carries aria-sort.
function SortIndicator({ direction }: { direction: SortDirection }) {
  if (direction) {
    return (
      <svg aria-hidden="true" viewBox="0 0 12 12" className="h-3 w-3 text-indigo-600" fill="currentColor">
        {direction === 'asc' ? <path d="M6 2.5 10 8H2z" /> : <path d="M6 9.5 2 4h8z" />}
      </svg>
    )
  }
  return (
    <svg aria-hidden="true" viewBox="0 0 12 12" className="h-3 w-3 text-slate-300 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" fill="currentColor">
      <path d="M6 1.5 9 5H3zM6 10.5 3 7h6z" />
    </svg>
  )
}

function compareValues(left: unknown, right: unknown) {
  if (typeof left === 'number' && typeof right === 'number') return left - right
  if (typeof left === 'boolean' && typeof right === 'boolean') return Number(left) - Number(right)
  return String(left ?? '').localeCompare(String(right ?? ''), undefined, { numeric: true, sensitivity: 'base' })
}

function formatValue(value: unknown) {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  return String(value ?? '')
}
