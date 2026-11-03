import { useEffect, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Search, X } from 'lucide-react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { api, ApiError } from '../api'
import { resultText } from '../assayResults'
import { NewExecution } from '../components/assay/NewExecution'
import { SampleFinder } from '../components/assay/SampleFinder'
import { inputClass, Panel, QuantityValue, SampleLink, SecondaryCode, StatusBadge } from '../components/common'
import { formatDateTime } from '../format'
import type { AssayDefinitionDetail, AssayExecution, ExecutionSample } from '../types'

const VALUE_TYPES = { either: 'number or text', numeric: 'number', text: 'text' }
const STATUSES = ['completed', 'failed', 'in_progress', 'cancelled']
const QC_STATES = ['not_reviewed', 'accepted', 'rejected']

/** An assay's workspace: what the procedure is, every execution of it with its samples and their results, and new executions. */
export function AssayDefinitionPage() {
  const { id = '' } = useParams()
  const query = useQuery({ queryKey: ['assay-definition', id], queryFn: () => api.getAssayDefinition(id) })
  if (query.isLoading) return <p className="py-6 text-sm text-muted-foreground">Loading assay…</p>
  if (!query.data) return <p className="py-6 text-sm text-muted-foreground">Assay not found.</p>
  return <AssayWorkspace definition={query.data} />
}

function AssayWorkspace({ definition }: { definition: AssayDefinitionDetail }) {
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)

  return (
    <div className="space-y-4">
      <header className="space-y-2">
        <Breadcrumb>
          <BreadcrumbList className="text-xs">
            <BreadcrumbItem><BreadcrumbLink asChild><Link to="/assays">Assays</Link></BreadcrumbLink></BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem><BreadcrumbPage>{definition.assay_name}</BreadcrumbPage></BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">{definition.assay_name}</h1>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
              <SecondaryCode>{definition.assay_code}</SecondaryCode>
              <span>{definition.assay_type}{definition.target ? ` · ${definition.target}` : ''}</span>
              {!definition.is_active && <StatusBadge status="retired" />}
              <span className="tabular-nums">{plural(definition.execution_count, 'execution')} on {plural(definition.sample_count, 'sample')}</span>
            </p>
          </div>
          {definition.is_active && !creating && <Button size="sm" onClick={() => setCreating(true)}><Plus aria-hidden="true" />New execution</Button>}
        </div>
        {!definition.is_active && <p className="text-xs text-muted-foreground">Retired: kept with its executions, but new executions cannot be recorded.</p>}
      </header>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(16rem,1fr)]">
        <Panel title="Procedure">
          <dl className="grid gap-x-8 text-[13px] sm:grid-cols-2 xl:grid-cols-3">
            <Detail label="Type">{definition.assay_type}</Detail>
            <Detail label="Target">{definition.target}</Detail>
            <Detail label="Result">{definition.result_name && <>{definition.result_name}{definition.result_unit && <span className="text-muted-foreground"> ({definition.result_unit})</span>} <span className="text-muted-foreground">· {VALUE_TYPES[definition.result_value_type]}</span></>}</Detail>
            <Detail label="Kit">{definition.kit}</Detail>
            <Detail label="Instrument">{definition.instrument}</Detail>
            <Detail label="Typical volume"><QuantityValue value={definition.typical_volume} unit={definition.typical_volume_unit} /></Detail>
            <Detail label="Procedure notes" wide>{definition.description && <span className="whitespace-pre-wrap">{definition.description}</span>}</Detail>
          </dl>
        </Panel>
        <ResultSummary definition={definition} />
      </div>

      {creating && (
        <NewExecution
          definition={definition}
          onCancel={() => setCreating(false)}
          onSaved={execution => { setCreating(false); navigate({ hash: `execution-${execution.assay_execution_id}` }) }}
        />
      )}

      <Executions definition={definition} />
    </div>
  )
}

/** The mean of numeric results, with what it is and is not based on, so a blank or text result is never mistaken for a zero. */
function ResultSummary({ definition }: { definition: AssayDefinitionDetail }) {
  const { mean, numeric_count: numeric, text_count: text, empty_count: empty, unit, averageable } = definition.result_summary
  return (
    <Panel title={`Average ${definition.result_name ?? 'result'}`} label="Average result">
      {!averageable ? (
        <p className="text-[13px] text-muted-foreground">This assay's result is text, so there is no average.</p>
      ) : (
        <>
          <p className="text-2xl font-semibold tracking-tight tabular-nums" aria-label="Average">
            {mean === null ? <span className="text-muted-foreground">—</span> : <>{formatMean(mean)}{unit && <span className="ml-1 text-sm font-normal text-muted-foreground">{unit}</span>}</>}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
            {numeric ? `Mean of ${plural(numeric, 'numeric result')}` : 'No numeric results yet'}
            {text > 0 && `; ${text} text not averaged`}
            {empty > 0 && `; ${empty} not entered`}
          </p>
        </>
      )}
    </Panel>
  )
}

function Executions({ definition }: { definition: AssayDefinitionDetail }) {
  const location = useLocation()
  const [filter, setFilter] = useState('')
  const term = filter.trim().toLowerCase()
  const executions = term
    ? definition.executions.filter(execution => [
      String(execution.assay_execution_id), execution.execution_name, execution.operator_name ?? '', execution.status, execution.qc_status,
      ...execution.samples.map(row => row.sample.sample_code),
    ].some(value => value.toLowerCase().includes(term)))
    : definition.executions
  const focused = /^#execution-(\d+)$/.exec(location.hash)?.[1]

  useEffect(() => {
    if (focused) document.getElementById(`execution-${focused}`)?.scrollIntoView?.({ block: 'start' })
  }, [focused, definition.executions.length])

  return (
    <section aria-label="Executions" className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[13px] font-semibold tracking-tight">Executions <span className="font-normal text-muted-foreground tabular-nums">· {definition.executions.length}</span></h2>
        <div className="relative w-full max-w-xs">
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input aria-label="Filter executions" value={filter} onChange={event => setFilter(event.target.value)} placeholder="Filter by execution, sample, person…" className={cn(inputClass, 'w-full pl-7 text-[13px]')} />
        </div>
      </div>
      {definition.executions.length === 0 ? (
        <p className="rounded-md border border-dashed bg-card px-4 py-6 text-center text-sm text-muted-foreground">No executions yet. Use New execution to run this assay on one or more samples.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border bg-card shadow-xs">
          <table className="w-full min-w-[40rem] text-[13px]" aria-label="Executions and their samples">
            <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
              <tr>
                <th className="border-b px-3 py-1.5 font-medium">Sample</th>
                <th className="border-b px-2 py-1.5 font-medium">Type</th>
                <th className="border-b px-2 py-1.5 font-medium">{definition.result_name ?? 'Result'}{definition.result_unit && <span className="font-normal"> ({definition.result_unit})</span>}</th>
                <th className="border-b px-2 py-1.5 text-right font-medium">Volume used</th>
                <th className="w-10 border-b px-2 py-1.5"><span className="sr-only">Remove</span></th>
              </tr>
            </thead>
            {executions.map(execution => (
              <ExecutionGroup key={execution.assay_execution_id} definition={definition} execution={execution} focused={focused === String(execution.assay_execution_id)} />
            ))}
            {executions.length === 0 && <tbody><tr><td colSpan={5} className="px-3 py-4 text-sm text-muted-foreground">No executions match your filter.</td></tr></tbody>}
          </table>
        </div>
      )}
    </section>
  )
}

/** Keep the definition's cached copy in step with a changed execution, then refetch so counts and the average follow. */
function useExecutionSaved(definition: AssayDefinitionDetail) {
  const client = useQueryClient()
  const key = ['assay-definition', String(definition.assay_definition_id)]
  return (execution: AssayExecution) => {
    client.setQueryData<AssayDefinitionDetail>(key, current => current && {
      ...current,
      executions: current.executions.map(candidate => (candidate.assay_execution_id === execution.assay_execution_id ? execution : candidate)),
    })
    client.invalidateQueries({ queryKey: key })
    client.invalidateQueries({ queryKey: ['assay-definitions'] })
    for (const row of execution.samples) client.invalidateQueries({ queryKey: ['sample', String(row.sample.sample_id)] })
  }
}

/** One execution: a header row with its identity and details, then one row per sample with its result. */
function ExecutionGroup({ definition, execution, focused }: { definition: AssayDefinitionDetail; execution: AssayExecution; focused: boolean }) {
  const saved = useExecutionSaved(definition)
  const [editing, setEditing] = useState(false)
  const [adding, setAdding] = useState(false)
  const update = useMutation({ mutationFn: (changes: Record<string, unknown>) => api.updateAssayExecution(execution.assay_execution_id, changes), onSuccess: data => { saved(data); setEditing(false) } })

  return (
    <tbody id={`execution-${execution.assay_execution_id}`} aria-label={`Execution ${execution.assay_execution_id}`} className={cn('scroll-mt-20 border-t-2 border-border', focused && 'bg-accent/30')}>
      <tr className="bg-muted/40">
        <th colSpan={5} scope="rowgroup" className="px-3 py-1.5 text-left font-normal">
          {editing ? (
            <ExecutionDetailsEditor execution={execution} pending={update.isPending} error={update.error} onSave={changes => update.mutate(changes)} onCancel={() => { setEditing(false); update.reset() }} />
          ) : (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-mono text-xs font-semibold text-foreground" title="Execution ID">#{execution.assay_execution_id}</span>
              <span className="font-medium text-foreground" data-testid="execution-name">{execution.execution_name}</span>
              <span className="text-xs text-muted-foreground tabular-nums">{formatDateTime(execution.assay_date)}</span>
              {execution.operator_name && <span className="text-xs text-muted-foreground">by <span className="text-foreground/80">{execution.operator_name}</span></span>}
              <StatusBadge status={execution.status} />
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">QC <StatusBadge status={execution.qc_status} /></span>
              <span className="text-xs text-muted-foreground tabular-nums">{plural(execution.samples.length, 'sample')}</span>
              {execution.data_files.length > 0 && <span className="text-xs text-muted-foreground">Files: {execution.data_files.map(file => file.file_name).join(', ')}</span>}
              {execution.output_samples.length > 0 && <span className="text-xs text-muted-foreground">Produced {execution.output_samples.map(sample => <SampleLink key={sample.sample_id} sample={sample} className="ml-1 text-xs" />)}</span>}
              <span className="ml-auto flex items-center gap-1">
                <Button type="button" variant="ghost" size="sm" className="h-7 text-primary hover:text-primary" onClick={() => setAdding(true)}><Plus aria-hidden="true" />Add sample</Button>
                <Button type="button" variant="ghost" size="icon" className="size-7" aria-label={`Edit execution ${execution.assay_execution_id}`} onClick={() => setEditing(true)}><Pencil aria-hidden="true" /></Button>
              </span>
              {execution.notes && <p className="basis-full text-xs whitespace-pre-wrap text-muted-foreground">{execution.notes}</p>}
            </div>
          )}
        </th>
      </tr>
      {execution.samples.map(row => <SampleRow key={row.assay_execution_sample_id} definition={definition} execution={execution} row={row} />)}
      {adding && <AddSampleRow definition={definition} execution={execution} onDone={() => setAdding(false)} />}
    </tbody>
  )
}

function ExecutionDetailsEditor({ execution, pending, error, onSave, onCancel }: {
  execution: AssayExecution; pending: boolean; error: Error | null; onSave: (changes: Record<string, unknown>) => void; onCancel: () => void
}) {
  const [draft, setDraft] = useState({
    execution_name: execution.execution_name,
    assay_date: execution.assay_date?.slice(0, 16) ?? '',
    operator_name: execution.operator_name ?? '',
    status: execution.status,
    qc_status: execution.qc_status,
    notes: execution.notes ?? '',
  })
  const set = (key: keyof typeof draft) => (event: { target: { value: string } }) => setDraft(current => ({ ...current, [key]: event.target.value }))
  const message = error instanceof ApiError ? Object.values(error.fieldErrors)[0] ?? error.message : error?.message
  return (
    <form
      aria-label={`Edit execution ${execution.assay_execution_id}`}
      onSubmit={event => { event.preventDefault(); onSave({ ...draft, assay_date: draft.assay_date || null, operator_name: draft.operator_name || null, notes: draft.notes || null }) }}
      onKeyDown={event => { if (event.key === 'Escape') onCancel() }}
      className="flex flex-wrap items-end gap-2"
    >
      <span className="self-center font-mono text-xs font-semibold">#{execution.assay_execution_id}</span>
      <label className="space-y-0.5 text-[11px] text-muted-foreground">Name<input aria-label="Execution name" required autoFocus value={draft.execution_name} onChange={set('execution_name')} className={cn(inputClass, 'block h-7 w-52 font-mono text-[13px] text-foreground')} /></label>
      <label className="space-y-0.5 text-[11px] text-muted-foreground">Date<input aria-label="Execution date" type="datetime-local" value={draft.assay_date} onChange={set('assay_date')} className={cn(inputClass, 'block h-7 text-[13px] text-foreground')} /></label>
      <label className="space-y-0.5 text-[11px] text-muted-foreground">Performed by<input aria-label="Performed by" value={draft.operator_name} onChange={set('operator_name')} className={cn(inputClass, 'block h-7 w-36 text-[13px] text-foreground')} /></label>
      <label className="space-y-0.5 text-[11px] text-muted-foreground">Status
        <select aria-label="Execution status" value={draft.status} onChange={set('status')} className={cn(inputClass, 'block h-7 text-[13px] text-foreground')}>
          {[...new Set([...STATUSES, execution.status])].map(value => <option key={value} value={value}>{value}</option>)}
        </select>
      </label>
      <label className="space-y-0.5 text-[11px] text-muted-foreground">QC
        <select aria-label="Execution QC" value={draft.qc_status} onChange={set('qc_status')} className={cn(inputClass, 'block h-7 text-[13px] text-foreground')}>
          {[...new Set([...QC_STATES, execution.qc_status])].map(value => <option key={value} value={value}>{value}</option>)}
        </select>
      </label>
      <label className="min-w-40 flex-1 space-y-0.5 text-[11px] text-muted-foreground">Notes<input aria-label="Execution notes" value={draft.notes} onChange={set('notes')} className={cn(inputClass, 'block h-7 w-full text-[13px] text-foreground')} /></label>
      <Button type="button" variant="ghost" size="sm" className="h-7" onClick={onCancel}>Cancel</Button>
      <Button type="submit" size="sm" className="h-7" disabled={pending}>{pending ? 'Saving…' : 'Save'}</Button>
      {message && <p role="alert" className="basis-full text-xs text-destructive">{message}</p>}
    </form>
  )
}

function SampleRow({ definition, execution, row }: { definition: AssayDefinitionDetail; execution: AssayExecution; row: ExecutionSample }) {
  const saved = useExecutionSaved(definition)
  const remove = useMutation({ mutationFn: () => api.removeExecutionSample(execution.assay_execution_id, row.sample.sample_id), onSuccess: saved })
  return (
    <tr className="hover:bg-muted/30">
      <td className="border-b py-1 pr-2 pl-6"><SampleLink sample={row.sample} /></td>
      <td className="border-b px-2 py-1 text-muted-foreground">{row.sample.sample_type}</td>
      <td className="border-b px-2 py-0.5"><ResultCell definition={definition} execution={execution} row={row} /></td>
      <td className="border-b px-2 py-1 text-right">{row.volume_used !== null ? <QuantityValue value={row.volume_used} unit={row.volume_unit} /> : <span className="text-muted-foreground/60">—</span>}</td>
      <td className="border-b px-2 py-1 text-right">
        {remove.error && <span role="alert" className="mr-1 text-xs text-destructive">{remove.error.message}</span>}
        {execution.samples.length > 1 && (
          <Button type="button" variant="ghost" size="icon" className="size-7 text-muted-foreground hover:text-destructive" aria-label={`Remove ${row.sample.sample_code} from execution ${execution.assay_execution_id}`} disabled={remove.isPending} onClick={() => remove.mutate()}>
            <X aria-hidden="true" />
          </Button>
        )}
      </td>
    </tr>
  )
}

/** A result edited in place: Enter or leaving the cell saves, Escape puts the saved value back. Blank clears it. */
function ResultCell({ definition, execution, row }: { definition: AssayDefinitionDetail; execution: AssayExecution; row: ExecutionSample }) {
  const saved = useExecutionSaved(definition)
  const stored = resultText(row)
  const [value, setValue] = useState(stored)
  useEffect(() => setValue(stored), [stored])
  const save = useMutation({ mutationFn: (result: string | null) => api.updateExecutionResult(execution.assay_execution_id, row.sample.sample_id, result), onSuccess: saved })
  const message = save.error instanceof ApiError ? save.error.fieldErrors.result ?? save.error.message : save.error?.message

  function commit() {
    if (value.trim() !== stored && !save.isPending) save.mutate(value.trim() || null)
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') { event.preventDefault(); commit() }
    if (event.key === 'Escape') { setValue(stored); save.reset() }
  }

  return (
    <span className="flex items-center gap-2">
      <input
        aria-label={`Result for ${row.sample.sample_code} in execution ${execution.assay_execution_id}`}
        value={value}
        placeholder="not entered"
        onChange={event => setValue(event.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
        aria-invalid={Boolean(message) || undefined}
        title={message}
        className={cn(
          'h-7 w-44 rounded-sm border border-transparent bg-transparent px-1.5 tabular-nums placeholder:text-muted-foreground/60 hover:border-input focus-visible:border-ring focus-visible:bg-card focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none',
          row.result_numeric !== null && 'font-medium',
          message && 'border-destructive bg-destructive/5',
        )}
      />
      {save.isPending && <span className="text-xs text-muted-foreground">Saving…</span>}
      {message && <span role="alert" className="text-xs text-destructive">{message}</span>}
    </span>
  )
}

function AddSampleRow({ definition, execution, onDone }: { definition: AssayDefinitionDetail; execution: AssayExecution; onDone: () => void }) {
  const saved = useExecutionSaved(definition)
  const samples = useQuery({ queryKey: ['samples', { rootOnly: false }], queryFn: () => api.listSamples() })
  const [notice, setNotice] = useState<string | null>(null)
  const add = useMutation({
    mutationFn: (sampleId: number) => api.addExecutionSample(execution.assay_execution_id, { sample_id: sampleId, result: null, volume_used: null, volume_unit: null }),
    onSuccess: data => { saved(data); onDone() },
  })
  return (
    <tr>
      <td colSpan={5} className="border-b py-1.5 pr-2 pl-6">
        <div className="flex flex-wrap items-center gap-2">
          <SampleFinder
            samples={samples.data ?? []}
            chosenIds={execution.samples.map(row => row.sample.sample_id)}
            onPick={sample => add.mutate(sample.sample_id)}
            onDuplicate={sample => setNotice(`${sample.sample_code} is already in this execution.`)}
            label={`Add a sample to execution ${execution.assay_execution_id}`}
            autoFocus
          />
          <Button type="button" variant="ghost" size="sm" className="h-7" onClick={onDone}>Cancel</Button>
          {(notice || add.error) && <p role="alert" className={cn('text-xs', add.error ? 'text-destructive' : 'text-muted-foreground')}>{add.error?.message ?? notice}</p>}
        </div>
      </td>
    </tr>
  )
}

function Detail({ label, wide = false, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={cn('grid grid-cols-[7.5rem_1fr] items-baseline gap-2 border-b py-1.5 last:border-b-0', wide && 'sm:col-span-2 xl:col-span-3')}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children || <span className="text-muted-foreground/60">—</span>}</dd>
    </div>
  )
}

function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

function formatMean(mean: string) {
  const value = Number(mean)
  return Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 3 }) : mean
}

