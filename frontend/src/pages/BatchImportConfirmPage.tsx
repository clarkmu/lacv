import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Info, Save, TriangleAlert, X } from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { api, ApiError } from '../api'
import { errorClass, inputClass, PageHeader } from '../components/common'
import type { BatchSampleImportPreview, BatchSampleImportPreviewRow, BatchSampleImportRow } from '../types'

type Column = keyof BatchSampleImportRow

const COLUMNS: { key: Column; label: string; width?: string }[] = [
  { key: 'sample_code', label: 'Sample code *', width: 'min-w-36' },
  { key: 'subject_code', label: 'Subject' },
  { key: 'external_sample_id', label: 'External ID' },
  { key: 'sample_type', label: 'Sample type' },
  { key: 'aliquot_number', label: 'Aliquot #', width: 'min-w-16' },
  { key: 'source_type', label: 'Source type' },
  { key: 'source_description', label: 'Source description' },
  { key: 'collection_date', label: 'Collection date' },
  { key: 'received_date', label: 'Received date' },
  { key: 'status', label: 'Status' },
  { key: 'latitude', label: 'Latitude', width: 'min-w-24' },
  { key: 'longitude', label: 'Longitude', width: 'min-w-24' },
  { key: 'notes', label: 'Notes', width: 'min-w-40' },
]

type Row = { row_number: number; values: BatchSampleImportRow; problems: Partial<Record<Column, string>> }

function fromPreview(row: BatchSampleImportPreviewRow): Row {
  const values = Object.fromEntries(COLUMNS.map(column => [column.key, row[column.key] ?? null])) as BatchSampleImportRow
  const problems: Row['problems'] = {}
  for (const problem of row.problems) problems[problem.column as Column] = problems[problem.column as Column] ? `${problems[problem.column as Column]}; ${problem.message}` : problem.message
  return { row_number: row.row_number, values, problems }
}

/**
 * The rows of an uploaded batch workbook, checked by the backend, to fix and save. Each problem sits on its cell, with the
 * workbook's own row number; editing a cell clears its old message, and saving checks every row again.
 */
export function BatchImportConfirmPage() {
  const navigate = useNavigate()
  const client = useQueryClient()
  const preview = (useLocation().state as { preview?: BatchSampleImportPreview } | null)?.preview
  const [batchName, setBatchName] = useState('')
  const [rows, setRows] = useState<Row[]>(() => (preview?.samples ?? []).map(fromPreview))

  const save = useMutation({
    mutationFn: () => api.createSampleBatch({ batch_name: batchName, samples: rows.map(row => row.values) }),
    onSuccess: batch => {
      client.invalidateQueries({ queryKey: ['batches'] })
      client.invalidateQueries({ queryKey: ['samples'] })
      navigate(`/batch/${batch.batch_id}`)
    },
    onError: error => {
      if (!(error instanceof ApiError)) return
      // Problems found on saving go onto their cells, like the preview's.
      setRows(current => current.map((row, index) => {
        const found = error.problems.filter(problem => problem.path[0] === 'samples' && problem.path[1] === index)
        if (!found.length) return row
        const problems = { ...row.problems }
        for (const problem of found) problems[problem.path[2] as Column] = problem.message
        return { ...row, problems }
      }))
    },
  })
  const saveError = save.error instanceof ApiError ? save.error : null
  const batchNameError = saveError?.fieldErrors.batch_name
  const otherSaveError = save.error && !(saveError && saveError.problems.length > 0) ? save.error.message : null

  if (!preview) {
    return (
      <section className="max-w-xl">
        <PageHeader title="Confirm batch import" description="Choose a batch workbook on the Batches page first; its rows are checked and shown here before anything is saved." />
        <Button asChild size="sm"><Link to="/batches">Back to batches</Link></Button>
      </section>
    )
  }

  const withProblems = rows.filter(row => Object.keys(row.problems).length > 0)

  function updateCell(index: number, key: Column, value: string) {
    setRows(current => current.map((row, i) => {
      if (i !== index) return row
      const { [key]: _cleared, ...problems } = row.problems
      return { ...row, values: { ...row.values, [key]: value.trim() === '' ? null : value }, problems }
    }))
  }

  return (
    <section className="space-y-3">
      <PageHeader
        title="Confirm batch import"
        description={<>{preview.file_name} · {rows.length} {rows.length === 1 ? 'root sample' : 'root samples'} · nothing is saved until you save the batch</>}
      />
      {preview.warnings.map(warning => (
        <p key={warning} role="note" className="flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900"><Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />{warning}</p>
      ))}

      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1 text-xs font-medium">Batch name
          <input required value={batchName} onChange={event => setBatchName(event.target.value)} aria-invalid={Boolean(batchNameError) || undefined} className={cn(inputClass, 'block w-80 text-[13px]', batchNameError && 'border-destructive')} />
        </label>
        {batchNameError && <p role="alert" className="pb-2 text-xs text-destructive">Batch name {batchNameError}</p>}
      </div>

      {withProblems.length > 0 && (
        <div role="alert" className={cn(errorClass, 'space-y-1')}>
          <p className="flex items-center gap-1.5 font-semibold"><TriangleAlert aria-hidden="true" className="size-4" />{withProblems.length} {withProblems.length === 1 ? 'row needs' : 'rows need'} fixing before the batch can be saved</p>
          <ul className="max-h-40 space-y-0.5 overflow-y-auto text-xs">
            {withProblems.flatMap(row => Object.entries(row.problems).map(([column, message]) => (
              <li key={`${row.row_number}-${column}`}><span className="font-medium">Row {row.row_number}, {column}:</span> {message}</li>
            )))}
          </ul>
          <p className="text-xs">Edit the marked cells below, remove the row, or fix the workbook and choose it again.</p>
        </div>
      )}

      <div className="overflow-hidden rounded-md border bg-card shadow-xs">
        <div className="max-h-[calc(100vh-20rem)] min-h-40 overflow-auto">
          <table className="w-full text-[13px]" aria-label="Samples to import">
            <thead className="sticky top-0 z-10 bg-muted text-left text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
              <tr>
                <th scope="col" className="border-b px-2 py-1.5" title="Row in the workbook">Row</th>
                {COLUMNS.map(column => <th scope="col" key={column.key} className="border-b px-2 py-1.5 whitespace-nowrap">{column.label}</th>)}
                <th className="border-b px-2 py-1.5"><span className="sr-only">Remove</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.row_number} aria-label={`Row ${row.row_number}`} className={cn('align-top', Object.keys(row.problems).length > 0 && 'bg-destructive/5')}>
                  <td className="border-b px-2 py-1.5 text-xs text-muted-foreground tabular-nums">{row.row_number}</td>
                  {COLUMNS.map(column => {
                    const problem = row.problems[column.key]
                    return (
                      <td key={column.key} className="border-b px-1 py-1">
                        <input
                          aria-label={`${column.label.replace(' *', '')}, row ${row.row_number}`}
                          value={row.values[column.key] ?? ''}
                          onChange={event => updateCell(index, column.key, event.target.value)}
                          aria-invalid={Boolean(problem) || undefined}
                          title={problem}
                          className={cn(inputClass, 'h-7 w-full min-w-28 text-[13px]', column.width, problem && 'border-destructive bg-destructive/5')}
                        />
                        {problem && <p className="mt-0.5 max-w-60 text-[11px] leading-snug text-destructive">{problem}</p>}
                      </td>
                    )
                  })}
                  <td className="border-b px-1 py-1">
                    <Button type="button" variant="ghost" size="icon" className="size-7" aria-label={`Remove row ${row.row_number}`} onClick={() => setRows(current => current.filter((_, i) => i !== index))}><X aria-hidden="true" /></Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        {otherSaveError && <p role="alert" className="mr-auto text-xs text-destructive">{otherSaveError}</p>}
        <Button asChild variant="ghost" size="sm"><Link to="/batches">Cancel</Link></Button>
        <Button type="button" size="sm" disabled={save.isPending || !batchName.trim() || rows.length === 0} onClick={() => save.mutate()}>
          <Save aria-hidden="true" />{save.isPending ? 'Saving…' : `Save batch of ${rows.length}`}
        </Button>
      </div>
    </section>
  )
}
