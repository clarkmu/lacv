import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, CircleCheck, Download, FileSpreadsheet, TriangleAlert, Upload } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { api } from '../api'
import { errorClass, QuantityValue, SecondaryCode } from '../components/common'
import type { AssayImportPreview } from '../types'

/** Upload a workbook, see exactly what it would create (or why it cannot), then confirm. Nothing is saved before confirming. */
export function AssayImportPage() {
  const navigate = useNavigate()
  const client = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const preview = useMutation({ mutationFn: api.previewAssayImport })
  const confirm = useMutation({
    mutationFn: api.importAssayDefinition,
    onSuccess: definition => {
      client.invalidateQueries({ queryKey: ['assay-definitions'] })
      navigate(`/assays/${definition.assay_definition_id}`)
    },
  })

  function choose(chosen: File | undefined) {
    if (!chosen) return
    setFile(chosen)
    confirm.reset()
    preview.mutate(chosen)
  }

  const step = confirm.isPending ? 3 : preview.data ? 2 : 1
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <header className="space-y-2">
        <Breadcrumb>
          <BreadcrumbList className="text-xs">
            <BreadcrumbItem><BreadcrumbLink asChild><Link to="/assays">Assays</Link></BreadcrumbLink></BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem><BreadcrumbPage>Import from XLSX</BreadcrumbPage></BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <h1 className="text-lg font-semibold tracking-tight">Import an assay from XLSX</h1>
        <ol aria-label="Import steps" className="flex flex-wrap items-center gap-1.5 text-[11px]">
          {['Choose workbook', 'Check what it creates', 'Confirm'].map((label, index) => (
            <li key={label} className="flex items-center gap-1.5">
              {index > 0 && <ArrowRight aria-hidden="true" className="size-3 text-muted-foreground/60" />}
              <span aria-current={step === index + 1 ? 'step' : undefined} className={cn('rounded-sm px-1.5 py-0.5', step === index + 1 ? 'bg-accent font-medium text-accent-foreground' : 'text-muted-foreground')}>{index + 1}. {label}</span>
            </li>
          ))}
        </ol>
      </header>

      <section aria-label="Workbook" className="rounded-md border bg-card px-4 py-3 shadow-xs">
        <div className="flex flex-wrap items-center gap-3">
          <input ref={input} type="file" accept=".xlsx" aria-label="Assay workbook" className="sr-only" onChange={event => { choose(event.target.files?.[0]); event.target.value = '' }} />
          <Button size="sm" variant={file ? 'outline' : 'default'} onClick={() => input.current?.click()} disabled={preview.isPending}>
            <Upload aria-hidden="true" />{preview.isPending ? 'Reading…' : file ? 'Choose another workbook' : 'Choose workbook'}
          </Button>
          {file && <span className="inline-flex items-center gap-1.5 text-[13px]"><FileSpreadsheet aria-hidden="true" className="size-4 text-muted-foreground" />{file.name}</span>}
          <a href="/api/assay-definitions/import-template" download className="ml-auto inline-flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline"><Download aria-hidden="true" className="size-3" />Download the template</a>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          The workbook needs an <b className="font-medium text-foreground">Assay</b> sheet (field names in column A, values in column B; assay_name and assay_type required)
          and may have a <b className="font-medium text-foreground">Results</b> sheet (columns result_name, analyte, unit, value_type). Formulas and macros are not read.
        </p>
      </section>

      {preview.error && <p role="alert" className={errorClass}>{preview.error.message}</p>}
      {preview.data && <PreviewView preview={preview.data} />}

      {preview.data && (
        <div className="flex flex-wrap items-center justify-end gap-3 rounded-md border bg-muted/40 px-4 py-3">
          {confirm.error && <p role="alert" className="mr-auto text-xs text-destructive">{confirm.error.message}</p>}
          {!preview.data.can_import && <p className="mr-auto text-xs text-muted-foreground">Fix the workbook and choose it again. Nothing has been created.</p>}
          <Button asChild variant="ghost" size="sm"><Link to="/assays">Cancel</Link></Button>
          <Button size="sm" disabled={!preview.data.can_import || confirm.isPending} onClick={() => file && confirm.mutate(file)}>
            <CircleCheck aria-hidden="true" />{confirm.isPending ? 'Creating…' : 'Create assay'}
          </Button>
        </div>
      )}
    </div>
  )
}

function PreviewView({ preview }: { preview: AssayImportPreview }) {
  const definition = preview.definition
  return (
    <section aria-label="Preview" className="rounded-md border bg-card shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2">
        <h2 className="text-[13px] font-semibold tracking-tight">{preview.can_import ? 'This workbook will create' : 'This workbook cannot be imported'}</h2>
        <span className="text-xs text-muted-foreground">Sheets: {preview.source.sheets.join(', ') || 'none'} · <SecondaryCode>sha256 {preview.source.sha256.slice(0, 12)}…</SecondaryCode></span>
      </div>
      {preview.problems.length > 0 && (
        <ul aria-label="Problems" className="space-y-1 border-b bg-destructive/5 px-4 py-2 text-[13px] text-destructive">
          {preview.problems.map(problem => <li key={problem} className="flex items-start gap-1.5"><TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />{problem}</li>)}
        </ul>
      )}
      {definition && (
        <div className="grid gap-4 px-4 py-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <dl className="grid gap-x-6 text-[13px] sm:grid-cols-2">
            <Item label="Name">{definition.assay_name}</Item>
            <Item label="Type">{definition.assay_type}</Item>
            <Item label="Code">{definition.assay_code ? <SecondaryCode>{definition.assay_code}</SecondaryCode> : <span className="text-muted-foreground">generated from the name</span>}</Item>
            <Item label="Target">{definition.target}</Item>
            <Item label="Kit">{definition.kit}</Item>
            <Item label="Instrument">{definition.instrument}</Item>
            <Item label="Typical volume"><QuantityValue value={definition.typical_volume} unit={definition.typical_volume_unit} /></Item>
            <Item label="Procedure notes" wide>{definition.description}</Item>
          </dl>
          <div>
            <h3 className="mb-1 text-xs font-medium text-muted-foreground">Results reported</h3>
            {definition.expected_results.length ? (
              <table className="w-full text-[13px]">
                <thead className="text-left text-xs text-muted-foreground"><tr>{['Analyte', 'Result', 'Unit', 'Value'].map(label => <th key={label} className="border-b py-1 pr-2 font-medium">{label}</th>)}</tr></thead>
                <tbody>{definition.expected_results.map((result, index) => <tr key={index}><td className="border-b py-1 pr-2">{result.analyte}</td><td className="border-b py-1 pr-2 font-medium">{result.result_name}</td><td className="border-b py-1 pr-2">{result.unit}</td><td className="border-b py-1 pr-2 text-muted-foreground">{result.value_type}</td></tr>)}</tbody>
              </table>
            ) : <p className="text-[13px] text-muted-foreground">No Results sheet.</p>}
          </div>
        </div>
      )}
    </section>
  )
}

function Item({ label, wide = false, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={`grid grid-cols-[7.5rem_1fr] items-baseline gap-2 border-b py-1.5 ${wide ? 'sm:col-span-2' : ''}`}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children || <span className="text-muted-foreground/60">—</span>}</dd>
    </div>
  )
}
