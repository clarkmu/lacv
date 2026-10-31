import { FormEvent, useState } from 'react'
import type { ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, FlaskConical, Pencil, Plus, TestTube, Trash2, X } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { api, ApiError } from '../api'
import { buttonClass, errorClass, inputClass, Panel, QuantityValue, SampleLink, SampleTypeLabel, SecondaryCode, StatusBadge } from '../components/common'
import { formatDateTime } from '../format'
import type { AssayExecutionDetail, AssayResult, ExpectedResult } from '../types'
import { resultLabel, resultPayload, type ResultDraft } from '../assayResults'

const QC_STATES = ['not_reviewed', 'accepted', 'rejected']
const EXECUTION_STATES = ['completed', 'failed', 'in_progress', 'cancelled']

/** One execution of an assay on one Sample: the procedure, the Sample, how it was run, and its results. */
export function AssayExecutionPage() {
  const { id = '' } = useParams()
  const query = useQuery({ queryKey: ['assay-execution', id], queryFn: () => api.getAssayExecution(id) })
  if (query.isLoading) return <p className="py-6 text-sm text-muted-foreground">Loading assay execution…</p>
  if (!query.data) return <p className="py-6 text-sm text-muted-foreground">Assay execution not found.</p>
  return <ExecutionView execution={query.data} />
}

function useSaveExecution(execution: AssayExecutionDetail) {
  const client = useQueryClient()
  return (data: AssayExecutionDetail) => {
    client.setQueryData(['assay-execution', String(execution.execution_id)], data)
    client.invalidateQueries({ queryKey: ['sample', String(execution.sample.sample_id)] })
    client.invalidateQueries({ queryKey: ['assay-definition', String(execution.assay_definition_id)] })
  }
}

function ExecutionView({ execution }: { execution: AssayExecutionDetail }) {
  const saved = useSaveExecution(execution)
  const update = useMutation({ mutationFn: (changes: Record<string, unknown>) => api.updateAssayExecution(execution.execution_id, changes), onSuccess: saved })
  const definition = execution.definition

  return (
    <div className="space-y-4">
      <header className="space-y-2">
        <Breadcrumb>
          <BreadcrumbList className="text-xs">
            <BreadcrumbItem><BreadcrumbLink asChild><Link to="/assays">Assays</Link></BreadcrumbLink></BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem><BreadcrumbLink asChild><Link to={`/assays/${definition.assay_definition_id}`}>{definition.assay_name}</Link></BreadcrumbLink></BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem><BreadcrumbPage className="font-mono">{execution.execution_code}</BreadcrumbPage></BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <h1 className="text-lg font-semibold tracking-tight">
          {definition.assay_name} <span className="font-normal text-muted-foreground">on</span> <SampleLink sample={execution.sample} className="font-semibold" />
        </h1>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
          <SecondaryCode>{execution.execution_code}</SecondaryCode>
          <StatusBadge status={execution.status} />
          <span className="inline-flex items-center gap-1">QC <StatusBadge status={execution.qc_status} /></span>
          {execution.assay_date && <span className="tabular-nums">{formatDateTime(execution.assay_date)}</span>}
          {execution.operator_name && <span>by <span className="text-foreground">{execution.operator_name}</span></span>}
        </p>
      </header>

      {/* The relationship, left to right: the reusable procedure, the Sample it ran on, this execution. */}
      <ol aria-label="Assay, sample and execution" className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)] md:items-stretch">
        <Step icon={FlaskConical} label="Assay procedure">
          <Link className="font-medium text-primary hover:underline" to={`/assays/${definition.assay_definition_id}`}>{definition.assay_name}</Link>
          <span className="block text-xs text-muted-foreground">{[definition.assay_type, definition.target, definition.kit].filter(Boolean).join(' · ')}</span>
        </Step>
        <Arrow />
        <Step icon={TestTube} label="Sample">
          <SampleLink sample={execution.sample} />
          <span className="block text-xs text-muted-foreground"><SampleTypeLabel typeId={null} name={execution.sample.sample_type} /></span>
        </Step>
        <Arrow />
        <Step icon={Pencil} label="This execution" current>
          <span className="font-mono font-medium">{execution.execution_code}</span>
          <span className="block text-xs text-muted-foreground tabular-nums">{execution.result_count} {execution.result_count === 1 ? 'result' : 'results'}</span>
        </Step>
      </ol>

      <ResultsPanel execution={execution} />

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Panel title="Execution">
          <dl className="grid gap-x-6 text-[13px] sm:grid-cols-2">
            <Detail label="Date">{formatDateTime(execution.assay_date)}</Detail>
            <Detail label="Performed by">{execution.operator_name}</Detail>
            <Detail label="Volume used">{execution.volume_used !== null ? <QuantityValue value={execution.volume_used} unit={execution.volume_unit} /> : <span className="text-muted-foreground">Not recorded</span>}</Detail>
            <Detail label="Status">
              <select aria-label="Execution status" value={execution.status} disabled={update.isPending} onChange={event => update.mutate({ status: event.target.value })} className={cn(inputClass, 'h-7')}>
                {[...new Set([...EXECUTION_STATES, execution.status])].map(value => <option key={value} value={value}>{value}</option>)}
              </select>
            </Detail>
            <Detail label="QC">
              <select aria-label="Execution QC" value={execution.qc_status} disabled={update.isPending} onChange={event => update.mutate({ qc_status: event.target.value })} className={cn(inputClass, 'h-7')}>
                {[...new Set([...QC_STATES, execution.qc_status])].map(value => <option key={value} value={value}>{value}</option>)}
              </select>
            </Detail>
            <Detail label="Notes" wide>{execution.notes && <span className="whitespace-pre-wrap">{execution.notes}</span>}</Detail>
          </dl>
          {update.error && <p role="alert" className={`${errorClass} mt-2`}>{update.error.message}</p>}
        </Panel>
        <div className="space-y-4">
          <OutputSamples execution={execution} />
          {execution.data_files.length > 0 && (
            <Panel title="Files">
              <ul className="space-y-0.5 text-[13px]">{execution.data_files.map(file => <li key={file.data_file_id}>{file.file_name} <span className="text-muted-foreground">· {file.file_type} · <code className="text-xs">{file.file_location}</code></span></li>)}</ul>
            </Panel>
          )}
        </div>
      </div>
    </div>
  )
}

const EMPTY_DRAFT: ResultDraft = { analyte: '', result_name: '', value: '', unit: '', interpretation: '', qc_status: 'not_reviewed' }

function draftFrom(result: AssayResult): ResultDraft {
  return {
    analyte: result.analyte ?? '', result_name: result.result_name,
    value: result.numeric_value !== null ? String(Number(result.numeric_value)) : result.text_value ?? '',
    unit: result.unit ?? '', interpretation: result.interpretation ?? '', qc_status: result.qc_status,
  }
}

function ResultsPanel({ execution }: { execution: AssayExecutionDetail }) {
  const [editing, setEditing] = useState<number | null>(null)
  const [adding, setAdding] = useState<ResultDraft | null>(null)
  const missing = execution.definition.expected_results.filter(expected => !execution.results.some(result => sameResult(result, expected)))

  return (
    <Panel
      title={<>Results <span className="font-normal text-muted-foreground tabular-nums">· {execution.results.length}</span></>}
      label="Results"
      bodyClassName="p-0"
      action={!adding && <Button variant="ghost" size="sm" className="h-7 text-primary hover:text-primary" onClick={() => { setEditing(null); setAdding({ ...EMPTY_DRAFT }) }}><Plus aria-hidden="true" />Add result</Button>}
    >
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>{['Analyte', 'Result', 'Value', 'Unit', 'Interpretation', 'QC', ''].map((label, index) => <th key={index} className={cn('border-b px-3 py-1.5 font-medium', label === 'Value' && 'text-right')}>{label}</th>)}</tr>
          </thead>
          <tbody>
            {execution.results.map(result => editing === result.assay_result_id
              ? <ResultEditor key={result.assay_result_id} execution={execution} result={result} initial={draftFrom(result)} onDone={() => setEditing(null)} />
              : <ResultRow key={result.assay_result_id} execution={execution} result={result} onEdit={() => { setAdding(null); setEditing(result.assay_result_id) }} />)}
            {adding && <ResultEditor key="new" execution={execution} initial={adding} onDone={() => setAdding(null)} />}
            {!execution.results.length && !adding && (
              <tr><td colSpan={7} className="px-3 py-3 text-sm text-muted-foreground">No results recorded yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {missing.length > 0 && !adding && (
        <div className="flex flex-wrap items-center gap-1.5 border-t px-3 py-2 text-xs text-muted-foreground">
          This assay reports
          {missing.map(expected => (
            <Button key={resultLabel(expected)} variant="outline" size="sm" className="h-6 px-2 text-xs" onClick={() => { setEditing(null); setAdding({ ...EMPTY_DRAFT, analyte: expected.analyte ?? '', result_name: expected.result_name, unit: expected.unit ?? '' }) }}>
              <Plus aria-hidden="true" />{resultLabel(expected)}
            </Button>
          ))}
        </div>
      )}
    </Panel>
  )
}

function sameResult(result: AssayResult, expected: ExpectedResult) {
  return result.result_name.toLowerCase() === expected.result_name.toLowerCase() && (result.analyte ?? '').toLowerCase() === (expected.analyte ?? '').toLowerCase()
}

const cellClass = 'border-b px-3 py-1.5 align-middle'

function ResultRow({ execution, result, onEdit }: { execution: AssayExecutionDetail; result: AssayResult; onEdit: () => void }) {
  const saved = useSaveExecution(execution)
  const [confirming, setConfirming] = useState(false)
  const remove = useMutation({ mutationFn: () => api.deleteAssayResult(execution.execution_id, result.assay_result_id), onSuccess: saved })
  const locked = result.qc_status === 'accepted'
  const value = result.numeric_value !== null ? String(Number(result.numeric_value)) : result.text_value ?? ''

  return (
    <tr className="hover:bg-muted/40">
      <td className={cellClass}>{result.analyte}</td>
      <td className={cn(cellClass, 'font-medium')}>{result.result_name}</td>
      <td className={cn(cellClass, 'text-right', result.numeric_value !== null && 'font-medium tabular-nums')}>{value}</td>
      <td className={cn(cellClass, 'text-muted-foreground')}>{result.unit}</td>
      <td className={cellClass}>{result.interpretation}</td>
      <td className={cellClass}><StatusBadge status={result.qc_status} /></td>
      <td className={cn(cellClass, 'text-right whitespace-nowrap')}>
        {remove.error && <span role="alert" className="mr-2 text-xs text-destructive">{remove.error.message}</span>}
        {confirming ? (
          <>
            <Button size="sm" variant="ghost" className="h-7" onClick={() => setConfirming(false)}>Keep</Button>
            <button type="button" className={cn(buttonClass.danger, 'h-7')} disabled={remove.isPending} onClick={() => remove.mutate()}>Remove result</button>
          </>
        ) : (
          <>
            <Button size="icon" variant="ghost" className="size-7" aria-label={`Edit ${resultLabel(result)}`} onClick={onEdit}><Pencil aria-hidden="true" /></Button>
            <Button
              size="icon" variant="ghost" className="size-7 text-muted-foreground hover:text-destructive" disabled={locked}
              aria-label={`Remove ${resultLabel(result)}`} title={locked ? 'QC accepted: reject it, or set QC back to not reviewed, before removing' : undefined}
              onClick={() => setConfirming(true)}
            ><Trash2 aria-hidden="true" /></Button>
          </>
        )}
      </td>
    </tr>
  )
}

function ResultEditor({ execution, result, initial, onDone }: { execution: AssayExecutionDetail; result?: AssayResult; initial: ResultDraft; onDone: () => void }) {
  const saved = useSaveExecution(execution)
  const [draft, setDraft] = useState(initial)
  const save = useMutation({
    mutationFn: () => result
      ? api.updateAssayResult(execution.execution_id, result.assay_result_id, resultPayload(draft))
      : api.createAssayResult(execution.execution_id, resultPayload(draft)),
    onSuccess: data => { saved(data); onDone() },
  })
  const fieldErrors = save.error instanceof ApiError ? save.error.fieldErrors : {}
  const set = (key: keyof ResultDraft) => (event: { target: { value: string } }) => setDraft(current => ({ ...current, [key]: event.target.value }))
  const label = result ? 'Edit result' : 'New result'
  const formId = `result-form-${result?.assay_result_id ?? 'new'}`

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!save.isPending) save.mutate()
  }

  return (
    <>
      <tr className="bg-accent/40" aria-label={label} onKeyDown={event => { if (event.key === 'Escape') onDone() }}>
        <td className="border-b px-2 py-1"><input form={formId} aria-label="Analyte" value={draft.analyte} onChange={set('analyte')} className={cn(inputClass, 'h-7 w-full min-w-20')} /></td>
        <td className="border-b px-2 py-1"><input form={formId} aria-label="Result name" required autoFocus={!initial.result_name} value={draft.result_name} onChange={set('result_name')} aria-invalid={Boolean(fieldErrors.result_name) || undefined} className={cn(inputClass, 'h-7 w-full min-w-20')} /></td>
        <td className="border-b px-2 py-1"><input form={formId} aria-label="Value" autoFocus={Boolean(initial.result_name)} value={draft.value} onChange={set('value')} placeholder="31.2 or not detected" aria-invalid={Boolean(fieldErrors.numeric_value) || undefined} className={cn(inputClass, 'h-7 w-full min-w-28 text-right tabular-nums')} /></td>
        <td className="border-b px-2 py-1"><input form={formId} aria-label="Unit" value={draft.unit} onChange={set('unit')} className={cn(inputClass, 'h-7 w-20')} /></td>
        <td className="border-b px-2 py-1"><input form={formId} aria-label="Interpretation" value={draft.interpretation} onChange={set('interpretation')} placeholder="e.g. negative" className={cn(inputClass, 'h-7 w-full min-w-24')} /></td>
        <td className="border-b px-2 py-1">
          <select form={formId} aria-label="Result QC" value={draft.qc_status} onChange={set('qc_status')} className={cn(inputClass, 'h-7')}>
            {[...new Set([...QC_STATES, draft.qc_status])].map(value => <option key={value} value={value}>{value}</option>)}
          </select>
        </td>
        <td className="border-b px-2 py-1 text-right whitespace-nowrap">
          <form id={formId} onSubmit={submit} className="inline-flex items-center gap-1">
            <Button type="button" size="icon" variant="ghost" className="size-7" aria-label="Cancel" onClick={onDone}><X aria-hidden="true" /></Button>
            <Button type="submit" size="sm" className="h-7" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save'}</Button>
          </form>
        </td>
      </tr>
      {save.error && (
        <tr><td colSpan={7} className="border-b px-3 py-1.5"><p role="alert" className="text-xs text-destructive">{Object.values(fieldErrors)[0] ?? save.error.message}</p></td></tr>
      )}
    </>
  )
}

function OutputSamples({ execution }: { execution: AssayExecutionDetail }) {
  const saved = useSaveExecution(execution)
  const [code, setCode] = useState('')
  const create = useMutation({ mutationFn: () => api.createAssayOutputSample(execution.execution_id, { sample_code: code }), onSuccess: data => { saved(data); setCode('') } })
  return (
    <Panel title="Derived samples produced">
      {execution.output_samples.length ? <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">{execution.output_samples.map(sample => <SampleLink key={sample.sample_id} sample={sample} />)}</div> : <p className="text-[13px] text-muted-foreground">None.</p>}
      <form onSubmit={event => { event.preventDefault(); create.mutate() }} className="mt-2 flex flex-wrap gap-2">
        <input required value={code} onChange={event => setCode(event.target.value)} aria-label="New derived sample code" placeholder="New derived sample code" className={cn(inputClass, 'w-56 font-mono')} />
        <button disabled={create.isPending} className={buttonClass.secondary}>Add derived sample</button>
      </form>
      {create.error && <p role="alert" className={`${errorClass} mt-2`}>{create.error.message}</p>}
    </Panel>
  )
}

function Step({ icon: Icon, label, current = false, children }: { icon: typeof FlaskConical; label: string; current?: boolean; children: ReactNode }) {
  return (
    <li className={cn('rounded-md border bg-card px-3 py-2 shadow-xs', current && 'border-primary/40 bg-accent/50')}>
      <span className="mb-0.5 flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase"><Icon aria-hidden="true" className="size-3" />{label}</span>
      <span className="text-[13px]">{children}</span>
    </li>
  )
}

function Arrow() {
  return <li aria-hidden="true" className="hidden items-center text-muted-foreground/60 md:flex"><ChevronRight className="size-4" /></li>
}

function Detail({ label, wide = false, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={`grid grid-cols-[7rem_1fr] items-center gap-2 border-b py-1.5 last:border-b-0 ${wide ? 'sm:col-span-2' : ''}`}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  )
}
