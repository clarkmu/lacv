import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, FileSpreadsheet, Save, TriangleAlert, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { api, ApiError } from '../../api'
import { inputClass } from '../common'
import { SuggestInput } from '../SuggestInput'
import { SampleFinder } from './SampleFinder'
import type { AssayDefinitionDetail, AssayExecution, ExecutionImportPreview, SampleRef } from '../../types'

type Row = { sample: SampleRef & { sample_type_id?: number | null }; result: string; volume: string; unit: string }

/**
 * A new execution of this assay as a small spreadsheet: name and details on top, then one row per sample with its
 * result (blank if not known yet) and the volume used. Rows come from the sample finder or an .xlsx workbook.
 * Saving creates the execution and every row together, or nothing.
 */
export function NewExecution({ definition, onSaved, onCancel }: { definition: AssayDefinitionDetail; onSaved: (execution: AssayExecution) => void; onCancel: () => void }) {
  const client = useQueryClient()
  const samples = useQuery({ queryKey: ['samples', { rootOnly: false }], queryFn: () => api.listSamples() })
  const performers = useQuery({ queryKey: ['assay-performed-by'], queryFn: api.listPerformedBy })
  const now = new Date()
  const [name, setName] = useState(definition.next_execution_name)
  const [date, setDate] = useState(localDate(now))
  const [time, setTime] = useState(localTime(now))
  const [performedBy, setPerformedBy] = useState('')
  const [notes, setNotes] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const submitting = useRef(false)
  const unit = definition.typical_volume_unit ?? ''

  const imported = useMutation({
    mutationFn: (file: File) => api.previewExecutionImport(definition.assay_definition_id, file),
    onSuccess: (preview: ExecutionImportPreview) => {
      if (!preview.can_import) return
      setRows(preview.rows.map(row => ({ sample: row.sample!, result: row.result ?? '', volume: row.volume_used ? String(Number(row.volume_used)) : '', unit: row.volume_unit ?? unit })))
      const details = preview.execution
      if (details?.execution_name) setName(details.execution_name)
      if (details?.assay_date) { setDate(details.assay_date.slice(0, 10)); setTime(details.assay_date.slice(11, 16)) }
      if (details?.operator_name) setPerformedBy(details.operator_name)
      if (details?.notes) setNotes(details.notes)
      setNotice(`${preview.rows.length} ${preview.rows.length === 1 ? 'sample' : 'samples'} loaded from ${preview.source.file_name}. Check them, then save.`)
    },
  })

  const save = useMutation({
    mutationFn: () => api.createAssayExecution(definition.assay_definition_id, {
      execution_name: name.trim() || null,
      assay_date: date ? `${date}T${time || '00:00'}` : null,
      operator_name: performedBy || null,
      notes: notes || null,
      samples: rows.map(row => ({ sample_id: row.sample.sample_id, result: row.result.trim() || null, volume_used: row.volume || null, volume_unit: row.volume ? row.unit || null : null })),
    }),
    onSuccess: execution => {
      client.invalidateQueries({ queryKey: ['assay-definition', String(definition.assay_definition_id)] })
      client.invalidateQueries({ queryKey: ['assay-definitions'] })
      client.invalidateQueries({ queryKey: ['assay-performed-by'] })
      for (const row of rows) client.invalidateQueries({ queryKey: ['sample', String(row.sample.sample_id)] })
      onSaved(execution)
    },
    onSettled: () => { submitting.current = false },
  })
  const fieldErrors = save.error instanceof ApiError ? save.error.fieldErrors : {}
  const rowError = (index: number) => ['sample_id', 'result', 'volume_used'].map(field => fieldErrors[`samples.${index}.${field}`]).filter(Boolean).join(' ')
  const otherError = save.error && !Object.keys(fieldErrors).some(key => key.startsWith('samples.')) ? (fieldErrors.execution_name ?? save.error.message) : null

  function addSample(sample: SampleRef) {
    setNotice(null)
    setRows(current => [...current, { sample, result: '', volume: '', unit: definition.typical_volume_unit ?? '' }])
  }

  function setRow(index: number, changes: Partial<Row>) {
    setRows(current => current.map((row, i) => (i === index ? { ...row, ...changes } : row)))
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (submitting.current || rows.length === 0) return
    submitting.current = true
    save.mutate()
  }

  return (
    <form onSubmit={submit} aria-label="New execution" className="rounded-md border border-primary/30 bg-card shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
        <h2 className="text-[13px] font-semibold tracking-tight">New execution <span className="font-normal text-muted-foreground">of {definition.assay_name}</span></h2>
        <div className="flex items-center gap-2">
          <a href={api.executionTemplateUrl(definition.assay_definition_id)} download className="inline-flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline"><Download aria-hidden="true" className="size-3" />Template</a>
          <input ref={fileInput} type="file" accept=".xlsx" aria-label="Execution workbook" className="sr-only" onChange={event => { const file = event.target.files?.[0]; if (file) imported.mutate(file); event.target.value = '' }} />
          <Button type="button" variant="outline" size="sm" className="h-7" disabled={imported.isPending} onClick={() => fileInput.current?.click()}>
            <FileSpreadsheet aria-hidden="true" />{imported.isPending ? 'Reading…' : 'Import from XLSX'}
          </Button>
        </div>
      </div>

      <div className="grid gap-3 border-b px-3 py-3 sm:grid-cols-[minmax(0,14rem)_9.5rem_6.5rem_minmax(0,12rem)_minmax(0,1fr)]">
        <label className="space-y-1 text-xs font-medium">Execution name
          <input aria-label="Execution name" required value={name} onChange={event => setName(event.target.value)} aria-invalid={Boolean(fieldErrors.execution_name) || undefined} className={cn(inputClass, 'w-full font-mono text-[13px]')} />
        </label>
        <label className="space-y-1 text-xs font-medium">Date
          <input aria-label="Execution date" type="date" required value={date} onChange={event => setDate(event.target.value)} className={cn(inputClass, 'w-full text-[13px] tabular-nums')} />
        </label>
        <label className="space-y-1 text-xs font-medium">Time
          <input aria-label="Execution time" type="time" value={time} onChange={event => setTime(event.target.value)} className={cn(inputClass, 'w-full text-[13px] tabular-nums')} />
        </label>
        <div className="space-y-1 text-xs font-medium">
          <label htmlFor="execution-performed-by">Performed by</label>
          <SuggestInput id="execution-performed-by" value={performedBy} onChange={setPerformedBy} suggestions={performers.data ?? []} suggestionsLabel="Previously recorded" placeholder="Name" />
        </div>
        <label className="space-y-1 text-xs font-medium">Notes
          <input aria-label="Execution notes" value={notes} onChange={event => setNotes(event.target.value)} placeholder="Plate layout, kit lot, deviations…" className={cn(inputClass, 'w-full text-[13px]')} />
        </label>
      </div>

      {imported.data && !imported.data.can_import && (
        <ul aria-label="Workbook problems" className="space-y-0.5 border-b bg-destructive/5 px-3 py-2 text-xs text-destructive">
          <li className="font-medium">{imported.data.source.file_name} was not loaded; fix these and choose it again:</li>
          {imported.data.problems.map(problem => <li key={problem} className="flex items-start gap-1"><TriangleAlert aria-hidden="true" className="mt-0.5 size-3 shrink-0" />{problem}</li>)}
        </ul>
      )}
      {imported.error && <p role="alert" className="border-b bg-destructive/5 px-3 py-2 text-xs text-destructive">{imported.error.message}</p>}

      <table className="w-full text-[13px]" aria-label="Samples in the new execution">
        <thead className="text-left text-xs text-muted-foreground">
          <tr>
            <th className="w-10 border-b px-3 py-1.5 font-medium">#</th>
            <th className="border-b px-2 py-1.5 font-medium">Sample</th>
            <th className="border-b px-2 py-1.5 font-medium">Type</th>
            <th className="border-b px-2 py-1.5 font-medium">{definition.result_name ?? 'Result'}{definition.result_unit && <span className="font-normal"> ({definition.result_unit})</span>}</th>
            <th className="border-b px-2 py-1.5 font-medium">Volume used{definition.typical_volume && <span className="font-normal"> · typical {Number(definition.typical_volume)} {definition.typical_volume_unit}</span>}</th>
            <th className="w-10 border-b px-2 py-1.5"><span className="sr-only">Remove</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const error = rowError(index)
            return (
              <tr key={row.sample.sample_id} className={cn(error && 'bg-destructive/5')}>
                <td className="border-b px-3 py-1 text-xs text-muted-foreground tabular-nums">{index + 1}</td>
                <td className="border-b px-2 py-1">
                  <Link className="font-mono font-medium text-primary hover:underline" to={`/sample/${row.sample.sample_id}`}>{row.sample.sample_code}</Link>
                  {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
                </td>
                <td className="border-b px-2 py-1 text-muted-foreground">{row.sample.sample_type}</td>
                <td className="border-b px-2 py-1">
                  <input aria-label={`Result for ${row.sample.sample_code}`} value={row.result} onChange={event => setRow(index, { result: event.target.value })} placeholder="blank until known" className={cn(inputClass, 'h-7 w-40 tabular-nums')} />
                </td>
                <td className="border-b px-2 py-1">
                  <span className="flex items-center gap-1">
                    <input aria-label={`Volume used from ${row.sample.sample_code}`} type="number" min="0" step="any" value={row.volume} onChange={event => setRow(index, { volume: event.target.value })} className={cn(inputClass, 'h-7 w-20 text-right tabular-nums')} />
                    <input aria-label={`Volume unit for ${row.sample.sample_code}`} value={row.unit} onChange={event => setRow(index, { unit: event.target.value })} className={cn(inputClass, 'h-7 w-14')} />
                  </span>
                </td>
                <td className="border-b px-2 py-1 text-right">
                  <Button type="button" variant="ghost" size="icon" className="size-7" aria-label={`Remove ${row.sample.sample_code}`} onClick={() => setRows(current => current.filter((_, i) => i !== index))}><X aria-hidden="true" /></Button>
                </td>
              </tr>
            )
          })}
          <tr>
            <td className="px-3 py-2 text-xs text-muted-foreground tabular-nums">{rows.length + 1}</td>
            <td colSpan={5} className="px-2 py-2">
              <SampleFinder
                samples={samples.data ?? []}
                chosenIds={rows.map(row => row.sample.sample_id)}
                onPick={addSample}
                onDuplicate={sample => setNotice(`${sample.sample_code} is already in this execution.`)}
                autoFocus
              />
              {notice && <p role="status" className="mt-1 text-xs text-muted-foreground">{notice}</p>}
            </td>
          </tr>
        </tbody>
      </table>

      <div className="flex flex-wrap items-center justify-end gap-2 bg-muted/40 px-3 py-2">
        <span className="mr-auto text-xs text-muted-foreground tabular-nums">
          {rows.length} {rows.length === 1 ? 'sample' : 'samples'}{rows.length > 0 && ` · ${rows.filter(row => row.result.trim()).length} with a result`}
        </span>
        {otherError && <p role="alert" className="text-xs text-destructive">{otherError}</p>}
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
        <Button type="submit" size="sm" disabled={save.isPending || rows.length === 0}><Save aria-hidden="true" />{save.isPending ? 'Saving…' : 'Save execution'}</Button>
      </div>
    </form>
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
