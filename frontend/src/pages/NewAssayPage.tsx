import { FormEvent, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, FlaskConical, Plus, TriangleAlert } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { api, ApiError } from '../api'
import { SampleLink, SampleTypeLabel, StatusBadge } from '../components/common'
import { SuggestInput } from '../components/SuggestInput'
import { formatQuantity } from '../format'
import type { AssayDefinition, SampleAvailability, SampleDetail } from '../types'

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
  const definitions = useQuery({ queryKey: ['assay-definitions'], queryFn: api.listAssayDefinitions })
  const performers = useQuery({ queryKey: ['assay-performed-by'], queryFn: api.listPerformedBy })
  const now = new Date()

  const [definitionId, setDefinitionId] = useState('')
  const [newDefinition, setNewDefinition] = useState(false)
  const [assayType, setAssayType] = useState('')
  const [target, setTarget] = useState('')
  const [assayName, setAssayName] = useState('')
  const [date, setDate] = useState(localDate(now))
  const [time, setTime] = useState(localTime(now))
  const [performedBy, setPerformedBy] = useState('')
  const [volume, setVolume] = useState('')
  const [volumeUnit, setVolumeUnit] = useState(sample.quantity_unit ?? '')
  const [notes, setNotes] = useState('')

  const definitionList = definitions.data ?? []
  const choosing = definitionList.length > 0 && !newDefinition
  const chosen = definitionList.find(definition => String(definition.assay_definition_id) === definitionId)
  // React Query reports isPending on a later tick, so a fast double click needs a synchronous guard as well.
  const submitting = useRef(false)
  const canUseVolume = sample.availability.state !== 'not_recorded' && sample.availability.state !== 'no_unit'

  const record = useMutation({
    mutationFn: () => api.createSampleAssay(sample.sample_id, {
      ...(choosing
        ? { assay_definition_id: definitionId ? Number(definitionId) : null }
        : { assay_type: assayType || null, target: target || null, assay_name: assayName || null }),
      assay_date: date ? `${date}T${time || '00:00'}` : null,
      operator_name: performedBy || null,
      volume_used: volume ? volume : null,
      volume_unit: volume ? volumeUnit || null : null,
      notes: notes || null,
    }),
    onSuccess: assay => {
      client.invalidateQueries({ queryKey: ['sample', String(sample.sample_id)] })
      client.invalidateQueries({ queryKey: ['samples'] })
      client.invalidateQueries({ queryKey: ['assays'] })
      client.invalidateQueries({ queryKey: ['assay-performed-by'] })
      client.invalidateQueries({ queryKey: ['assay-definitions'] })
      navigate(`/assay/${assay.assay_id}`)
    },
    onSettled: () => { submitting.current = false },
  })
  const fieldErrors = record.error instanceof ApiError ? record.error.fieldErrors : {}
  const assayError = fieldErrors.assay_definition_id ?? fieldErrors.assay_type
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
        <Section title="Assay" description="Type is the method (e.g. qPCR); target is what it detects; the name is how the lab refers to this assay.">
          {choosing ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Select value={definitionId} onValueChange={setDefinitionId}>
                  <SelectTrigger id="assay-definition" aria-label="Assay" aria-invalid={Boolean(assayError) || undefined} className="h-8 w-full max-w-md text-[13px]">
                    <SelectValue placeholder="Choose an assay the lab runs" />
                  </SelectTrigger>
                  <SelectContent>
                    {definitionList.map(definition => (
                      <SelectItem key={definition.assay_definition_id} value={String(definition.assay_definition_id)}>
                        {definition.assay_name} <span className="text-muted-foreground">· {definition.assay_type}{definition.target ? ` · ${definition.target}` : ''}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button type="button" variant="ghost" size="sm" className="text-primary hover:text-primary" onClick={() => setNewDefinition(true)}><Plus aria-hidden="true" />New assay</Button>
              </div>
              {chosen && <DefinitionSummary definition={chosen} />}
              <FieldError message={assayError} />
            </div>
          ) : (
            <div className="space-y-2">
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Assay type" htmlFor="assay-type" error={fieldErrors.assay_type}>
                  <SuggestInput id="assay-type" value={assayType} onChange={setAssayType} suggestions={distinct(definitionList.map(definition => definition.assay_type))} suggestionsLabel="Types in use" placeholder="e.g. qPCR" invalid={Boolean(fieldErrors.assay_type)} />
                </Field>
                <Field label="Target" htmlFor="assay-target" optional>
                  <SuggestInput id="assay-target" value={target} onChange={setTarget} suggestions={distinct(definitionList.map(definition => definition.target ?? ''))} suggestionsLabel="Targets in use" placeholder="e.g. LACV" />
                </Field>
                <Field label="Assay name" htmlFor="assay-name" optional>
                  <Input id="assay-name" value={assayName} onChange={event => setAssayName(event.target.value)} placeholder={assayType || 'Defaults to the type'} className="h-8 text-[13px]" />
                </Field>
              </div>
              {definitionList.length > 0 && <Button type="button" variant="link" size="sm" className="h-auto px-0 text-xs" onClick={() => setNewDefinition(false)}>Choose an existing assay instead</Button>}
            </div>
          )}
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

        <Section title="Sample usage" description={<>Volume of <span className="font-mono">{sample.sample_code}</span> used by this assay. It is deducted from the sample's available quantity.</>}>
          <div className="grid items-start gap-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
            <Field label="Volume used" htmlFor="volume-used" optional error={fieldErrors.volume_used}>
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
                  aria-invalid={Boolean(fieldErrors.volume_used) || undefined}
                  className="h-8 rounded-r-none text-right text-[13px] tabular-nums"
                />
                <Input aria-label="Volume unit" disabled={!canUseVolume} value={volumeUnit} onChange={event => setVolumeUnit(event.target.value)} className="h-8 w-20 rounded-l-none border-l-0 text-[13px]" />
              </div>
            </Field>
            <AvailabilityPanel availability={sample.availability} />
          </div>
        </Section>

        <Section title="Details" description="Anything a colleague would need to interpret this run.">
          <Field label="Notes" htmlFor="assay-notes" optional>
            <Textarea id="assay-notes" value={notes} onChange={event => setNotes(event.target.value)} className="min-h-20 text-[13px]" placeholder="Plate layout, kit lot, deviations…" />
          </Field>
        </Section>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-muted/40 px-4 py-3">
          <p className="text-xs text-muted-foreground">Results and derived samples are added on the assay page after recording. QC starts as not reviewed.</p>
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

function Section({ title, description, children }: { title: string; description: ReactNode; children: ReactNode }) {
  return (
    <fieldset className="grid gap-x-6 gap-y-2 border-b px-4 py-4 md:grid-cols-[13rem_minmax(0,1fr)]">
      <div>
        <legend className="text-[13px] font-semibold tracking-tight">{title}</legend>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </fieldset>
  )
}

function Field({ label, htmlFor, optional = false, hint, error, children }: { label: string; htmlFor: string; optional?: boolean; hint?: string; error?: string; children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-1">
      <Label htmlFor={htmlFor} className="text-xs font-medium">{label}{optional && <span className="font-normal text-muted-foreground">optional</span>}</Label>
      {children}
      {hint && !error && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      <FieldError message={error} />
    </div>
  )
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return <p role="alert" className="flex items-start gap-1 text-xs text-destructive"><TriangleAlert aria-hidden="true" className="mt-0.5 size-3 shrink-0" />{message}</p>
}

function DefinitionSummary({ definition }: { definition: AssayDefinition }) {
  return (
    <dl className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
      <div className="flex gap-1.5"><dt className="text-muted-foreground">Type</dt><dd className="font-medium">{definition.assay_type}</dd></div>
      <div className="flex gap-1.5"><dt className="text-muted-foreground">Target</dt><dd className="font-medium">{definition.target || '—'}</dd></div>
      <div className="flex gap-1.5"><dt className="text-muted-foreground">Name</dt><dd className="font-medium">{definition.assay_name}</dd></div>
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
  { label: 'Results', here: false },
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
      <li className="ml-1 text-muted-foreground">· results and derived samples follow on the assay page</li>
    </ol>
  )
}

function distinct(values: string[]) {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))]
}

function localDate(date: Date) {
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function localTime(date: Date) {
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}
