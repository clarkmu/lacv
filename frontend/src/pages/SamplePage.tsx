import { FormEvent, useEffect, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import { availabilityTitle, SampleAvailability } from '../components/SampleAvailability'
import { Panel } from '../components/ui'
import { formatDateTime, formatQuantity, toDateTimeInput } from '../format'
import type { SampleDetail, SampleLineageNode, SampleRef } from '../types'

type FieldKind = 'text' | 'number' | 'datetime' | 'textarea' | 'checkbox' | 'sample-type' | 'storage-location'
type Field = { key: keyof SampleDetail & string; label: string; kind: FieldKind }

const fields: Field[] = [
  { key: 'sample_code', label: 'Sample code', kind: 'text' },
  { key: 'sample_type_id', label: 'Sample type', kind: 'sample-type' },
  { key: 'status', label: 'Status', kind: 'text' },
  { key: 'label', label: 'Label', kind: 'text' },
  { key: 'subtype', label: 'Subtype', kind: 'text' },
  { key: 'external_sample_id', label: 'External ID', kind: 'text' },
  { key: 'current_quantity', label: 'Quantity', kind: 'number' },
  { key: 'quantity_unit', label: 'Quantity unit', kind: 'text' },
  { key: 'concentration', label: 'Concentration', kind: 'number' },
  { key: 'concentration_unit', label: 'Concentration unit', kind: 'text' },
  { key: 'storage_location_id', label: 'Storage location', kind: 'storage-location' },
  { key: 'source_type', label: 'Source type', kind: 'text' },
  { key: 'source_description', label: 'Source description', kind: 'text' },
  { key: 'collection_date', label: 'Collected', kind: 'datetime' },
  { key: 'received_date', label: 'Received', kind: 'datetime' },
  { key: 'expiration_date', label: 'Expires', kind: 'datetime' },
  { key: 'is_consumed', label: 'Consumed', kind: 'checkbox' },
  { key: 'is_disposed', label: 'Disposed', kind: 'checkbox' },
  { key: 'notes', label: 'Notes', kind: 'textarea' },
]

const processActions = ['Homogenization', 'RNA extraction', 'Reverse transcription', 'Library preparation']

export function SamplePage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const client = useQueryClient()
  const query = useQuery({ queryKey: ['sample', id], queryFn: () => api.getSample(id) })
  const lineage = useQuery({ queryKey: ['sample-lineage', id], queryFn: () => api.getSampleLineage(id) })
  const remove = useMutation({
    mutationFn: () => api.deleteSample(Number(id)),
    onSuccess: () => { client.invalidateQueries({ queryKey: ['samples'] }); navigate('/samples') },
  })

  if (query.isLoading) return <p>Loading sample…</p>
  if (!query.data) return <p>Sample not found.</p>
  const sample = query.data
  const actionClass = 'rounded border border-slate-300 bg-white px-2.5 py-1 text-sm hover:bg-slate-50'

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500">Sample</div>
          <h1 className="text-2xl font-semibold">{sample.sample_code}</h1>
          <div className="mt-0.5 flex flex-wrap gap-x-3 text-sm text-slate-600">
            <span>{sample.sample_type || 'No type'}</span>
            <span>{sample.status}</span>
            {sample.label && <span>{sample.label}</span>}
            {sample.parent && <span>Parent <SampleLink sample={sample.parent} /></span>}
            {sample.batch && <span>Batch <Link className="text-blue-700 hover:underline" to={`/batch/${sample.batch.batch_id}`}>{sample.batch.batch_code}</Link></span>}
            {sample.legacy_codes.length > 0 && <span title="Legacy material codes that now refer to this sample">Legacy {sample.legacy_codes.join(', ')}</span>}
          </div>
        </div>
        <nav aria-label="Sample actions" className="flex flex-wrap gap-1.5">
          <Link to={`/sample/${sample.sample_id}/children/new`} className={actionClass}>Add child sample</Link>
          <Link to={`/sample/${sample.sample_id}/aliquots/new`} className={actionClass}>Aliquot</Link>
          {processActions.map(action => <Link key={action} to={`/sample/${sample.sample_id}/process/new?action=${encodeURIComponent(action)}`} className={actionClass}>{action}</Link>)}
          <Link to={`/sample/${sample.sample_id}/process/new`} className={actionClass}>Other process</Link>
          <Link to={`/sample/${sample.sample_id}/assays/new`} className={actionClass}>Send to assay</Link>
          <button type="button" onClick={() => { if (confirm(`Delete ${sample.sample_code}?`)) remove.mutate() }} className="rounded border border-red-200 bg-white px-2.5 py-1 text-sm text-red-700 hover:bg-red-50">Delete</button>
        </nav>
      </header>
      {remove.error && <p role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{remove.error.message}</p>}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <SampleFields sample={sample} />
        <div className="space-y-4">
          <Panel title={availabilityTitle(sample.availability)}>
            <SampleAvailability availability={sample.availability} />
          </Panel>
          <Panel title="Lineage">
            {lineage.data ? <LineageTree sample={sample} ancestors={lineage.data.ancestors} descendants={lineage.data.descendants} /> : <Empty>Loading lineage…</Empty>}
          </Panel>
        </div>
      </div>

      <Panel title="Child samples" action={<Link to={`/sample/${sample.sample_id}/children/new`} className="text-sm text-blue-700 hover:underline">Add child</Link>}>
        {sample.children.length ? (
          <Table head={['Sample', 'Type', 'Status']} rows={sample.children.map(child => [<SampleLink key="code" sample={child} />, child.sample_type || '', child.status])} />
        ) : <Empty>No child samples.</Empty>}
      </Panel>

      <Panel title="Process history" action={<Link to={`/sample/${sample.sample_id}/process/new`} className="text-sm text-blue-700 hover:underline">Record process</Link>}>
        {sample.process_events.length ? (
          <Table
            head={['Process', 'Type', 'Role', 'Inputs', 'Outputs', 'Operator', 'Started', 'Status']}
            rows={sample.process_events.map(event => [
              <span key="code" className="font-medium">{event.process_code}</span>, event.process_type, event.role,
              <SampleLinks key="in" samples={event.inputs} />, <SampleLinks key="out" samples={event.outputs} />,
              event.operator_name || '', formatDateTime(event.started_at), event.status,
            ])}
          />
        ) : <Empty>No processes recorded for this sample.</Empty>}
      </Panel>

      <Panel title="Assays" action={<Link to={`/sample/${sample.sample_id}/assays/new`} className="text-sm text-blue-700 hover:underline">Send to assay</Link>}>
        {sample.generated_by_assays.length > 0 && <p className="mb-2 text-sm text-slate-600">Produced by assay {sample.generated_by_assays.map(assay => <Link key={assay.assay_id} className="text-blue-700 hover:underline" to={`/assay/${assay.assay_id}`}>{assay.assay_code}</Link>)}</p>}
        {sample.assays.length ? (
          <Table
            head={['Assay', 'Type', 'Target', 'Date', 'Status', 'QC', 'Results']}
            rows={sample.assays.map(assay => [
              <Link key="code" className="font-medium text-blue-700 hover:underline" to={`/assay/${assay.assay_id}`}>{assay.assay_code}</Link>,
              assay.assay_type, assay.target || '', formatDateTime(assay.assay_date), assay.status, assay.qc_status, assay.result_count,
            ])}
          />
        ) : <Empty>No assays on this sample.</Empty>}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Storage history">
          {sample.storage_events.length ? (
            <Table
              head={['Date', 'Action', 'From', 'To', 'Operator', 'Notes']}
              rows={sample.storage_events.map(event => [formatDateTime(event.event_date), event.event_type, event.from_location_code || '', event.to_location_code || '', event.operator_name || '', event.notes || ''])}
            />
          ) : <Empty>No storage events.</Empty>}
        </Panel>
        <Panel title="Quantity history">
          {sample.quantity_events.length ? (
            <Table
              head={['Date', 'Action', 'Change', 'Before', 'After', 'Operator']}
              rows={sample.quantity_events.map(event => [
                formatDateTime(event.event_date), event.event_type, formatQuantity(event.quantity_change, event.quantity_unit),
                formatQuantity(event.quantity_before, null), formatQuantity(event.quantity_after, null), event.operator_name || '',
              ])}
            />
          ) : <Empty>No quantity events.</Empty>}
        </Panel>
      </div>

      <DataFiles sample={sample} />

      {sample.legacy_identifiers.length > 0 && (
        <Panel title="Legacy identifiers">
          <Table
            head={['Legacy material code', 'Legacy material ID', 'Resolution', 'Migrated']}
            rows={sample.legacy_identifiers.map(item => [item.material_code, item.legacy_material_id, item.resolution === 'matched' ? 'Same physical sample' : 'Became this derived sample', formatDateTime(item.migrated_at)])}
          />
        </Panel>
      )}
    </div>
  )
}

function SampleFields({ sample }: { sample: SampleDetail }) {
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

  const inputClass = 'w-full rounded border border-transparent bg-slate-50 px-2 py-1 text-sm hover:border-slate-200 focus:border-blue-400 focus:bg-white'

  return (
    <Panel title="Fields" action={<span className="text-xs text-slate-500">Enter or leave a field to save · Esc to cancel</span>}>
      <div className="grid gap-x-4 2xl:grid-cols-2">
        {fields.map(field => {
          const value = draft[field.key] ?? ''
          const common = {
            id: `field-${field.key}`,
            onKeyDown: (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => onKeyDown(field, event),
            className: inputClass,
          }
          let control: ReactNode
          if (field.kind === 'checkbox') {
            control = <input id={common.id} type="checkbox" checked={value === 'true'} onChange={event => { setDraft(d => ({ ...d, [field.key]: String(event.target.checked) })); commit(field, String(event.target.checked)) }} />
          } else if (field.kind === 'sample-type' || field.kind === 'storage-location') {
            const options = field.kind === 'sample-type'
              ? (sampleTypes.data ?? []).map(type => ({ value: String(type.sample_type_id), label: type.type_name }))
              : (locations.data ?? []).map(location => ({ value: String(location.storage_location_id), label: `${location.location_code} · ${location.location_name || location.location_type}` }))
            control = (
              <select {...common} value={value} onChange={event => { setDraft(d => ({ ...d, [field.key]: event.target.value })); commit(field, event.target.value) }}>
                <option value="">{field.kind === 'sample-type' ? 'No type' : 'No location'}</option>
                {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            )
          } else if (field.kind === 'textarea') {
            control = <textarea {...common} value={value} onChange={event => setDraft(d => ({ ...d, [field.key]: event.target.value }))} onBlur={() => commit(field)} className={`${inputClass} min-h-16`} />
          } else {
            const type = field.kind === 'number' ? 'number' : field.kind === 'datetime' ? 'datetime-local' : 'text'
            control = <input {...common} type={type} step={field.kind === 'number' ? 'any' : undefined} value={value} onChange={event => setDraft(d => ({ ...d, [field.key]: event.target.value }))} onBlur={() => commit(field)} />
          }
          return (
            <div key={field.key} className={`grid grid-cols-[9rem_1fr] items-center gap-2 border-b border-slate-100 py-1 ${field.kind === 'textarea' ? '2xl:col-span-2' : ''}`}>
              <label htmlFor={`field-${field.key}`} className="text-sm text-slate-600">{field.label}{savingKey === field.key && <span className="ml-1 text-xs text-slate-400">saving…</span>}</label>
              {control}
            </div>
          )
        })}
      </div>
      {save.error && <p role="alert" className="mt-2 text-sm text-red-700">{save.error.message}</p>}
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

function LineageTree({ sample, ancestors, descendants }: { sample: SampleRef; ancestors: SampleRef[]; descendants: SampleLineageNode[] }) {
  return (
    <div className="text-sm">
      {ancestors.length > 0 && (
        <ol className="mb-2 flex flex-wrap items-center gap-1 text-slate-600" aria-label="Ancestors">
          {ancestors.map(ancestor => <li key={ancestor.sample_id} className="after:ml-1 after:content-['›']"><SampleLink sample={ancestor} /></li>)}
          <li className="font-semibold text-slate-900">{sample.sample_code}</li>
        </ol>
      )}
      {descendants.length ? <ul className="space-y-1">{descendants.map(node => <LineageNode key={node.sample_id} node={node} />)}</ul> : <Empty>No derived samples.</Empty>}
    </div>
  )
}

function LineageNode({ node }: { node: SampleLineageNode }) {
  return (
    <li className="border-l border-slate-200 pl-3">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <SampleLink sample={node} />
        <span className="text-slate-500">{node.sample_type || 'No type'} · {node.status}</span>
        {node.generated_by && <span className="text-xs text-slate-400">via {node.generated_by.type} {node.generated_by.code}</span>}
      </div>
      {node.children.length > 0 && <ul className="mt-1 space-y-1">{node.children.map(child => <LineageNode key={child.sample_id} node={child} />)}</ul>}
    </li>
  )
}

function DataFiles({ sample }: { sample: SampleDetail }) {
  const client = useQueryClient()
  const [draft, setDraft] = useState({ file_name: '', file_type: '', file_location: '', assay_id: '' })
  const attach = useMutation({
    mutationFn: () => api.attachDataFile(sample.sample_id, {
      file_name: draft.file_name, file_type: draft.file_type, file_location: draft.file_location, assay_id: draft.assay_id ? Number(draft.assay_id) : null,
    }),
    onSuccess: data => { client.setQueryData(['sample', String(sample.sample_id)], data); setDraft({ file_name: '', file_type: '', file_location: '', assay_id: '' }) },
  })
  const inputClass = 'rounded border border-slate-300 px-2 py-1 text-sm'

  function submit(event: FormEvent) {
    event.preventDefault()
    attach.mutate()
  }

  return (
    <Panel title="Files">
      {sample.data_files.length ? (
        <Table
          head={['File', 'Type', 'Location', 'Assay', 'Added']}
          rows={sample.data_files.map(file => [
            file.file_name, file.file_type, <code key="loc" className="text-xs">{file.file_location}</code>,
            sample.assays.find(assay => assay.assay_id === file.assay_id)?.assay_code ?? '', formatDateTime(file.created_at),
          ])}
        />
      ) : <Empty>No files attached.</Empty>}
      <form onSubmit={submit} className="mt-2 flex flex-wrap items-center gap-2" aria-label="Attach file">
        <input required placeholder="File name" value={draft.file_name} onChange={e => setDraft(d => ({ ...d, file_name: e.target.value }))} className={inputClass} />
        <input required placeholder="Type" value={draft.file_type} onChange={e => setDraft(d => ({ ...d, file_type: e.target.value }))} className={`${inputClass} w-28`} />
        <input required placeholder="Location / path" value={draft.file_location} onChange={e => setDraft(d => ({ ...d, file_location: e.target.value }))} className={`${inputClass} min-w-64 flex-1`} />
        <select value={draft.assay_id} onChange={e => setDraft(d => ({ ...d, assay_id: e.target.value }))} className={inputClass}>
          <option value="">No assay</option>
          {sample.assays.map(assay => <option key={assay.assay_id} value={assay.assay_id}>{assay.assay_code}</option>)}
        </select>
        <button disabled={attach.isPending} className="rounded border border-slate-300 px-2.5 py-1 text-sm hover:bg-slate-50">Attach</button>
      </form>
      {attach.error && <p role="alert" className="mt-2 text-sm text-red-700">{attach.error.message}</p>}
    </Panel>
  )
}

export function SampleLink({ sample }: { sample: SampleRef }) {
  return <Link className="font-medium text-blue-700 hover:underline" to={`/sample/${sample.sample_id}`}>{sample.sample_code}</Link>
}

function SampleLinks({ samples }: { samples: SampleRef[] }) {
  return <span className="flex flex-wrap gap-x-2">{samples.map(sample => <SampleLink key={sample.sample_id} sample={sample} />)}</span>
}

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase tracking-wide text-slate-500"><tr>{head.map(label => <th key={label} className="border-b border-slate-200 px-2 py-1 font-medium">{label}</th>)}</tr></thead>
        <tbody>{rows.map((row, index) => <tr key={index} className="hover:bg-slate-50">{row.map((cell, cellIndex) => <td key={cellIndex} className="border-b border-slate-100 px-2 py-1 align-top">{cell}</td>)}</tr>)}</tbody>
      </table>
    </div>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-slate-500">{children}</p>
}
