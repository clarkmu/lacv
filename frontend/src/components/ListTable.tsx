import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { ArrowDown, ArrowUp, ChevronsUpDown, Columns3, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'

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

/**
 * The LACV data table: a toolbar of list filters, then a sortable table that scrolls inside its own frame
 * with a sticky header and a pinned first (identity) column. Search runs over every column, shown or not.
 */
export function ListTable<T>({ rows, columns, searchPlaceholder, getRowKey, emptyMessage, filters }: ListTableProps<T>) {
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState('')
  const [sortDirection, setSortDirection] = useState<SortDirection>(null)
  const [hiddenKeys, setHiddenKeys] = useState<string[]>([])
  const shownColumns = columns.filter((column, index) => index === 0 || !hiddenKeys.includes(column.key))

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
    <div className="overflow-hidden rounded-md border bg-card shadow-xs">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b bg-card px-3 py-2">
        <div className="relative w-full max-w-md">
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder={searchPlaceholder} aria-label="Filter" className="h-8 pl-8" />
        </div>
        {filters}
        <div className="ml-auto flex items-center gap-2">
          <p className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
            {visibleRows.length === rows.length ? `${rows.length} ${rows.length === 1 ? 'row' : 'rows'}` : `${visibleRows.length} of ${rows.length} rows`}
          </p>
          {columns.length > 2 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 text-muted-foreground"><Columns3 aria-hidden="true" />Columns</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuLabel className="text-xs text-muted-foreground">Show columns</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {columns.slice(1).map(column => (
                  <DropdownMenuCheckboxItem
                    key={column.key}
                    checked={!hiddenKeys.includes(column.key)}
                    onSelect={event => event.preventDefault()}
                    onCheckedChange={checked => setHiddenKeys(keys => checked ? keys.filter(key => key !== column.key) : [...keys, column.key])}
                  >
                    {column.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
      <Table containerClassName="max-h-[calc(100vh-12rem)] min-h-40 overflow-auto" className="border-separate border-spacing-0 text-[13px]">
        <TableHeader className="[&_tr]:border-0">
          <TableRow className="hover:bg-transparent">
            {shownColumns.map((column, index) => {
              const direction = sortKey === column.key ? sortDirection : null
              return (
                <TableHead
                  key={column.key}
                  scope="col"
                  aria-sort={direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : 'none'}
                  className={cn(
                    'sticky top-0 h-8 border-b bg-muted px-3 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase',
                    index === 0 ? 'left-0 z-20 border-r' : 'z-10',
                  )}
                >
                  <button type="button" onClick={() => updateSort(column.key)} className={cn('group inline-flex items-center gap-1 rounded-sm hover:text-foreground', column.numeric && 'w-full justify-end', direction && 'text-foreground')}>
                    {column.label}
                    <SortIndicator direction={direction} />
                  </button>
                </TableHead>
              )
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {visibleRows.map(row => (
            <TableRow key={getRowKey(row)} className="group border-0 hover:bg-transparent">
              {shownColumns.map((column, index) => (
                // Opaque cell backgrounds so the pinned first column stays readable while the table scrolls sideways.
                <TableCell
                  key={column.key}
                  className={cn(
                    'border-b border-border/70 bg-card px-3 py-1.5 text-foreground/85 group-hover:bg-accent/60',
                    column.numeric && 'text-right tabular-nums',
                    index === 0 && 'sticky left-0 z-[1] border-r',
                  )}
                >
                  {column.render ? column.render(row) : formatValue(column.value(row))}
                </TableCell>
              ))}
            </TableRow>
          ))}
          {visibleRows.length === 0 && (
            <TableRow className="hover:bg-transparent">
              <TableCell className="px-3 py-10 text-center text-muted-foreground" colSpan={shownColumns.length}>
                {emptyMessage}
                {search && <Button type="button" variant="link" size="sm" onClick={() => setSearch('')} className="ml-1">Clear search</Button>}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}

// A small arrow shows the active sort; unsorted columns show a faint double arrow on hover. The <th> carries aria-sort.
function SortIndicator({ direction }: { direction: SortDirection }) {
  if (direction === 'asc') return <ArrowUp aria-hidden="true" className="size-3 text-primary" />
  if (direction === 'desc') return <ArrowDown aria-hidden="true" className="size-3 text-primary" />
  return <ChevronsUpDown aria-hidden="true" className="size-3 opacity-0 group-hover:opacity-60 group-focus-visible:opacity-60" />
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
