import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'

type SortDirection = 'asc' | 'desc' | null

export type ListTableColumn<T> = {
  key: string
  label: string
  value: (row: T) => string | number | boolean | null | undefined
  render?: (row: T) => ReactNode
}

type ListTableProps<T> = {
  rows: T[]
  columns: ListTableColumn<T>[]
  searchPlaceholder: string
  getRowKey: (row: T) => string | number
  emptyMessage: string
}

export function ListTable<T>({ rows, columns, searchPlaceholder, getRowKey, emptyMessage }: ListTableProps<T>) {
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
    <div className="space-y-3">
      <input value={search} onChange={event => setSearch(event.target.value)} placeholder={searchPlaceholder} className="w-full max-w-md rounded-lg border border-slate-200 px-3 py-2 text-sm" />
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>{columns.map(column => <th className="px-4 py-3" key={column.key}><button type="button" onClick={() => updateSort(column.key)} className="flex items-center gap-1 font-medium hover:text-slate-900">{column.label}<span className="text-xs text-slate-400">{sortKey === column.key ? sortDirection : ''}</span></button></th>)}</tr>
          </thead>
          <tbody>
            {visibleRows.map(row => <tr key={getRowKey(row)} className="border-t border-slate-100 hover:bg-slate-50">{columns.map(column => <td className="px-4 py-3" key={column.key}>{column.render ? column.render(row) : formatValue(column.value(row))}</td>)}</tr>)}
            {visibleRows.length === 0 && <tr><td className="px-4 py-6 text-sm text-slate-500" colSpan={columns.length}>{emptyMessage}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
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
