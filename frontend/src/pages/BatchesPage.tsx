import { useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { FileSpreadsheet, TriangleAlert } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { api } from '../api'
import { ListTable } from '../components/ListTable'
import { TemplateDownload } from '../components/TemplateDownload'
import { errorClass, PageHeader } from '../components/common'
import type { BatchSampleImportPreview } from '../types'

export function BatchesPage() {
  const input = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const query = useQuery({ queryKey: ['batches'], queryFn: api.listBatches })
  // A workbook LACV could not use: its problems are listed here, and nothing moves on to the confirm page.
  const [refused, setRefused] = useState<BatchSampleImportPreview | null>(null)
  const upload = useMutation({
    mutationFn: (file: File) => api.previewSampleBatchImport(file),
    onMutate: () => setRefused(null),
    onSuccess: preview => {
      if (preview.can_import) navigate('/batches/import/confirm', { state: { preview } })
      else setRefused(preview)
    },
  })

  return (
    <section>
      <PageHeader
        title="Batches"
        description="Shipping batches of root samples."
        actions={<>
          <TemplateDownload
            label="Sample batch template"
            templateUrl={api.batchTemplateUrl()}
            queryKey={['batch-template-doc']}
            loadDoc={api.describeBatchTemplate}
          />
          <input ref={input} type="file" accept=".xlsx" aria-label="Batch workbook" className="sr-only" onChange={event => { const file = event.target.files?.[0]; if (file) upload.mutate(file); event.target.value = '' }} />
          <Button type="button" size="sm" disabled={upload.isPending} onClick={() => input.current?.click()}>
            <FileSpreadsheet aria-hidden="true" />{upload.isPending ? 'Reading…' : 'Import XLSX'}
          </Button>
        </>}
      />
      {upload.error && <p role="alert" className={`${errorClass} mb-4`}>{upload.error.message}</p>}
      {refused && (
        <div role="alert" className={`${errorClass} mb-4 space-y-1`}>
          <p className="flex items-center gap-1.5 font-semibold"><TriangleAlert aria-hidden="true" className="size-4" />{refused.file_name} cannot be imported. Nothing was saved.</p>
          <ul className="list-disc space-y-0.5 pl-6">{refused.problems.map(problem => <li key={problem}>{problem}</li>)}</ul>
          <p className="text-xs">Fix the workbook and choose it again. The sample batch template shows the expected columns.</p>
        </div>
      )}
      {query.isLoading ? <p className="py-6 text-sm text-muted-foreground">Loading batches…</p> : query.error ? <p role="alert" className={errorClass}>Could not load batches. {query.error.message}</p> : (
        <ListTable
          rows={query.data ?? []}
          searchPlaceholder="Filter batches by name, code, or description"
          getRowKey={batch => batch.batch_id}
          emptyMessage="No batches match your filter."
          columns={[
            { key: 'batch_code', label: 'Batch', value: batch => batch.batch_code, render: batch => <Link className="font-mono text-[13px] font-semibold text-foreground decoration-primary/40 underline-offset-2 hover:text-primary hover:underline" to={`/batch/${batch.batch_id}`}>{batch.batch_code}</Link> },
            { key: 'batch_name', label: 'Name', value: batch => batch.batch_name },
            { key: 'sample_count', label: 'Root samples', numeric: true, value: batch => batch.sample_count },
            { key: 'description', label: 'Description', value: batch => batch.description },
          ]}
        />
      )}
    </section>
  )
}
