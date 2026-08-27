import { useRef } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { ListTable } from '../components/ListTable'

export function BatchesPage() {
  const input = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const query = useQuery({ queryKey: ['batches'], queryFn: api.listBatches })
  const upload = useMutation({
    mutationFn: (file: File) => api.previewSampleBatchImport(file),
    onSuccess: (preview, file) => navigate('/batches/import/confirm', { state: { samples: preview.samples, fileName: file.name } }),
  })
  return <section>
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-semibold">Batches</h1><p className="mt-1 text-sm text-slate-500">Accession and workflow groupings.</p></div><div className="flex flex-wrap gap-2"><a href="/api/batches/sample-template" download className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Download sample batch file</a><input ref={input} type="file" accept=".xlsx" className="hidden" onChange={event => { const file = event.target.files?.[0]; if (file) upload.mutate(file); event.target.value = '' }} /><button onClick={() => input.current?.click()} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white">{upload.isPending ? 'Loading…' : 'Import XLSX'}</button></div></div>
    {upload.error && <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{upload.error.message}</p>}
    {query.isLoading ? <p>Loading batches…</p> : <ListTable
      rows={query.data ?? []}
      searchPlaceholder="Search batches by name, code, or active state"
      getRowKey={batch => batch.batch_id}
      emptyMessage="No batches match your search."
      columns={[
        { key: 'batch_code', label: 'Batch', value: batch => batch.batch_code, render: batch => <Link className="font-medium text-blue-700 hover:underline" to={`/batch/${batch.batch_id}`}>{batch.batch_code}</Link> },
        { key: 'batch_name', label: 'Name', value: batch => batch.batch_name },
        { key: 'is_active', label: 'Active', value: () => true },
      ]}
    />}
  </section>
}
