import { FormEvent, useState } from 'react'
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { ListTable } from '../components/ListTable'
import { buttonClass, errorClass, inputClass, PageHeader, StatusBadge } from '../components/ui'
import { formatDateTime, formatQuantity } from '../format'
import type { SampleListItem } from '../types'

export function SamplesPage() {
  const navigate = useNavigate()
  const [baseSamplesOnly, setBaseSamplesOnly] = useState(true)
  // Keep the previous rows while the other list loads so the table (and its search text) stays mounted.
  const { data = [], isLoading, error } = useQuery({
    queryKey: ['samples', { rootOnly: baseSamplesOnly }],
    queryFn: () => api.listSamples({ rootOnly: baseSamplesOnly }),
    placeholderData: keepPreviousData,
  })
  const [code, setCode] = useState('')
  const lookup = useMutation({ mutationFn: api.lookupSample, onSuccess: sample => navigate(`/sample/${sample.sample_id}`) })
  const codes = new Map(data.map(sample => [sample.sample_id, sample.sample_code]))

  function openCode(event: FormEvent) {
    event.preventDefault()
    if (code.trim()) lookup.mutate(code.trim())
  }

  if (isLoading) return <p className="py-6 text-sm text-slate-500">Loading samples…</p>
  if (error) return <p role="alert" className={errorClass}>Could not load samples.</p>

  return (
    <section>
      <PageHeader
        title="Samples"
        description="Every physical sample, original and derived."
        actions={<>
          <form onSubmit={openCode} className="flex w-full gap-1.5 sm:w-auto" aria-label="Open by code">
            <input value={code} onChange={event => setCode(event.target.value)} aria-label="Sample or legacy MAT code" placeholder="Scan or type a sample or legacy MAT code" className={`${inputClass} min-w-0 flex-1 font-mono sm:w-80 sm:flex-none placeholder:font-sans`} />
            <button className={buttonClass.secondary}>Open</button>
          </form>
          <Link to="/samples/new" className={buttonClass.primary}>Create root sample</Link>
        </>}
      />
      {lookup.error && <p role="alert" className={`${errorClass} mb-3`}>{lookup.error.message}</p>}
      <ListTable<SampleListItem>
        rows={data}
        searchPlaceholder="Filter by code, legacy code, type, status, label, or external ID"
        getRowKey={sample => sample.sample_id}
        emptyMessage="No samples match your filter."
        filters={
          <label className="flex cursor-pointer items-center gap-2 rounded-md px-1 text-sm text-slate-700 select-none">
            <input type="checkbox" checked={baseSamplesOnly} onChange={event => setBaseSamplesOnly(event.target.checked)} className="h-4 w-4 cursor-pointer accent-indigo-600" />
            Base samples only
          </label>
        }
        columns={[
          { key: 'sample_code', label: 'Sample', value: sample => sample.sample_code, render: sample => <Link className="font-mono text-[13px] font-semibold text-indigo-700 hover:text-indigo-900 hover:underline" to={`/sample/${sample.sample_id}`}>{sample.sample_code}</Link> },
          { key: 'sample_type', label: 'Type', value: sample => sample.sample_type },
          { key: 'status', label: 'Status', value: sample => sample.status, render: sample => <StatusBadge status={sample.status} /> },
          { key: 'label', label: 'Label', value: sample => sample.label, render: sample => <span className="text-slate-900">{sample.label}</span> },
          { key: 'parent', label: 'Parent', value: sample => (sample.parent_sample_id ? codes.get(sample.parent_sample_id) : ''), render: sample => sample.parent_sample_id ? <Link className="font-mono text-xs text-slate-600 hover:text-indigo-700 hover:underline" to={`/sample/${sample.parent_sample_id}`}>{codes.get(sample.parent_sample_id)}</Link> : '' },
          { key: 'quantity', label: 'Quantity', numeric: true, value: sample => (sample.current_quantity === null ? null : Number(sample.current_quantity)), render: sample => <Quantity value={sample.current_quantity} unit={sample.quantity_unit} /> },
          { key: 'external_sample_id', label: 'External ID', value: sample => sample.external_sample_id, render: sample => <span className="font-mono text-xs">{sample.external_sample_id}</span> },
          { key: 'received_date', label: 'Received', value: sample => sample.received_date, render: sample => <span className="text-slate-600 tabular-nums">{formatDateTime(sample.received_date)}</span> },
          { key: 'legacy_codes', label: 'Legacy codes', value: sample => sample.legacy_codes.join(' '), render: sample => <span className="font-mono text-xs text-slate-400">{sample.legacy_codes.join(' ')}</span> },
        ]}
      />
    </section>
  )
}

function Quantity({ value, unit }: { value: string | null; unit: string | null }) {
  const amount = formatQuantity(value, null)
  if (!amount) return null
  return <span className="font-medium text-slate-900">{amount}{unit && <> <span className="font-normal text-slate-500">{unit}</span></>}</span>
}
