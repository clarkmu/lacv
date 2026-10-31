import { FormEvent, useState } from 'react'
import type { ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FileText, FlaskConical } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api } from '../api'
import { errorClass, inputClass, Panel, SecondaryCode, StatusBadge } from '../components/common'
import { SampleActivity } from '../components/sample/SampleActivity'
import { SampleIdentity } from '../components/sample/SampleIdentity'
import { SampleLineage } from '../components/sample/SampleLineage'
import { SampleProperties } from '../components/sample/SampleProperties'
import { SpecimenState } from '../components/sample/SpecimenState'
import { formatDateTime } from '../format'
import type { SampleDetail } from '../types'

/** The Sample workspace: identity and physical state first, then lineage and history, with every field editable alongside. */
export function SamplePage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const client = useQueryClient()
  const query = useQuery({ queryKey: ['sample', id], queryFn: () => api.getSample(id) })
  const lineage = useQuery({ queryKey: ['sample-lineage', id], queryFn: () => api.getSampleLineage(id) })
  const remove = useMutation({
    mutationFn: () => api.deleteSample(Number(id)),
    onSuccess: () => { client.invalidateQueries({ queryKey: ['samples'] }); navigate('/samples') },
  })

  if (query.isLoading) return <p className="py-6 text-sm text-muted-foreground">Loading sample…</p>
  if (!query.data) return <p className="py-6 text-sm text-muted-foreground">Sample not found.</p>
  const sample = query.data

  return (
    <div className="space-y-4">
      <SampleIdentity
        sample={sample}
        ancestors={lineage.data?.ancestors ?? (sample.parent ? [sample.parent] : [])}
        isDeleting={remove.isPending}
        onDelete={() => { if (confirm(`Delete ${sample.sample_code}?`)) remove.mutate() }}
      />
      {remove.error && <p role="alert" className={errorClass}>{remove.error.message}</p>}

      <SpecimenState sample={sample} />

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_23rem] 2xl:grid-cols-[minmax(0,1fr)_27rem]">
        <div className="min-w-0 space-y-4">
          <SampleLineage sample={sample} lineage={lineage.data} />
          <SampleAssays sample={sample} />
          <SampleActivity sample={sample} />
          <DataFiles sample={sample} />
          {sample.legacy_identifiers.length > 0 && (
            <Panel title="Legacy identifiers" bodyClassName="p-0">
              <CompactTable
                head={['Legacy material code', 'Legacy material ID', 'Resolution', 'Migrated']}
                rows={sample.legacy_identifiers.map(item => [
                  <SecondaryCode key="code" className="text-foreground">{item.material_code}</SecondaryCode>, item.legacy_material_id,
                  item.resolution === 'matched' ? 'Same physical sample' : 'Became this derived sample', formatDateTime(item.migrated_at),
                ])}
              />
            </Panel>
          )}
        </div>
        <SampleProperties sample={sample} />
      </div>
    </div>
  )
}

function SampleAssays({ sample }: { sample: SampleDetail }) {
  return (
    <Panel
      title="Assays"
      bodyClassName="p-0"
      action={<Button asChild variant="ghost" size="sm" className="h-7 text-primary hover:text-primary"><Link to={`/sample/${sample.sample_id}/assays/new`}><FlaskConical aria-hidden="true" />Record assay</Link></Button>}
    >
      {sample.generated_by_assays.length > 0 && (
        <p className="border-b px-3 py-2 text-xs text-muted-foreground">
          Produced by assay {sample.generated_by_assays.map(assay => <Link key={assay.execution_id} className="font-mono text-primary hover:underline" to={`/assay-executions/${assay.execution_id}`}>{assay.execution_code}</Link>)}
        </p>
      )}
      {sample.assays.length ? (
        <CompactTable
          head={['Execution', 'Assay', 'Type', 'Date', 'Status', 'QC', 'Results']}
          numericColumns={[6]}
          rows={sample.assays.map(assay => [
            <Link key="code" className="font-mono font-medium text-primary hover:underline" to={`/assay-executions/${assay.execution_id}`}>{assay.execution_code}</Link>,
            <Link key="assay" className="hover:text-primary hover:underline" to={`/assays/${assay.assay_definition_id}`}>{assay.assay_name}</Link>,
            assay.assay_type, <span key="date" className="text-muted-foreground tabular-nums">{formatDateTime(assay.assay_date)}</span>,
            <StatusBadge key="status" status={assay.status} />, <StatusBadge key="qc" status={assay.qc_status} />, assay.result_count,
          ])}
        />
      ) : <p className="px-3 py-3 text-sm text-muted-foreground">No assays on this sample.</p>}
    </Panel>
  )
}

function DataFiles({ sample }: { sample: SampleDetail }) {
  const client = useQueryClient()
  const [draft, setDraft] = useState({ file_name: '', file_type: '', file_location: '', assay_id: '' })
  const attach = useMutation({
    mutationFn: () => api.attachDataFile(sample.sample_id, {
      file_name: draft.file_name, file_type: draft.file_type, file_location: draft.file_location, assay_id: draft.assay_id ? Number(draft.assay_id) : null,
    }),
    onSuccess: data => { client.setQueryData(['sample', String(sample.sample_id)], data); setDraft({ file_name: '', file_type: '', file_location: '', assay_id: '' }) },
  })

  function submit(event: FormEvent) {
    event.preventDefault()
    attach.mutate()
  }

  return (
    <Panel title="Files" bodyClassName="p-0">
      {sample.data_files.length ? (
        <CompactTable
          head={['File', 'Type', 'Location', 'Assay', 'Added']}
          rows={sample.data_files.map(file => [
            <span key="name" className="inline-flex items-center gap-1.5"><FileText aria-hidden="true" className="size-3.5 text-muted-foreground" />{file.file_name}</span>,
            file.file_type, <SecondaryCode key="loc">{file.file_location}</SecondaryCode>,
            sample.assays.find(assay => assay.execution_id === file.assay_id)?.execution_code ?? '', <span key="added" className="text-muted-foreground tabular-nums">{formatDateTime(file.created_at)}</span>,
          ])}
        />
      ) : <p className="px-3 pt-3 text-sm text-muted-foreground">No files attached.</p>}
      <form onSubmit={submit} className="flex flex-wrap items-center gap-2 p-3" aria-label="Attach file">
        <input required placeholder="File name" value={draft.file_name} onChange={e => setDraft(d => ({ ...d, file_name: e.target.value }))} className={inputClass} />
        <input required placeholder="Type" value={draft.file_type} onChange={e => setDraft(d => ({ ...d, file_type: e.target.value }))} className={`${inputClass} w-28`} />
        <input required placeholder="Location / path" value={draft.file_location} onChange={e => setDraft(d => ({ ...d, file_location: e.target.value }))} className={`${inputClass} min-w-56 flex-1 font-mono`} />
        <select value={draft.assay_id} onChange={e => setDraft(d => ({ ...d, assay_id: e.target.value }))} className={inputClass}>
          <option value="">No assay</option>
          {sample.assays.map(assay => <option key={assay.execution_id} value={assay.execution_id}>{assay.execution_code} · {assay.assay_name}</option>)}
        </select>
        <Button variant="outline" size="sm" disabled={attach.isPending}>Attach file</Button>
      </form>
      {attach.error && <p role="alert" className={`${errorClass} mx-3 mb-3`}>{attach.error.message}</p>}
    </Panel>
  )
}

function CompactTable({ head, rows, numericColumns = [] }: { head: string[]; rows: ReactNode[][]; numericColumns?: number[] }) {
  return (
    <Table className="text-[13px]">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          {head.map((label, index) => <TableHead key={label} className={`h-8 bg-muted/60 px-3 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase ${numericColumns.includes(index) ? 'text-right' : ''}`}>{label}</TableHead>)}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, rowIndex) => (
          <TableRow key={rowIndex} className="hover:bg-accent/50">
            {row.map((cell, index) => <TableCell key={index} className={`px-3 py-1.5 ${numericColumns.includes(index) ? 'text-right tabular-nums' : ''}`}>{cell}</TableCell>)}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
