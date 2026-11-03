import { FormEvent, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, FlaskConical, Plus } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { api, ApiError } from '../api'
import { inputClass, SampleLink, SampleTypeLabel, StatusBadge } from '../components/common'
import { Field, FieldError, Section } from '../components/form'
import { SuggestInput } from '../components/SuggestInput'
import { formatQuantity } from '../format'
import type { AssayDefinition, SampleAvailability, SampleDetail } from '../types'
import { executionHref } from '../assayResults'

/** Recording an assay that was performed on a Sample: what was run, when and by whom, and how much of the Sample it used. */
export function NewAssayPage() {
  const { id = '' } = useParams()
  const sampleQuery = useQuery({ queryKey: ['sample', id], queryFn: () => api.getSample(id) })

  if (sampleQuery.isLoading) return <p className="py-6 text-sm text-muted-foreground">Loading sample…</p>
  if (!sampleQuery.data) return <p className="py-6 text-sm text-muted-foreground">Sample not found.</p>
  return <RecordAssayForm sample={sampleQuery.data} />
}

function RecordAssayForm({ sample }: { sample: SampleDetail }) {
  const navigate = useNavigate()
  const client = useQueryClient()
  const definitions = useQuery({ queryKey: ['assay-definitions', { activeOnly: true }], queryFn: () => api.listAssayDefinitions({ activeOnly: true }) })
  const performers = useQuery({ queryKey: ['assay-performed-by'], queryFn: api.listPerformedBy })
  const now = new Date()

  const [definitionId, setDefinitionId] = useState('')
  const [date, setDate] = useState(localDate(now))
  const [time, setTime] = useState(localTime(now))
  const [performedBy, setPerformedBy] = useState('')
  const [volume, setVolume] = useState('')
  const [volumeUnit, setVolumeUnit] = useState(sample.quantity_unit ?? '')
  // Typed values by result field id; anything left blank is sent as not entered.
  const [results, setResults] = useState<Record<number, { value: string; interpretation: string }>>({})
  const [notes, setNotes] = useState('')

  const definitionList = definitions.data ?? []
  const chosen = definitionList.find(definition => String(definition.assay_definition_id) === definitionId)
  // React Query reports isPending on a later tick, so a fast double click needs a synchronous guard as well.
  const submitting = useRef(false)
  const canUseVolume = sample.availability.state !== 'not_recorded' && sample.availability.state !== 'no_unit'

  function chooseDefinition(id: string) {
    setDefinitionId(id)
    setResults({})
    const definition = definitionList.find(row => String(row.assay_definition_id) === id)
    if (definition?.typical_volume && canUseVolume && !volume) {
      setVolume(String(Number(definition.typical_volume)))
      setVolumeUnit(definition.typical_volume_unit ?? volumeUnit)
    }
  }

  const record = useMutation({
    // A new execution of the chosen assay holding this one Sample; more samples can join it on the assay's page.
    mutationFn: () => api.createAssayExecution(Number(definitionId), {
      assay_date: date ? `${date}T${time || '00:00'}` : null,
      operator_name: performedBy || null,
      notes: notes || null,
      samples: [{
        sample_id: sample.sample_id,
        results: (chosen?.result_fields ?? []).map(field => ({
          assay_definition_result_id: field.assay_definition_result_id,
          value: results[field.assay_definition_result_id]?.value.trim() || null,
          interpretation: results[field.assay_definition_result_id]?.interpretation.trim() || null,
          qc_status: null,
        })),
        volume_used: volume ? volume : null,
        volume_unit: volume ? volumeUnit || null : null,
      }],
    }),
    onSuccess: execution => {
      client.invalidateQueries({ queryKey: ['sample', String(sample.sample_id)] })
      client.invalidateQueries({ queryKey: ['samples'] })
      client.invalidateQueries({ queryKey: ['assay-definitions'] })
      client.invalidateQueries({ queryKey: ['assay-definition', String(execution.assay_definition_id)] })
      client.invalidateQueries({ queryKey: ['assay-performed-by'] })
      navigate(executionHref(execution))
    },
    onSettled: () => { submitting.current = false },
  })
  const fieldErrors = record.error instanceof ApiError ? record.error.fieldErrors : {}
  // Errors about the one sample row arrive as samples.0.<field>.
  const rowError = (field: string) => fieldErrors[`samples.0.${field}`]
  const otherError = record.error && Object.keys(fieldErrors).length === 0 ? record.error.message : null

  function submit(event: FormEvent) {
    event.preventDefault()
    if (submitting.current) return
    submitting.current = true
    record.mutate()
  }


  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <header className="space-y-2">
        <Breadcrumb>
          <BreadcrumbList className="text-xs">
            <BreadcrumbItem><BreadcrumbLink asChild><Link to="/samples">Samples</Link></BreadcrumbLink></BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem><BreadcrumbLink asChild><Link className="font-mono" to={`/sample/${sample.sample_id}`}>{sample.sample_code}</Link></BreadcrumbLink></BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem><BreadcrumbPage>Record assay</BreadcrumbPage></BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <h1 className="text-lg font-semibold tracking-tight">
          Record assay <span className="font-normal text-muted-foreground">on</span> <SampleLink sample={sample} className="font-semibold" />
        </h1>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
          <SampleTypeLabel typeId={sample.sample_type_id} name={sample.sample_type} className="text-foreground/80" />
          <StatusBadge status={sample.status} />
          <AvailabilityLine availability={sample.availability} />
        </p>
        <WorkflowSteps />
      </header>

      <form onSubmit={submit} aria-label="Record assay" className="rounded-md border bg-card shadow-xs">
        <Section title="Assay" description="The procedure that was performed. Assays are defined once on the Assays page and reused for every Sample.">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <select
                id="assay-definition"
                aria-label="Assay"
                required
                value={definitionId}
                onChange={event => chooseDefinition(event.target.value)}
                aria-invalid={Boolean(fieldErrors.assay_definition_id) || undefined}
                className={cn(inputClass, 'w-full max-w-md text-[13px]')}
              >
                <option value="">{definitions.isLoading ? 'Loading assays…' : 'Choose an assay'}</option>
                {definitionList.map(definition => (
                  <option key={definition.assay_definition_id} value={definition.assay_definition_id}>
                    {definition.assay_name} · {definition.assay_type}{definition.target ? ` · ${definition.target}` : ''}
                  </option>
                ))}
              </select>
              <Button asChild variant="ghost" size="sm" className="text-primary hover:text-primary"><Link to="/assays/new"><Plus aria-hidden="true" />Define a new assay</Link></Button>
            </div>
            {chosen && <DefinitionSummary definition={chosen} />}
            {!definitions.isLoading && definitionList.length === 0 && <p className="text-xs text-muted-foreground">No assays are defined yet. Define one first; it can then be recorded on any Sample.</p>}
            <FieldError message={fieldErrors.assay_definition_id} />
          </div>
        </Section>

        <Section title="Performed" description="When the assay was run, and who ran it.">
          <div className="grid gap-3 sm:grid-cols-[10rem_7rem_minmax(0,1fr)]">
            <Field label="Date" htmlFor="assay-date" error={fieldErrors.assay_date}>
              <Input id="assay-date" type="date" required value={date} onChange={event => setDate(event.target.value)} className="h-8 text-[13px] tabular-nums" />
            </Field>
            <Field label="Time" htmlFor="assay-time">
              <Input id="assay-time" type="time" required value={time} onChange={event => setTime(event.target.value)} className="h-8 text-[13px] tabular-nums" />
            </Field>
            <Field label="Performed by" htmlFor="performed-by" hint="Pick a previous name or type a new one." error={fieldErrors.operator_name}>
              <SuggestInput id="performed-by" value={performedBy} onChange={setPerformedBy} suggestions={performers.data ?? []} suggestionsLabel="Previously recorded" placeholder="Name" invalid={Boolean(fieldErrors.operator_name)} />
            </Field>
          </div>
        </Section>

        <Section title="Sample usage" description={<>Volume of <span className="font-mono">{sample.sample_code}</span> this execution used. It is deducted from the sample's available quantity.</>}>
          <div className="grid items-start gap-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
            <Field label="Volume used" htmlFor="volume-used" optional hint={chosen?.typical_volume ? `Typical for this assay: ${formatQuantity(chosen.typical_volume, chosen.typical_volume_unit)}` : undefined} error={rowError('volume_used')}>
              <div className="flex">
                <Input
                  id="volume-used"
                  type="number"
                  min="0"
                  step="any"
                  inputMode="decimal"
                  disabled={!canUseVolume}
                  value={volume}
                  onChange={event => setVolume(event.target.value)}
                  aria-invalid={Boolean(rowError('volume_used')) || undefined}
                  className="h-8 rounded-r-none text-right text-[13px] tabular-nums"
                />
                <Input aria-label="Volume unit" disabled={!canUseVolume} value={volumeUnit} onChange={event => setVolumeUnit(event.target.value)} className="h-8 w-20 rounded-l-none border-l-0 text-[13px]" />
              </div>
            </Field>
            <AvailabilityPanel availability={sample.availability} />
          </div>
        </Section>

        <Section title="Results" description="Leave any of them blank if the assay has not been read yet; they can be entered later on the assay's page. A number is stored as a number; text such as “not detected” as text.">
          {chosen?.result_fields.length ? (
            <table className="w-full max-w-2xl text-[13px]" aria-label="Results">
              <thead className="text-left text-xs text-muted-foreground"><tr><th className="pb-1 font-medium">Result</th><th className="pb-1 font-medium">Value</th><th className="pb-1 font-medium">Interpretation</th></tr></thead>
              <tbody>
                {chosen.result_fields.map((field, index) => {
                  const entry = results[field.assay_definition_result_id] ?? { value: '', interpretation: '' }
                  const set = (changes: Partial<typeof entry>) => setResults(current => ({ ...current, [field.assay_definition_result_id]: { ...entry, ...changes } }))
                  const error = rowError(`results.${index}.value`)
                  return (
                    <tr key={field.assay_definition_result_id}>
                      <td className="py-0.5 pr-2 font-medium">{field.label}{field.unit && <span className="font-normal text-muted-foreground"> ({field.unit})</span>}</td>
                      <td className="py-0.5 pr-2">
                        <input aria-label={`${field.label} value`} value={entry.value} onChange={event => set({ value: event.target.value })} placeholder={field.value_type === 'numeric' ? 'e.g. 31.2' : '31.2 or not detected'} aria-invalid={Boolean(error) || undefined} className={cn(inputClass, 'w-40 tabular-nums')} />
                        <FieldError message={error} />
                      </td>
                      <td className="py-0.5 pr-2"><input aria-label={`${field.label} interpretation`} value={entry.interpretation} onChange={event => set({ interpretation: event.target.value })} placeholder="e.g. negative" className={cn(inputClass, 'w-full')} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          ) : <p className="text-xs text-muted-foreground">{chosen ? 'This assay lists no result fields.' : 'Choose an assay to lay out its results.'}</p>}
        </Section>

        <Section title="Details" description="Anything a colleague would need to interpret this run.">
          <Field label="Notes" htmlFor="assay-notes" optional>
            <Textarea id="assay-notes" value={notes} onChange={event => setNotes(event.target.value)} className="min-h-20 text-[13px]" placeholder="Plate layout, kit lot, deviations…" />
          </Field>
        </Section>

        <div className="flex flex-wrap items-center justify-between gap-3 bg-muted/40 px-4 py-3">
          <p className="text-xs text-muted-foreground">The execution is named after the assay (for example LACV-QPCR-SYBR-013) and can be renamed on the assay's page. Status is completed and QC starts as not reviewed; both can be changed on the execution page.</p>
          <div className="flex items-center gap-2">
            {otherError && <p role="alert" className="text-xs text-destructive">{otherError}</p>}
            <Button asChild variant="ghost" size="sm"><Link to={`/sample/${sample.sample_id}`}>Cancel</Link></Button>
            <Button type="submit" size="sm" disabled={record.isPending}><FlaskConical aria-hidden="true" />{record.isPending ? 'Recording…' : 'Record assay'}</Button>
          </div>
        </div>
      </form>
    </div>
  )
}

function DefinitionSummary({ definition }: { definition: AssayDefinition }) {
  const items: [string, ReactNode][] = [
    ['Type', definition.assay_type],
    ['Target', definition.target],
    ['Kit', definition.kit],
    ['Instrument', definition.instrument],
    ['Reports', definition.result_fields.map(field => field.label).join(', ')],
  ]
  return (
    <dl className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
      {items.filter(([, value]) => value).map(([label, value]) => <div key={label} className="flex gap-1.5"><dt className="text-muted-foreground">{label}</dt><dd className="font-medium">{value}</dd></div>)}
      <Link className="text-primary hover:underline" to={`/assays/${definition.assay_definition_id}`}>About this assay</Link>
    </dl>
  )
}

function AvailabilityLine({ availability }: { availability: SampleAvailability }) {
  if (availability.available_quantity === null) return <span>No quantity recorded</span>
  return <span className="tabular-nums"><span className="font-medium text-foreground">{formatQuantity(availability.available_quantity, availability.unit)}</span> available</span>
}

/** The Sample's availability next to the volume field, so the amount used can be judged against what is there. */
function AvailabilityPanel({ availability }: { availability: SampleAvailability }) {
  const { state, unit, available_quantity: available, starting_quantity: starting, percent_remaining: percent } = availability
  if (state === 'not_recorded' || state === 'no_unit') {
    return (
      <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
        {state === 'not_recorded' ? 'This sample has no recorded quantity' : 'This sample has no quantity unit'}, so a volume cannot be deducted.
        Record its quantity on the sample first, or record the assay without a volume.
      </p>
    )
  }
  return (
    <div className="rounded-md bg-muted/60 px-3 py-2 text-xs">
      <p className="text-muted-foreground">
        <span className="text-[15px] font-semibold text-foreground tabular-nums">{formatQuantity(available, unit)}</span> available
        {starting !== null && <> of {formatQuantity(starting, unit)}</>}
        {percent !== null && <span className="tabular-nums"> · {percent}%</span>}
      </p>
      {percent !== null && (
        <div role="meter" aria-label="Remaining" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(Math.max(percent, 0), 100)} aria-valuetext={`${percent}% remaining`} className="mt-1.5 h-1 overflow-hidden rounded-full bg-secondary ring-1 ring-border ring-inset">
          <div className={cn('h-full rounded-full', percent <= 10 ? 'bg-amber-500' : 'bg-primary')} style={{ width: `${Math.min(Math.max(percent, 0), 100)}%` }} />
        </div>
      )}
      {state !== 'tracked' && <p className="mt-1 text-amber-800">Quantity history needs attention on the sample page; the recorded quantity is used.</p>}
    </div>
  )
}

const STEPS = [
  { label: 'Sample', here: true },
  { label: 'Assay performed', here: true },
  { label: 'Volume used', here: true },
  { label: 'Results', here: true },
  { label: 'Derived samples', here: false },
]

function WorkflowSteps() {
  return (
    <ol aria-label="Assay workflow" className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px]">
      {STEPS.map((step, index) => (
        <li key={step.label} className="flex items-center gap-1.5">
          {index > 0 && <ArrowRight aria-hidden="true" className="size-3 text-muted-foreground/60" />}
          <span className={cn('rounded-sm px-1.5 py-0.5', step.here ? 'bg-accent font-medium text-accent-foreground' : 'text-muted-foreground')}>{step.label}</span>
        </li>
      ))}
      <li className="ml-1 text-muted-foreground">· the execution opens on its assay's page, where more samples can join it</li>
    </ol>
  )
}

function localDate(date: Date) {
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function localTime(date: Date) {
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}
