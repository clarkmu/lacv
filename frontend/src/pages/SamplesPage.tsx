import { FormEvent, useState } from 'react'
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'
import { CornerDownRight, Plus, ScanBarcode } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Separator } from '@/components/ui/separator'
import { api } from '../api'
import { ListTable } from '../components/ListTable'
import { errorClass, PageHeader, QuantityValue, SampleTypeLabel, SecondaryCode, StatusBadge } from '../components/common'
import { formatDateTime } from '../format'
import type { SampleListItem } from '../types'

export function SamplesPage() {
  const [baseSamplesOnly, setBaseSamplesOnly] = useState(true)
  // Keep the previous rows while the other list loads so the table (and its search text) stays mounted.
  const { data = [], isLoading, error } = useQuery({
    queryKey: ['samples', { rootOnly: baseSamplesOnly }],
    queryFn: () => api.listSamples({ rootOnly: baseSamplesOnly }),
    placeholderData: keepPreviousData,
  })
  const codes = new Map(data.map(sample => [sample.sample_id, sample.sample_code]))

  if (isLoading) return <p className="py-6 text-sm text-muted-foreground">Loading samples…</p>
  if (error) return <p role="alert" className={errorClass}>Could not load samples.</p>

  return (
    <section>
      <PageHeader
        title="Samples"
        description="Every physical sample, original and derived."
        actions={<>
          <OpenByCode />
          <Separator orientation="vertical" className="mx-1 hidden data-[orientation=vertical]:h-6 sm:block" />
          <Button asChild size="sm"><Link to="/samples/new"><Plus aria-hidden="true" />Create root sample</Link></Button>
        </>}
      />
      <ListTable<SampleListItem>
        rows={data}
        searchPlaceholder="Filter by code, legacy code, type, status, label, or external ID"
        getRowKey={sample => sample.sample_id}
        emptyMessage="No samples match your filter."
        filters={
          <div className="flex items-center gap-2">
            <Checkbox id="base-samples-only" checked={baseSamplesOnly} onCheckedChange={checked => setBaseSamplesOnly(checked === true)} />
            <label htmlFor="base-samples-only" className="cursor-pointer text-[13px] select-none">Base samples only</label>
          </div>
        }
        columns={[
          { key: 'sample_code', label: 'Sample', value: sample => sample.sample_code, render: sample => <Link className="font-mono text-[13px] font-semibold text-foreground decoration-primary/40 underline-offset-2 hover:text-primary hover:underline" to={`/sample/${sample.sample_id}`}>{sample.sample_code}</Link> },
          { key: 'sample_type', label: 'Type', value: sample => sample.sample_type, render: sample => <SampleTypeLabel typeId={sample.sample_type_id} name={sample.sample_type} /> },
          { key: 'status', label: 'Status', value: sample => sample.status, render: sample => <StatusBadge status={sample.status} /> },
          { key: 'label', label: 'Label', value: sample => sample.label, render: sample => <span className="text-foreground">{sample.label}</span> },
          {
            key: 'parent', label: 'Parent', value: sample => (sample.parent_sample_id ? codes.get(sample.parent_sample_id) : ''),
            render: sample => sample.parent_sample_id ? (
              <Link className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-primary hover:underline" to={`/sample/${sample.parent_sample_id}`}>
                <CornerDownRight aria-hidden="true" className="size-3 opacity-60" />{codes.get(sample.parent_sample_id)}
              </Link>
            ) : '',
          },
          { key: 'quantity', label: 'Quantity', numeric: true, value: sample => (sample.current_quantity === null ? null : Number(sample.current_quantity)), render: sample => <QuantityValue value={sample.current_quantity} unit={sample.quantity_unit} /> },
          { key: 'external_sample_id', label: 'External ID', value: sample => sample.external_sample_id, render: sample => <SecondaryCode>{sample.external_sample_id}</SecondaryCode> },
          { key: 'received_date', label: 'Received', value: sample => sample.received_date, render: sample => <span className="text-muted-foreground tabular-nums">{formatDateTime(sample.received_date)}</span> },
          { key: 'legacy_codes', label: 'Legacy codes', value: sample => sample.legacy_codes.join(' '), render: sample => <SecondaryCode className="text-muted-foreground/80">{sample.legacy_codes.join(' ')}</SecondaryCode> },
        ]}
      />
    </section>
  )
}

/** Direct access: scan or type any Sample or legacy MAT code, including derived Samples hidden by the list filter. */
function OpenByCode() {
  const navigate = useNavigate()
  const [code, setCode] = useState('')
  const lookup = useMutation({ mutationFn: api.lookupSample, onSuccess: sample => navigate(`/sample/${sample.sample_id}`) })

  function openCode(event: FormEvent) {
    event.preventDefault()
    if (code.trim()) lookup.mutate(code.trim())
  }

  return (
    <div className="w-full sm:w-auto">
      <form onSubmit={openCode} aria-label="Open by code" className="flex h-8 items-stretch overflow-hidden rounded-md border border-input bg-card shadow-xs focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/30">
        <span className="grid place-items-center pl-2.5 text-muted-foreground"><ScanBarcode aria-hidden="true" className="size-4" /></span>
        <input
          value={code}
          onChange={event => setCode(event.target.value)}
          aria-label="Sample or legacy MAT code"
          aria-invalid={lookup.isError || undefined}
          placeholder="Scan or type a sample or legacy MAT code"
          className="min-w-0 flex-1 bg-transparent px-2 font-mono text-[13px] outline-none placeholder:font-sans placeholder:text-muted-foreground focus-visible:outline-none sm:w-80 sm:flex-none"
        />
        <button className="border-l px-3 text-[13px] font-medium text-foreground hover:bg-accent focus-visible:bg-accent">Open</button>
      </form>
      {lookup.error && <p role="alert" className="mt-1 text-xs text-destructive">{lookup.error.message}</p>}
    </div>
  )
}
