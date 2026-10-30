import { FormEvent, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { ListTable } from '../components/ListTable'
import { formatDateTime, formatQuantity } from '../format'
import type { SampleListItem } from '../types'

export function SamplesPage() {
  const navigate = useNavigate()
  const { data = [], isLoading, error } = useQuery({ queryKey: ['samples'], queryFn: api.listSamples })
  const [code, setCode] = useState('')
  const lookup = useMutation({ mutationFn: api.lookupSample, onSuccess: sample => navigate(`/sample/${sample.sample_id}`) })
  const codes = new Map(data.map(sample => [sample.sample_id, sample.sample_code]))

  function openCode(event: FormEvent) {
    event.preventDefault()
    if (code.trim()) lookup.mutate(code.trim())
  }

  if (isLoading) return <p>Loading samples…</p>
  if (error) return <p className="text-red-700">Could not load samples.</p>

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-xl font-semibold">Samples</h1><p className="text-sm text-slate-500">Every physical sample, original and derived.</p></div>
        <div className="flex flex-wrap items-center gap-2">
          <form onSubmit={openCode} className="flex gap-1" aria-label="Open by code">
            <input value={code} onChange={event => setCode(event.target.value)} placeholder="Scan or type a sample or legacy MAT code" className="w-72 rounded border border-slate-300 px-2 py-1.5 text-sm" />
            <button className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50">Open</button>
          </form>
          <Link to="/samples/new" className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white">Create root sample</Link>
        </div>
      </div>
      {lookup.error && <p role="alert" className="mb-2 text-sm text-red-700">{lookup.error.message}</p>}
      <ListTable<SampleListItem>
        rows={data}
        searchPlaceholder="Filter by code, legacy code, type, status, label, or external ID"
        getRowKey={sample => sample.sample_id}
        emptyMessage="No samples match your filter."
        columns={[
          { key: 'sample_code', label: 'Sample', value: sample => sample.sample_code, render: sample => <Link className="font-medium text-blue-700 hover:underline" to={`/sample/${sample.sample_id}`}>{sample.sample_code}</Link> },
          { key: 'sample_type', label: 'Type', value: sample => sample.sample_type },
          { key: 'status', label: 'Status', value: sample => sample.status },
          { key: 'label', label: 'Label', value: sample => sample.label },
          { key: 'parent', label: 'Parent', value: sample => (sample.parent_sample_id ? codes.get(sample.parent_sample_id) : ''), render: sample => sample.parent_sample_id ? <Link className="text-blue-700 hover:underline" to={`/sample/${sample.parent_sample_id}`}>{codes.get(sample.parent_sample_id)}</Link> : '' },
          { key: 'quantity', label: 'Quantity', value: sample => (sample.current_quantity === null ? null : Number(sample.current_quantity)), render: sample => formatQuantity(sample.current_quantity, sample.quantity_unit) },
          { key: 'external_sample_id', label: 'External ID', value: sample => sample.external_sample_id },
          { key: 'received_date', label: 'Received', value: sample => sample.received_date, render: sample => formatDateTime(sample.received_date) },
          { key: 'legacy_codes', label: 'Legacy codes', value: sample => sample.legacy_codes.join(' ') },
        ]}
      />
    </section>
  )
}
