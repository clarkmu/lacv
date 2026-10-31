import { useMemo, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ListOrdered, RotateCcw, Save, TriangleAlert } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'
import { api, ApiError } from '../api'
import { errorClass, inputClass } from '../components/common'
import type { BatchDetail, BatchSampleRow, SampleType, StorageLocation } from '../types'

const STATUSES = ['expected', 'received', 'available', 'consumed', 'disposed']

type Field = 'subject_code' | 'sample_type_id' | 'aliquot_number' | 'external_sample_id' | 'collection_date' | 'received_date' | 'current_quantity' | 'quantity_unit' | 'storage_location_id' | 'status'
type Draft = Partial<Record<Field, string>>

/** Text values of a row, as the cells edit them. */
function cellValues(row: BatchSampleRow): Record<Field, string> {
  return {
    subject_code: row.subject_code ?? '',
    sample_type_id: row.sample_type_id === null ? '' : String(row.sample_type_id),
    aliquot_number: row.aliquot_number === null ? '' : String(row.aliquot_number),
    external_sample_id: row.external_sample_id ?? '',
    collection_date: row.collection_date?.slice(0, 10) ?? '',
    received_date: row.received_date?.slice(0, 10) ?? '',
    current_quantity: row.current_quantity === null ? '' : String(Number(row.current_quantity)),
    quantity_unit: row.quantity_unit ?? '',
    storage_location_id: row.storage_location_id === null ? '' : String(row.storage_location_id),
    status: row.status,
  }
}

/** The request value for an edited cell; blank clears it. */
function requestValue(field: Field, text: string, row: BatchSampleRow): unknown {
  const value = text.trim()
  if (field === 'sample_type_id' || field === 'storage_location_id' || field === 'aliquot_number') return value === '' ? null : Number(value)
  if (field === 'collection_date' || field === 'received_date') {
    if (!value) return null
    // Keep the original time of day when only the date is edited.
    const original = row[field]
    return `${value}T${original && original.length > 10 ? original.slice(11, 19) : '00:00:00'}`
  }
  return value === '' ? null : value
}

/** A shipping batch: its root Samples, editable as a table, row by row or several rows at once. */
export function BatchPage() {
  const { id = '' } = useParams()
  const query = useQuery({ queryKey: ['batch', id], queryFn: () => api.getBatch(id) })
  const types = useQuery({ queryKey: ['sample-types'], queryFn: api.listSampleTypes })
  const locations = useQuery({ queryKey: ['storage-locations'], queryFn: api.listStorageLocations })
  if (query.isLoading) return <p className="py-6 text-sm text-muted-foreground">Loading batch…</p>
  if (!query.data) return <p className="py-6 text-sm text-muted-foreground">Batch not found.</p>
  return <BatchEditor batch={query.data} types={types.data ?? []} locations={locations.data ?? []} />
}

function BatchEditor({ batch, types, locations }: { batch: BatchDetail; types: SampleType[]; locations: StorageLocation[] }) {
  const client = useQueryClient()
  const [drafts, setDrafts] = useState<Record<number, Draft>>({})
  const [selected, setSelected] = useState<number[]>([])
  const rows = batch.samples
  const changedIds = rows.filter(row => Object.keys(drafts[row.sample_id] ?? {}).length > 0).map(row => row.sample_id)

  const save = useMutation({
    mutationFn: (changes: Record<string, unknown>[]) => api.updateBatchSamples(batch.batch_id, { changes }),
    onSuccess: data => {
      client.setQueryData(['batch', String(batch.batch_id)], data)
      client.invalidateQueries({ queryKey: ['samples'] })
      client.invalidateQueries({ queryKey: ['batches'] })
      for (const sampleId of changedIds) client.invalidateQueries({ queryKey: ['sample', String(sampleId)] })
      setDrafts({})
    },
  })
  const changes = useMemo(() => changedIds.map(sampleId => {
    const row = rows.find(candidate => candidate.sample_id === sampleId)!
    const draft = drafts[sampleId]!
    return { sample_id: sampleId, ...Object.fromEntries(Object.entries(draft).map(([field, text]) => [field, requestValue(field as Field, text ?? '', row)])) }
  }), [changedIds, drafts, rows])
  // Errors come back per change ("changes.2.aliquot_number"); map them to the Sample and field they are about.
  const cellErrors = useMemo(() => {
    const errors: Record<string, string> = {}
    if (save.error instanceof ApiError) {
      for (const [path, message] of Object.entries(save.error.fieldErrors)) {
        const match = /^changes\.(\d+)\.(\w+)$/.exec(path)
        const change = match && (save.variables?.[Number(match[1])] as { sample_id: number } | undefined)
        if (change) errors[`${change.sample_id}.${match[2]}`] = message
      }
    }
    return errors
  }, [save.error, save.variables])
  const unplacedError = save.error && Object.keys(cellErrors).length === 0 ? save.error.message : null

  function edit(row: BatchSampleRow, field: Field, text: string) {
    setDrafts(current => {
      const draft = { ...current[row.sample_id] }
      if (text === cellValues(row)[field]) delete draft[field]
      else draft[field] = text
      return { ...current, [row.sample_id]: draft }
    })
  }

  function assign(field: Field, text: string) {
    for (const row of rows.filter(row => selected.includes(row.sample_id))) edit(row, field, text)
  }

  function numberAliquots(start: number) {
    rows.filter(row => selected.includes(row.sample_id)).forEach((row, index) => edit(row, 'aliquot_number', String(start + index)))
  }

  const allSelected = selected.length === rows.length && rows.length > 0
  const subjects = new Set(rows.map(row => row.subject_code).filter(Boolean)).size
  return (
    <div className="space-y-3">
      <header className="space-y-1.5">
        <Breadcrumb>
          <BreadcrumbList className="text-xs">
            <BreadcrumbItem><BreadcrumbLink asChild><Link to="/batches">Batches</Link></BreadcrumbLink></BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem><BreadcrumbPage className="font-mono">{batch.batch_code}</BreadcrumbPage></BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <h1 className="text-lg font-semibold tracking-tight"><span className="font-mono">{batch.batch_code}</span> <span className="font-normal text-muted-foreground">· {batch.batch_name}</span></h1>
        <p className="text-[13px] text-muted-foreground tabular-nums">
          {rows.length} root {rows.length === 1 ? 'sample' : 'samples'}{subjects > 0 && <> from {subjects} {subjects === 1 ? 'subject' : 'subjects'}</>}. Derived samples are made from each sample's own page and are not part of the batch.
        </p>
      </header>

      <BulkBar
        count={selected.length} types={types} locations={locations}
        onAssign={assign} onNumber={numberAliquots} onClear={() => setSelected([])}
      />

      <div className="overflow-x-auto rounded-md border bg-card shadow-xs">
        <table className="w-full min-w-[72rem] border-collapse text-[13px]" aria-label="Batch samples">
          <thead className="sticky top-0 z-10 bg-muted/70 text-left text-xs text-muted-foreground">
            <tr>
              <th className="w-8 border-b px-2 py-1.5"><Checkbox aria-label="Select all samples" checked={allSelected ? true : selected.length ? 'indeterminate' : false} onCheckedChange={checked => setSelected(checked === true ? rows.map(row => row.sample_id) : [])} /></th>
              {['Sample', 'Subject', 'Material', 'Aliquot #', 'External ID', 'Collected', 'Received', 'Quantity', 'Storage', 'Status', 'Derived'].map(label => (
                <th key={label} className={cn('border-b px-2 py-1.5 font-medium whitespace-nowrap', (label === 'Quantity' || label === 'Derived' || label === 'Aliquot #') && 'text-right')}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <BatchRow
                key={row.sample_id} row={row} rowIndex={rowIndex} draft={drafts[row.sample_id] ?? {}} errors={cellErrors}
                types={types} locations={locations}
                selected={selected.includes(row.sample_id)}
                onSelect={checked => setSelected(current => (checked ? [...current, row.sample_id] : current.filter(id => id !== row.sample_id)))}
                onEdit={(field, text) => edit(row, field, text)}
              />
            ))}
            {!rows.length && <tr><td colSpan={12} className="px-3 py-4 text-sm text-muted-foreground">No samples in this batch.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className={cn('sticky bottom-0 flex flex-wrap items-center gap-3 rounded-md border bg-card px-3 py-2 shadow-sm', !changedIds.length && !save.error && 'hidden')} aria-label="Unsaved changes">
        <span className="text-[13px] tabular-nums"><span className="font-medium">{changedIds.length}</span> {changedIds.length === 1 ? 'sample' : 'samples'} changed</span>
        {Object.keys(cellErrors).length > 0 && <span role="alert" className="inline-flex items-center gap-1 text-xs text-destructive"><TriangleAlert aria-hidden="true" className="size-3.5" />Nothing was saved: {Object.keys(cellErrors).length === 1 ? 'one cell needs' : `${Object.keys(cellErrors).length} cells need`} attention.</span>}
        {unplacedError && <p role="alert" className={cn(errorClass, 'py-1')}>{unplacedError}</p>}
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="sm" disabled={save.isPending} onClick={() => { setDrafts({}); save.reset() }}><RotateCcw aria-hidden="true" />Discard</Button>
          <Button size="sm" disabled={save.isPending || !changedIds.length} onClick={() => save.mutate(changes)}><Save aria-hidden="true" />{save.isPending ? 'Saving…' : 'Save changes'}</Button>
        </div>
      </div>
    </div>
  )
}

function BulkBar({ count, types, locations, onAssign, onNumber, onClear }: {
  count: number; types: SampleType[]; locations: StorageLocation[]
  onAssign: (field: Field, text: string) => void; onNumber: (start: number) => void; onClear: () => void
}) {
  const [material, setMaterial] = useState('')
  const [storage, setStorage] = useState('')
  const [status, setStatus] = useState('')
  const [start, setStart] = useState('1')
  return (
    <section aria-label="Set for selected samples" className={cn('flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border px-3 py-2 text-[13px]', count ? 'border-primary/30 bg-accent/40' : 'bg-card text-muted-foreground')}>
      <span className="font-medium tabular-nums">{count ? `${count} selected` : 'Select rows to set values on several samples at once'}</span>
      <BulkControl label="Material" disabled={!count || !material} onApply={() => onAssign('sample_type_id', material)}>
        <select aria-label="Material for selected" value={material} disabled={!count} onChange={event => setMaterial(event.target.value)} className={cn(inputClass, 'h-7')}>
          <option value="">Material…</option>
          {types.map(type => <option key={type.sample_type_id} value={type.sample_type_id}>{type.type_name}</option>)}
        </select>
      </BulkControl>
      <BulkControl label="Storage" disabled={!count || !storage} onApply={() => onAssign('storage_location_id', storage === 'none' ? '' : storage)}>
        <select aria-label="Storage for selected" value={storage} disabled={!count} onChange={event => setStorage(event.target.value)} className={cn(inputClass, 'h-7')}>
          <option value="">Storage…</option>
          <option value="none">No location</option>
          {locations.map(location => <option key={location.storage_location_id} value={location.storage_location_id}>{location.location_code}</option>)}
        </select>
      </BulkControl>
      <BulkControl label="Status" disabled={!count || !status} onApply={() => onAssign('status', status)}>
        <select aria-label="Status for selected" value={status} disabled={!count} onChange={event => setStatus(event.target.value)} className={cn(inputClass, 'h-7')}>
          <option value="">Status…</option>
          {STATUSES.map(value => <option key={value} value={value}>{value}</option>)}
        </select>
      </BulkControl>
      <span className="inline-flex items-center gap-1.5" title="Aliquot numbers tell apart one subject's tubes of the same Material, so each selected row gets its own number, in table order.">
        <label htmlFor="aliquot-start" className="text-xs text-muted-foreground">Aliquots from</label>
        <input id="aliquot-start" type="number" min="1" value={start} disabled={!count} onChange={event => setStart(event.target.value)} className={cn(inputClass, 'h-7 w-14 text-right tabular-nums')} />
        <Button type="button" variant="outline" size="sm" className="h-7" disabled={!count || !(Number(start) >= 1)} onClick={() => onNumber(Number(start))}><ListOrdered aria-hidden="true" />Number in order</Button>
      </span>
      {count > 0 && <Button type="button" variant="ghost" size="sm" className="ml-auto h-7" onClick={onClear}>Clear selection</Button>}
    </section>
  )
}

function BulkControl({ label, disabled, onApply, children }: { label: string; disabled: boolean; onApply: () => void; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1">
      {children}
      <Button type="button" variant="outline" size="sm" className="h-7" disabled={disabled} onClick={onApply} aria-label={`Set ${label.toLowerCase()} on selected samples`}>Set</Button>
    </span>
  )
}

const COLUMNS: Field[] = ['subject_code', 'sample_type_id', 'aliquot_number', 'external_sample_id', 'collection_date', 'received_date', 'current_quantity', 'storage_location_id', 'status']

/** Enter moves to the same column on the next row, as in a spreadsheet. */
function moveDown(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== 'Enter') return
  const cell = event.currentTarget
  const next = document.querySelector<HTMLElement>(`[data-cell="${Number(cell.dataset.row) + (event.shiftKey ? -1 : 1)}:${cell.dataset.col}"]`)
  if (next) {
    event.preventDefault()
    next.focus()
  }
}

function BatchRow({ row, rowIndex, draft, errors, types, locations, selected, onSelect, onEdit }: {
  row: BatchSampleRow; rowIndex: number; draft: Draft; errors: Record<string, string>; types: SampleType[]; locations: StorageLocation[]
  selected: boolean; onSelect: (checked: boolean) => void; onEdit: (field: Field, text: string) => void
}) {
  const saved = cellValues(row)
  const value = (field: Field) => draft[field] ?? saved[field]
  const cell = (field: Field) => {
    const error = errors[`${row.sample_id}.${field}`]
    return {
      value: value(field),
      onChange: (event: { target: { value: string } }) => onEdit(field, event.target.value),
      onKeyDown: moveDown,
      'data-cell': `${rowIndex}:${COLUMNS.indexOf(field)}`,
      'data-row': rowIndex,
      'data-col': COLUMNS.indexOf(field),
      'aria-invalid': error ? true : undefined,
      title: error,
      className: cn(
        'h-7 w-full min-w-0 rounded-sm border border-transparent bg-transparent px-1.5 hover:border-input focus-visible:border-ring focus-visible:bg-card focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none',
        field in draft && 'bg-amber-50 dark:bg-amber-950/40',
        error && 'border-destructive bg-destructive/5',
      ),
    }
  }
  const label = (field: string) => `${field} for ${row.sample_code}`
  const rowErrors = Object.entries(errors).filter(([key]) => key.startsWith(`${row.sample_id}.`)).map(([, message]) => message)

  return (
    <>
      <tr className={cn('hover:bg-muted/30', selected && 'bg-accent/30')}>
        <td className="border-b px-2 py-0.5"><Checkbox aria-label={`Select ${row.sample_code}`} checked={selected} onCheckedChange={checked => onSelect(checked === true)} /></td>
        <td className="border-b px-2 py-0.5 whitespace-nowrap"><Link className="font-mono font-semibold text-foreground hover:text-primary hover:underline" to={`/sample/${row.sample_id}`}>{row.sample_code}</Link></td>
        <td className="border-b px-1 py-0.5"><input aria-label={label('Subject')} {...cell('subject_code')} className={cn(cell('subject_code').className, 'w-28 font-mono')} /></td>
        <td className="border-b px-1 py-0.5">
          <select aria-label={label('Material')} {...cell('sample_type_id')} className={cn(cell('sample_type_id').className, 'w-40')}>
            <option value="">No type</option>
            {types.map(type => <option key={type.sample_type_id} value={type.sample_type_id}>{type.type_name}</option>)}
          </select>
        </td>
        <td className="border-b px-1 py-0.5"><input aria-label={label('Aliquot number')} type="number" min="1" step="1" {...cell('aliquot_number')} className={cn(cell('aliquot_number').className, 'w-16 text-right tabular-nums')} /></td>
        <td className="border-b px-1 py-0.5"><input aria-label={label('External ID')} {...cell('external_sample_id')} className={cn(cell('external_sample_id').className, 'w-28 font-mono')} /></td>
        <td className="border-b px-1 py-0.5"><input aria-label={label('Collected')} type="date" {...cell('collection_date')} className={cn(cell('collection_date').className, 'w-32 tabular-nums')} /></td>
        <td className="border-b px-1 py-0.5"><input aria-label={label('Received')} type="date" {...cell('received_date')} className={cn(cell('received_date').className, 'w-32 tabular-nums')} /></td>
        <td className="border-b px-1 py-0.5">
          <span className="flex items-center justify-end gap-1">
            <input aria-label={label('Quantity')} type="number" min="0" step="any" {...cell('current_quantity')} className={cn(cell('current_quantity').className, 'w-20 text-right tabular-nums')} />
            <input aria-label={label('Quantity unit')} value={value('quantity_unit')} onChange={event => onEdit('quantity_unit', event.target.value)} className={cn(cell('quantity_unit').className, 'w-12 text-muted-foreground')} />
          </span>
        </td>
        <td className="border-b px-1 py-0.5">
          <select aria-label={label('Storage')} {...cell('storage_location_id')} className={cn(cell('storage_location_id').className, 'w-32')}>
            <option value="">—</option>
            {locations.map(location => <option key={location.storage_location_id} value={location.storage_location_id}>{location.location_code}</option>)}
          </select>
        </td>
        <td className="border-b px-1 py-0.5">
          <select aria-label={label('Status')} {...cell('status')} className={cn(cell('status').className, 'w-28')}>
            {[...new Set([...STATUSES, saved.status])].map(status => <option key={status} value={status}>{status}</option>)}
          </select>
        </td>
        <td className="border-b px-2 py-0.5 text-right tabular-nums">{row.child_count ? <Link className="text-primary hover:underline" to={`/sample/${row.sample_id}`}>{row.child_count}</Link> : <span className="text-muted-foreground/60">0</span>}</td>
      </tr>
      {rowErrors.length > 0 && (
        <tr><td colSpan={12} className="border-b bg-destructive/5 px-3 py-1 text-xs text-destructive" role="alert">{row.sample_code}: {rowErrors.join('; ')}</td></tr>
      )}
    </>
  )
}

