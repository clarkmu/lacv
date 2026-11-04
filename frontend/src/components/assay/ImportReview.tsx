import { useState } from 'react'
import type { ReactNode } from 'react'
import { Check, CircleAlert, CircleCheck, CircleHelp, TriangleAlert, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { SampleLink } from '../common'
import { SampleFinder } from './SampleFinder'
import type { AssayDefinitionDetail, ExecutionImportPreview, ExecutionImportRow, SampleListItem, SampleRef } from '../../types'

/** A workbook row with the Sample it will use, once chosen. */
export type ReviewedRow = { row: ExecutionImportRow; sample: SampleRef }

type Choice = { sample: SampleRef | null; removed: boolean }

const GROUPS = [
  { match: 'none' as const, title: 'No match', icon: CircleAlert, tone: 'text-destructive', hint: 'No sample has this code. Find the sample, or remove the row.' },
  { match: 'close' as const, title: 'Possible match', icon: CircleHelp, tone: 'text-amber-700', hint: 'The code is not exact. Confirm a suggestion, find another sample, or remove the row.' },
  { match: 'exact' as const, title: 'Matched', icon: CircleCheck, tone: 'text-emerald-700', hint: 'The code is exactly a sample code (or an old Material code).' },
]

/**
 * Review of an uploaded execution workbook before its rows join the new execution: rows with no match first, then
 * possible matches, then exact matches. Nothing is chosen for the user; every kept row needs a Sample, used once.
 */
export function ImportReview({ preview, definition, samples, alreadyAdded, onConfirm, onClose }: {
  preview: ExecutionImportPreview
  definition: AssayDefinitionDetail
  samples: SampleListItem[]
  /** Samples already in the new execution's table. */
  alreadyAdded: SampleRef[]
  onConfirm: (rows: ReviewedRow[]) => void
  onClose: () => void
}) {
  const [choices, setChoices] = useState<Record<number, Choice>>(() => Object.fromEntries(
    // Exact matches start chosen (a repeated one then shows as a clash to resolve); everything else waits for the user.
    preview.rows.map(row => [row.row_number, { sample: row.match === 'exact' ? row.sample : null, removed: false }]),
  ))
  const choose = (rowNumber: number, changes: Partial<Choice>) => setChoices(current => ({ ...current, [rowNumber]: { ...current[rowNumber], ...changes } }))
  const kept = preview.rows.filter(row => !choices[row.row_number].removed)
  const clashes = clashesOf(kept, choices, alreadyAdded)
  const unresolved = kept.filter(row => !choices[row.row_number].sample).length
  const ready = preview.can_import && kept.length > 0 && unresolved === 0 && Object.keys(clashes).length === 0
  const suggestionsLeft = kept.filter(row => row.match === 'close' && !choices[row.row_number].sample)

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose() }}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-3 sm:max-w-4xl" aria-describedby="import-review-summary">
        <DialogHeader>
          <DialogTitle>Samples from {preview.source.file_name}</DialogTitle>
          <DialogDescription id="import-review-summary">
            {preview.can_import
              ? <>{plural(preview.rows.length, 'row')}: {GROUPS.map(group => `${preview.rows.filter(row => row.match === group.match).length} ${group.title.toLowerCase()}`).join(', ')}. Fix the rows above the matched ones, then add them to the execution.</>
              : 'This workbook cannot be used. Fix these and choose it again; nothing has been added.'}
          </DialogDescription>
        </DialogHeader>

        {preview.problems.length > 0 && (
          <ul aria-label="Workbook problems" className="space-y-0.5 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {preview.problems.map(problem => <li key={problem} className="flex items-start gap-1"><TriangleAlert aria-hidden="true" className="mt-0.5 size-3 shrink-0" />{problem}</li>)}
          </ul>
        )}

        {preview.can_import && (
          <div className="-mx-1 min-h-0 flex-1 space-y-3 overflow-y-auto px-1">
            {GROUPS.map(group => {
              const rows = preview.rows.filter(row => row.match === group.match)
              if (!rows.length) return null
              const Icon = group.icon
              return (
                <section key={group.match} aria-label={group.title} className="rounded-md border">
                  <header className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b bg-muted/50 px-3 py-1.5">
                    <h3 className={cn('flex items-center gap-1.5 text-[13px] font-semibold', group.tone)}><Icon aria-hidden="true" className="size-3.5" />{group.title} <span className="font-normal text-muted-foreground tabular-nums">· {rows.length}</span></h3>
                    <span className="text-xs text-muted-foreground">{group.hint}</span>
                    {group.match === 'close' && suggestionsLeft.length > 0 && (
                      <Button type="button" variant="outline" size="sm" className="ml-auto h-7" onClick={() => suggestionsLeft.forEach(row => choose(row.row_number, { sample: row.candidates[0].sample }))}>
                        <Check aria-hidden="true" />Use first suggestion for all {suggestionsLeft.length}
                      </Button>
                    )}
                  </header>
                  <table className="w-full text-[13px]">
                    <tbody>
                      {rows.map(row => (
                        <ReviewRow
                          key={row.row_number}
                          row={row}
                          choice={choices[row.row_number]}
                          clash={clashes[row.row_number]}
                          definition={definition}
                          samples={samples}
                          onChoose={sample => choose(row.row_number, { sample })}
                          onRemove={removed => choose(row.row_number, { removed })}
                        />
                      ))}
                    </tbody>
                  </table>
                </section>
              )
            })}
          </div>
        )}

        <DialogFooter className="items-center border-t pt-3">
          {preview.can_import && (
            <span className="mr-auto text-xs text-muted-foreground tabular-nums">
              {unresolved > 0 ? `${plural(unresolved, 'row')} still need a sample` : Object.keys(clashes).length > 0 ? 'Some rows use the same sample' : `${plural(kept.length, 'sample')} ready`}
            </span>
          )}
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>{preview.can_import ? 'Cancel' : 'Close'}</Button>
          {preview.can_import && (
            <Button type="button" size="sm" disabled={!ready} onClick={() => onConfirm(kept.map(row => ({ row, sample: choices[row.row_number].sample! })))}>
              Add {plural(kept.length, 'sample')} to execution
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ReviewRow({ row, choice, clash, definition, samples, onChoose, onRemove }: {
  row: ExecutionImportRow; choice: Choice; clash?: string; definition: AssayDefinitionDetail; samples: SampleListItem[]
  onChoose: (sample: SampleRef | null) => void; onRemove: (removed: boolean) => void
}) {
  const values = row.results
    .filter(result => result.value || result.interpretation)
    .map(result => {
      const field = definition.result_fields.find(item => item.assay_definition_result_id === result.assay_definition_result_id)
      return `${field?.label ?? 'Result'} ${[result.value, result.interpretation && `(${result.interpretation})`].filter(Boolean).join(' ')}`
    })
  const label = `row ${row.row_number}`
  return (
    <tr className={cn('border-b last:border-b-0 align-top', choice.removed && 'opacity-50')} aria-label={`Row ${row.row_number}`}>
      <td className="w-12 px-3 py-2 text-xs text-muted-foreground tabular-nums">{row.row_number}</td>
      <td className="w-56 py-2 pr-3">
        <div className={cn('font-mono', choice.removed && 'line-through')}>{row.sample_code ?? <span className="font-sans text-muted-foreground italic">no code</span>}</div>
        {values.length > 0 && <div className="text-xs text-muted-foreground">{values.join('; ')}</div>}
        {row.problems.map(problem => <div key={problem} className="text-xs text-amber-800">{problem}</div>)}
      </td>
      <td className="py-2 pr-3">
        {choice.removed ? <span className="text-xs text-muted-foreground">Removed; this row will not be added.</span> : (
          <Resolution row={row} choice={choice} samples={samples} onChoose={onChoose} label={label} />
        )}
        {clash && !choice.removed && <p role="alert" className="mt-1 text-xs text-destructive">{clash}</p>}
      </td>
      <td className="w-24 py-2 pr-3 text-right">
        <Button type="button" variant="ghost" size="sm" className="h-7" aria-label={`${choice.removed ? 'Keep' : 'Remove'} ${label}`} onClick={() => onRemove(!choice.removed)}>
          {choice.removed ? 'Keep' : <><X aria-hidden="true" />Remove</>}
        </Button>
      </td>
    </tr>
  )
}

function Resolution({ row, choice, samples, onChoose, label }: {
  row: ExecutionImportRow; choice: Choice; samples: SampleListItem[]; onChoose: (sample: SampleRef | null) => void; label: string
}) {
  const [finding, setFinding] = useState(row.match === 'none')
  if (choice.sample && !finding) {
    return (
      <Chosen>
        <SampleLink sample={choice.sample} />
        <span className="text-xs text-muted-foreground">{choice.sample.sample_type}</span>
        <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => { onChoose(null); setFinding(row.match !== 'close') }}>Change</Button>
      </Chosen>
    )
  }
  return (
    <div className="space-y-1.5">
      {row.match === 'close' && !choice.sample && (
        <div className="flex flex-wrap gap-1.5" aria-label={`Suggestions for ${label}`}>
          {row.candidates.map(candidate => (
            <Button key={candidate.sample.sample_id} type="button" variant="outline" size="sm" className="h-auto flex-col items-start gap-0 px-2 py-1" onClick={() => { onChoose(candidate.sample); setFinding(false) }}>
              <span className="font-mono text-[13px]">Use {candidate.sample.sample_code}</span>
              <span className="text-[11px] font-normal text-muted-foreground">{candidate.reason}</span>
            </Button>
          ))}
        </div>
      )}
      <SampleFinder
        samples={samples}
        chosenIds={[]}
        label={`Find the sample for ${label}`}
        onPick={sample => { onChoose(sample); setFinding(false) }}
      />
    </div>
  )
}

function Chosen({ children }: { children: ReactNode }) {
  return <span className="flex flex-wrap items-center gap-2"><Check aria-hidden="true" className="size-3.5 text-emerald-600" />{children}</span>
}

/** Rows whose chosen Sample is also another row's, or is already in the new execution: a Sample appears once. */
function clashesOf(rows: ExecutionImportRow[], choices: Record<number, Choice>, alreadyAdded: SampleRef[]) {
  const clashes: Record<number, string> = {}
  const firstRow = new Map<number, number>()
  for (const row of rows) {
    const sample = choices[row.row_number].sample
    if (!sample) continue
    if (alreadyAdded.some(added => added.sample_id === sample.sample_id)) {
      clashes[row.row_number] = `${sample.sample_code} is already in this execution.`
    } else if (firstRow.has(sample.sample_id)) {
      clashes[row.row_number] = `${sample.sample_code} is also on row ${firstRow.get(sample.sample_id)}; a sample appears once in an execution.`
    } else {
      firstRow.set(sample.sample_id, row.row_number)
    }
  }
  return clashes
}

function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}
