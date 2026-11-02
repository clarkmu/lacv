import { FormEvent, useState } from 'react'
import type { ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CornerDownRight, PackageOpen, Pencil, Plus, Save } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { api, ApiError } from '../api'
import { ListTable, type ListTableColumn } from '../components/ListTable'
import { inputClass, Panel, QuantityValue, SampleLink, SampleTypeLabel, SecondaryCode, StatusBadge } from '../components/common'
import { distinct, Field } from '../components/form'
import { SuggestInput } from '../components/SuggestInput'
import { formatDateTime } from '../format'
import type { StorageLocation, StorageLocationDetail, StoredSample } from '../types'

/** A storage location as a workspace: what it is, where it sits, and every tube stored in it. */
export function StorageLocationPage() {
  const { id = '' } = useParams()
  const query = useQuery({ queryKey: ['storage-location', id], queryFn: () => api.getStorageLocation(id) })
  if (query.isLoading) return <p className="py-6 text-sm text-muted-foreground">Loading storage location…</p>
  if (!query.data) return <p className="py-6 text-sm text-muted-foreground">Storage location not found.</p>
  return <LocationView key={query.data.storage_location_id} location={query.data} />
}

function LocationView({ location }: { location: StorageLocationDetail }) {
  const [editing, setEditing] = useState(false)
  const here = location.contents.filter(sample => sample.storage_location_id === location.storage_location_id).length
  const below = location.contents.length - here

  return (
    <div className="space-y-4">
      <header className="space-y-2">
        <Breadcrumb>
          <BreadcrumbList className="text-xs">
            <BreadcrumbItem><BreadcrumbLink asChild><Link to="/storage-locations">Storage</Link></BreadcrumbLink></BreadcrumbItem>
            {location.ancestors.map(ancestor => (
              <LocationCrumb key={ancestor.storage_location_id} location={ancestor} />
            ))}
            <BreadcrumbSeparator />
            <BreadcrumbItem><BreadcrumbPage className="font-mono">{location.location_code}</BreadcrumbPage></BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold tracking-tight">
              <span className="font-mono">{location.location_code}</span>
              {location.location_name && <span className="font-normal text-muted-foreground"> · {location.location_name}</span>}
            </h1>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
              <span className="capitalize text-foreground/80">{location.location_type}</span>
              {!location.is_active && <StatusBadge status="inactive" />}
              <span className="tabular-nums">{countLine(here, below)}</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm"><Link to={`/storage-locations/new?parent=${location.storage_location_id}`}><Plus aria-hidden="true" />Add location inside</Link></Button>
            {!editing && <Button variant="outline" size="sm" onClick={() => setEditing(true)}><Pencil aria-hidden="true" />Edit</Button>}
          </div>
        </div>
      </header>

      <div className={cn('grid items-start gap-4', location.sub_locations.length > 0 && 'lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]')}>
        {editing ? <LocationEditor location={location} onDone={() => setEditing(false)} /> : <LocationDetails location={location} spread={location.sub_locations.length === 0} />}
        {location.sub_locations.length > 0 && <SubLocations location={location} />}
      </div>

      <Contents location={location} />
    </div>
  )
}

function countLine(here: number, below: number) {
  const samples = (count: number) => `${count} ${count === 1 ? 'sample' : 'samples'}`
  if (here === 0 && below === 0) return 'Empty'
  if (below === 0) return `${samples(here)} stored here`
  if (here === 0) return `${samples(below)} in sub-locations`
  return `${samples(here)} stored here, ${below} more in sub-locations`
}

function LocationCrumb({ location }: { location: StorageLocation }) {
  return (
    <>
      <BreadcrumbSeparator />
      <BreadcrumbItem><BreadcrumbLink asChild><Link className="font-mono" to={`/storage-location/${location.storage_location_id}`}>{location.location_code}</Link></BreadcrumbLink></BreadcrumbItem>
    </>
  )
}

/** spread: the panel has the full width to itself, so lay the fields out three across instead of two. */
function LocationDetails({ location, spread }: { location: StorageLocationDetail; spread: boolean }) {
  const parent = location.ancestors.at(-1)
  return (
    <Panel title="Location">
      <dl className={cn('grid gap-x-8 text-[13px] sm:grid-cols-2', spread && 'xl:grid-cols-3')}>
        <Detail label="Code"><span className="font-mono">{location.location_code}</span></Detail>
        <Detail label="Type"><span className="capitalize">{location.location_type}</span></Detail>
        <Detail label="Name">{location.location_name}</Detail>
        <Detail label="Inside">{parent ? <Link className="font-mono text-primary hover:underline" to={`/storage-location/${parent.storage_location_id}`}>{parent.location_code}</Link> : <span className="text-muted-foreground">Top level</span>}</Detail>
        <Detail label="State">{location.is_active ? 'Active' : <StatusBadge status="inactive" />}</Detail>
        <Detail label="Path">
          <span className="font-mono text-xs">{[...location.ancestors.map(ancestor => ancestor.location_code), location.location_code].join(' › ')}</span>
        </Detail>
        <Detail label="Description" wide spread={spread}>{location.description && <span className="whitespace-pre-wrap">{location.description}</span>}</Detail>
      </dl>
    </Panel>
  )
}

function LocationEditor({ location, onDone }: { location: StorageLocationDetail; onDone: () => void }) {
  const client = useQueryClient()
  const locations = useQuery({ queryKey: ['storage-locations'], queryFn: api.listStorageLocations })
  const [draft, setDraft] = useState({
    location_code: location.location_code,
    location_type: location.location_type,
    location_name: location.location_name ?? '',
    parent_location_id: location.parent_location_id === null ? '' : String(location.parent_location_id),
    description: location.description ?? '',
    is_active: location.is_active,
  })
  const set = <K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) => setDraft(current => ({ ...current, [key]: value }))
  const save = useMutation({
    mutationFn: () => api.updateStorageLocation(location.storage_location_id, {
      ...draft,
      location_name: draft.location_name || null,
      description: draft.description || null,
      parent_location_id: draft.parent_location_id ? Number(draft.parent_location_id) : null,
    }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['storage-location'] })
      client.invalidateQueries({ queryKey: ['storage-locations'] })
      onDone()
    },
  })
  const fieldErrors = save.error instanceof ApiError ? save.error.fieldErrors : {}
  const otherError = save.error && Object.keys(fieldErrors).length === 0 ? save.error.message : null
  const others = (locations.data ?? []).filter(candidate => candidate.storage_location_id !== location.storage_location_id)

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!save.isPending) save.mutate()
  }

  return (
    <form onSubmit={submit} aria-label="Edit location" className="rounded-md border bg-card shadow-xs" onKeyDown={event => { if (event.key === 'Escape') onDone() }}>
      <div className="flex min-h-9 items-center border-b px-3 py-1.5"><h2 className="text-[13px] font-semibold tracking-tight">Edit location</h2></div>
      <div className="grid gap-3 p-3 sm:grid-cols-3">
        <Field label="Code" htmlFor="location-code" error={fieldErrors.location_code}>
          <Input id="location-code" required autoFocus value={draft.location_code} onChange={event => set('location_code', event.target.value)} aria-invalid={Boolean(fieldErrors.location_code) || undefined} className="h-8 font-mono text-[13px]" />
        </Field>
        <Field label="Type" htmlFor="location-type" hint="e.g. freezer, rack, box" error={fieldErrors.location_type}>
          <SuggestInput id="location-type" value={draft.location_type} onChange={value => set('location_type', value)} suggestions={distinct((locations.data ?? []).map(candidate => candidate.location_type))} suggestionsLabel="Types in use" invalid={Boolean(fieldErrors.location_type)} />
        </Field>
        <Field label="Name" htmlFor="location-name" optional>
          <Input id="location-name" value={draft.location_name} onChange={event => set('location_name', event.target.value)} className="h-8 text-[13px]" />
        </Field>
        <Field label="Inside" htmlFor="location-parent" error={fieldErrors.parent_location_id}>
          <select id="location-parent" value={draft.parent_location_id} onChange={event => set('parent_location_id', event.target.value)} aria-invalid={Boolean(fieldErrors.parent_location_id) || undefined} className={cn(inputClass, 'w-full text-[13px]')}>
            <option value="">Top level</option>
            {others.map(candidate => <option key={candidate.storage_location_id} value={candidate.storage_location_id}>{candidate.location_code} · {candidate.location_name || candidate.location_type}</option>)}
          </select>
        </Field>
        <div className="flex items-end pb-1.5 sm:col-span-2">
          <label htmlFor="location-active" className="flex cursor-pointer items-center gap-2 text-[13px]">
            <Checkbox id="location-active" checked={draft.is_active} onCheckedChange={checked => set('is_active', checked === true)} />
            Active <span className="text-xs text-muted-foreground">(inactive locations stay visible with their contents)</span>
          </label>
        </div>
        <div className="sm:col-span-3">
          <Field label="Description" htmlFor="location-description" optional>
            <Textarea id="location-description" value={draft.description} onChange={event => set('description', event.target.value)} className="min-h-16 text-[13px]" />
          </Field>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 border-t bg-muted/40 px-3 py-2">
        {otherError && <p role="alert" className="mr-auto text-xs text-destructive">{otherError}</p>}
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>Cancel</Button>
        <Button type="submit" size="sm" disabled={save.isPending}><Save aria-hidden="true" />{save.isPending ? 'Saving…' : 'Save location'}</Button>
      </div>
    </form>
  )
}

function SubLocations({ location }: { location: StorageLocationDetail }) {
  return (
    <Panel title={<>Inside this {location.location_type} <span className="font-normal text-muted-foreground tabular-nums">· {location.sub_locations.length}</span></>} label="Sub-locations" bodyClassName="p-0">
      <table className="w-full text-[13px]">
        <thead className="text-left text-xs text-muted-foreground">
          <tr>{['Location', 'Type', 'Name', 'Samples'].map(label => <th key={label} className={cn('border-b px-3 py-1.5 font-medium', label === 'Samples' && 'text-right')}>{label}</th>)}</tr>
        </thead>
        <tbody>
          {location.sub_locations.map(child => (
            <tr key={child.storage_location_id} className="hover:bg-muted/40">
              <td className="border-b px-3 py-1.5 whitespace-nowrap"><Link className="font-mono font-medium text-primary hover:underline" to={`/storage-location/${child.storage_location_id}`}>{child.location_code}</Link>{!child.is_active && <StatusBadge status="inactive" className="ml-2" />}</td>
              <td className="border-b px-3 py-1.5 capitalize">{child.location_type}</td>
              <td className="border-b px-3 py-1.5 text-muted-foreground">{child.location_name}</td>
              <td className="border-b px-3 py-1.5 text-right tabular-nums">{child.sample_count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  )
}

// Columns many tubes leave blank, keyed by the field that fills them.
const OPTIONAL_COLUMNS: Partial<Record<string, keyof StoredSample>> = {
  subject_code: 'subject_code', aliquot_number: 'aliquot_number', concentration: 'concentration', label: 'label', legacy_codes: 'legacy_codes',
  received_date: 'received_date',
}

function Contents({ location }: { location: StorageLocationDetail }) {
  const hasSubLocations = location.sub_locations.length > 0
  const [includeBelow, setIncludeBelow] = useState(true)
  const showBelow = hasSubLocations && includeBelow
  const rows = showBelow ? location.contents : location.contents.filter(sample => sample.storage_location_id === location.storage_location_id)
  // An optional column is shown only when some tube in the table has a value for it.
  const shown = (column: ListTableColumn<StoredSample>) => {
    const field = OPTIONAL_COLUMNS[column.key]
    return !field || rows.some(sample => {
      const value = sample[field]
      return Array.isArray(value) ? value.length > 0 : value !== null && value !== ''
    })
  }

  return (
    <section aria-label="Contents" className="space-y-2">
      <h2 className="text-[13px] font-semibold tracking-tight">
        Contents <span className="font-normal text-muted-foreground tabular-nums">· {rows.length} {rows.length === 1 ? 'sample' : 'samples'}</span>
        <span className="ml-2 font-normal text-muted-foreground">Each row is one physical tube.</span>
      </h2>
      {location.contents.length === 0 ? (
        <div className="flex flex-col items-center gap-1 rounded-md border border-dashed bg-card px-4 py-8 text-center">
          <PackageOpen aria-hidden="true" className="size-5 text-muted-foreground" />
          <p className="text-sm font-medium">No samples are currently stored in this location.</p>
          <p className="text-xs text-muted-foreground">A sample is placed here by setting its storage location, on the sample's page or a batch.</p>
        </div>
      ) : (
        <ListTable<StoredSample>
          rows={rows}
          searchPlaceholder="Filter contents…"
          getRowKey={sample => sample.sample_id}
          emptyMessage={showBelow || !hasSubLocations ? 'No samples match your filter.' : 'Nothing is stored directly here; include sub-locations to see their contents.'}
          filters={hasSubLocations && (
            <div className="flex items-center gap-2">
              <Checkbox id="include-sub-locations" checked={includeBelow} onCheckedChange={checked => setIncludeBelow(checked === true)} />
              <label htmlFor="include-sub-locations" className="cursor-pointer text-[13px] select-none">Include sub-locations</label>
            </div>
          )}
          columns={([
            { key: 'sample_code', label: 'Sample', value: sample => sample.sample_code, render: sample => <SampleLink sample={sample} className="text-[13px]" /> },
            {
              key: 'root', label: 'From original sample', value: sample => sample.root?.sample_code ?? sample.sample_code,
              render: sample => sample.root ? (
                <span className="inline-flex items-center gap-1 text-xs">
                  <CornerDownRight aria-hidden="true" className="size-3 text-muted-foreground/70" />
                  <SampleLink sample={sample.root} />
                  {sample.parent && sample.parent.sample_id !== sample.root.sample_id && <span className="text-muted-foreground">via <Link className="font-mono hover:text-primary hover:underline" to={`/sample/${sample.parent.sample_id}`}>{sample.parent.sample_code}</Link></span>}
                </span>
              ) : <span className="text-xs text-muted-foreground">original</span>,
            },
            { key: 'sample_type', label: 'Type', value: sample => sample.sample_type, render: sample => <SampleTypeLabel typeId={sample.sample_type_id} name={sample.sample_type} /> },
            { key: 'subject_code', label: 'Subject', value: sample => sample.subject_code, render: sample => <SecondaryCode className="text-foreground/80">{sample.subject_code}</SecondaryCode> },
            { key: 'aliquot_number', label: 'Aliquot #', numeric: true, value: sample => sample.aliquot_number },
            { key: 'quantity', label: 'Quantity', numeric: true, value: sample => (sample.current_quantity === null ? null : Number(sample.current_quantity)), render: sample => <QuantityValue value={sample.current_quantity} unit={sample.quantity_unit} /> },
            { key: 'concentration', label: 'Concentration', numeric: true, value: sample => (sample.concentration === null ? null : Number(sample.concentration)), render: sample => <QuantityValue value={sample.concentration} unit={sample.concentration_unit} /> },
            { key: 'status', label: 'Status', value: sample => sample.status, render: sample => <StatusBadge status={sample.status} /> },
            ...(showBelow ? [{
              key: 'location', label: 'Location', value: (sample: StoredSample) => sample.storage_location_code,
              render: (sample: StoredSample) => <Link className="font-mono text-xs hover:text-primary hover:underline" to={`/storage-location/${sample.storage_location_id}`}>{sample.storage_location_code}</Link>,
            }] : []),
            { key: 'label', label: 'Label', value: sample => sample.label },
            { key: 'legacy_codes', label: 'Legacy codes', value: sample => sample.legacy_codes.join(' '), render: sample => <SecondaryCode>{sample.legacy_codes.join(' ')}</SecondaryCode> },
            { key: 'received_date', label: 'Received', value: sample => sample.received_date, render: sample => <span className="text-muted-foreground tabular-nums">{formatDateTime(sample.received_date)}</span> },
          ] satisfies ListTableColumn<StoredSample>[]).filter(shown)}
        />
      )}
    </section>
  )
}

function Detail({ label, wide = false, spread = false, children }: { label: string; wide?: boolean; spread?: boolean; children: ReactNode }) {
  return (
    <div className={cn('grid grid-cols-[6.5rem_1fr] items-baseline gap-2 border-b py-1.5 last:border-b-0', wide && 'sm:col-span-2', wide && spread && 'xl:col-span-3')}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children || <span className="text-muted-foreground/60">—</span>}</dd>
    </div>
  )
}

