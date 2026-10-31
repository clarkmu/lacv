import { useEffect, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'
import { api } from '../../api'
import { Panel } from '../common'
import { toDateTimeInput } from '../../format'
import type { SampleDetail } from '../../types'

type FieldKind = 'text' | 'number' | 'datetime' | 'textarea' | 'checkbox' | 'sample-type' | 'storage-location'
type Field = { key: keyof SampleDetail & string; label: string; kind: FieldKind }

// Grouped so related properties sit together; every field remains editable in place.
const groups: { title: string; fields: Field[] }[] = [
  {
    title: 'Identity',
    fields: [
      { key: 'sample_code', label: 'Sample code', kind: 'text' },
      { key: 'sample_type_id', label: 'Sample type', kind: 'sample-type' },
      { key: 'subtype', label: 'Subtype', kind: 'text' },
      { key: 'status', label: 'Status', kind: 'text' },
      { key: 'label', label: 'Label', kind: 'text' },
      { key: 'external_sample_id', label: 'External ID', kind: 'text' },
      { key: 'subject_code', label: 'Subject', kind: 'text' },
      { key: 'aliquot_number', label: 'Aliquot #', kind: 'number' },
    ],
  },
  {
    title: 'Inventory',
    fields: [
      { key: 'current_quantity', label: 'Quantity', kind: 'number' },
      { key: 'quantity_unit', label: 'Quantity unit', kind: 'text' },
      { key: 'concentration', label: 'Concentration', kind: 'number' },
      { key: 'concentration_unit', label: 'Concentration unit', kind: 'text' },
      { key: 'storage_location_id', label: 'Storage location', kind: 'storage-location' },
      { key: 'is_consumed', label: 'Consumed', kind: 'checkbox' },
      { key: 'is_disposed', label: 'Disposed', kind: 'checkbox' },
    ],
  },
  {
    title: 'Source and dates',
    fields: [
      { key: 'source_type', label: 'Source type', kind: 'text' },
      { key: 'source_description', label: 'Source description', kind: 'text' },
      { key: 'collection_date', label: 'Collected', kind: 'datetime' },
      { key: 'received_date', label: 'Received', kind: 'datetime' },
      { key: 'expiration_date', label: 'Expires', kind: 'datetime' },
    ],
  },
  { title: 'Notes', fields: [{ key: 'notes', label: 'Notes', kind: 'textarea' }] },
]
const fields = groups.flatMap(group => group.fields)

const controlClass = 'h-7 w-full min-w-0 rounded-sm border border-transparent bg-transparent px-1.5 text-[13px] text-foreground hover:border-input hover:bg-card focus-visible:border-ring focus-visible:bg-card focus-visible:ring-[3px] focus-visible:ring-ring/25 focus-visible:outline-none'

/** Every Sample field, edited in place: Enter or leaving a field saves, Esc cancels. */
export function SampleProperties({ sample }: { sample: SampleDetail }) {
  const client = useQueryClient()
  const sampleTypes = useQuery({ queryKey: ['sample-types'], queryFn: api.listSampleTypes })
  const locations = useQuery({ queryKey: ['storage-locations'], queryFn: api.listStorageLocations })
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [savingKey, setSavingKey] = useState<string | null>(null)

  useEffect(() => setDraft(initialDraft(sample)), [sample])

  const save = useMutation({
    mutationFn: (changes: Record<string, unknown>) => api.updateSample(sample.sample_id, changes),
    onSuccess: data => {
      client.setQueryData(['sample', String(sample.sample_id)], data)
      client.invalidateQueries({ queryKey: ['sample-lineage'] })
      client.invalidateQueries({ queryKey: ['samples'] })
    },
    onSettled: () => setSavingKey(null),
  })

  function commit(field: Field, rawValue = draft[field.key]) {
    if (rawValue === initialDraft(sample)[field.key]) return
    setSavingKey(field.key)
    save.mutate({ [field.key]: toPayloadValue(field.kind, rawValue) })
  }

  function onKeyDown(field: Field, event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) {
    if (event.key === 'Escape') {
      setDraft(current => ({ ...current, [field.key]: initialDraft(sample)[field.key] }))
      event.currentTarget.blur()
    }
    if (event.key === 'Enter' && field.kind !== 'textarea') {
      event.preventDefault()
      commit(field)
    }
  }

  function control(field: Field): ReactNode {
    const value = draft[field.key] ?? ''
    const common = {
      id: `field-${field.key}`,
      onKeyDown: (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => onKeyDown(field, event),
      className: controlClass,
    }
    if (field.kind === 'checkbox') {
      return <Checkbox id={common.id} className="ml-1.5" checked={value === 'true'} onCheckedChange={checked => { const next = String(checked === true); setDraft(d => ({ ...d, [field.key]: next })); commit(field, next) }} />
    }
    if (field.kind === 'sample-type' || field.kind === 'storage-location') {
      const options = field.kind === 'sample-type'
        ? (sampleTypes.data ?? []).map(type => ({ value: String(type.sample_type_id), label: type.type_name }))
        : (locations.data ?? []).map(location => ({ value: String(location.storage_location_id), label: `${location.location_code} · ${location.location_name || location.location_type}` }))
      return (
        <select {...common} value={value} onChange={event => { setDraft(d => ({ ...d, [field.key]: event.target.value })); commit(field, event.target.value) }}>
          <option value="">{field.kind === 'sample-type' ? 'No type' : 'No location'}</option>
          {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      )
    }
    if (field.kind === 'textarea') {
      return <textarea {...common} value={value} onChange={event => setDraft(d => ({ ...d, [field.key]: event.target.value }))} onBlur={() => commit(field)} className={cn(controlClass, 'h-auto min-h-20 py-1')} placeholder="No notes" />
    }
    const type = field.kind === 'number' ? 'number' : field.kind === 'datetime' ? 'datetime-local' : 'text'
    return <input {...common} type={type} step={field.kind === 'number' ? 'any' : undefined} value={value} onChange={event => setDraft(d => ({ ...d, [field.key]: event.target.value }))} onBlur={() => commit(field)} className={cn(controlClass, (field.key === 'sample_code' || field.key === 'external_sample_id' || field.key === 'subject_code') && 'font-mono', field.kind === 'number' && 'tabular-nums')} />
  }

  return (
    <Panel title="Properties" action={<span className="text-[11px] text-muted-foreground">Enter saves · Esc cancels</span>} bodyClassName="p-0">
      {groups.map(group => (
        <div key={group.title} className="border-b px-3 py-2 last:border-b-0">
          <h3 className="mb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{group.title}</h3>
          {group.fields.map(field => (
            <div key={field.key} className={cn('grid items-center gap-2', field.kind === 'textarea' ? 'grid-cols-1' : 'grid-cols-[8.5rem_minmax(0,1fr)]')}>
              <label htmlFor={`field-${field.key}`} className={cn('text-[13px] text-muted-foreground', field.kind === 'textarea' && 'sr-only')}>
                {field.label}{savingKey === field.key && <span className="ml-1 text-[11px] text-primary">saving…</span>}
              </label>
              {control(field)}
            </div>
          ))}
        </div>
      ))}
      {save.error && <p role="alert" className="mx-3 mb-3 rounded-md border border-destructive/25 bg-destructive/5 px-2.5 py-1.5 text-xs text-destructive">{save.error.message}</p>}
    </Panel>
  )
}

function initialDraft(sample: SampleDetail): Record<string, string> {
  const draft: Record<string, string> = {}
  for (const field of fields) {
    const value = sample[field.key]
    if (field.kind === 'datetime') draft[field.key] = toDateTimeInput(value as string | null)
    else if (field.kind === 'number') draft[field.key] = value === null || value === undefined ? '' : String(Number(value))
    else draft[field.key] = value === null || value === undefined ? '' : String(value)
  }
  return draft
}

function toPayloadValue(kind: FieldKind, value: string) {
  if (kind === 'checkbox') return value === 'true'
  if (value === '') return null
  if (kind === 'number' || kind === 'sample-type' || kind === 'storage-location') return Number(value)
  return value
}
